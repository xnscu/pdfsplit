import { DebugPageData, QuestionImage, DetectedQuestion } from "../types";
import { CropSettings } from "./pdfService";
import { WORKER_BLOB_URL } from "./workerScript";

export const normalizeBoxes = (boxes2d: any): [number, number, number, number][] => {
  if (Array.isArray(boxes2d[0])) {
    return boxes2d as [number, number, number, number][];
  }
  return [boxes2d] as [number, number, number, number][];
};

export interface LogicalQuestion {
  id: string;
  fileId: string;
  parts: {
    pageObj: DebugPageData;
    detection: DetectedQuestion;
    indexInFile: number;
  }[];
}

/**
 * Group pages into Logical Questions (handling continuations)
 */
export const createLogicalQuestions = (pages: DebugPageData[]): LogicalQuestion[] => {
  const files = new Map<string, DebugPageData[]>();
  pages.forEach((p) => {
    if (!files.has(p.fileName)) files.set(p.fileName, []);
    files.get(p.fileName)!.push(p);
  });

  const logicalQuestions: LogicalQuestion[] = [];

  for (const [fileId, filePages] of files) {
    // Sort pages to ensure correct continuation order
    filePages.sort((a, b) => a.pageNumber - b.pageNumber);

    let currentQ: LogicalQuestion | null = null;

    for (const page of filePages) {
      for (const [idx, det] of page.detections.entries()) {
        if (det.id === "continuation") {
          if (currentQ) {
            currentQ.parts.push({
              pageObj: page,
              detection: det,
              indexInFile: idx,
            });
          } else {
            // Orphan continuation: Treat as separate or skip.
            // Creating separate to ensure visibility.
            currentQ = {
              id: `cont_${page.pageNumber}_${idx}`,
              fileId,
              parts: [{ pageObj: page, detection: det, indexInFile: idx }],
            };
            logicalQuestions.push(currentQ);
          }
        } else {
          currentQ = {
            id: det.id,
            fileId,
            parts: [{ pageObj: page, detection: det, indexInFile: idx }],
          };
          logicalQuestions.push(currentQ);
        }
      }
    }
  }
  return logicalQuestions;
};

// --- WORKER POOL IMPLEMENTATION ---

class WorkerPool {
  private workers: Worker[] = [];
  private queue: {
    type: string;
    payload: any;
    resolve: (val: any) => void;
    reject: (err: any) => void;
  }[] = [];
  private activeCount = 0;
  private _concurrency = 4;
  private workerMap = new Map<Worker, boolean>(); // Worker -> busy/free

  constructor() {
    // Initialize lazy
  }

  set concurrency(val: number) {
    this._concurrency = val;
    this.processQueue();
  }

  get concurrency() {
    return this._concurrency;
  }

  get size() {
    return this.queue.length + this.activeCount;
  }

  private getFreeWorker(): Worker | null {
    // Ensure we have enough workers
    while (this.workers.length < this._concurrency) {
      const w = new Worker(WORKER_BLOB_URL);
      this.workers.push(w);
      this.workerMap.set(w, false); // false = free
    }

    // Find free worker
    for (const [w, busy] of this.workerMap.entries()) {
      if (!busy) return w;
    }
    return null;
  }

