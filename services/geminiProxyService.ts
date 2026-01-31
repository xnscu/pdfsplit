/**
 * Gemini Proxy Service
 * Supports both direct browser requests and Worker proxy mode
 * Handles key rotation from the pool and statistics tracking
 */

import { DetectedQuestion, QuestionAnalysis } from "../types";
import { PROMPTS, SCHEMAS, MODEL_IDS } from "../shared/ai-config.js";
import { getNextKey, recordCall, recordSuccess, recordFailure, isKeyPoolEmpty } from "./keyPoolService";
import { imageRefToInlineImageData, isDataUrl } from "./imageRef";
import { STORAGE_KEYS } from "../hooks/useExamState";

// Worker API base URL
const getApiBase = () => {
  return "/api";
};

// Gemini API base URL
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Check if proxy mode is enabled (from localStorage)
 */
const isProxyEnabled = (): boolean => {
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
 * Make a request through the Gemini proxy endpoint on the worker (non-streaming)
 */


/**
 * Make a streaming request through the Gemini proxy endpoint
 * Uses streamGenerateContent API to avoid Cloudflare 524 timeout
 * Returns accumulated response from all chunks
 */
const callViaProxyStream = async (url: string, body: any, signal?: AbortSignal): Promise<any> => {
  // 1. Force use of streamGenerateContent to avoid timeouts
  // Replace the method in the URL, e.g. ...:generateContent -> ...:streamGenerateContent
  let streamUrl = url;
  if (url.includes(":generateContent")) {
    streamUrl = url.replace(":generateContent", ":streamGenerateContent");
  } else if (!url.includes(":streamGenerateContent")) {
    // Fallback if URL structure is unexpected, though usually it will match above
    streamUrl = url + "?alt=sse"; // or similar, but Gemini uses :streamGenerateContent
  }

  // 2. Rewrite URL to point to our transparent proxy
  // https://generativelanguage.googleapis.com/... -> /api/gemini/...
  const proxyUrl = streamUrl.replace("https://generativelanguage.googleapis.com", `${getApiBase()}/gemini`);

  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage;
    try {
      const errorData = JSON.parse(errorText);
      errorMessage = errorData.error?.message || errorData.error || `HTTP ${response.status}`;
    } catch {
      errorMessage = errorText || `HTTP ${response.status}`;
    }
    throw new Error(errorMessage);
  }

  if (!response.body) {
    throw new Error("No response body");
  }

  // Read the streaming response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Collect all chunks
  const chunks: any[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (signal?.aborted) {
      reader.cancel();
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process buffer to extract complete JSON objects
    // We look for top-level objects enclosed in {}
    let braceCount = 0;
    let startIndex = -1;
    let handledIndex = 0;
    let inString = false;
    let escaped = false;

    // Simple parser to find matching braces while ignoring braces inside strings
    for (let i = 0; i < buffer.length; i++) {
      const char = buffer[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === "{") {
        if (braceCount === 0) {
          startIndex = i;
        }
        braceCount++;
      } else if (char === "}") {
        braceCount--;
        if (braceCount === 0 && startIndex !== -1) {
          // Found a complete object
          const jsonStr = buffer.substring(startIndex, i + 1);
          try {
            const chunk = JSON.parse(jsonStr);
            // Verify it's a valid chunk before adding
            if (chunk.candidates || chunk.usageMetadata || chunk.error) {
              chunks.push(chunk);
            }
          } catch (e) {
            console.debug("[Stream] JSON parse error for chunk:", e);
          }
          startIndex = -1;
          handledIndex = i + 1;
        }
      }
    }

    // Remove processed part from buffer, keep the rest for next read
    if (handledIndex > 0) {
      buffer = buffer.slice(handledIndex);
    }
  }

  // Handle any valid object left in buffer (rare case if stream ends perfectly)
  if (buffer.trim()) {
      try {
        const trimmed = buffer.trim();
        // Remove potential trailing brackets/commas if it looks like a valid object inside
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            const chunk = JSON.parse(trimmed);
            if (chunk.candidates || chunk.usageMetadata) {
                chunks.push(chunk);
            }
        }
      } catch (e) {
          // Ignore
      }
  }

  if (chunks.length === 0) {
    console.error("Stream buffer dump:", buffer); // Debug info
    throw new Error("No valid chunks received from stream");
  }

  // Merge all chunks into a single response
  // We need to handle cases where text might be empty (e.g. thinking models)
  const lastChunk = chunks[chunks.length - 1];

  // Combine all text from all chunks
  let combinedText = "";
  for (const chunk of chunks) {
    const parts = chunk.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.text) {
        combinedText += part.text;
      }
    }
  }

  // Return in the same format as non-streaming response
  return {
    candidates: [
      {
        content: {
          parts: [{ text: combinedText }],
          role: lastChunk.candidates?.[0]?.content?.role || "model",
        },
        finishReason: lastChunk.candidates?.[0]?.finishReason || "STOP",
      },
    ],
    usageMetadata: lastChunk.usageMetadata,
  };
};

