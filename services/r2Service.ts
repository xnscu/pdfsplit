/**
 * R2 Storage Service
 * Handles image uploads to Cloudflare R2 storage
 * Images are stored by their hash to enable deduplication
 */

// Get API URL from environment or use default
const getApiUrl = (): string => {
  // @ts-ignore - Vite injects import.meta.env
  const envUrl = typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL;
  return envUrl || "/api";
};

const API_BASE_URL = getApiUrl();

/**
 * Calculate SHA-256 hash of a data URL
 * Returns hex string
 */
export async function calculateImageHash(dataUrl: string): Promise<string> {
  // Extract base64 data from data URL
  const base64Data = dataUrl.split(",")[1];
  if (!base64Data) {
    throw new Error("Invalid data URL format");
  }

  // Convert base64 to array buffer
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Calculate SHA-256 hash
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return hashHex;
}

/**
 * Convert data URL to Blob
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64Data] = dataUrl.split(",");
  const mimeMatch = header.match(/data:([^;]+)/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/png";

  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

/**
 * Check if an image exists in R2 by hash
 */
export async function checkImageExists(hash: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/r2/${hash}`, {
      method: "HEAD",
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Batch check if images exist in R2
 * Returns map of hash -> exists
 *
 * Note: Cloudflare Workers has a limit of ~1000 R2 API calls per invocation.
 * This function automatically splits large batches into smaller chunks.
 */

// Default values (can be overridden via options or global settings)
let globalBatchCheckChunkSize = 50;
let globalBatchCheckConcurrency = 100;

/**
 * Set global batch check settings
 */
export function setBatchCheckSettings(settings: { chunkSize?: number; concurrency?: number }): void {
  if (settings.chunkSize !== undefined) {
    globalBatchCheckChunkSize = settings.chunkSize;
  }
  if (settings.concurrency !== undefined) {
    globalBatchCheckConcurrency = settings.concurrency;
  }
}

/**
 * Get current batch check settings
 */
export function getBatchCheckSettings(): { chunkSize: number; concurrency: number } {
  return {
    chunkSize: globalBatchCheckChunkSize,
    concurrency: globalBatchCheckConcurrency,
  };
}

export interface BatchCheckOptions {
  chunkSize?: number; // Hashes per chunk (default: 50)
  concurrency?: number; // Concurrent requests (default: 100)
  onProgress?: (progress: BatchCheckProgress) => void; // Progress callback
  maxRetries?: number; // Max retries for failed hashes (default: infinite until all succeed)
}

export interface BatchCheckProgress {
  phase: "checking" | "retrying" | "completed";
  message: string;
  current: number;
  total: number;
  percentage: number;
  round: number; // Current retry round (1 = first attempt)
  failedCount: number; // Number of hashes that failed in this round
}

/**
 * Process a single chunk of hashes
 * Returns { results, failedHashes }
 */
async function checkChunk(
  chunk: string[],
): Promise<{ results: Record<string, boolean>; failedHashes: string[] }> {
  try {
    const response = await fetch(`${API_BASE_URL}/r2/check-batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ hashes: chunk }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Batch check failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return { results: data.results || {}, failedHashes: [] };
  } catch (error) {
    console.error(`[R2] Chunk failed:`, error);
    // Return all hashes as failed
    return { results: {}, failedHashes: chunk };
  }
}