  exec(type: "PROCESS_QUESTION" | "GENERATE_DEBUG", payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({ type, payload, resolve, reject });
      this.processQueue();
    });
  }

  private processQueue() {
    if (this.queue.length === 0) return;

    while (this.activeCount < this._concurrency && this.queue.length > 0) {
      const worker = this.getFreeWorker();
      if (!worker) break; // All workers busy

      const job = this.queue.shift();
      if (job) {
        this.activeCount++;
        this.workerMap.set(worker, true);

        const msgId = Math.random().toString(36).substring(7);

        const cleanup = () => {
          worker.removeEventListener("message", handler);
          worker.removeEventListener("error", onError);
          worker.removeEventListener("messageerror", onMessageError);
        };

        const onError = (e: ErrorEvent) => {
          cleanup();
          this.activeCount--;
          this.workerMap.set(worker, false);
          job.reject(new Error(e.message || "Worker error"));
          this.processQueue();
        };

        const onMessageError = () => {
          cleanup();
          this.activeCount--;
          this.workerMap.set(worker, false);
          job.reject(new Error("Worker message deserialization error"));
          this.processQueue();
        };

        const handler = (e: MessageEvent) => {
          if (e.data.id === msgId) {
            cleanup();
            this.activeCount--;
            this.workerMap.set(worker, false);

            if (e.data.success) {
              if (e.data.result === null || e.data.result === undefined) {
                job.reject(new Error("Worker returned empty result"));
              } else {
                job.resolve(e.data.result);
              }
            } else {
              job.reject(new Error(e.data.error || "Worker processing error"));
            }
            this.processQueue();
          }
        };

        worker.addEventListener("message", handler);
        worker.addEventListener("error", onError);
        worker.addEventListener("messageerror", onMessageError);
        worker.postMessage({
          id: msgId,
          type: job.type,
          payload: job.payload,
        });
      }
    }
  }

  onIdle(): Promise<void> {
    if (this.queue.length === 0 && this.activeCount === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (this.queue.length === 0 && this.activeCount === 0) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  clear() {
    this.queue = [];
  }
}

// Global Singleton for the pool
export const globalWorkerPool = new WorkerPool();

// Backwards compatibility wrapper for CropQueue
export class CropQueue {
  set concurrency(val: number) {
    globalWorkerPool.concurrency = val;
  }

  get concurrency() {
    return globalWorkerPool.concurrency;
  }

  enqueue(task: () => Promise<void>) {
    task();
  }

  get size() {
    return globalWorkerPool.size;
  }

  onIdle() {
    return globalWorkerPool.onIdle();
  }

  clear() {
    globalWorkerPool.clear();
  }
}

/**
 * Process a single logical question - NOW USES WORKER
 */
export const processLogicalQuestion = async (
  task: LogicalQuestion,
  settings: CropSettings,
  targetWidth?: number,
): Promise<QuestionImage | null> => {
  return globalWorkerPool.exec("PROCESS_QUESTION", {
    task,
    settings,
    targetWidth,
  });
};

/**
 * Generate Debug Previews (4 stages) - NOW USES WORKER
 */
export const generateDebugPreviews = async (
  sourceDataUrl: string,
  boxes: [number, number, number, number][],
  originalWidth: number,
  originalHeight: number,
  settings: CropSettings,
  targetWidth?: number,
): Promise<{
  stage1: string;
  stage2: string;
  stage3: string;
  stage4: string;
} | null> => {
  return globalWorkerPool.exec("GENERATE_DEBUG", {
    sourceDataUrl,
    boxes,
    originalWidth,
    originalHeight,
    settings,
    targetWidth,
  });
};

// Legacy helper used by History loading
export const pMap = async <T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number,
  signal?: AbortSignal,
): Promise<R[]> => {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) throw new Error("Aborted");
    const p = mapper(items[i], i).then((res) => {
      results[i] = res;
    });
    executing.push(p);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
};

/**
 * Generates processed questions from raw debug data.
 */
export const generateQuestionsFromRawPages = async (
  pages: DebugPageData[],
  settings: CropSettings,
  signal: AbortSignal,
  callbacks?: {
    onProgress?: () => void;
    onResult?: (image: QuestionImage) => void;
  },
  concurrency: number = 3,
): Promise<QuestionImage[]> => {
  globalWorkerPool.concurrency = concurrency;

  // 1. Calculate Global Max Width (for column alignment)
  // We want to force all questions to have the same width (aligned right with whitespace)
  let globalMaxWidth = 0;

  for (const page of pages) {
    for (const det of page.detections) {
      const boxes = Array.isArray(det.boxes_2d[0]) ? det.boxes_2d : [det.boxes_2d];
      for (const box of boxes) {
        // box is [ymin, xmin, ymax, xmax] (0-1000)
        // Width in px
        const w = (((box as number[])[3] - (box as number[])[1]) / 1000) * page.width;
        if (w > globalMaxWidth) globalMaxWidth = w;
      }
    }
  }
  globalMaxWidth = Math.ceil(globalMaxWidth);

  const logicalQuestions = createLogicalQuestions(pages);
  if (logicalQuestions.length === 0) return [];

  const results: QuestionImage[] = [];

  const promises = logicalQuestions.map(async (task) => {
    if (signal.aborted) return null;

    // Use global max width as target width for alignment
    const targetWidth = globalMaxWidth;

    const res = await processLogicalQuestion(task, settings, targetWidth);

    if (res) {
      if (callbacks?.onResult) callbacks.onResult(res);
      if (callbacks?.onProgress) callbacks.onProgress();
      results.push(res);
    }
    return res;
  });

  await Promise.all(promises);
  return results;
};
