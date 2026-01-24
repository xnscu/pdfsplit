/**
 * React Hook for sync state management
 * Provides easy access to sync status and operations in components
 */

import { useState, useEffect, useCallback } from "react";
import * as syncService from "../services/syncService";

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncTime: number;
  error: string | null;
}

export interface UseSyncResult {
  status: SyncStatus;
  sync: () => Promise<void>;
  forceUpload: () => Promise<void>;
  forceDownload: () => Promise<void>;
  clearPending: () => void;
}

export function useSync(): UseSyncResult {
  const [status, setStatus] = useState<SyncStatus>({
    isOnline: true,
    isSyncing: false,
    pendingCount: 0,
    lastSyncTime: 0,
    error: null,
  });

  // Load initial state
  useEffect(() => {
    const state = syncService.loadSyncState();
    setStatus((prev) => ({
      ...prev,
      isOnline: state.isOnline,
      pendingCount: state.pendingActions.length,
      lastSyncTime: state.lastSyncTime,
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

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      syncService.stopAutoSync();
    };
  }, []);

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
    setStatus((prev) => ({ ...prev, isSyncing: true, error: null }));

    try {
      const result = await syncService.forceUploadAll();
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
        error: e instanceof Error ? e.message : "Upload failed",
      }));
    }
  }, []);

  const forceDownload = useCallback(async () => {
    setStatus((prev) => ({ ...prev, isSyncing: true, error: null }));

    try {
      const result = await syncService.forceDownloadAll();
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
        error: e instanceof Error ? e.message : "Download failed",
      }));
    }
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
  };
}

export default useSync;
