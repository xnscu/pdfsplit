/**
 * Sync Service for bidirectional synchronization between IndexedDB and D1
 * Handles conflict resolution, offline mode, and background sync
 * Images are stored in R2, with hashes stored in D1
 */

import { ExamRecord, HistoryMetadata } from "../types";
import * as storageService from "./storageService";
import {
  calculateImageHash,
  prepareUploadTasks,
  ConcurrentUploader,
  batchCheckImagesExist,
  isImageHash,
  ImageUploadTask,
  setBatchCheckSettings,
  getBatchCheckSettings,
} from "./r2Service";

// Get API URL from environment or use default
const getApiUrl = (): string => {
  // @ts-ignore - Vite injects import.meta.env
  const envUrl = typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL;
  return envUrl || "/api";
};

// Configuration
const SYNC_CONFIG = {
  // API base URL - configure based on environment
  // In production, this would be your Cloudflare Worker URL
  apiBaseUrl: getApiUrl(),

  // Local storage key for sync state
  syncStateKey: "gksx_sync_state",

  // Local storage key for sync settings
  syncSettingsKey: "gksx_sync_settings",

  // Auto-sync interval in milliseconds (5 minutes)
  autoSyncInterval: 5 * 60 * 1000,

  // Maximum retries for failed sync
  maxRetries: 3,

  // Default concurrency for image uploads
  defaultConcurrency: 10,
};

// Sync settings interface
export interface SyncSettings {
  uploadConcurrency: number;
  batchCheckChunkSize: number;
  batchCheckConcurrency: number;
}

// Default sync settings
const defaultSyncSettings: SyncSettings = {
  uploadConcurrency: SYNC_CONFIG.defaultConcurrency,
  batchCheckChunkSize: 50,
  batchCheckConcurrency: 100,
};

// Current sync settings
let syncSettings: SyncSettings = { ...defaultSyncSettings };

/**
 * Load sync settings from localStorage
 */
export const loadSyncSettings = (): SyncSettings => {
  try {
    const saved = localStorage.getItem(SYNC_CONFIG.syncSettingsKey);
    if (saved) {
      syncSettings = { ...defaultSyncSettings, ...JSON.parse(saved) };
    }
    // Sync batch check settings to r2Service
    setBatchCheckSettings({
      chunkSize: syncSettings.batchCheckChunkSize,
      concurrency: syncSettings.batchCheckConcurrency,
    });
  } catch (e) {
    console.warn("Failed to load sync settings:", e);
  }
  return syncSettings;
};

/**
 * Save sync settings to localStorage
 */
export const saveSyncSettings = (settings: Partial<SyncSettings>): void => {
  syncSettings = { ...syncSettings, ...settings };
  try {
    localStorage.setItem(SYNC_CONFIG.syncSettingsKey, JSON.stringify(syncSettings));
  } catch (e) {
    console.warn("Failed to save sync settings:", e);
  }
};

/**
 * Get current sync settings
 */
export const getSyncSettings = (): SyncSettings => {
  return { ...syncSettings };
};

// Sync state interface
interface SyncState {
  lastSyncTime: number;
  pendingActions: PendingAction[];
  isOnline: boolean;
}

interface PendingAction {
  type: "save" | "delete";
  examId: string;
  timestamp: number;
  data?: ExamRecord;
}

interface SyncResult {
  success: boolean;
  pushed: number;
  pulled: number;
  conflicts: ConflictInfo[];
  errors: string[];
  imagesUploaded?: number;
  imagesSkipped?: number;
}

// Progress callback type
export type SyncProgressCallback = (progress: SyncProgress) => void;

export interface SyncProgress {
  phase: "hashing" | "checking" | "uploading" | "syncing" | "downloading" | "completed";
  message: string;
  current: number;
  total: number;
  percentage: number; // 0-100% for current phase only
  // For checking phase, include retry info
  round?: number;
  failedCount?: number;
}

