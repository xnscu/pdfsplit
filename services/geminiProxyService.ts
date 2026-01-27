/**
 * Gemini Proxy Service
 * Sends requests to the worker which transparently proxies to Gemini API
 * Handles key rotation from the pool and statistics tracking
 */

import { DetectedQuestion, QuestionAnalysis } from "../types";
import { PROMPTS, SCHEMAS, MODEL_IDS } from "../shared/ai-config.js";
import { getNextKey, recordCall, recordSuccess, recordFailure, isKeyPoolEmpty } from "./keyPoolService";
import { imageRefToInlineImageData, isDataUrl } from "./imageRef";

// Worker API base URL
const getApiBase = () => {
  // In development, use relative URL (same origin)
  // In production, it will also work since worker serves the frontend
  return "/api";
};

// Gemini API base URL
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Convert any image reference to base64 data (without data URL prefix)
 * Handles: data URLs (extract base64), r2:// references, http URLs
 */
const resolveImageToBase64 = async (imageRef: string): Promise<{ mimeType: string; data: string }> => {
  if (isDataUrl(imageRef)) {
    // Extract mimeType and data from data URL
    const match = imageRef.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { mimeType: match[1], data: match[2] };
    }
    throw new Error("Invalid data URL format");
  }

  // Need to fetch and convert to base64
  return imageRefToInlineImageData(imageRef);
};

interface GeminiProxyRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
}

/**
 * Make a request through the Gemini proxy endpoint on the worker
 */
const callGeminiProxy = async (request: GeminiProxyRequest, signal?: AbortSignal): Promise<any> => {
  const response = await fetch(`${getApiBase()}/gemini/proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal,
  });

  // Get response text first
  const responseText = await response.text();

  // Parse JSON
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`Invalid JSON response: ${responseText.slice(0, 200)}`);
  }

  // Check for errors
  if (!response.ok || data.error) {
    const errorMessage = data.error?.message || data.error || `HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  return data;
};

/**
 * Build Gemini API request body for generateContent
 */
const buildGenerateContentRequest = (mimeType: string, imageData: string, prompt: string, responseSchema: any) => {
  return {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: imageData,
            },
          },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
    },
  };
};

/**
 * Detects questions on a single image with automatic retry logic.
 * Routes through worker proxy using key pool
 */
export const detectQuestionsViaProxy = async (
  image: string,
  modelId: string = MODEL_IDS.PRO,
  maxRetries: number = 5,
  fallbackApiKey?: string,
  signal?: AbortSignal
): Promise<DetectedQuestion[]> => {
  let attempt = 0;

  // Resolve image reference to base64 before retry loop
  const { mimeType, data: imageData } = await resolveImageToBase64(image);

  // Build response schema for detection
  const responseSchema = {
    type: "ARRAY",
    items: SCHEMAS.BASIC,
  };

  while (attempt < maxRetries) {
    // Check if aborted
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    // Get next key from pool, or use fallback
    const apiKey = isKeyPoolEmpty() ? fallbackApiKey : getNextKey();
    if (!apiKey) {
      throw new Error("No API key available. Please configure API keys in settings.");
    }

    // Record the call attempt
    recordCall(apiKey);

    try {
      // Build the Gemini API URL with API key
      const url = `${GEMINI_API_BASE}/${modelId}:generateContent?key=${apiKey}`;

      // Build request body
      const requestBody = buildGenerateContentRequest(mimeType, imageData, PROMPTS.BASIC, responseSchema);

      const result = await callGeminiProxy(
        {
          url,
          method: "POST",
          body: requestBody,
        },
        signal
      );

      // Check if aborted after request completes
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      // Extract text from Gemini response
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("Empty response from AI");
      }

      // Parse the JSON response
      const data = JSON.parse(text);
      if (!Array.isArray(data)) {
        throw new Error("Invalid response format: Expected Array");
      }

      // Record success
      recordSuccess(apiKey);
      return data as DetectedQuestion[];
    } catch (error: any) {
      // If aborted, propagate immediately
      if (error.name === "AbortError" || signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      // Record failure
      recordFailure(apiKey);

      attempt++;
      const isRateLimit = error?.message?.includes("429") || error?.message?.includes("rate");
      const waitTime = isRateLimit ? Math.pow(2, attempt) * 1000 : 2000;

      console.warn(
        `Gemini detection attempt ${attempt} failed (key: ${apiKey.slice(0, 8)}...): ${error.message}. Retrying in ${waitTime}ms...`
      );

      if (attempt >= maxRetries) {
        throw new Error(`AI 识别在 ${maxRetries} 次重试后仍然失败: ${error.message}`);
      }

      // Wait with abort check
      await Promise.race([
        delay(waitTime),
        new Promise((_, reject) => {
          if (signal) {
            const abortHandler = () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            };
            signal.addEventListener("abort", abortHandler, { once: true });
          }
        }),
      ]).catch(() => {
        throw new DOMException("The operation was aborted.", "AbortError");
      });
    }
  }
  return [];
};

/**
 * Analyzes a single math question image to extract solution, difficulty, etc.
 * Routes through worker proxy using key pool
 */
export const analyzeQuestionViaProxy = async (
  image: string,
  modelId: string = MODEL_IDS.FLASH,
  maxRetries: number = 3,
  fallbackApiKey?: string,
  signal?: AbortSignal
): Promise<QuestionAnalysis> => {
  let attempt = 0;

  // Resolve image reference to base64 before retry loop
  const { mimeType, data: imageData } = await resolveImageToBase64(image);

  while (attempt < maxRetries) {
    // Check if aborted
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    // Get next key from pool, or use fallback
    const apiKey = isKeyPoolEmpty() ? fallbackApiKey : getNextKey();
    if (!apiKey) {
      throw new Error("No API key available. Please configure API keys in settings.");
    }

    // Record the call attempt
    recordCall(apiKey);

    try {
      // Build the Gemini API URL with API key
      const url = `${GEMINI_API_BASE}/${modelId}:generateContent?key=${apiKey}`;

      // Build request body
      const requestBody = buildGenerateContentRequest(mimeType, imageData, PROMPTS.ANALYSIS, SCHEMAS.ANALYSIS);

      const result = await callGeminiProxy(
        {
          url,
          method: "POST",
          body: requestBody,
        },
        signal
      );

      // Check if aborted after request completes
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      // Extract text from Gemini response
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("Empty response from AI");
      }

      // Parse the JSON response
      const data = JSON.parse(text);

      // Record success
      recordSuccess(apiKey);
      return data as QuestionAnalysis;
    } catch (error: any) {
      // If aborted, propagate immediately
      if (error.name === "AbortError" || signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      // Record failure
      recordFailure(apiKey);

      attempt++;
      const isRateLimit = error?.message?.includes("429") || error?.message?.includes("rate");
      const waitTime = isRateLimit ? Math.pow(2, attempt) * 1000 : 2000;

      console.warn(
        `Gemini analysis attempt ${attempt} failed (key: ${apiKey.slice(0, 8)}...): ${error.message}. Retrying...`
      );

      if (attempt >= maxRetries) {
        throw error;
      }

      // Wait with abort check
      await Promise.race([
        delay(waitTime),
        new Promise((_, reject) => {
          if (signal) {
            const abortHandler = () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            };
            signal.addEventListener("abort", abortHandler, { once: true });
          }
        }),
      ]).catch(() => {
        throw new DOMException("The operation was aborted.", "AbortError");
      });
    }
  }
  throw new Error("Analysis failed");
};