export async function batchCheckImagesExist(
  hashes: string[],
  options: BatchCheckOptions = {},
): Promise<Record<string, boolean>> {
  if (hashes.length === 0) {
    options.onProgress?.({
      phase: "completed",
      message: "没有需要检查的图片",
      current: 0,
      total: 0,
      percentage: 100,
      round: 1,
      failedCount: 0,
    });
    return {};
  }

  const chunkSize = options.chunkSize ?? globalBatchCheckChunkSize;
  const concurrency = options.concurrency ?? globalBatchCheckConcurrency;
  const maxRetries = options.maxRetries; // undefined = infinite retries

  const allResults: Record<string, boolean> = {};
  let pendingHashes = [...hashes];
  let round = 1;

  while (pendingHashes.length > 0) {
    // Check if max retries exceeded
    if (maxRetries !== undefined && round > maxRetries + 1) {
      console.error(`[R2] Max retries (${maxRetries}) exceeded. ${pendingHashes.length} hashes still failed.`);
      // Mark remaining as false
      for (const hash of pendingHashes) {
        allResults[hash] = false;
      }
      break;
    }

    const phaseMessage = round === 1 ? "checking" : "retrying";

    // Split into chunks
    const chunks: string[][] = [];
    for (let i = 0; i < pendingHashes.length; i += chunkSize) {
      chunks.push(pendingHashes.slice(i, i + chunkSize));
    }

    console.log(
      `[R2] Round ${round}: Batch checking ${pendingHashes.length} hashes in ${chunks.length} chunks (max ${chunkSize} per chunk, concurrency: ${concurrency})`,
    );

    options.onProgress?.({
      phase: phaseMessage,
      message: round === 1
        ? `正在检查 ${pendingHashes.length} 张图片...`
        : `第 ${round} 轮重试: 检查 ${pendingHashes.length} 张失败的图片...`,
      current: 0,
      total: pendingHashes.length,
      percentage: 0,
      round,
      failedCount: pendingHashes.length,
    });

    const failedHashes: string[] = [];
    let completedInRound = 0;

    // Process chunks with concurrency control
    let index = 0;
    const executing: Promise<void>[] = [];

    while (index < chunks.length || executing.length > 0) {
      // Fill up to concurrency limit
      while (executing.length < concurrency && index < chunks.length) {
        const chunk = chunks[index++];
        const promise = checkChunk(chunk).then(({ results, failedHashes: chunkFailed }) => {
          // Merge results
          for (const [hash, exists] of Object.entries(results)) {
            allResults[hash] = exists as boolean;
          }
          // Collect failed hashes
          failedHashes.push(...chunkFailed);

          // Update progress
          completedInRound += chunk.length;
          const percentage = Math.round((completedInRound / pendingHashes.length) * 100);
          options.onProgress?.({
            phase: phaseMessage,
            message: round === 1
              ? `正在检查图片 ${completedInRound}/${pendingHashes.length} (${percentage}%)`
              : `第 ${round} 轮重试: ${completedInRound}/${pendingHashes.length} (${percentage}%)`,
            current: completedInRound,
            total: pendingHashes.length,
            percentage,
            round,
            failedCount: failedHashes.length,
          });

          executing.splice(executing.indexOf(promise), 1);
        });
        executing.push(promise);
      }

      // Wait for at least one to complete if at concurrency limit
      if (executing.length > 0 && (executing.length >= concurrency || index >= chunks.length)) {
        await Promise.race(executing);
      }
    }

    // Prepare for next round if there are failed hashes
    if (failedHashes.length > 0) {
      console.log(`[R2] Round ${round} completed with ${failedHashes.length} failures. Retrying...`);
      pendingHashes = failedHashes;
      round++;

      // Add a small delay before retrying to avoid hammering the server
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      // All succeeded
      pendingHashes = [];
    }
  }

  options.onProgress?.({
    phase: "completed",
    message: `检查完成: ${hashes.length} 张图片`,
    current: hashes.length,
    total: hashes.length,
    percentage: 100,
    round,
    failedCount: 0,
  });

  return allResults;
}

/**
 * Upload image to R2
 * Returns true if successful (or already existed)
 */