// Global uploader instance for pause/resume control
let globalUploader: ConcurrentUploader | null = null;
let currentSyncAbortController: AbortController | null = null;

interface ConflictInfo {
  id: string;
  name: string;
  localTimestamp: number;
  remoteTimestamp: number;
  resolution?: "local" | "remote" | "merge";
}

// ============ State Management ============

let syncState: SyncState = {
  lastSyncTime: 0,
  pendingActions: [],
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
};

let syncInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Load sync state from localStorage
 */
export const loadSyncState = (): SyncState => {
  try {
    const saved = localStorage.getItem(SYNC_CONFIG.syncStateKey);
    if (saved) {
      syncState = JSON.parse(saved);
    }
  } catch (e) {
    console.warn("Failed to load sync state:", e);
  }
  return syncState;
};

/**
 * Save sync state to localStorage
 */
const saveSyncState = (): void => {
  try {
    localStorage.setItem(SYNC_CONFIG.syncStateKey, JSON.stringify(syncState));
  } catch (e) {
    console.warn("Failed to save sync state:", e);
  }
};

/**
 * Update online status
 */
const updateOnlineStatus = (isOnline: boolean): void => {
  syncState.isOnline = isOnline;
  saveSyncState();

  if (isOnline && syncState.pendingActions.length > 0) {
    // Auto-sync pending actions when coming back online
    syncToRemote().catch(console.error);
  }
};

// ============ API Functions ============

/**
 * Make API request with error handling
 */
async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${SYNC_CONFIG.apiBaseUrl}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Check if API is available
 */
export const checkApiAvailable = async (): Promise<boolean> => {
  try {
    await apiRequest<{ lastSync: number }>("/sync/status");
    return true;
  } catch {
    return false;
  }
};

// ============ Remote Storage Operations ============

/**
 * Get list of exams from remote
 */
export const getRemoteExamList = async (): Promise<HistoryMetadata[]> => {
  return apiRequest<HistoryMetadata[]>("/exams");
};

/**
 * Get full exam from remote
 */
export const getRemoteExam = async (id: string): Promise<ExamRecord | null> => {
  try {
    return await apiRequest<ExamRecord>(`/exams/${id}`);
  } catch {
    return null;
  }
};

/**
 * Save exam to remote
 */
export const saveRemoteExam = async (exam: ExamRecord): Promise<boolean> => {
  try {
    await apiRequest<{ success: boolean }>("/exams", {
      method: "POST",
      body: JSON.stringify(exam),
    });
    return true;
  } catch (e) {
    console.error("Failed to save exam to remote:", e);
    return false;
  }
};

/**
 * Delete exam from remote
 */
export const deleteRemoteExam = async (id: string): Promise<boolean> => {
  try {
    await apiRequest<{ success: boolean }>(`/exams/${id}`, {
      method: "DELETE",
    });
    return true;
  } catch (e) {
    console.error("Failed to delete exam from remote:", e);
    return false;
  }
};

/**
 * Delete multiple exams from remote
 */