/**
 * Make a direct request to Gemini API (browser direct)
 */
const callDirect = async (url: string, body: any, signal?: AbortSignal): Promise<any> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`Invalid JSON response: ${responseText.slice(0, 200)}`);
  }

  if (!response.ok || data.error) {
    const errorMessage = data.error?.message || data.error || `HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  return data;
};

/**
 * Unified call function - chooses between proxy (streaming) and direct based on settings
 * When using proxy mode, always uses streaming to avoid Cloudflare 524 timeout
 */
const callGemini = async (url: string, body: any, signal?: AbortSignal): Promise<any> => {
  if (isProxyEnabled()) {
    console.log("[Gemini] Using Worker proxy mode with streaming");
    return callViaProxyStream(url, body, signal);
  } else {
    console.log("[Gemini] Using direct browser mode");
    return callDirect(url, body, signal);
  }
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
 */
export const detectQuestionsViaProxy = async (
  image: string,
  modelId: string = MODEL_IDS.PRO,
  maxRetries: number = 5,
  fallbackApiKey?: string,
  signal?: AbortSignal
): Promise<DetectedQuestion[]> => {
  let attempt = 0;

  const { mimeType, data: imageData } = await resolveImageToBase64(image);

  const responseSchema = {
    type: "ARRAY",
    items: SCHEMAS.BASIC,
  };

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
      const url = `${GEMINI_API_BASE}/${modelId}:generateContent?key=${apiKey}`;
      const requestBody = buildGenerateContentRequest(mimeType, imageData, PROMPTS.BASIC, responseSchema);

      const result = await callGemini(url, requestBody, signal);

      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("Empty response from AI");
      }

      const data = JSON.parse(text);
      if (!Array.isArray(data)) {
        throw new Error("Invalid response format: Expected Array");
      }

      recordSuccess(apiKey);
      return data as DetectedQuestion[];
    } catch (error: any) {
      if (error.name === "AbortError" || signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

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
 */
export const analyzeQuestionViaProxy = async (
  image: string,
  modelId: string = MODEL_IDS.FLASH,
  maxRetries: number = 3,
  fallbackApiKey?: string,
  signal?: AbortSignal
): Promise<QuestionAnalysis> => {
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
      const url = `${GEMINI_API_BASE}/${modelId}:generateContent?key=${apiKey}`;
      const requestBody = buildGenerateContentRequest(mimeType, imageData, PROMPTS.ANALYSIS, SCHEMAS.ANALYSIS);

      const result = await callGemini(url, requestBody, signal);

      if (signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("Empty response from AI");
      }

      const data = JSON.parse(text);

      recordSuccess(apiKey);
      return data as QuestionAnalysis;
    } catch (error: any) {
      if (error.name === "AbortError" || signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

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
