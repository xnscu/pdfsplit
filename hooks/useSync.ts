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
}

export interface UseSyncResult {
  status: SyncStatus;
  sync: () => Promise<void>;
  forceUpload: () => Promise<void>;
  forceDownload: () => Promise<void>;
  clearPending: () => void;
  pauseSync: () => void;
  resumeSync: () => void;
  cancelSync: () => void;
  setUploadConcurrency: (concurrency: number) => void;
  setBatchCheckChunkSize: (chunkSize: number) => void;
  setBatchCheckConcurrency: (concurrency: number) => void;
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
    };
  });

  const isPausedRef = useRef(false);

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
    setStatus((prev) => ({ ...prev, isSyncing: true, error: null }));

    try {
      const result = await syncService.fullSync();
      const state = syncService.getSyncState();

      setStatus((prev) => ({
        ...prev,
        isSyncing: false,
        pendingCount: state.pendingActions.length,
        lastSyncTime: state.lastSyncTime,
        error: result.errors.length > 0 ? result.errors.join(", ") : null,
      }));
    } catch (e) {
      setStatus((prev) => ({
        ...prev,
        isSyncing: false,
        error: e instanceof Error ? e.message : "Sync failed",
      }));
    }
  }, []);

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

  const clearPending = useCallback(() => {
    syncService.clearPendingActions();
    setStatus((prev) => ({ ...prev, pendingCount: 0 }));
  }, []);

  return {
    status,
    sync,
    forceUpload,
    forceDownload,
    clearPending,
    pauseSync,
    resumeSync,
    cancelSync,
    setUploadConcurrency,
    setBatchCheckChunkSize,
    setBatchCheckConcurrency,
  };
}

export default useSync;
