/**
 * Gemini Proxy Service
 * Sends requests to the worker which proxies Gemini API calls
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Convert any image reference to a base64 data URL
 * Handles: data URLs (pass through), r2:// references, http URLs
 */
const resolveImageToDataUrl = async (imageRef: string): Promise<string> => {
  // Already a data URL, pass through
  if (isDataUrl(imageRef)) {
    return imageRef;
  }

  // Need to fetch and convert to base64
  const { mimeType, data } = await imageRefToInlineImageData(imageRef);
  return `data:${mimeType};base64,${data}`;
};

interface GeminiProxyRequest {
  apiKey: string;
  modelId: string;
  image: string;
  prompt: string;
  responseSchema: any;
  requestType: "detection" | "analysis";
}

/**
 * Make a request to the Gemini proxy endpoint on the worker
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

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
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

  // Resolve image reference to base64 data URL before retry loop
  // This handles r2:// references, http URLs, etc.
  const resolvedImage = await resolveImageToDataUrl(image);

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
      const result = await callGeminiProxy(
        {
          apiKey,
          modelId,
          image: resolvedImage,
          prompt: PROMPTS.BASIC,
          responseSchema: {
            type: "ARRAY",
            items: SCHEMAS.BASIC,
          },
          requestType: "detection",
        },
        signal
      );

      // Check if aborted after request completes
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      if (!Array.isArray(result.data)) {
        throw new Error("Invalid response format: Expected Array");
      }

      // Record success
      recordSuccess(apiKey);
      return result.data as DetectedQuestion[];
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

  // Resolve image reference to base64 data URL before retry loop
  // This handles r2:// references, http URLs, etc.
  const resolvedImage = await resolveImageToDataUrl(image);

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
      const result = await callGeminiProxy(
        {
          apiKey,
          modelId,
          image: resolvedImage,
          prompt: PROMPTS.ANALYSIS,
          responseSchema: SCHEMAS.ANALYSIS,
          requestType: "analysis",
        },
        signal
      );

      // Check if aborted after request completes
      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      // Record success
      recordSuccess(apiKey);
      return result.data as QuestionAnalysis;
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
