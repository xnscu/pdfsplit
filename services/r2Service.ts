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
 */
export async function batchCheckImagesExist(hashes: string[]): Promise<Record<string, boolean>> {
  if (hashes.length === 0) {
    return {};
  }

  try {
    const response = await fetch(`${API_BASE_URL}/r2/check-batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ hashes }),
    });

    if (!response.ok) {
      throw new Error(`Batch check failed: ${response.status}`);
    }

    const data = await response.json();
    return data.results || {};
  } catch (error) {
    console.error("Batch check failed:", error);
    // Fall back to individual checks
    const results: Record<string, boolean> = {};
    for (const hash of hashes) {
      results[hash] = await checkImageExists(hash);
    }
    return results;
  }
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
 * Prepare upload tasks from exam data
 * Calculates hashes and identifies which images need uploading
 */
export async function prepareUploadTasks(
  rawPages: Array<{ pageNumber: number; dataUrl: string }>,
  questions: Array<{ id: string; dataUrl: string; originalDataUrl?: string }>,
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

  // Calculate all hashes
  const hashMap = new Map<string, string>();
  const uniqueHashes = new Set<string>();

  for (const item of allDataUrls) {
    // Skip if already calculated (dedup by dataUrl)
    if (hashMap.has(item.dataUrl)) continue;

    const hash = await calculateImageHash(item.dataUrl);
    hashMap.set(item.dataUrl, hash);
    uniqueHashes.add(hash);
  }

  // Batch check which hashes already exist
  const hashArray = Array.from(uniqueHashes);
  const existsMap = await batchCheckImagesExist(hashArray);
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
  return `${API_BASE_URL}/r2/${hash}`;
}

/**
 * Check if a value looks like a hash (64 hex characters for SHA-256)
 */
export function isImageHash(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}
