/**
 * Sync Service for bidirectional synchronization between IndexedDB and D1
 * Handles conflict resolution, offline mode, and background sync
 */

import { ExamRecord, HistoryMetadata } from "../types";
import * as storageService from "./storageService";

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

  // Auto-sync interval in milliseconds (5 minutes)
  autoSyncInterval: 5 * 60 * 1000,

  // Maximum retries for failed sync
  maxRetries: 3,
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
}

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
 * Force sync all local data to remote
 */
export const forceUploadAll = async (): Promise<SyncResult> => {
  const result: SyncResult = {
    success: true,
    pushed: 0,
    pulled: 0,
    conflicts: [],
    errors: [],
  };

  try {
    const localList = await storageService.getHistoryList();

    for (const meta of localList) {
      const exam = await storageService.loadExamResult(meta.id);
      if (exam) {
        const success = await saveRemoteExam(exam);
        if (success) {
          result.pushed++;
        } else {
          result.errors.push(`Failed to upload: ${meta.name}`);
        }
      }
    }

    syncState.lastSyncTime = Date.now();
    saveSyncState();
  } catch (e) {
    result.success = false;
    result.errors.push(`Force upload failed: ${e}`);
  }

  return result;
};

/**
 * Force download all remote data to local
 */
export const forceDownloadAll = async (): Promise<SyncResult> => {
  const result: SyncResult = {
    success: true,
    pushed: 0,
    pulled: 0,
    conflicts: [],
    errors: [],
  };

  try {
    const remoteList = await getRemoteExamList();

    for (const meta of remoteList) {
      const exam = await getRemoteExam(meta.id);
      if (exam) {
        await saveExamToLocal(exam);
        result.pulled++;
      } else {
        result.errors.push(`Failed to download: ${meta.name}`);
      }
    }

    syncState.lastSyncTime = Date.now();
    saveSyncState();
  } catch (e) {
    result.success = false;
    result.errors.push(`Force download failed: ${e}`);
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
  // Update locally first
  await storageService.reSaveExamResult(fileName, rawPages, questions);

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
    } else if (exam) {
      // Offline - add to pending queue
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
 */
export const updatePageDetectionsAndQuestionsWithSync = async (
  fileName: string,
  pageNumber: number,
  newDetections: any[],
  newFileQuestions: ExamRecord["questions"],
): Promise<void> => {
  // Update locally first
  await storageService.updatePageDetectionsAndQuestions(fileName, pageNumber, newDetections, newFileQuestions);

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
    } else if (exam) {
      // Offline - add to pending queue
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
