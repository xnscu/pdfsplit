/**
 * Pro Analysis Server
 * 
 * Fetches questions without pro_analysis from D1 cloud database,
 * processes them with Gemini Pro API using key rotation,
 * and updates results back to D1. Uses exponential backoff for rate limiting.
 * 
 * Run with: node pro-analysis-server.mjs
 * Or with PM2: pm2 start pro-analysis-server.mjs --name gksx-pro-analysis
 */

import { GoogleGenAI } from '@google/genai';
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import dotenv from 'dotenv';

// Import shared config from frontend (reuse same prompt/schema)
import { PROMPTS, SCHEMAS, MODEL_IDS } from '../shared/ai-config.js';

// Load environment variables
dotenv.config();

// ============ Configuration ============

const CONFIG = {
  API_BASE_URL: process.env.API_BASE_URL || 'https://gksx.xnscu.com',
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE) || 50,
  CONCURRENCY: parseInt(process.env.CONCURRENCY) || 5,
  INITIAL_DELAY_MS: parseInt(process.env.INITIAL_DELAY_MS) || 1000,
  MAX_DELAY_MS: parseInt(process.env.MAX_DELAY_MS) || 60000,
  MAX_RETRIES_PER_QUESTION: parseInt(process.env.MAX_RETRIES_PER_QUESTION) || 3,
  MODEL_ID: process.env.MODEL_ID || MODEL_IDS.PRO,
  KEYS_FILE: process.env.KEYS_FILE || 'keys.txt',
};

// ============ Key Pool Management ============

class KeyPool {
  constructor(keysFilePath) {
    this.keys = this.loadKeys(keysFilePath);
    this.currentIndex = 0;
    this.keyDelays = new Map(); // Track per-key delay for backoff
    
    if (this.keys.length === 0) {
      throw new Error(`No API keys found in ${keysFilePath}`);
    }
    
    console.log(`[KeyPool] Loaded ${this.keys.length} API keys`);
  }
  
  loadKeys(filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`Keys file not found: ${filePath}`);
    }
    
    const content = readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')); // Skip empty lines and comments
  }
  
  getNext() {
    const key = this.keys[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    return key;
  }
  
  // Get delay for a specific key (for exponential backoff)
  getDelay(key) {
    return this.keyDelays.get(key) || CONFIG.INITIAL_DELAY_MS;
  }
  
  // Increase delay after rate limit error
  increaseDelay(key) {
    const currentDelay = this.getDelay(key);
    const newDelay = Math.min(currentDelay * 2, CONFIG.MAX_DELAY_MS);
    this.keyDelays.set(key, newDelay);
    return newDelay;
  }
  
  // Reset delay after successful call
  resetDelay(key) {
    this.keyDelays.set(key, CONFIG.INITIAL_DELAY_MS);
  }
  
  // Get key suffix for display (last 4 chars)
  getKeyPrefix(key) {
    return key.slice(-4);
  }
  
  // Get key hash for storage
  getKeyHash(key) {
    return createHash('sha256').update(key).digest('hex').slice(0, 16);
  }
}

// ============ API Client ============

class CloudAPIClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }
  
  async fetchPendingQuestions(limit) {
    const response = await fetch(`${this.baseUrl}/api/pro-analysis/pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch pending questions: ${response.status}`);
    }
    
    return response.json();
  }
  
  async updateProAnalysis(examId, questionId, proAnalysis) {
    const response = await fetch(`${this.baseUrl}/api/pro-analysis/update`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exam_id: examId,
        question_id: questionId,
        pro_analysis: proAnalysis,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to update pro_analysis: ${response.status}`);
    }
    
    return response.json();
  }
  
  async recordKeyStats(data) {
    try {
      await fetch(`${this.baseUrl}/api/key-stats/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } catch (err) {
      // Non-critical, just log
      console.warn('[Stats] Failed to record key stats:', err.message);
    }
  }
}

// ============ Gemini Analyzer ============

class GeminiAnalyzer {
  constructor(keyPool, cloudClient) {
    this.keyPool = keyPool;
    this.cloudClient = cloudClient;
    this.stats = {
      processed: 0,
      successful: 0,
      failed: 0,
    };
  }
  