export const deleteRemoteExams = async (ids: string[]): Promise<boolean> => {
  try {
    await apiRequest<{ success: boolean }>("/exams/batch-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    return true;
  } catch (e) {
    console.error("Failed to batch delete exams from remote:", e);
    return false;
  }
};

// ============ Sync Operations ============

/**
 * Add action to pending queue (for offline mode)
 */
const addPendingAction = (action: PendingAction): void => {
  // Remove any existing action for the same exam
  syncState.pendingActions = syncState.pendingActions.filter((a) => a.examId !== action.examId);
  syncState.pendingActions.push(action);
  saveSyncState();
};

/**
 * Sync local changes to remote
 */
export const syncToRemote = async (): Promise<SyncResult> => {
  const result: SyncResult = {
    success: true,
    pushed: 0,
    pulled: 0,
    conflicts: [],
    errors: [],
  };

  if (!syncState.isOnline) {
    result.success = false;
    result.errors.push("Offline mode - changes will sync when online");
    return result;
  }

  // Process pending actions
  const pendingActions = [...syncState.pendingActions];

  for (const action of pendingActions) {
    try {
      if (action.type === "save" && action.data) {
        const success = await saveRemoteExam(action.data);
        if (success) {
          result.pushed++;
          syncState.pendingActions = syncState.pendingActions.filter((a) => a.examId !== action.examId);
        } else {
          result.errors.push(`Failed to sync exam: ${action.examId}`);
        }
      } else if (action.type === "delete") {
        const success = await deleteRemoteExam(action.examId);
        if (success) {
          syncState.pendingActions = syncState.pendingActions.filter((a) => a.examId !== action.examId);
        } else {
          result.errors.push(`Failed to delete exam: ${action.examId}`);
        }
      }
    } catch (e) {
      result.errors.push(`Sync error for ${action.examId}: ${e}`);
    }
  }

  saveSyncState();
  return result;
};

/**
 * Pull changes from remote to local
 */
export const syncFromRemote = async (): Promise<SyncResult> => {
  const result: SyncResult = {
    success: true,
    pushed: 0,
    pulled: 0,
    conflicts: [],
    errors: [],
  };

  if (!syncState.isOnline) {
    result.success = false;
    result.errors.push("Offline mode");
    return result;
  }

  try {
    // Get changes since last sync
    const pullResult = await apiRequest<{
      exams: ExamRecord[];
      deleted: string[];
      syncTime: number;
    }>("/sync/pull", {
      method: "POST",
      body: JSON.stringify({ since: syncState.lastSyncTime }),
    });

    // Get local list for conflict detection
    const localList = await storageService.getHistoryList();
    const localMap = new Map(localList.map((l) => [l.id, l]));

    // Process remote exam updates
    for (const remoteExam of pullResult.exams) {
      const localMeta = localMap.get(remoteExam.id);

      if (localMeta) {
        // Exam exists locally - check for conflicts
        const localExam = await storageService.loadExamResult(remoteExam.id);

        if (localExam && localExam.timestamp > syncState.lastSyncTime) {
          // Local was also modified - conflict!
          result.conflicts.push({
            id: remoteExam.id,
            name: remoteExam.name,
            localTimestamp: localExam.timestamp,
            remoteTimestamp: remoteExam.timestamp,
          });
          continue;
        }
      }

      // No conflict, save remote version locally
      await saveExamToLocal(remoteExam);
      result.pulled++;
    }

    // Process remote deletions
    for (const deletedId of pullResult.deleted) {
      await storageService.deleteExamResult(deletedId);
    }

    // Update sync time
    syncState.lastSyncTime = pullResult.syncTime;
    saveSyncState();
  } catch (e) {
    result.success = false;
    result.errors.push(`Sync pull failed: ${e}`);
  }

  return result;
};

/**
 * Full bidirectional sync
 */
export const fullSync = async (): Promise<SyncResult> => {
  const result: SyncResult = {
    success: true,
    pushed: 0,
    pulled: 0,
    conflicts: [],
    errors: [],
  };

  // First push local changes
  const pushResult = await syncToRemote();
  result.pushed = pushResult.pushed;
  result.errors.push(...pushResult.errors);

  // Then pull remote changes
  const pullResult = await syncFromRemote();
  result.pulled = pullResult.pulled;
  result.conflicts = pullResult.conflicts;
  result.errors.push(...pullResult.errors);

  result.success = result.errors.length === 0;

  return result;
};

/**
 * Force sync all local data to remote with R2 image upload
 * Supports progress callback, pause/resume
 *
 * Progress phases (each phase has independent 0-100%):
 * 1. hashing - Calculate image hashes
 * 2. checking - Check which images exist in R2
 * 3. uploading - Upload missing images to R2
 * 4. syncing - Sync exam data to D1
 */
export const forceUploadAll = async (
  onProgress?: SyncProgressCallback,
): Promise<SyncResult> => {
  const result: SyncResult = {
    success: true,
    pushed: 0,
    pulled: 0,
    conflicts: [],
    errors: [],
    imagesUploaded: 0,
    imagesSkipped: 0,
  };

  currentSyncAbortController = new AbortController();

  try {
    // Phase 0: Load local exam data
    onProgress?.({
      phase: "hashing",
      message: "正在加载本地数据...",
      current: 0,
      total: 0,
      percentage: 0,
    });

    const localList = await storageService.getHistoryList();
    const totalExams = localList.length;

    if (totalExams === 0) {
      onProgress?.({
        phase: "completed",
        message: "没有数据需要同步",
        current: 0,
        total: 0,
        percentage: 100,
      });
      return result;
    }

    // Collect all images from all exams
    const allRawPages: Array<{ examId: string; pageNumber: number; dataUrl: string }> = [];
    const allQuestions: Array<{ examId: string; id: string; dataUrl: string; originalDataUrl?: string }> = [];
    const examDataMap = new Map<string, ExamRecord>();

    for (let i = 0; i < localList.length; i++) {
      const meta = localList[i];
      const exam = await storageService.loadExamResult(meta.id);
      if (!exam) continue;

      examDataMap.set(exam.id, exam);

      for (const page of exam.rawPages) {
        // Skip if already a hash
        if (!isImageHash(page.dataUrl)) {
          allRawPages.push({
            examId: exam.id,
            pageNumber: page.pageNumber,
            dataUrl: page.dataUrl,
          });
        }
      }

      for (const q of exam.questions) {
        if (!isImageHash(q.dataUrl)) {
          allQuestions.push({
            examId: exam.id,
            id: q.id,
            dataUrl: q.dataUrl,
            originalDataUrl: q.originalDataUrl && !isImageHash(q.originalDataUrl) ? q.originalDataUrl : undefined,
          });
        }
      }
    }

    // Phase 1 & 2: Prepare upload tasks (includes hashing and checking phases)
    // The prepareUploadTasks function now handles progress for both hashing and checking
    const { tasks, hashMap, existingHashes } = await prepareUploadTasks(
      allRawPages.map((p) => ({ pageNumber: p.pageNumber, dataUrl: p.dataUrl })),
      allQuestions.map((q) => ({ id: q.id, dataUrl: q.dataUrl, originalDataUrl: q.originalDataUrl })),
      {
        onProgress: (prepareProgress) => {
          // Forward hashing and checking progress directly
          if (prepareProgress.phase === "hashing") {
            onProgress?.({
              phase: "hashing",
              message: prepareProgress.message,
              current: prepareProgress.current,
              total: prepareProgress.total,
              percentage: prepareProgress.percentage,
            });
          } else if (prepareProgress.phase === "checking") {
            onProgress?.({
              phase: "checking",
              message: prepareProgress.message,
              current: prepareProgress.current,
              total: prepareProgress.total,
              percentage: prepareProgress.percentage,
              round: prepareProgress.round,
              failedCount: prepareProgress.failedCount,
            });
          }
        },
        batchCheckOptions: {
          chunkSize: syncSettings.batchCheckChunkSize,
          concurrency: syncSettings.batchCheckConcurrency,
        },
      },
    );

    result.imagesSkipped = existingHashes.size;
    const totalImages = tasks.length;

    // Phase 3: Upload images to R2 with concurrency control
    onProgress?.({
      phase: "uploading",
      message: `准备上传 ${totalImages} 张图片 (${existingHashes.size} 张已存在)`,
      current: 0,
      total: totalImages,
      percentage: 0,
    });

    if (totalImages > 0) {
      globalUploader = new ConcurrentUploader(syncSettings.uploadConcurrency);
      globalUploader.setOnProgress((completed, total) => {
        const percentage = Math.round((completed / total) * 100);
        onProgress?.({
          phase: "uploading",
          message: `正在上传图片 ${completed}/${total} (${percentage}%)`,
          current: completed,
          total,
          percentage,
        });
      });

      const uploadResults = await globalUploader.upload(tasks, hashMap);
      globalUploader = null;

      // Count successful uploads
      result.imagesUploaded = uploadResults.filter((r) => r.success).length;
      const failedUploads = uploadResults.filter((r) => !r.success);

      if (failedUploads.length > 0) {
        result.errors.push(`${failedUploads.length} 张图片上传失败`);
        result.success = false;

        // 如果有图片上传失败，不要继续同步 exam 数据，因为数据不完整
        onProgress?.({
          phase: "completed",
          message: `上传失败: ${failedUploads.length} 张图片未能上传到 R2，数据同步已中止`,
          current: 0,
          total: totalImages,
          percentage: 0,
        });
        return result;
      }

      onProgress?.({
        phase: "uploading",
        message: `上传完成: ${totalImages} 张图片`,
        current: totalImages,
        total: totalImages,
        percentage: 100,
      });
    }

    // Phase 4: Sync exams to D1 with hash references
    onProgress?.({
      phase: "syncing",
      message: "正在同步数据到云端...",
      current: 0,
      total: totalExams,
      percentage: 0,
    });

    for (let i = 0; i < localList.length; i++) {
      const meta = localList[i];
      const exam = examDataMap.get(meta.id);
      if (!exam) continue;

      // Replace dataUrls with hashes
      const examWithHashes = prepareExamForRemote(exam, hashMap);

      const success = await saveRemoteExam(examWithHashes);
      if (success) {
        result.pushed++;
      } else {
        result.errors.push(`Failed to upload: ${meta.name}`);
        result.success = false;
      }

      const percentage = Math.round(((i + 1) / totalExams) * 100);
      onProgress?.({
        phase: "syncing",
        message: `正在同步: ${meta.name} (${i + 1}/${totalExams})`,
        current: i + 1,
        total: totalExams,
        percentage,
      });
    }

    syncState.lastSyncTime = Date.now();
    saveSyncState();

    const finalMessage = result.success
      ? `同步完成: ${result.pushed} 个试卷, ${result.imagesUploaded} 张图片上传`
      : `同步部分完成，但有错误: ${result.errors.join(", ")}`;

    onProgress?.({
      phase: "completed",
      message: finalMessage,
      current: totalExams,
      total: totalExams,
      percentage: result.success ? 100 : 0,
    });
  } catch (e) {
    result.success = false;
    result.errors.push(`Force upload failed: ${e}`);
    onProgress?.({
      phase: "completed",
      message: `同步失败: ${e}`,
      current: 0,
      total: 0,
      percentage: 0,
    });
  } finally {
    globalUploader = null;
    currentSyncAbortController = null;
  }

  return result;
};

/**
 * Prepare exam data for remote storage by replacing dataUrls with hashes
 */
function prepareExamForRemote(exam: ExamRecord, hashMap: Map<string, string>): ExamRecord {
  const rawPages = exam.rawPages.map((page) => ({
    ...page,
    dataUrl: isImageHash(page.dataUrl) ? page.dataUrl : (hashMap.get(page.dataUrl) || page.dataUrl),
  }));

  const questions = exam.questions.map((q) => ({
    ...q,
    dataUrl: isImageHash(q.dataUrl) ? q.dataUrl : (hashMap.get(q.dataUrl) || q.dataUrl),
    originalDataUrl: q.originalDataUrl
      ? isImageHash(q.originalDataUrl)
        ? q.originalDataUrl
        : (hashMap.get(q.originalDataUrl) || q.originalDataUrl)
      : undefined,
  }));

  return {
    ...exam,
    rawPages,
    questions,
  };
}

/**
 * Force download all remote data to local
 * Note: Downloaded data keeps hash references; frontend handles URL resolution
 */
export const forceDownloadAll = async (
  onProgress?: SyncProgressCallback,
): Promise<SyncResult> => {
  const result: SyncResult = {
    success: true,
    pushed: 0,
    pulled: 0,
    conflicts: [],
    errors: [],
  };

  currentSyncAbortController = new AbortController();

  try {
    onProgress?.({
      phase: "downloading",
      message: "正在获取远程数据列表...",
      current: 0,
      total: 0,
      percentage: 0,
    });

    const remoteList = await getRemoteExamList();
    const total = remoteList.length;

    if (total === 0) {
      onProgress?.({
        phase: "completed",
        message: "没有数据需要下载",
        current: 0,
        total: 0,
        percentage: 100,
      });
      return result;
    }

    onProgress?.({
      phase: "downloading",
      message: `准备下载 ${total} 个试卷`,
      current: 0,
      total,
      percentage: 0,
    });

    for (let i = 0; i < remoteList.length; i++) {
      const meta = remoteList[i];

      onProgress?.({
        phase: "downloading",
        message: `正在下载: ${meta.name}`,
        current: i,
        total,
        percentage: Math.round((i / total) * 100),
      });

      const exam = await getRemoteExam(meta.id);
      if (exam) {
        // Downloaded exam may have hash references instead of data URLs
        // The frontend will handle resolving these to actual URLs
        await saveExamToLocal(exam);
        result.pulled++;
      } else {
        result.errors.push(`Failed to download: ${meta.name}`);
      }
    }

    syncState.lastSyncTime = Date.now();
    saveSyncState();

    onProgress?.({
      phase: "completed",
      message: `下载完成: ${result.pulled} 个试卷`,
      current: total,
      total,
      percentage: 100,
    });
  } catch (e) {
    result.success = false;
    result.errors.push(`Force download failed: ${e}`);
    onProgress?.({
      phase: "completed",
      message: `下载失败: ${e}`,
      current: 0,
      total: 0,
      percentage: 0,
    });
  } finally {
    currentSyncAbortController = null;
  }

  return result;
};

// ============ Wrapper Functions for Dual Storage ============

/**
 * Save exam to local IndexedDB
 */
async function saveExamToLocal(exam: ExamRecord): Promise<void> {
  await storageService.saveExamResult(exam.name, exam.rawPages, exam.questions);
}

/**
 * Save exam to both local and remote (with offline support)
 */
export const saveExamWithSync = async (
  fileName: string,
  rawPages: ExamRecord["rawPages"],
  questions: ExamRecord["questions"] = [],
): Promise<string> => {
  // Always save locally first
  const id = await storageService.saveExamResult(fileName, rawPages, questions);

  // Get the full record for remote sync
  const exam = await storageService.loadExamResult(id);

  if (exam && syncState.isOnline) {
    // Try to sync immediately if online
    const success = await saveRemoteExam(exam);
    if (!success) {
      // Add to pending if remote save fails
      addPendingAction({
        type: "save",
        examId: id,
        timestamp: Date.now(),
        data: exam,
      });
    }
  } else if (exam) {
    // Offline - add to pending queue
    addPendingAction({
      type: "save",
      examId: id,
      timestamp: Date.now(),
      data: exam,
    });
  }

  return id;
};

/**
 * Delete exam from both local and remote (with offline support)
 */
export const deleteExamWithSync = async (id: string): Promise<void> => {
  // Always delete locally first
  await storageService.deleteExamResult(id);

  if (syncState.isOnline) {
    // Try to delete from remote immediately
    const success = await deleteRemoteExam(id);
    if (!success) {
      addPendingAction({
        type: "delete",
        examId: id,
        timestamp: Date.now(),
      });
    }
  } else {
    // Offline - add to pending queue
    addPendingAction({
      type: "delete",
      examId: id,
      timestamp: Date.now(),
    });
  }
};

/**
 * Delete multiple exams from both local and remote
 */
export const deleteExamsWithSync = async (ids: string[]): Promise<void> => {
  // Delete locally
  await storageService.deleteExamResults(ids);

  if (syncState.isOnline) {
    await deleteRemoteExams(ids).catch(() => {
      // Add to pending if fails
      for (const id of ids) {
        addPendingAction({
          type: "delete",
          examId: id,
          timestamp: Date.now(),
        });
      }
    });
  } else {
    for (const id of ids) {
      addPendingAction({
        type: "delete",
        examId: id,
        timestamp: Date.now(),
      });
    }
  }
};

/**
 * Update questions with sync
 */
export const updateQuestionsWithSync = async (fileName: string, questions: ExamRecord["questions"]): Promise<void> => {
  // Update locally
  await storageService.updateQuestionsForFile(fileName, questions);

  // Get updated record for sync
  const list = await storageService.getHistoryList();
  const meta = list.find((h) => h.name === fileName);

  if (meta) {
    const exam = await storageService.loadExamResult(meta.id);
    if (exam && syncState.isOnline) {
      await saveRemoteExam(exam).catch(() => {
        addPendingAction({
          type: "save",
          examId: meta.id,
          timestamp: Date.now(),
          data: exam,
        });
      });
    }
  }
};

/**
 * Re-save exam result with sync (used for recrop operations)
 */
export const reSaveExamResultWithSync = async (
  fileName: string,
  rawPages: ExamRecord["rawPages"],
  questions?: ExamRecord["questions"],
): Promise<void> => {
  console.log("[Sync] reSaveExamResultWithSync called for:", fileName);

  // Update locally first
  await storageService.reSaveExamResult(fileName, rawPages, questions);
  console.log("[Sync] Local save completed for:", fileName);

  // Get updated record for sync
  const list = await storageService.getHistoryList();
  const meta = list.find((h) => h.name === fileName);

  if (meta) {
    const exam = await storageService.loadExamResult(meta.id);
    if (exam && syncState.isOnline) {
      console.log("[Sync] Online - attempting remote save for:", fileName);
      await saveRemoteExam(exam).catch((error) => {
        console.error("[Sync] Remote save failed:", error);
        addPendingAction({
          type: "save",
          examId: meta.id,
          timestamp: Date.now(),
          data: exam,
        });
      });
      console.log("[Sync] Remote save attempt completed for:", fileName);
    } else if (exam) {
      console.log("[Sync] Offline - adding to pending queue:", fileName);
      // Offline - add to pending queue
      addPendingAction({
        type: "save",
        examId: meta.id,
        timestamp: Date.now(),
        data: exam,
      });
    }
  } else {
    console.warn("[Sync] No metadata found for:", fileName);
  }
};

/**
 * Update page detections and questions with sync (used for debug box adjustments)
 */
export const updatePageDetectionsAndQuestionsWithSync = async (
  fileName: string,
  pageNumber: number,
  newDetections: any[],
  newFileQuestions: ExamRecord["questions"],
): Promise<void> => {
  console.log("[Sync] updatePageDetectionsAndQuestionsWithSync called for:", fileName, "page:", pageNumber);

  // Update locally first
  await storageService.updatePageDetectionsAndQuestions(fileName, pageNumber, newDetections, newFileQuestions);
  console.log("[Sync] Local detection update completed for:", fileName);

  // Get updated record for sync
  const list = await storageService.getHistoryList();
  const meta = list.find((h) => h.name === fileName);

  if (meta) {
    const exam = await storageService.loadExamResult(meta.id);
    console.log("[Sync] isOnline:", syncState.isOnline, "exam loaded:", !!exam);
    if (exam && syncState.isOnline) {
      console.log("[Sync] Online - attempting remote save for detection update:", fileName);
      await saveRemoteExam(exam).catch((error) => {
        console.error("[Sync] Remote save failed:", error);
        addPendingAction({
          type: "save",
          examId: meta.id,
          timestamp: Date.now(),
          data: exam,
        });
      });
      console.log("[Sync] Remote save attempt completed for:", fileName);
    } else if (exam) {
      console.log("[Sync] Offline - adding to pending queue:", fileName);
      // Offline - add to pending queue
      addPendingAction({
        type: "save",
        examId: meta.id,
        timestamp: Date.now(),
        data: exam,
      });
    }
  } else {
    console.warn("[Sync] No metadata found for:", fileName);
  }
};

// ============ Auto Sync Setup ============

/**
 * Initialize sync service with online/offline listeners
 */
export const initSyncService = (): void => {
  // Load saved state
  loadSyncState();

  // Setup online/offline listeners
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => updateOnlineStatus(true));
    window.addEventListener("offline", () => updateOnlineStatus(false));
  }

  // Start auto-sync interval
  startAutoSync();
};

