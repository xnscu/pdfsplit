/**
 * Sync Status Component
 * Displays sync status and provides sync controls in the UI
 * Supports progress display, pause/resume functionality
 */

import React, { useState, useEffect, useRef } from "react";
import { useSync } from "../hooks/useSync";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  onSyncComplete?: () => void;
  onFilesUpdated?: (pulledNames: string[]) => void;
  selectedHistoryIds?: Set<string>;
}

const SyncStatus: React.FC<Props> = ({ onSyncComplete, onFilesUpdated, selectedHistoryIds }) => {
  const {
    status,
    checkDiff,
    sync,
    forceUpload,
    forceUploadSelected,
    forceDownload,
    clearPending,
    pauseSync,
    resumeSync,
    cancelSync,
  } = useSync();

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    action: () => Promise<void> | void;
    isDestructive: boolean;
  }>({
    isOpen: false,
    title: "",
    message: "",
    action: () => {},
    isDestructive: false,
  });

  const [isCheckingDiff, setIsCheckingDiff] = useState(false);

  // Track previous syncing state to detect when sync completes
  const wasSyncingRef = useRef(false);

  // Detect when sync completes and notify about pulled files
  useEffect(() => {
    if (wasSyncingRef.current && !status.isSyncing) {
      // Sync just completed
      if (status.lastSyncResult?.pulledNames?.length) {
        onFilesUpdated?.(status.lastSyncResult.pulledNames);
      }
    }
    wasSyncingRef.current = status.isSyncing;
  }, [status.isSyncing, status.lastSyncResult, onFilesUpdated]);

  /* Confirmed sync action */
  const executeSync = async () => {
    await sync();
    onSyncComplete?.();
  };

  const handleSync = async () => {
    if (isCheckingDiff) return;

    setIsCheckingDiff(true);
    try {
      if (!status.isOnline) {
        // Offline just tries to sync (will probably fail or queue)
        await executeSync();
        return;
      }

      const diff = await checkDiff();

      if (diff.hasChanges) {
        const parts = [];
        if (diff.toPush > 0) parts.push(`推送 ${diff.toPush} 个试卷`);
        if (diff.toPull > 0) parts.push(`拉取 ${diff.toPull} 个试卷`);

        let conflictMsg = "";
        if (diff.conflicts > 0) {
          conflictMsg = `\n\n注意：检测到 ${diff.conflicts} 个冲突，将自动合并（以最近修改为准）。`;
        }

        setConfirmState({
          isOpen: true,
          title: "确认同步",
          message: `检测到以下变更：\n${parts.join("，")}${conflictMsg}\n\n是否立即开始同步？`,
          action: async () => {
            setConfirmState((prev) => ({ ...prev, isOpen: false }));
            await executeSync();
          },
          isDestructive: false,
        });
      } else {
        // No obvious changes detected, but run sync anyway to be safe or update timestamps
        await executeSync();
      }
    } catch (e) {
      console.error("Sync diff check failed:", e);
      // Fallback to direct sync
      await executeSync();
    } finally {
      setIsCheckingDiff(false);
    }
  };

  const handleForceUpload = async () => {
    if (selectedHistoryIds && selectedHistoryIds.size > 0) {
      await forceUploadSelected(Array.from(selectedHistoryIds));
    } else {
      await forceUpload();
    }
    onSyncComplete?.();
  };

  const handleForceDownload = async () => {
    await forceDownload();
    onSyncComplete?.();
  };

  const handlePauseResume = () => {
    if (status.isPaused) {
      resumeSync();
    } else {
      pauseSync();
    }
  };

  const handleCancel = () => {
    cancelSync();
  };

  const formatTime = (timestamp: number): string => {
    if (!timestamp) return "从未";
    const date = new Date(timestamp);
    return date.toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="sync-status-container">
      <div className="sync-status-header">
        {/* Status indicator */}
        <div className="sync-status-indicator">
          <span className={`status-dot ${status.isOnline ? "online" : "offline"}`} />
          <span className="status-text">{status.isOnline ? "在线" : "离线"}</span>
          {status.pendingCount > 0 && <span className="pending-badge">{status.pendingCount} 待同步</span>}
        </div>

        {/* Last sync time */}
        <div className="last-sync-time">上次同步: {formatTime(status.lastSyncTime)}</div>
      </div>

      {/* Progress display */}
      {status.progress && status.isSyncing && (
        <div className="sync-progress">
          <div className="progress-header">
            <span className="progress-message">{status.progress.message}</span>
            <span className="progress-percentage">{status.progress.percentage}%</span>
          </div>
          <div className="progress-bar-container">
            <div
              className={`progress-bar ${status.isPaused ? "paused" : ""}`}
              style={{ width: `${status.progress.percentage}%` }}
            />
          </div>
          {status.progress.total > 0 && (
            <div className="progress-detail">
              {status.progress.current} / {status.progress.total}
            </div>
          )}
        </div>
      )}

      {/* Error display */}
      {status.error && (
        <div className="sync-error">
          <svg
            className="error-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="error-text">{status.error}</span>
        </div>
      )}

      {/* Sync Result Details */}
      {status.lastSyncResult &&
        !status.isSyncing &&
        (status.lastSyncResult.pushed > 0 || status.lastSyncResult.pulled > 0) && (
          <div className="sync-result">
            <div className="sync-result-header">
              <svg
                className="success-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span className="sync-result-title">同步完成</span>
            </div>

            {status.lastSyncResult.pushed > 0 && (
              <div className="sync-result-section">
                <div className="sync-result-label">
                  <svg
                    className="arrow-icon upload"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  推送 ({status.lastSyncResult.pushed})
                </div>
                <div className="sync-result-names">
                  {status.lastSyncResult.pushedNames.map((name, i) => (
                    <span key={i} className="sync-name-tag pushed">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {status.lastSyncResult.pulled > 0 && (
              <div className="sync-result-section">
                <div className="sync-result-label">
                  <svg
                    className="arrow-icon download"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  拉取 ({status.lastSyncResult.pulled})
                </div>
                <div className="sync-result-names">
                  {status.lastSyncResult.pulledNames.map((name, i) => (
                    <span key={i} className="sync-name-tag pulled">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      {/* No changes message */}
      {status.lastSyncResult &&
        !status.isSyncing &&
        status.lastSyncResult.pushed === 0 &&
        status.lastSyncResult.pulled === 0 &&
        !status.error && (
          <div className="sync-no-changes">
            <svg
              className="check-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>已是最新，无需同步</span>
          </div>
        )}

      {/* Sync controls */}
      <div className="sync-controls">
        {status.isSyncing ? (
          <>
            {/* Pause/Resume button */}
            <button className={`sync-button ${status.isPaused ? "primary" : "warning"}`} onClick={handlePauseResume}>
              {status.isPaused ? (
                <>
                  <svg
                    className="icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  继续
                </>
              ) : (
                <>
                  <svg
                    className="icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                  暂停
                </>
              )}
            </button>

            {/* Cancel button */}
            <button className="sync-button danger" onClick={handleCancel}>
              <svg
                className="icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              取消
            </button>
          </>
        ) : (
          <>
            <button className="sync-button primary" onClick={handleSync} disabled={!status.isOnline || isCheckingDiff}>
              {isCheckingDiff ? (
                <>
                  <div className="spinner" />
                  检查中...
                </>
              ) : (
                <>
                  <svg
                    className="icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 2v6h-6" />
                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                    <path d="M3 22v-6h6" />
                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  </svg>
                  同步
                </>
              )}
            </button>

            <button
              className="sync-button"
              onClick={handleForceUpload}
              disabled={!status.isOnline}
              title={
                selectedHistoryIds && selectedHistoryIds.size > 0 ? "上传选中的文件到云端" : "上传所有本地数据到云端"
              }
            >
              <svg
                className="icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {selectedHistoryIds && selectedHistoryIds.size > 0 ? "上传选中" : "上传全部"}
            </button>

            <button
              className="sync-button"
              onClick={handleForceDownload}
              disabled={!status.isOnline}
              title="从云端下载所有数据到本地"
            >
              <svg
                className="icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              下载全部
            </button>

            {status.pendingCount > 0 && (
              <button className="sync-button danger" onClick={clearPending} title="清除待同步操作（谨慎使用）">
                <svg
                  className="icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                清除
              </button>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        onConfirm={() => {
          confirmState.action();
        }}
        onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
        isDestructive={confirmState.isDestructive}
      />

      <style>{`
        .sync-status-container {
          padding: 12px;
          background: #f8fafc;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          margin-bottom: 8px;
        }

        .sync-status-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }

        .sync-status-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .status-dot.online {
          background: #22c55e;
          box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
        }

        .status-dot.offline {
          background: #ef4444;
          box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
        }

        .status-text {
          font-size: 13px;
          font-weight: 700;
          color: #334155;
        }

        .pending-badge {
          background: #fef3c7;
          color: #92400e;
          padding: 1px 6px;
          border-radius: 6px;
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
        }

        .last-sync-time {
          font-size: 11px;
          font-weight: 500;
          color: #94a3b8;
        }

        .sync-progress {
          margin-bottom: 12px;
          padding: 10px;
          background: #f1f5f9;
          border-radius: 8px;
        }

        .progress-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }

        .progress-message {
          font-size: 12px;
          font-weight: 600;
          color: #475569;
        }

        .progress-percentage {
          font-size: 12px;
          font-weight: 800;
          color: #3b82f6;
        }

        .progress-bar-container {
          width: 100%;
          height: 6px;
          background: #e2e8f0;
          border-radius: 3px;
          overflow: hidden;
        }

        .progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #60a5fa);
          border-radius: 3px;
          transition: width 0.3s ease;
        }

        .progress-bar.paused {
          background: linear-gradient(90deg, #f59e0b, #fbbf24);
        }

        .progress-detail {
          font-size: 10px;
          font-weight: 500;
          color: #94a3b8;
          text-align: center;
          margin-top: 4px;
        }

        .sync-error {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: #fef2f2;
          border: 1px solid #fee2e2;
          border-radius: 8px;
          margin-bottom: 10px;
        }

        .error-icon {
          width: 14px;
          height: 14px;
          color: #ef4444;
        }

        .error-text {
          font-size: 11px;
          font-weight: 500;
          color: #b91c1c;
        }

        .sync-controls {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .sync-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 6px 10px;
          border-radius: 8px;
          font-size: 11px;
          font-weight: 700;
          border: 1px solid #e2e8f0;
          background: white;
          color: #475569;
          cursor: pointer;
          transition: all 0.2s ease;
          flex: 1;
          min-width: 0;
          white-space: nowrap;
        }

        .sync-button:hover:not(:disabled) {
          border-color: #cbd5e1;
          background: #f1f5f9;
          transform: translateY(-1px);
        }

        .sync-button:active:not(:disabled) {
          transform: translateY(0);
        }

        .sync-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          background: #f8fafc;
        }

        .sync-button.primary {
          background: #3b82f6;
          border-color: #2563eb;
          color: white;
          flex: 1.2;
        }

        .sync-button.primary:hover:not(:disabled) {
          background: #2563eb;
          border-color: #1d4ed8;
        }

        .sync-button.warning {
          background: #f59e0b;
          border-color: #d97706;
          color: white;
        }

        .sync-button.warning:hover:not(:disabled) {
          background: #d97706;
          border-color: #b45309;
        }

        .sync-button.danger {
          color: #ef4444;
          border-color: #fee2e2;
        }

        .sync-button.danger:hover:not(:disabled) {
          background: #fef2f2;
          border-color: #fca5a5;
        }

        .icon {
          width: 14px;
          height: 14px;
        }

        .spinner {
          width: 12px;
          height: 12px;
          border: 2px solid transparent;
          border-top-color: currentColor;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .sync-result {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 10px;
          max-height: 200px;
          overflow-y: auto;
        }

        .sync-result-header {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
        }

        .success-icon {
          width: 16px;
          height: 16px;
          color: #22c55e;
        }

        .sync-result-title {
          font-size: 12px;
          font-weight: 700;
          color: #166534;
        }

        .sync-result-section {
          margin-top: 6px;
        }

        .sync-result-label {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          font-weight: 700;
          color: #475569;
          margin-bottom: 4px;
          text-transform: uppercase;
        }

        .arrow-icon {
          width: 12px;
          height: 12px;
        }

        .arrow-icon.upload {
          color: #3b82f6;
        }

        .arrow-icon.download {
          color: #22c55e;
        }

        .sync-result-names {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          max-height: 200px;
          overflow-y: auto;
        }

        .sync-name-tag {
          font-size: 10px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 4px;
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sync-name-tag.pushed {
          background: #dbeafe;
          color: #1e40af;
        }

        .sync-name-tag.pulled {
          background: #dcfce7;
          color: #166534;
        }

        .sync-no-changes {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 10px;
          background: #f1f5f9;
          border-radius: 8px;
          margin-bottom: 10px;
        }

        .sync-no-changes .check-icon {
          width: 14px;
          height: 14px;
          color: #22c55e;
        }

        .sync-no-changes span {
          font-size: 11px;
          font-weight: 600;
          color: #64748b;
        }
      `}</style>
    </div>
  );
};

export default SyncStatus;
