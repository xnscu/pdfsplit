/**
 * Gemini Proxy Service
 * Supports both direct browser requests and Worker proxy mode
 * Handles key rotation from the pool and statistics tracking
 */

import { GoogleGenAI, Type } from "@google/genai";
import { DetectedQuestion, QuestionAnalysis } from "../types";
import { PROMPTS, SCHEMAS, MODEL_IDS } from "../shared/ai-config.js";
import { getNextKey, recordCall, recordSuccess, recordFailure, isKeyPoolEmpty } from "./keyPoolService";
import { imageRefToInlineImageData, isDataUrl } from "./imageRef";
import { STORAGE_KEYS } from "../hooks/useExamState";

// Worker API base URL
const getApiBase = () => {
  return "/api";
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Check if proxy mode is enabled (from localStorage)
 */
const isProxyEnabled = (): boolean => {
  if (typeof localStorage === 'undefined') return true;
  const saved = localStorage.getItem(STORAGE_KEYS.USE_GEMINI_PROXY);
  // Default to true (use proxy) for backward compatibility
  return saved !== null ? saved === "true" : true;
};

/**
 * Convert any image reference to base64 data (without data URL prefix)
 * Handles: data URLs (extract base64), r2:// references, http URLs
 */
const resolveImageToBase64 = async (imageRef: string): Promise<{ mimeType: string; data: string }> => {
  if (isDataUrl(imageRef)) {
    const match = imageRef.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { mimeType: match[1], data: match[2] };
    }
    throw new Error("Invalid data URL format");
  }
  return imageRefToInlineImageData(imageRef);
};


/**
 * Helper to execute a Gemini call using the SDK with retry logic
 */
const executeGeminiCall = async <T>(
  fn: (ai: GoogleGenAI, mimeType: string, imageData: string) => Promise<T>,
  image: string,
  maxRetries: number,
  fallbackApiKey: string | undefined,
  signal: AbortSignal | undefined
): Promise<T> => {
  let attempt = 0;
  
  const { mimeType, data: imageData } = await resolveImageToBase64(image);

  while (attempt < maxRetries) {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const apiKey = isKeyPoolEmpty() ? fallbackApiKey : getNextKey();
    if (!apiKey) {
      throw new Error("No API key available. Please configure API keys in settings.");
    }

    recordCall(apiKey);

    try {
      // Configure SDK
      // If proxy is enabled, use the worker endpoint. Otherwise use default (undefined).
      const baseURL = (isProxyEnabled() && typeof window !== 'undefined')
        ? `${window.location.origin}${getApiBase()}/gemini` 
        : undefined;

      // Note: The SDK expects httpOptions.baseUrl, not a top-level baseURL in GoogleGenAIOptions
      // Ref: node_modules/@google/genai/dist/genai.d.ts lines 5004, 5418
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: baseURL ? { baseUrl: baseURL } : undefined,
      });

      const result = await fn(ai, mimeType, imageData);

      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      
      recordSuccess(apiKey);
      return result;

    } catch (error: any) {
      if (error.name === "AbortError" || signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      recordFailure(apiKey);
      attempt++;
      
      const isRateLimit = error?.message?.includes("429") || error?.message?.includes("rate") || error.status === 429;
      const waitTime = isRateLimit ? Math.pow(2, attempt) * 1000 : 2000;

      console.warn(
        `Gemini attempt ${attempt} failed (key: ${apiKey.slice(0, 8)}...): ${error.message}. Retrying in ${waitTime}ms...`
      );

      if (attempt >= maxRetries) {
        throw new Error(`AI Request failed after ${maxRetries} attempts: ${error.message}`);
      }

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
  throw new Error("Request failed");
};

/**
 * Detects questions on a single image with automatic retry logic.
 */
export const detectQuestionsViaProxy = async (
  image: string,
  modelId: string = MODEL_IDS.PRO,
  maxRetries: number = 5,
  fallbackApiKey?: string,
  signal?: AbortSignal
): Promise<DetectedQuestion[]> => {
  return executeGeminiCall(async (ai, mimeType, imageData) => {
    // Generate content using stream to avoid timeouts
    const response = await ai.models.generateContentStream({
      model: modelId,
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: imageData,
              },
            },
            { text: PROMPTS.BASIC },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: SCHEMAS.BASIC as any,
        },
      },
    });

    let fullText = "";
    for await (const chunk of response) {
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      fullText += chunk.text;
    }

    if (!fullText) {
      throw new Error("Empty response from AI");
    }

    const data = JSON.parse(fullText);
    if (!Array.isArray(data)) {
      throw new Error("Invalid response format: Expected Array");
    }
    return data as DetectedQuestion[];
  }, image, maxRetries, fallbackApiKey, signal);
};

/**
 * Analyzes a single math question image to extract solution, difficulty, etc.
 */
export const analyzeQuestionViaProxy = async (
  image: string,
  modelId: string = MODEL_IDS.FLASH,
  maxRetries: number = 3,
  fallbackApiKey?: string,
  signal?: AbortSignal
): Promise<QuestionAnalysis> => {
  return executeGeminiCall(async (ai, mimeType, imageData) => {
    const response = await ai.models.generateContentStream({
      model: modelId,
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: imageData,
              },
            },
            { text: PROMPTS.ANALYSIS },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: SCHEMAS.ANALYSIS as any,
      },
    });

    let fullText = "";
    for await (const chunk of response) {
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      fullText += chunk.text;
    }

    if (!fullText) {
      throw new Error("Empty response from AI");
    }

    return JSON.parse(fullText) as QuestionAnalysis;
  }, image, maxRetries, fallbackApiKey, signal);
};
