/**
 * React Hook for sync state management
 * Provides easy access to sync status and operations in components
 */

import { useState, useEffect, useCallback, useRef } from "react";
import * as syncService from "../services/syncService";
import { SyncProgress } from "../services/syncService";

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  isPaused: boolean;
  pendingCount: number;
  lastSyncTime: number;
  error: string | null;
  progress: SyncProgress | null;
  uploadConcurrency: number;
  batchCheckChunkSize: number;
  batchCheckConcurrency: number;
  // Detailed sync result for UI display
  lastSyncResult: {
    pushed: number;
    pulled: number;
    pushedNames: string[];
    pulledNames: string[];
  } | null;
}

export interface UseSyncResult {
  status: SyncStatus;
  sync: () => Promise<void>;
  forceUpload: () => Promise<void>;
  forceUploadSelected: (selectedExamIds: string[]) => Promise<void>;
  forceDownload: () => Promise<void>;
  clearPending: () => void;
  pauseSync: () => void;
  resumeSync: () => void;
  cancelSync: () => void;
  setUploadConcurrency: (concurrency: number) => void;
  setBatchCheckChunkSize: (chunkSize: number) => void;
  setBatchCheckConcurrency: (concurrency: number) => void;
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
  setAutoSyncEnabled: (enabled: boolean) => void;
  setAutoSyncIntervalMinutes: (minutes: number) => void;
}

