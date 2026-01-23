
import { GoogleGenAI, Type } from "@google/genai";
import { DetectedQuestion, QuestionAnalysis } from "../types";
import { PROMPTS, SCHEMAS, MODEL_IDS } from "../shared/ai-config.js";

const getAiClient = (apiKey?: string) => {
  const key = apiKey || process.env.API_KEY;
  if (!key) throw new Error("No API Key available");
  return new GoogleGenAI({ apiKey: key });
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Detects questions on a single image with automatic retry logic.
 */
export const detectQuestionsOnPage = async (
  image: string, 
  modelId: string = MODEL_IDS.PRO,
  maxRetries: number = 5,
  apiKey?: string
): Promise<DetectedQuestion[]> => {
  let attempt = 0;
  const ai = getAiClient(apiKey);
  
  while (attempt < maxRetries) {
    try {
      const promptText = PROMPTS.BASIC;
      const itemsSchema = SCHEMAS.BASIC;

      const response = await ai.models.generateContent({
        model: modelId,
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: image.split(',')[1]
                }
              },
              { text: promptText }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: itemsSchema
          }
        }
      });

      const text = response.text;
      if (!text) throw new Error("Empty response from AI");
      
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("Invalid response format: Expected Array");
      
      return parsed as DetectedQuestion[];
    } catch (error: any) {
      attempt++;
      const isRateLimit = error?.message?.includes('429') || error?.status === 429;
      const waitTime = isRateLimit ? Math.pow(2, attempt) * 1000 : 2000;
      
      console.warn(`Gemini detection attempt ${attempt} failed: ${error.message}. Retrying in ${waitTime}ms...`);
      
      if (attempt >= maxRetries) {
        throw new Error(`AI 识别在 ${maxRetries} 次重试后仍然失败: ${error.message}`);
      }
      
      await delay(waitTime);
    }
  }
  return [];
};

/**
 * Analyzes a single math question image to extract solution, difficulty, etc.
 */
export const analyzeQuestion = async (
  image: string,
  modelId: string = MODEL_IDS.FLASH,
  maxRetries: number = 3,
  apiKey?: string
): Promise<QuestionAnalysis> => {
  let attempt = 0;
  const ai = getAiClient(apiKey);
  
  while (attempt < maxRetries) {
    try {
      const promptText = PROMPTS.ANALYSIS;
      const response = await ai.models.generateContent({
        model: modelId,
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: image.split(',')[1]
                }
              },
              { text: promptText }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: SCHEMAS.ANALYSIS
        }
      });

      const text = response.text;
      if (!text) throw new Error("Empty response from AI Analysis");
      
      return JSON.parse(text) as QuestionAnalysis;

    } catch (error: any) {
      attempt++;
      const isRateLimit = error?.message?.includes('429') || error?.status === 429;
      const waitTime = isRateLimit ? Math.pow(2, attempt) * 1000 : 2000;
      
      console.warn(`Gemini analysis attempt ${attempt} failed: ${error.message}. Retrying...`);
      
      if (attempt >= maxRetries) {
        throw error;
      }
      await delay(waitTime);
    }
  }
  throw new Error("Analysis failed");
};