/**
 * Start automatic sync interval
 */
export const startAutoSync = (): void => {
  if (syncInterval) {
    clearInterval(syncInterval);
  }

  syncInterval = setInterval(() => {
    if (syncState.isOnline) {
      fullSync().catch(console.error);
    }
  }, SYNC_CONFIG.autoSyncInterval);
};

/**
 * Stop automatic sync
 */
export const stopAutoSync = (): void => {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
};

/**
 * Get current sync state
 */
export const getSyncState = (): SyncState => {
  return { ...syncState };
};

/**
 * Get pending action count
 */
export const getPendingCount = (): number => {
  return syncState.pendingActions.length;
};

/**
 * Clear all pending actions (use with caution)
 */
export const clearPendingActions = (): void => {
  syncState.pendingActions = [];
  saveSyncState();
};

/**
 * Reset sync state (force fresh sync)
 */
export const resetSyncState = (): void => {
  syncState = {
    lastSyncTime: 0,
    pendingActions: [],
    isOnline: navigator.onLine,
  };
  saveSyncState();
};

// ============ Sync Control Functions ============

/**
 * Pause current sync operation
 */
export const pauseSync = (): void => {
  if (globalUploader) {
    globalUploader.pause();
  }
};

/**
 * Resume paused sync operation
 */
