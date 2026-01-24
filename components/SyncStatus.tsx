/**
 * Sync Status Component
 * Displays sync status and provides sync controls in the UI
 */

import React from "react";
import { useSync } from "../hooks/useSync";

const SyncStatus: React.FC = () => {
  const { status, sync, forceUpload, forceDownload, clearPending } = useSync();

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

      {/* Sync controls */}
      <div className="sync-controls">
        <button className="sync-button primary" onClick={sync} disabled={status.isSyncing || !status.isOnline}>
          {status.isSyncing ? (
            <>
              <span className="spinner" />
              同步中...
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
          onClick={forceUpload}
          disabled={status.isSyncing || !status.isOnline}
          title="上传所有本地数据到云端"
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
          上传全部
        </button>

        <button
          className="sync-button"
          onClick={forceDownload}
          disabled={status.isSyncing || !status.isOnline}
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
      </div>

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
      `}</style>
    </div>
  );
};

export default SyncStatus;