export function useSync(): UseSyncResult {
  const [status, setStatus] = useState<SyncStatus>(() => {
    const settings = syncService.getSyncSettings();
    return {
      isOnline: true,
      isSyncing: false,
      isPaused: false,
      pendingCount: 0,
      lastSyncTime: 0,
      error: null,
      progress: null,
      uploadConcurrency: settings.uploadConcurrency,
      batchCheckChunkSize: settings.batchCheckChunkSize,
      batchCheckConcurrency: settings.batchCheckConcurrency,
      lastSyncResult: null,
    };
  });

  const [autoSyncEnabled, setAutoSyncEnabledState] = useState<boolean>(() => {
    const settings = syncService.getSyncSettings();
    return settings.autoSyncEnabled || false;
  });

  const [autoSyncIntervalMinutes, setAutoSyncIntervalMinutesState] = useState<number>(() => {
    const settings = syncService.getSyncSettings();
    return settings.autoSyncIntervalMinutes || 5;
  });

  const isPausedRef = useRef(false);
  const autoSyncTimerRef = useRef<number | null>(null);
  const isSyncingRef = useRef(false);

  const handleProgress = useCallback((progress: SyncProgress) => {
    setStatus((prev) => ({
      ...prev,
      progress,
      isSyncing: progress.phase !== "completed",
    }));
  }, []);

  // Load initial state
  useEffect(() => {
    const state = syncService.loadSyncState();
    const settings = syncService.loadSyncSettings();
    setStatus((prev) => ({
      ...prev,
      isOnline: state.isOnline,
      pendingCount: state.pendingActions.length,
      lastSyncTime: state.lastSyncTime,
      uploadConcurrency: settings.uploadConcurrency,
      batchCheckChunkSize: settings.batchCheckChunkSize,
      batchCheckConcurrency: settings.batchCheckConcurrency,
    }));
    // Load auto-sync settings
    setAutoSyncEnabledState(settings.autoSyncEnabled || false);
    setAutoSyncIntervalMinutesState(settings.autoSyncIntervalMinutes || 5);

    // Initialize sync service
    syncService.initSyncService();

    // Listen for online/offline events
    const handleOnline = () => {
      setStatus((prev) => ({ ...prev, isOnline: true }));
    };
    const handleOffline = () => {
      setStatus((prev) => ({ ...prev, isOnline: false }));
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Register progress listener
    syncService.addProgressListener(handleProgress);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      syncService.removeProgressListener(handleProgress);
    };
  }, [handleProgress]);

  // Update pending count periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const count = syncService.getPendingCount();
      setStatus((prev) => {
        if (prev.pendingCount !== count) {
          return { ...prev, pendingCount: count };
        }
        return prev;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const sync = useCallback(async () => {
    // Prevent concurrent sync calls
    if (isSyncingRef.current) {
      console.log("Sync already in progress, skipping...");
      return;
    }

    isSyncingRef.current = true;
    setStatus((prev) => ({ ...prev, isSyncing: true, error: null, lastSyncResult: null }));

    try {
      const result = await syncService.fullSync();
      const state = syncService.getSyncState();

      setStatus((prev) => ({
        ...prev,
        isSyncing: false,
        pendingCount: state.pendingActions.length,
        lastSyncTime: state.lastSyncTime,
        error: result.errors.length > 0 ? result.errors.join(", ") : null,
        lastSyncResult: {
          pushed: result.pushed,
          pulled: result.pulled,
          pushedNames: result.pushedNames || [],
          pulledNames: result.pulledNames || [],
        },
      }));
    } catch (e) {
      setStatus((prev) => ({
        ...prev,
        isSyncing: false,
        error: e instanceof Error ? e.message : "Sync failed",
        lastSyncResult: null,
      }));
    } finally {
      isSyncingRef.current = false;
    }
  }, []);

  // Auto-sync timer effect (must be after sync definition)
  useEffect(() => {
    // Clear existing timer
    if (autoSyncTimerRef.current !== null) {
      clearInterval(autoSyncTimerRef.current);
      autoSyncTimerRef.current = null;
    }

    // Only start timer if auto-sync is enabled and online
    if (autoSyncEnabled && status.isOnline) {
      const intervalMs = autoSyncIntervalMinutes * 60 * 1000;

      // Set up periodic sync
      autoSyncTimerRef.current = window.setInterval(() => {
        // Only sync if online and not currently syncing
        const currentState = syncService.getSyncState();
        if (currentState.isOnline && !isSyncingRef.current) {
          sync().catch((e) => {
            console.error("Auto-sync failed:", e);
          });
        }
      }, intervalMs);
    }

    return () => {
      if (autoSyncTimerRef.current !== null) {
        clearInterval(autoSyncTimerRef.current);
        autoSyncTimerRef.current = null;
      }
    };
  }, [autoSyncEnabled, autoSyncIntervalMinutes, status.isOnline, sync]);

  const forceUpload = useCallback(async () => {
    setStatus((prev) => ({
      ...prev,
      isSyncing: true,
      isPaused: false,
      error: null,
      progress: null,
    }));
    isPausedRef.current = false;

    try {
      const result = await syncService.forceUploadAll(handleProgress);
      const state = syncService.getSyncState();

      setStatus((prev) => ({
        ...prev,
        isSyncing: false,
        isPaused: false,
        pendingCount: state.pendingActions.length,
        lastSyncTime: state.lastSyncTime,
        error: result.errors.length > 0 ? result.errors.join(", ") : null,
        progress: null,
      }));
    } catch (e) {
      setStatus((prev) => ({
        ...prev,
        isSyncing: false,
        isPaused: false,
        error: e instanceof Error ? e.message : "Upload failed",
        progress: null,
      }));
    }
  }, [handleProgress]);

  const forceUploadSelected = useCallback(async (selectedExamIds: string[]) => {
    setStatus((prev) => ({
      ...prev,
      isSyncing: true,
      isPaused: false,
      error: null,
      progress: null,
    }));
    isPausedRef.current = false;

    try {
      const result = await syncService.forceUploadSelected(selectedExamIds, handleProgress);
      const state = syncService.getSyncState();

      setStatus((prev) => ({
        ...prev,
        isSyncing: false,
        isPaused: false,
        pendingCount: state.pendingActions.length,
        lastSyncTime: state.lastSyncTime,
        error: result.errors.length > 0 ? result.errors.join(", ") : null,
        progress: null,
      }));
    } catch (e) {
      setStatus((prev) => ({
        ...prev,
        isSyncing: false,
        isPaused: false,
        error: e instanceof Error ? e.message : "Upload failed",
        progress: null,
      }));
    }
  }, [handleProgress]);

  const forceDownload = useCallback(async () => {
    setStatus((prev) => ({
      ...prev,
      isSyncing: true,
      isPaused: false,
      error: null,
      progress: null,
    }));
    isPausedRef.current = false;

    try {
      const result = await syncService.forceDownloadAll(handleProgress);
      const state = syncService.getSyncState();

      setStatus((prev) => ({
        ...prev,
        isSyncing: false,
        isPaused: false,
        pendingCount: state.pendingActions.length,
        lastSyncTime: state.lastSyncTime,
        error: result.errors.length > 0 ? result.errors.join(", ") : null,
        progress: null,
      }));
    } catch (e) {
      setStatus((prev) => ({
        ...prev,
        isSyncing: false,
        isPaused: false,
        error: e instanceof Error ? e.message : "Download failed",
        progress: null,
      }));
    }
  }, [handleProgress]);

  const pauseSync = useCallback(() => {
    syncService.pauseSync();
    isPausedRef.current = true;
    setStatus((prev) => ({ ...prev, isPaused: true }));
  }, []);

  const resumeSync = useCallback(() => {
    syncService.resumeSync();
    isPausedRef.current = false;
    setStatus((prev) => ({ ...prev, isPaused: false }));
  }, []);

  const cancelSync = useCallback(() => {
    syncService.cancelSync();
    isPausedRef.current = false;
    setStatus((prev) => ({
      ...prev,
      isSyncing: false,
      isPaused: false,
      progress: null,
    }));
  }, []);

  const setUploadConcurrency = useCallback((concurrency: number) => {
    syncService.setUploadConcurrency(concurrency);
    setStatus((prev) => ({ ...prev, uploadConcurrency: concurrency }));
  }, []);

  const setBatchCheckChunkSize = useCallback((chunkSize: number) => {
    syncService.setBatchCheckChunkSize(chunkSize);
    setStatus((prev) => ({ ...prev, batchCheckChunkSize: chunkSize }));
  }, []);

  const setBatchCheckConcurrency = useCallback((concurrency: number) => {
    syncService.setBatchCheckConcurrency(concurrency);
    setStatus((prev) => ({ ...prev, batchCheckConcurrency: concurrency }));
  }, []);

  const setAutoSyncEnabled = useCallback((enabled: boolean) => {
    syncService.saveSyncSettings({ autoSyncEnabled: enabled });
    setAutoSyncEnabledState(enabled);
  }, []);

  const setAutoSyncIntervalMinutes = useCallback((minutes: number) => {
    syncService.saveSyncSettings({ autoSyncIntervalMinutes: minutes });
    setAutoSyncIntervalMinutesState(minutes);
  }, []);

  const clearPending = useCallback(() => {
    syncService.clearPendingActions();
    setStatus((prev) => ({ ...prev, pendingCount: 0 }));
  }, []);

  return {
    status,
    sync,
    forceUpload,
    forceUploadSelected,
    forceDownload,
    clearPending,
    pauseSync,
    resumeSync,
    cancelSync,
    setUploadConcurrency,
    setBatchCheckChunkSize,
    setBatchCheckConcurrency,
    autoSyncEnabled,
    autoSyncIntervalMinutes,
    setAutoSyncEnabled,
    setAutoSyncIntervalMinutes,
  };
}

export default useSync;