export const resumeSync = (): void => {
  if (globalUploader) {
    globalUploader.resume();
  }
};

/**
 * Cancel current sync operation
 */
export const cancelSync = (): void => {
  if (globalUploader) {
    globalUploader.cancel();
  }
  if (currentSyncAbortController) {
    currentSyncAbortController.abort();
  }
};

/**
 * Check if sync is currently paused
 */
export const isSyncPaused = (): boolean => {
  if (globalUploader) {
    return globalUploader.getProgress().completed < globalUploader.getProgress().total;
  }
  return false;
};

/**
 * Get upload concurrency setting
 */
export const getUploadConcurrency = (): number => {
  return syncSettings.uploadConcurrency;
};

/**
 * Set upload concurrency
 */
export const setUploadConcurrency = (concurrency: number): void => {
  saveSyncSettings({ uploadConcurrency: concurrency });
  if (globalUploader) {
    globalUploader.setConcurrency(concurrency);
  }
};

/**
 * Get batch check chunk size
 */
export const getBatchCheckChunkSize = (): number => {
  return syncSettings.batchCheckChunkSize;
};

/**
 * Set batch check chunk size
 */
export const setBatchCheckChunkSize = (chunkSize: number): void => {
  saveSyncSettings({ batchCheckChunkSize: chunkSize });
  setBatchCheckSettings({ chunkSize });
};

/**
 * Get batch check concurrency
 */
export const getBatchCheckConcurrency = (): number => {
  return syncSettings.batchCheckConcurrency;
};

/**
 * Set batch check concurrency
 */
export const setBatchCheckConcurrency = (concurrency: number): void => {
  saveSyncSettings({ batchCheckConcurrency: concurrency });
  setBatchCheckSettings({ concurrency });
};