export async function uploadImageToR2(hash: string, dataUrl: string): Promise<boolean> {
  try {
    const blob = dataUrlToBlob(dataUrl);

    const response = await fetch(`${API_BASE_URL}/r2/${hash}`, {
      method: "PUT",
      headers: {
        "Content-Type": blob.type,
      },
      body: blob,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error("R2 upload failed:", error);
    return false;
  }
}

/**
 * Process a data URL for R2 storage
 * 1. Calculate hash
 * 2. Check if exists
 * 3. Upload if not exists
 * 4. Return hash
 */
export async function processImageForR2(dataUrl: string): Promise<string> {
  const hash = await calculateImageHash(dataUrl);
  const exists = await checkImageExists(hash);

  if (!exists) {
    const uploaded = await uploadImageToR2(hash, dataUrl);
    if (!uploaded) {
      throw new Error(`Failed to upload image with hash: ${hash}`);
    }
  }

  return hash;
}

/**
 * Image upload task for concurrent processing
 */
export interface ImageUploadTask {
  id: string; // Unique identifier (e.g., "page_1" or "question_abc123")
  dataUrl: string;
  type: "rawPage" | "question";
}

export interface ImageUploadResult {
  id: string;
  hash: string;
  type: "rawPage" | "question";
  success: boolean;
  error?: string;
  skipped?: boolean; // True if already existed
}

/**
 * Progress callback for prepare upload tasks
 */
export interface PrepareUploadProgress {
  phase: "hashing" | "checking" | "completed";
  message: string;
  current: number;
  total: number;
  percentage: number;
  // For checking phase, include retry info
  round?: number;
  failedCount?: number;
}

export interface PrepareUploadOptions {
  onProgress?: (progress: PrepareUploadProgress) => void;
  batchCheckOptions?: BatchCheckOptions;
}

/**
 * Prepare upload tasks from exam data
 * Calculates hashes and identifies which images need uploading
 */
export async function prepareUploadTasks(
  rawPages: Array<{ pageNumber: number; dataUrl: string }>,
  questions: Array<{ id: string; dataUrl: string; originalDataUrl?: string }>,
  options: PrepareUploadOptions = {},
): Promise<{
  tasks: ImageUploadTask[];
  hashMap: Map<string, string>; // dataUrl -> hash
  existingHashes: Set<string>;
}> {
  const allDataUrls: Array<{ id: string; dataUrl: string; type: "rawPage" | "question" }> = [];

  // Collect all data URLs
  for (const page of rawPages) {
    allDataUrls.push({
      id: `page_${page.pageNumber}`,
      dataUrl: page.dataUrl,
      type: "rawPage",
    });
  }

  for (const q of questions) {
    allDataUrls.push({
      id: `question_${q.id}`,
      dataUrl: q.dataUrl,
      type: "question",
    });
    if (q.originalDataUrl) {
      allDataUrls.push({
        id: `question_original_${q.id}`,
        dataUrl: q.originalDataUrl,
        type: "question",
      });
    }
  }

  // Calculate all hashes with progress
  const hashMap = new Map<string, string>();
  const uniqueHashes = new Set<string>();
  const totalToHash = allDataUrls.filter((item, index, arr) =>
    arr.findIndex((i) => i.dataUrl === item.dataUrl) === index
  ).length;
  let hashedCount = 0;

  options.onProgress?.({
    phase: "hashing",
    message: `正在分析图片 0/${totalToHash}`,
    current: 0,
    total: totalToHash,
    percentage: 0,
  });

  for (const item of allDataUrls) {
    // Skip if already calculated (dedup by dataUrl)
    if (hashMap.has(item.dataUrl)) continue;

    const hash = await calculateImageHash(item.dataUrl);
    hashMap.set(item.dataUrl, hash);
    uniqueHashes.add(hash);
    hashedCount++;

    const percentage = Math.round((hashedCount / totalToHash) * 100);
    options.onProgress?.({
      phase: "hashing",
      message: `正在分析图片 ${hashedCount}/${totalToHash} (${percentage}%)`,
      current: hashedCount,
      total: totalToHash,
      percentage,
    });
  }

  // Batch check which hashes already exist with progress
  const hashArray = Array.from(uniqueHashes);

  options.onProgress?.({
    phase: "checking",
    message: `正在检查 ${hashArray.length} 张图片...`,
    current: 0,
    total: hashArray.length,
    percentage: 0,
    round: 1,
    failedCount: 0,
  });

  const existsMap = await batchCheckImagesExist(hashArray, {
    ...options.batchCheckOptions,
    onProgress: (checkProgress) => {
      options.onProgress?.({
        phase: "checking",
        message: checkProgress.message,
        current: checkProgress.current,
        total: checkProgress.total,
        percentage: checkProgress.percentage,
        round: checkProgress.round,
        failedCount: checkProgress.failedCount,
      });
    },
  });
  const existingHashes = new Set<string>(hashArray.filter((h) => existsMap[h]));

  // Build tasks for non-existing images
  const tasks: ImageUploadTask[] = [];
  const processedHashes = new Set<string>();

  for (const item of allDataUrls) {
    const hash = hashMap.get(item.dataUrl)!;
    if (existingHashes.has(hash) || processedHashes.has(hash)) {
      continue;
    }
    processedHashes.add(hash);
    tasks.push({
      id: item.id,
      dataUrl: item.dataUrl,
      type: item.type,
    });
  }

  options.onProgress?.({
    phase: "completed",
    message: `分析完成: ${existingHashes.size} 张已存在, ${tasks.length} 张需要上传`,
    current: hashArray.length,
    total: hashArray.length,
    percentage: 100,
  });

  return { tasks, hashMap, existingHashes };
}

/**
 * Concurrent upload controller
 */
export class ConcurrentUploader {
  private concurrency: number;
  private tasks: ImageUploadTask[] = [];
  private hashMap: Map<string, string> = new Map();
  private results: ImageUploadResult[] = [];
  private completed = 0;
  private total = 0;
  private isPaused = false;
  private isCancelled = false;
  private onProgress?: (completed: number, total: number) => void;

  constructor(concurrency: number = 10) {
    this.concurrency = concurrency;
  }

  setOnProgress(callback: (completed: number, total: number) => void) {
    this.onProgress = callback;
  }

  setConcurrency(concurrency: number) {
    this.concurrency = concurrency;
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
  }

  cancel() {
    this.isCancelled = true;
    this.isPaused = false;
  }

  getProgress(): { completed: number; total: number; percentage: number } {
    return {
      completed: this.completed,
      total: this.total,
      percentage: this.total > 0 ? Math.round((this.completed / this.total) * 100) : 0,
    };
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.isPaused && !this.isCancelled) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private async uploadTask(task: ImageUploadTask): Promise<ImageUploadResult> {
    try {
      await this.waitWhilePaused();
      if (this.isCancelled) {
        return {
          id: task.id,
          hash: "",
          type: task.type,
          success: false,
          error: "Cancelled",
        };
      }

      const hash = this.hashMap.get(task.dataUrl)!;
      const success = await uploadImageToR2(hash, task.dataUrl);

      return {
        id: task.id,
        hash,
        type: task.type,
        success,
        error: success ? undefined : "Upload failed",
      };
    } catch (error) {
      const hash = this.hashMap.get(task.dataUrl) || "";
      return {
        id: task.id,
        hash,
        type: task.type,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async upload(
    tasks: ImageUploadTask[],
    hashMap: Map<string, string>,
  ): Promise<ImageUploadResult[]> {
    this.tasks = tasks;
    this.hashMap = hashMap;
    this.results = [];
    this.completed = 0;
    this.total = tasks.length;
    this.isPaused = false;
    this.isCancelled = false;

    if (tasks.length === 0) {
      return [];
    }

    // Process tasks with concurrency control
    let index = 0;
    const executing: Promise<void>[] = [];

    while (index < tasks.length) {
      await this.waitWhilePaused();
      if (this.isCancelled) break;

      // Fill up to concurrency limit
      while (executing.length < this.concurrency && index < tasks.length) {
        const task = tasks[index++];
        const promise = this.uploadTask(task).then((result) => {
          this.results.push(result);
          this.completed++;
          this.onProgress?.(this.completed, this.total);
          executing.splice(executing.indexOf(promise), 1);
        });
        executing.push(promise);
      }

      // Wait for at least one to complete
      if (executing.length >= this.concurrency) {
        await Promise.race(executing);
      }
    }

    // Wait for remaining tasks
    await Promise.all(executing);

    return this.results;
  }
}

/**
 * Get R2 image URL from hash
 */
export function getR2ImageUrl(hash: string): string {
  const base = API_BASE_URL.replace(/\/$/, "");
  return `${base}/r2/${hash}`;
}

/**
 * Check if a value looks like a hash (64 hex characters for SHA-256)
 */
export function isImageHash(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

/**
 * Resolve an image reference for display:
 * - If it's a SHA-256 hash, return the fetchable R2 URL (/api/r2/:hash or VITE_API_URL-based)
 * - Otherwise (data URL / normal URL), return as-is
 */
export function resolveImageUrl(value?: string): string | undefined {
  if (!value) return value;
  return isImageHash(value) ? getR2ImageUrl(value) : value;
}