  async analyzeQuestion(question) {
    const key = this.keyPool.getNext();
    const keyPrefix = this.keyPool.getKeyPrefix(key);
    const keyHash = this.keyPool.getKeyHash(key);
    const startTime = Date.now();
    
    try {
      // Wait based on per-key backoff
      const delay = this.keyPool.getDelay(key);
      if (delay > CONFIG.INITIAL_DELAY_MS) {
        console.log(`[Analyzer] Using key ${keyPrefix}... with backoff delay ${delay}ms`);
      }
      await this.sleep(delay);
      
      // Create Gemini client
      const ai = new GoogleGenAI({ apiKey: key });
      
      // Extract base64 from data URL
      const { mimeType, data } = this.extractBase64(question.data_url);
      
      // Call Gemini API with streaming
      const response = await ai.models.generateContentStream({
        model: CONFIG.MODEL_ID,
        contents: [{
          parts: [
            {
              inlineData: { mimeType, data },
            },
            { text: PROMPTS.ANALYSIS },
          ],
        }],
        config: {
          responseMimeType: "application/json",
          responseSchema: SCHEMAS.ANALYSIS,
        },
      });
      
      // Collect streaming response
      let fullText = "";
      for await (const chunk of response) {
        fullText += chunk.text;
      }
      
      if (!fullText) {
        throw new Error("Empty response from Gemini");
      }
      
      const analysis = JSON.parse(fullText);
      const durationMs = Date.now() - startTime;
      
      // Success - reset backoff and record stats
      this.keyPool.resetDelay(key);
      this.stats.successful++;
      
      await this.cloudClient.recordKeyStats({
        api_key_prefix: keyPrefix,
        api_key_hash: keyHash,
        success: true,
        question_id: question.question_id,
        exam_id: question.exam_id,
        duration_ms: durationMs,
        model_id: CONFIG.MODEL_ID,
      });
      
      console.log(`[Analyzer] ✓ Analyzed question ${question.question_id} (${durationMs}ms) using key ${keyPrefix}...`);
      
      return { success: true, analysis };
      
    } catch (error) {
      const durationMs = Date.now() - startTime;
      
      // Check if rate limiting or server error
      const isRateLimit = error.message?.includes('429') || 
                         error.message?.includes('rate') ||
                         error.status === 429;
      const isServerError = error.message?.includes('503') || 
                           error.message?.includes('500') ||
                           error.status === 503 ||
                           error.status === 500;
      
      if (isRateLimit || isServerError) {
        // Increase backoff for this key
        const newDelay = this.keyPool.increaseDelay(key);
        console.warn(`[Analyzer] Rate limit/server error for key ${keyPrefix}..., increasing delay to ${newDelay}ms`);
      }
      
      this.stats.failed++;
      
      await this.cloudClient.recordKeyStats({
        api_key_prefix: keyPrefix,
        api_key_hash: keyHash,
        success: false,
        error_message: error.message?.slice(0, 200),
        question_id: question.question_id,
        exam_id: question.exam_id,
        duration_ms: durationMs,
        model_id: CONFIG.MODEL_ID,
      });
      
      console.error(`[Analyzer] ✗ Failed question ${question.question_id}: ${error.message?.slice(0, 100)}`);
      
      return { 
        success: false, 
        error: error.message,
        isRetryable: isRateLimit || isServerError,
      };
    }
  }
  
  extractBase64(dataUrl) {
    if (!dataUrl.startsWith('data:')) {
      throw new Error('Invalid data URL');
    }
    
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error('Invalid data URL format');
    }
    
    return { mimeType: match[1], data: match[2] };
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ Main Processor ============

class ProAnalysisProcessor {
  constructor() {
    this.keyPool = new KeyPool(CONFIG.KEYS_FILE);
    this.cloudClient = new CloudAPIClient(CONFIG.API_BASE_URL);
    this.analyzer = new GeminiAnalyzer(this.keyPool, this.cloudClient);
    this.running = true;
    
    // Handle graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }
  
  shutdown() {
    console.log('\n[Processor] Shutting down gracefully...');
    this.running = false;
  }
  
  async run() {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║            GKSX Pro Analysis Server                            ║
║────────────────────────────────────────────────────────────────║
║  API Base:     ${CONFIG.API_BASE_URL.padEnd(46)}║
║  Batch Size:   ${String(CONFIG.BATCH_SIZE).padEnd(46)}║
║  Concurrency:  ${String(CONFIG.CONCURRENCY).padEnd(46)}║
║  Model:        ${CONFIG.MODEL_ID.padEnd(46)}║
╚════════════════════════════════════════════════════════════════╝
`);
    
    let roundNumber = 0;
    
    while (this.running) {
      roundNumber++;
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`[Round ${roundNumber}] Fetching pending questions...`);
      
      try {
        // Fetch pending questions
        const { questions, count } = await this.cloudClient.fetchPendingQuestions(CONFIG.BATCH_SIZE);
        
        if (count === 0) {
          console.log('[Processor] No pending questions. All done!');
          console.log('[Processor] Waiting 60 seconds before checking again...');
          await this.sleep(60000);
          continue;
        }
        
        console.log(`[Round ${roundNumber}] Found ${count} questions to process`);
        
        // Process with concurrency control
        const failedQuestions = [];
        const batchSize = CONFIG.CONCURRENCY;
        
        for (let i = 0; i < questions.length && this.running; i += batchSize) {
          const batch = questions.slice(i, i + batchSize);
          
          console.log(`\n[Batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(questions.length/batchSize)}] Processing ${batch.length} questions...`);
          
          const results = await Promise.all(
            batch.map(async (question) => {
              const result = await this.analyzer.analyzeQuestion(question);
              
              if (result.success) {
                // Update D1 immediately on success
                try {
                  await this.cloudClient.updateProAnalysis(
                    question.exam_id,
                    question.question_id,
                    result.analysis
                  );
                  console.log(`[Processor] ✓ Saved pro_analysis for ${question.question_id}`);
                } catch (updateErr) {
                  console.error(`[Processor] Failed to save: ${updateErr.message}`);
                  return { question, success: false, retryable: true };
                }
              }
              
              return { question, ...result };
            })
          );
          
          // Collect failed questions for retry
          for (const result of results) {
            if (!result.success && result.isRetryable) {
              failedQuestions.push(result.question);
            }
          }
        }
        
        // Print round summary
        const { processed, successful, failed } = this.analyzer.stats;
        console.log(`\n[Round ${roundNumber}] Summary:`);
        console.log(`  Total processed: ${processed}`);
        console.log(`  Successful: ${successful}`);
        console.log(`  Failed: ${failed}`);
        console.log(`  Pending retry: ${failedQuestions.length}`);
        
        // Small delay between rounds
        if (this.running) {
          console.log(`[Processor] Waiting 5 seconds before next round...`);
          await this.sleep(5000);
        }
        
      } catch (error) {
        console.error(`[Round ${roundNumber}] Error: ${error.message}`);
        console.log('[Processor] Waiting 30 seconds before retry...');
        await this.sleep(30000);
      }
    }
    
    console.log('\n[Processor] Shutdown complete.');
    process.exit(0);
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ Entry Point ============

const processor = new ProAnalysisProcessor();
processor.run().catch(err => {
  console.error('[Fatal Error]', err);
  process.exit(1);
});
