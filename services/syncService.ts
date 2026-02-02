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
  uploadImageToR2,
  checkImageExists,
} from "./r2Service";
import * as syncHistoryService from "./syncHistoryService";

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
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
}

// Default sync settings
const defaultSyncSettings: SyncSettings = {
  uploadConcurrency: SYNC_CONFIG.defaultConcurrency,
  batchCheckChunkSize: 50,
  batchCheckConcurrency: 100,
  autoSyncEnabled: false,
  autoSyncIntervalMinutes: 5,
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
  // Detailed sync info for UI display
  pushedNames?: string[];
  pulledNames?: string[];
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
let lastProgress: SyncProgress | null = null;
const progressListeners = new Set<SyncProgressCallback>();

/**
 * Register a progress listener
 */
export const addProgressListener = (callback: SyncProgressCallback): void => {
  progressListeners.add(callback);
  // Send last progress if available
  if (lastProgress) {
    callback(lastProgress);
  }
};

/**
 * Remove a progress listener
 */
export const removeProgressListener = (callback: SyncProgressCallback): void => {
  progressListeners.delete(callback);
};

/**
 * Notify all progress listeners
 */
const notifyProgress = (progress: SyncProgress): void => {
  lastProgress = progress;
  progressListeners.forEach((callback) => callback(progress));
};

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
 * Returns the server timestamp if successful, null if failed
 */
export const saveRemoteExam = async (exam: ExamRecord): Promise<number | null> => {
  try {
    const result = await apiRequest<{ success: boolean; id: string; timestamp: number }>("/exams", {
      method: "POST",
      body: JSON.stringify(exam),
    });
    return result.timestamp || null;
  } catch (e) {
    console.error("Failed to save exam to remote:", e);
    return null;
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
        // Re-upload images and sync (action.data might be stale, so use uploadExamImagesToR2AndSync)
        const uploadResult = await uploadExamImagesToR2AndSync(action.data);
        if (uploadResult.success) {
          result.pushed++;
          syncState.pendingActions = syncState.pendingActions.filter((a) => a.examId !== action.examId);
        } else {
          result.errors.push(`Failed to sync exam: ${action.examId} - ${uploadResult.error}`);
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
 *
 * This performs a proper bidirectional sync:
 * 1. Get all local exams and their timestamps
 * 2. Get all remote exams and their timestamps
 * 3. Compare to determine what needs to be pushed vs pulled
 * 4. Push local changes (exams modified since last sync)
 * 5. Pull remote changes (exams modified on remote since last sync)
 */
export const fullSync = async (): Promise<SyncResult> => {
  const result: SyncResult = {
    success: true,
    pushed: 0,
    pulled: 0,
    conflicts: [],
    errors: [],
    pushedNames: [],
    pulledNames: [],
  };

  if (!syncState.isOnline) {
    result.success = false;
    result.errors.push("离线模式 - 无法同步");
    return result;
  }

  try {
    // Step 1: Get local exam list
    const localList = await storageService.getHistoryList();
    const localMap = new Map(localList.map((l) => [l.id, l]));

    // Step 2: Get remote exam list
    const remoteList = await getRemoteExamList();
    const remoteMap = new Map(remoteList.map((r) => [r.id, r]));

    // Step 3: Find exams that need to be pushed (local changes)
    // An exam needs to be pushed if:
    // - It doesn't exist on remote, OR
    // - Its local timestamp > lastSyncTime (was modified locally since last sync)
    // Also identify exams to force pull (Remote > Local)
    const examsToPush: string[] = [];
    const examsToForcePull: string[] = [];

    for (const local of localList) {
      const remote = remoteMap.get(local.id);
      if (!remote) {
        // Doesn't exist on remote - push it
        examsToPush.push(local.id);
      } else {
        // Check for push (Local modified)
        if (local.timestamp > syncState.lastSyncTime) {
          // Local was modified since last sync
          // Check for conflict: was remote also modified?
          if (remote.timestamp > syncState.lastSyncTime) {
            // Conflict: both sides modified
            // For now, use "last write wins" - the more recent one wins
            if (local.timestamp > remote.timestamp) {
              examsToPush.push(local.id);
            }
            // If remote is newer, it will be pulled later via /sync/pull or examsToForcePull
            result.conflicts.push({
              id: local.id,
              name: local.name,
              localTimestamp: local.timestamp,
              remoteTimestamp: remote.timestamp,
              resolution: local.timestamp > remote.timestamp ? "local" : "remote",
            });
          } else {
            // Only local was modified - push it
            examsToPush.push(local.id);
          }
        }

        // Check for force pull (Remote is newer than Local)
        // This covers cases where Local is "stale" (reverted/restored to old version)
        // even if it hasn't been modified "since last sync"
        if (remote.timestamp > local.timestamp) {
          examsToForcePull.push(local.id);
        }
      }
    }

    // Step 3.5: Find exams that exist on remote but not locally
    // These need to be pulled regardless of lastSyncTime
    for (const remote of remoteList) {
      if (!localMap.has(remote.id)) {
        examsToForcePull.push(remote.id);
      }
    }

    // Step 4: Push local changes
    for (const examId of examsToPush) {
      try {
        const exam = await storageService.loadExamResult(examId);
        if (!exam) continue;

        // Upload images and sync to remote
        const uploadResult = await uploadExamImagesToR2AndSync(exam);
        if (uploadResult.success) {
          result.pushed++;
          result.pushedNames!.push(exam.name);
        } else {
          result.errors.push(`推送失败: ${exam.name} - ${uploadResult.error}`);
        }
      } catch (e) {
        const local = localMap.get(examId);
        result.errors.push(`推送失败: ${local?.name || examId} - ${e}`);
      }
    }

    // Also process any pending actions (from previous failed syncs)
    const pendingActions = [...syncState.pendingActions];
    for (const action of pendingActions) {
      try {
        if (action.type === "save" && action.data) {
          // Skip if we already pushed this exam above
          if (examsToPush.includes(action.examId)) {
            syncState.pendingActions = syncState.pendingActions.filter((a) => a.examId !== action.examId);
            continue;
          }
          const uploadResult = await uploadExamImagesToR2AndSync(action.data);
          if (uploadResult.success) {
            result.pushed++;
            result.pushedNames!.push(action.data.name);
            syncState.pendingActions = syncState.pendingActions.filter((a) => a.examId !== action.examId);
          }
        } else if (action.type === "delete") {
          const success = await deleteRemoteExam(action.examId);
          if (success) {
            syncState.pendingActions = syncState.pendingActions.filter((a) => a.examId !== action.examId);
          }
        }
      } catch (e) {
        result.errors.push(`待同步操作失败: ${action.examId} - ${e}`);
      }
    }

    // Step 5: Pull remote changes
    // Get changes since last sync time
    const pullResult = await apiRequest<{
      exams: ExamRecord[];
      deleted: string[];
      syncTime: number;
    }>("/sync/pull", {
      method: "POST",
      body: JSON.stringify({ since: syncState.lastSyncTime }),
    });

    // Process remote exam updates
    for (const remoteExam of pullResult.exams) {
      // Skip if we just pushed this exam (we have the latest version)
      if (examsToPush.includes(remoteExam.id)) {
        continue;
      }

      // Check if this is a conflict we already handled
      const conflict = result.conflicts.find((c) => c.id === remoteExam.id);
      if (conflict && conflict.resolution === "local") {
        // We chose local version, skip remote
        continue;
      }

      // Save remote version locally
      await saveExamToLocal(remoteExam);
      result.pulled++;
      result.pulledNames!.push(remoteExam.name);
    }

    // Process remote deletions
    for (const deletedId of pullResult.deleted) {
      // Only delete if we didn't just push it
      if (!examsToPush.includes(deletedId)) {
        await storageService.deleteExamResult(deletedId);
      }
    }

    // Capture IDs processed by standard pull
    const processedIds = new Set(pullResult.exams.map(e => e.id));

    // Step 6: Force pull exams that are newer on remote but missed by /sync/pull
    // (This happens when local files are reverted to old versions older than lastSyncTime)
    for (const id of examsToForcePull) {
      if (processedIds.has(id)) continue;
      if (pullResult.deleted.includes(id)) continue;
      
      try {
        const exam = await getRemoteExam(id);
        if (exam) {
          // Check again if we should overwrite (though examsToForcePull logic implies we should)
          const currentLocal = await storageService.loadExamResult(id);
          if (currentLocal && currentLocal.timestamp >= exam.timestamp) continue;

          await saveExamToLocal(exam);
          result.pulled++;
          result.pulledNames!.push(exam.name);
          processedIds.add(id);
        }
      } catch (e) {
        result.errors.push(`补充拉取失败: ${id} - ${e}`);
      }
    }

    // Update sync time
    syncState.lastSyncTime = pullResult.syncTime;
    saveSyncState();

    // Record sync history - Split into push and pull records
    if (result.pushedNames && result.pushedNames.length > 0) {
      await syncHistoryService.saveSyncHistory(
        "push",
        result.pushedNames,
        result.success,
        result.errors.length > 0 ? result.errors.join("; ") : undefined
      );
    }

    if (result.pulledNames && result.pulledNames.length > 0) {
      await syncHistoryService.saveSyncHistory(
        "pull",
        result.pulledNames,
        result.success,
        result.errors.length > 0 ? result.errors.join("; ") : undefined
      );
    }
  } catch (e) {
    result.success = false;
    result.errors.push(`同步失败: ${e}`);
    // Record failed sync
    await syncHistoryService.saveSyncHistory("full_sync", [], false, `同步失败: ${e}`);
  }

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
export const forceUploadAll = async (onProgress?: SyncProgressCallback): Promise<SyncResult> => {
  const result: SyncResult = {
    success: true,
    pushed: 0,
    pulled: 0,
    conflicts: [],
    errors: [],
    imagesUploaded: 0,
    imagesSkipped: 0,
    pushedNames: [],
  };

  const handleProgress = (progress: SyncProgress) => {
    onProgress?.(progress);
    notifyProgress(progress);
  };

  currentSyncAbortController = new AbortController();

  try {
    // Phase 0: Load local exam data
    handleProgress({
      phase: "hashing",
      message: "正在加载本地数据...",
      current: 0,
      total: 0,
      percentage: 0,
    });

    const localList = await storageService.getHistoryList();
    const totalExams = localList.length;

    if (totalExams === 0) {
      handleProgress({
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
    const allQuestions: Array<{ examId: string; id: string; dataUrl: string }> = [];
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
          });
        }
      }
    }

    // Phase 1 & 2: Prepare upload tasks (includes hashing and checking phases)
    // The prepareUploadTasks function now handles progress for both hashing and checking
    const { tasks, hashMap, existingHashes } = await prepareUploadTasks(
      allRawPages.map((p) => ({ pageNumber: p.pageNumber, dataUrl: p.dataUrl })),
      allQuestions.map((q) => ({ id: q.id, dataUrl: q.dataUrl })),
      {
        onProgress: (prepareProgress) => {
          // Forward hashing and checking progress directly
          if (prepareProgress.phase === "hashing") {
            handleProgress({
              phase: "hashing",
              message: prepareProgress.message,
              current: prepareProgress.current,
              total: prepareProgress.total,
              percentage: prepareProgress.percentage,
            });
          } else if (prepareProgress.phase === "checking") {
            handleProgress({
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
      }
    );

    result.imagesSkipped = existingHashes.size;
    const totalImages = tasks.length;

    // Phase 3: Upload images to R2 with concurrency control
    // Use batchCheckConcurrency for upload concurrency as well (user expectation)
    const uploadConcurrency = syncSettings.batchCheckConcurrency;

    handleProgress({
      phase: "uploading",
      message: `准备上传 ${totalImages} 张图片 (${existingHashes.size} 张已存在, 并发: ${uploadConcurrency})`,
      current: 0,
      total: totalImages,
      percentage: 0,
    });

    if (totalImages > 0) {
      globalUploader = new ConcurrentUploader(uploadConcurrency);
      globalUploader.setOnProgress((uploadProgress) => {
        handleProgress({
          phase: "uploading",
          message: uploadProgress.message,
          current: uploadProgress.current,
          total: uploadProgress.total,
          percentage: uploadProgress.percentage,
          round: uploadProgress.round,
          failedCount: uploadProgress.failedCount,
        });
      });

      const uploadResults = await globalUploader.upload(tasks, hashMap);
      globalUploader = null;

      // Count successful uploads (with retry, all should succeed unless cancelled)
      result.imagesUploaded = uploadResults.filter((r) => r.success).length;
      const failedUploads = uploadResults.filter((r) => !r.success && r.error !== "Cancelled");

      if (failedUploads.length > 0) {
        // This should rarely happen now with infinite retry
        result.errors.push(`${failedUploads.length} 张图片上传失败`);
        result.success = false;

        handleProgress({
          phase: "completed",
          message: `上传失败: ${failedUploads.length} 张图片未能上传到 R2，数据同步已中止`,
          current: 0,
          total: totalImages,
          percentage: 0,
        });
        return result;
      }

      // Check if cancelled
      const cancelledUploads = uploadResults.filter((r) => r.error === "Cancelled");
      if (cancelledUploads.length > 0) {
        result.errors.push(`上传已取消，${cancelledUploads.length} 张图片未上传`);
        result.success = false;

        handleProgress({
          phase: "completed",
          message: `上传已取消`,
          current: result.imagesUploaded,
          total: totalImages,
          percentage: 0,
        });
        return result;
      }
    }

    // Phase 4: Sync exams to D1 with hash references
    handleProgress({
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

      const serverTimestamp = await saveRemoteExam(examWithHashes);
      if (serverTimestamp) {
        // Update local storage with server timestamp to keep in sync
        await storageService.saveExamResult(
          examWithHashes.name,
          examWithHashes.rawPages,
          examWithHashes.questions,
          exam.id,
          serverTimestamp
        );
        result.pushed++;
        result.pushedNames!.push(examWithHashes.name);
      } else {
        result.errors.push(`Failed to upload: ${meta.name}`);
        result.success = false;
      }

      const percentage = Math.round(((i + 1) / totalExams) * 100);
      handleProgress({
        phase: "syncing",
        message: `正在同步: ${meta.name} (${i + 1}/${totalExams})`,
        current: i + 1,
        total: totalExams,
        percentage,
      });
    }

    syncState.lastSyncTime = Date.now();
    saveSyncState();

    // Record sync history
    const pushedNames = result.pushedNames || [];
    await syncHistoryService.saveSyncHistory(
      "push",
      pushedNames,
      result.success,
      result.errors.length > 0 ? result.errors.join("; ") : undefined
    );

    const finalMessage = result.success
      ? `同步完成: ${result.pushed} 个试卷, ${result.imagesUploaded} 张图片上传`
      : `同步部分完成，但有错误: ${result.errors.join(", ")}`;

    handleProgress({
      phase: "completed",
      message: finalMessage,
      current: totalExams,
      total: totalExams,
      percentage: result.success ? 100 : 0,
    });
  } catch (e) {
    result.success = false;
    result.errors.push(`Force upload failed: ${e}`);
    // Record failed sync
    await syncHistoryService.saveSyncHistory("push", [], false, `Force upload failed: ${e}`);
    handleProgress({
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
 * Force upload selected exams to remote with R2 image upload
 * Supports progress callback, pause/resume
 *
 * Progress phases (each phase has independent 0-100%):
 * 1. hashing - Calculate image hashes
 * 2. checking - Check which images exist in R2
 * 3. uploading - Upload missing images to R2
 * 4. syncing - Sync exam data to D1
 */
export const forceUploadSelected = async (
  selectedExamIds: string[],
  onProgress?: SyncProgressCallback
): Promise<SyncResult> => {
  const result: SyncResult = {
    success: true,
    pushed: 0,
    pulled: 0,
    conflicts: [],
    errors: [],
    imagesUploaded: 0,
    imagesSkipped: 0,
    pushedNames: [],
  };

  const handleProgress = (progress: SyncProgress) => {
    onProgress?.(progress);
    notifyProgress(progress);
  };

  currentSyncAbortController = new AbortController();

  try {
    // Phase 0: Load local exam data
    handleProgress({
      phase: "hashing",
      message: "正在加载选中数据...",
      current: 0,
      total: 0,
      percentage: 0,
    });

    if (selectedExamIds.length === 0) {
      handleProgress({
        phase: "completed",
        message: "没有选中数据需要同步",
        current: 0,
        total: 0,
        percentage: 100,
      });
      return result;
    }

    const localList = await storageService.getHistoryList();
    const selectedList = localList.filter((meta) => selectedExamIds.includes(meta.id));
    const totalExams = selectedList.length;

    if (totalExams === 0) {
      handleProgress({
        phase: "completed",
        message: "没有数据需要同步",
        current: 0,
        total: 0,
        percentage: 100,
      });
      return result;
    }

    // Collect all images from selected exams
    const allRawPages: Array<{ examId: string; pageNumber: number; dataUrl: string }> = [];
    const allQuestions: Array<{ examId: string; id: string; dataUrl: string }> = [];
    const examDataMap = new Map<string, ExamRecord>();

    for (let i = 0; i < selectedList.length; i++) {
      const meta = selectedList[i];
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
          });
        }
      }
    }

    // Phase 1 & 2: Prepare upload tasks (includes hashing and checking phases)
    // The prepareUploadTasks function now handles progress for both hashing and checking
    const { tasks, hashMap, existingHashes } = await prepareUploadTasks(
      allRawPages.map((p) => ({ pageNumber: p.pageNumber, dataUrl: p.dataUrl })),
      allQuestions.map((q) => ({ id: q.id, dataUrl: q.dataUrl })),
      {
        onProgress: (prepareProgress) => {
          // Forward hashing and checking progress directly
          if (prepareProgress.phase === "hashing") {
            handleProgress({
              phase: "hashing",
              message: prepareProgress.message,
              current: prepareProgress.current,
              total: prepareProgress.total,
              percentage: prepareProgress.percentage,
            });
          } else if (prepareProgress.phase === "checking") {
            handleProgress({
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
      }
    );

    result.imagesSkipped = existingHashes.size;
    const totalImages = tasks.length;

    // Phase 3: Upload images to R2 with concurrency control
    // Use batchCheckConcurrency for upload concurrency as well (user expectation)
    const uploadConcurrency = syncSettings.batchCheckConcurrency;

    handleProgress({
      phase: "uploading",
      message: `准备上传 ${totalImages} 张图片 (${existingHashes.size} 张已存在, 并发: ${uploadConcurrency})`,
      current: 0,
      total: totalImages,
      percentage: 0,
    });

    if (totalImages > 0) {
      globalUploader = new ConcurrentUploader(uploadConcurrency);
      globalUploader.setOnProgress((uploadProgress) => {
        handleProgress({
          phase: "uploading",
          message: uploadProgress.message,
          current: uploadProgress.current,
          total: uploadProgress.total,
          percentage: uploadProgress.percentage,
          round: uploadProgress.round,
          failedCount: uploadProgress.failedCount,
        });
      });

      const uploadResults = await globalUploader.upload(tasks, hashMap);
      globalUploader = null;

      // Count successful uploads (with retry, all should succeed unless cancelled)
      result.imagesUploaded = uploadResults.filter((r) => r.success).length;
      const failedUploads = uploadResults.filter((r) => !r.success && r.error !== "Cancelled");

      if (failedUploads.length > 0) {
        // This should rarely happen now with infinite retry
        result.errors.push(`${failedUploads.length} 张图片上传失败`);
        result.success = false;

        handleProgress({
          phase: "completed",
          message: `上传失败: ${failedUploads.length} 张图片未能上传到 R2，数据同步已中止`,
          current: 0,
          total: totalImages,
          percentage: 0,
        });
        return result;
      }

      // Check if cancelled
      const cancelledUploads = uploadResults.filter((r) => r.error === "Cancelled");
      if (cancelledUploads.length > 0) {
        result.errors.push(`上传已取消，${cancelledUploads.length} 张图片未上传`);
        result.success = false;

        handleProgress({
          phase: "completed",
          message: `上传已取消`,
          current: result.imagesUploaded,
          total: totalImages,
          percentage: 0,
        });
        return result;
      }
    }

    // Phase 4: Sync exams to D1 with hash references
    handleProgress({
      phase: "syncing",
      message: "正在同步数据到云端...",
      current: 0,
      total: totalExams,
      percentage: 0,
    });

    for (let i = 0; i < selectedList.length; i++) {
      const meta = selectedList[i];
      const exam = examDataMap.get(meta.id);
      if (!exam) continue;

      // Replace dataUrls with hashes
      const examWithHashes = prepareExamForRemote(exam, hashMap);

      const serverTimestamp = await saveRemoteExam(examWithHashes);
      if (serverTimestamp) {
        // Update local storage with server timestamp to keep in sync
        await storageService.saveExamResult(
          examWithHashes.name,
          examWithHashes.rawPages,
          examWithHashes.questions,
          exam.id,
          serverTimestamp
        );
        result.pushed++;
      } else {
        result.errors.push(`Failed to upload: ${meta.name}`);
        result.success = false;
      }

      const percentage = Math.round(((i + 1) / totalExams) * 100);
      handleProgress({
        phase: "syncing",
        message: `正在同步: ${meta.name} (${i + 1}/${totalExams})`,
        current: i + 1,
        total: totalExams,
        percentage,
      });
    }

    syncState.lastSyncTime = Date.now();
    saveSyncState();

    // Record sync history for selected upload
    const pushedNames = result.pushedNames || [];
    await syncHistoryService.saveSyncHistory(
      "push",
      pushedNames,
      result.success,
      result.errors.length > 0 ? result.errors.join("; ") : undefined
    );

    const finalMessage = result.success
      ? `同步完成: ${result.pushed} 个试卷, ${result.imagesUploaded} 张图片上传`
      : `同步部分完成，但有错误: ${result.errors.join(", ")}`;

    handleProgress({
      phase: "completed",
      message: finalMessage,
      current: totalExams,
      total: totalExams,
      percentage: result.success ? 100 : 0,
    });
  } catch (e) {
    result.success = false;
    result.errors.push(`Force upload failed: ${e}`);
    // Record failed sync
    await syncHistoryService.saveSyncHistory("push", [], false, `Force upload failed: ${e}`);
    handleProgress({
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
    dataUrl: isImageHash(page.dataUrl) ? page.dataUrl : hashMap.get(page.dataUrl) || page.dataUrl,
  }));

  const questions = exam.questions.map((q) => ({
    ...q,
    dataUrl: isImageHash(q.dataUrl) ? q.dataUrl : hashMap.get(q.dataUrl) || q.dataUrl,
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
export const forceDownloadAll = async (onProgress?: SyncProgressCallback): Promise<SyncResult> => {
  const result: SyncResult = {
    success: true,
    pushed: 0,
    pulled: 0,
    conflicts: [],
    errors: [],
    pulledNames: [],
  };

  const handleProgress = (progress: SyncProgress) => {
    onProgress?.(progress);
    notifyProgress(progress);
  };

  currentSyncAbortController = new AbortController();

  try {
    handleProgress({
      phase: "downloading",
      message: "正在获取远程数据列表...",
      current: 0,
      total: 0,
      percentage: 0,
    });

    const remoteList = await getRemoteExamList();
    const total = remoteList.length;

    if (total === 0) {
      handleProgress({
        phase: "completed",
        message: "没有数据需要下载",
        current: 0,
        total: 0,
        percentage: 100,
      });
      return result;
    }

    handleProgress({
      phase: "downloading",
      message: `准备下载 ${total} 个试卷`,
      current: 0,
      total,
      percentage: 0,
    });

    for (let i = 0; i < remoteList.length; i++) {
      const meta = remoteList[i];

      handleProgress({
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
        result.pulledNames!.push(exam.name);
      } else {
        result.errors.push(`Failed to download: ${meta.name}`);
      }
    }

    syncState.lastSyncTime = Date.now();
    saveSyncState();

    // Record sync history
    const pulledNames = result.pulledNames || [];
    await syncHistoryService.saveSyncHistory(
      "pull",
      pulledNames,
      result.success,
      result.errors.length > 0 ? result.errors.join("; ") : undefined
    );

    handleProgress({
      phase: "completed",
      message: `下载完成: ${result.pulled} 个试卷`,
      current: total,
      total,
      percentage: 100,
    });
  } catch (e) {
    result.success = false;
    result.errors.push(`Force download failed: ${e}`);
    // Record failed sync
    await syncHistoryService.saveSyncHistory("pull", [], false, `Force download failed: ${e}`);
    handleProgress({
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

/**
 * Force download selected exams from remote to local
 * Note: Downloaded data keeps hash references; frontend handles URL resolution
 */
export const forceDownloadSelected = async (
  selectedExamIds: string[],
  onProgress?: SyncProgressCallback
): Promise<SyncResult> => {
  const result: SyncResult = {
    success: true,
    pushed: 0,
    pulled: 0,
    conflicts: [],
    errors: [],
    pulledNames: [],
  };

  const handleProgress = (progress: SyncProgress) => {
    onProgress?.(progress);
    notifyProgress(progress);
  };

  currentSyncAbortController = new AbortController();

  try {
    const total = selectedExamIds.length;

    handleProgress({
      phase: "downloading",
      message: `准备下载 ${total} 个试卷`,
      current: 0,
      total,
      percentage: 0,
    });

    for (let i = 0; i < total; i++) {
      const id = selectedExamIds[i];

      handleProgress({
        phase: "downloading",
        message: `正在下载 ID: ${id}...`,
        current: i,
        total,
        percentage: Math.round((i / total) * 100),
      });

      try {
        const exam = await getRemoteExam(id);
        if (exam) {
          await saveExamToLocal(exam);
          result.pulled++;
          result.pulledNames!.push(exam.name);
          
          handleProgress({
             phase: "downloading",
             message: `正在下载: ${exam.name}`,
             current: i + 1,
             total,
             percentage: Math.round(((i + 1) / total) * 100),
           });
        } else {
          result.errors.push(`Failed to download exam ID: ${id} (Not found on remote)`);
        }
      } catch (err) {
         result.errors.push(`Failed to download exam ID: ${id} - ${err}`);
      }
    }

    syncState.lastSyncTime = Date.now();
    saveSyncState();

    // Record sync history
    const pulledNames = result.pulledNames || [];
    await syncHistoryService.saveSyncHistory(
      "pull",
      pulledNames,
      result.success,
      result.errors.length > 0 ? result.errors.join("; ") : undefined
    );

    handleProgress({
      phase: "completed",
      message: `下载完成: ${result.pulled} 个试卷`,
      current: total,
      total,
      percentage: 100,
    });
  } catch (e) {
    result.success = false;
    result.errors.push(`Force download failed: ${e}`);
    // Record failed sync
    await syncHistoryService.saveSyncHistory("pull", [], false, `Force download failed: ${e}`);
    handleProgress({
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
 * IMPORTANT: Must preserve both exam.id and exam.timestamp to maintain consistency between local and remote!
 * - Preserving ID prevents duplicate records
 * - Preserving timestamp ensures sync logic correctly detects which version is newer
 * Without preserving timestamp, a pulled exam would get a new timestamp (Date.now()), making it appear
 * newer than the remote version, causing the next sync to incorrectly push it back.
 */
async function saveExamToLocal(exam: ExamRecord): Promise<void> {
  // Pass exam.id and exam.timestamp to maintain consistency across devices
  await storageService.saveExamResult(exam.name, exam.rawPages, exam.questions, exam.id, exam.timestamp);
}

/**
 * Upload images for a single exam to R2 and sync to remote D1
 * This is the core function for incremental/fine-grained sync
 *
 * @param exam - The exam record to sync
 * @returns Object with upload stats and the exam with hashes
 */
async function uploadExamImagesToR2AndSync(exam: ExamRecord): Promise<{
  success: boolean;
  imagesUploaded: number;
  imagesSkipped: number;
  error?: string;
}> {
  const result = {
    success: true,
    imagesUploaded: 0,
    imagesSkipped: 0,
    error: undefined as string | undefined,
  };

  try {
    // Collect all base64 images that need to be uploaded
    const imagesToProcess: Array<{ dataUrl: string; type: "rawPage" | "question"; index: number }> = [];

    // Collect from rawPages
    exam.rawPages.forEach((page, index) => {
      if (!isImageHash(page.dataUrl)) {
        imagesToProcess.push({ dataUrl: page.dataUrl, type: "rawPage", index });
      }
    });

    // Collect from questions
    exam.questions.forEach((q, index) => {
      if (!isImageHash(q.dataUrl)) {
        imagesToProcess.push({ dataUrl: q.dataUrl, type: "question", index });
      }
    });

    console.log(`[Sync] Found ${imagesToProcess.length} images to process for ${exam.name}`);

    if (imagesToProcess.length === 0) {
      // No new images, just sync metadata to remote
      const examWithHashes = exam; // Already all hashes
      const serverTimestamp = await saveRemoteExam(examWithHashes);
      if (!serverTimestamp) {
        result.success = false;
        result.error = "Failed to sync to remote";
        return result;
      }
      // Update local storage with server timestamp to keep in sync
      await storageService.saveExamResult(
        examWithHashes.name,
        examWithHashes.rawPages,
        examWithHashes.questions,
        exam.id,
        serverTimestamp
      );
      return result;
    }

    // Calculate hashes for all images
    const hashMap = new Map<string, string>(); // dataUrl -> hash
    const uniqueDataUrls = [...new Set(imagesToProcess.map((img) => img.dataUrl))];

    console.log(`[Sync] Calculating hashes for ${uniqueDataUrls.length} unique images...`);

    for (const dataUrl of uniqueDataUrls) {
      const hash = await calculateImageHash(dataUrl);
      hashMap.set(dataUrl, hash);
    }

    // Check which hashes already exist in R2
    const uniqueHashes = [...new Set(hashMap.values())];
    console.log(`[Sync] Checking ${uniqueHashes.length} hashes in R2...`);

    const existsMap = await batchCheckImagesExist(uniqueHashes, {
      chunkSize: syncSettings.batchCheckChunkSize,
      concurrency: syncSettings.batchCheckConcurrency,
    });

    // Upload missing images
    const hashesToUpload = uniqueHashes.filter((h) => !existsMap[h]);
    console.log(
      `[Sync] ${hashesToUpload.length} images need upload, ${uniqueHashes.length - hashesToUpload.length} already exist`
    );

    result.imagesSkipped = uniqueHashes.length - hashesToUpload.length;

    // Create reverse map: hash -> dataUrl (for uploading)
    const hashToDataUrl = new Map<string, string>();
    for (const [dataUrl, hash] of hashMap.entries()) {
      if (!hashToDataUrl.has(hash)) {
        hashToDataUrl.set(hash, dataUrl);
      }
    }

    // Upload missing images
    for (const hash of hashesToUpload) {
      const dataUrl = hashToDataUrl.get(hash);
      if (!dataUrl) continue;

      const uploaded = await uploadImageToR2(hash, dataUrl);
      if (uploaded) {
        result.imagesUploaded++;
      } else {
        console.error(`[Sync] Failed to upload image with hash: ${hash}`);
        result.success = false;
        result.error = `Failed to upload image`;
        return result;
      }
    }

    console.log(`[Sync] Uploaded ${result.imagesUploaded} images to R2`);

    // Prepare exam with hashes for remote sync
    const examWithHashes: ExamRecord = {
      ...exam,
      rawPages: exam.rawPages.map((page) => ({
        ...page,
        dataUrl: isImageHash(page.dataUrl) ? page.dataUrl : hashMap.get(page.dataUrl) || page.dataUrl,
      })),
      questions: exam.questions.map((q) => ({
        ...q,
        dataUrl: isImageHash(q.dataUrl) ? q.dataUrl : hashMap.get(q.dataUrl) || q.dataUrl,
      })),
    };

    // Sync to remote D1
    console.log(`[Sync] Syncing ${exam.name} to remote...`);
    const serverTimestamp = await saveRemoteExam(examWithHashes);
    if (!serverTimestamp) {
      result.success = false;
      result.error = "Failed to sync to remote D1";
      return result;
    }

    // Also update local storage with hashes and server timestamp to keep in sync
    // IMPORTANT: Pass exam.id and serverTimestamp to maintain consistency
    // The server timestamp ensures that local and remote timestamps match,
    // preventing the next sync from incorrectly thinking the local version is newer.
    await storageService.saveExamResult(
      examWithHashes.name,
      examWithHashes.rawPages,
      examWithHashes.questions,
      exam.id,
      serverTimestamp
    );
    console.log(
      `[Sync] Successfully synced ${exam.name}: ${result.imagesUploaded} uploaded, ${result.imagesSkipped} skipped`
    );
  } catch (e) {
    result.success = false;
    result.error = e instanceof Error ? e.message : String(e);
    console.error(`[Sync] Error syncing ${exam.name}:`, e);
  }

  return result;
}

/**
 * Save exam to local IndexedDB and sync to remote with R2 image upload
 * This is the fine-grained sync version
 */
export const saveExamWithSync = async (
  fileName: string,
  rawPages: ExamRecord["rawPages"],
  questions: ExamRecord["questions"] = []
): Promise<string> => {
  // Save locally first
  const id = await storageService.saveExamResult(fileName, rawPages, questions);
  console.log("[Sync] Exam saved locally:", fileName, "id:", id);

  // If online, sync to remote with R2 upload
  if (syncState.isOnline) {
    const exam = await storageService.loadExamResult(id);
    if (exam) {
      const result = await uploadExamImagesToR2AndSync(exam);
      if (!result.success) {
        console.error("[Sync] Remote sync failed:", result.error);
        addPendingAction({
          type: "save",
          examId: id,
          timestamp: Date.now(),
          data: exam,
        });
      }
    }
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
    // deleteRemoteExams returns boolean, not throws, so check return value
    const success = await deleteRemoteExams(ids);
    if (!success) {
      // Add to pending if fails
      for (const id of ids) {
        addPendingAction({
          type: "delete",
          examId: id,
          timestamp: Date.now(),
        });
      }
    }
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
 * Update questions with sync (fine-grained: only uploads changed images)
 */
export const updateQuestionsWithSync = async (fileName: string, questions: ExamRecord["questions"]): Promise<void> => {
  // Update locally first
  await storageService.updateQuestionsForFile(fileName, questions);
  console.log("[Sync] Questions updated locally for:", fileName);

  const list = await storageService.getHistoryList();
  const meta = list.find((h) => h.name === fileName);

  if (!meta) return;

  // If online, sync to remote with R2 upload (fine-grained)
  if (syncState.isOnline) {
    const exam = await storageService.loadExamResult(meta.id);
    if (exam) {
      const result = await uploadExamImagesToR2AndSync(exam);
      if (!result.success) {
        console.error("[Sync] Remote sync failed:", result.error);
        addPendingAction({
          type: "save",
          examId: meta.id,
          timestamp: Date.now(),
          data: exam,
        });
      }
    }
  } else {
    // Offline - add to pending queue for later sync
    console.log("[Sync] Offline - adding to pending queue:", fileName);
    const exam = await storageService.loadExamResult(meta.id);
    if (exam) {
      addPendingAction({
        type: "save",
        examId: meta.id,
        timestamp: Date.now(),
        data: exam,
      });
    }
  }
};

/**
 * Re-save exam result with sync (used for recrop operations)
 * Fine-grained: only uploads changed images to R2 and syncs this file
 */
export const reSaveExamResultWithSync = async (
  fileName: string,
  rawPages: ExamRecord["rawPages"],
  questions?: ExamRecord["questions"]
): Promise<void> => {
  console.log("[Sync] reSaveExamResultWithSync called for:", fileName);

  // Update locally first
  await storageService.reSaveExamResult(fileName, rawPages, questions);
  console.log("[Sync] Local save completed for:", fileName);

  const list = await storageService.getHistoryList();
  const meta = list.find((h) => h.name === fileName);

  if (!meta) return;

  // If online, sync to remote with R2 upload (fine-grained)
  if (syncState.isOnline) {
    const exam = await storageService.loadExamResult(meta.id);
    if (exam) {
      const result = await uploadExamImagesToR2AndSync(exam);
      if (!result.success) {
        console.error("[Sync] Remote sync failed:", result.error);
        addPendingAction({
          type: "save",
          examId: meta.id,
          timestamp: Date.now(),
          data: exam,
        });
      } else {
        console.log(
          `[Sync] Synced ${fileName}: ${result.imagesUploaded} images uploaded, ${result.imagesSkipped} skipped`
        );
      }
    }
  } else {
    // Offline - add to pending queue for later sync
    console.log("[Sync] Offline - adding to pending queue:", fileName);
    const exam = await storageService.loadExamResult(meta.id);
    if (exam) {
      addPendingAction({
        type: "save",
        examId: meta.id,
        timestamp: Date.now(),
        data: exam,
      });
    }
  }
};

/**
 * Update page detections and questions with sync (used for debug box adjustments)
 * Fine-grained: only uploads changed images to R2 and syncs this file
 *
 * When user adjusts boundaries in debug boxes:
 * 1. New question images are generated (base64 dataUrl)
 * 2. This function uploads only those new images to R2
 * 3. Updates the data_url to hash references
 * 4. Syncs only this file to remote D1
 */
export const updatePageDetectionsAndQuestionsWithSync = async (
  fileName: string,
  pageNumber: number,
  newDetections: any[],
  newFileQuestions: ExamRecord["questions"]
): Promise<void> => {
  console.log("[Sync] updatePageDetectionsAndQuestionsWithSync called for:", fileName, "page:", pageNumber);

  // Update locally first - this saves the new base64 dataUrls to IndexedDB
  await storageService.updatePageDetectionsAndQuestions(fileName, pageNumber, newDetections, newFileQuestions);
  console.log("[Sync] Local detection update completed for:", fileName);

  const list = await storageService.getHistoryList();
  const meta = list.find((h) => h.name === fileName);

  if (!meta) return;

  // If online, sync to remote with R2 upload (fine-grained)
  if (syncState.isOnline) {
    const exam = await storageService.loadExamResult(meta.id);
    if (exam) {
      console.log(`[Sync] Starting fine-grained sync for ${fileName}...`);
      const result = await uploadExamImagesToR2AndSync(exam);
      if (!result.success) {
        console.error("[Sync] Remote sync failed:", result.error);
        addPendingAction({
          type: "save",
          examId: meta.id,
          timestamp: Date.now(),
          data: exam,
        });
      } else {
        console.log(
          `[Sync] Fine-grained sync completed for ${fileName}: ${result.imagesUploaded} images uploaded, ${result.imagesSkipped} skipped`
        );
      }
    }
  } else {
    // Offline - add to pending queue for later sync
    console.log("[Sync] Offline - adding to pending queue:", fileName);
    const exam = await storageService.loadExamResult(meta.id);
    if (exam) {
      addPendingAction({
        type: "save",
        examId: meta.id,
        timestamp: Date.now(),
        data: exam,
      });
    }
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
    return globalUploader.getIsPaused();
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
