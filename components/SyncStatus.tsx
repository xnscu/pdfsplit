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
      {/* Status indicator */}
      <div className="sync-status-indicator">
        <span className={`status-dot ${status.isOnline ? "online" : "offline"}`} />
        <span className="status-text">{status.isOnline ? "在线" : "离线"}</span>
        {status.pendingCount > 0 && <span className="pending-badge">{status.pendingCount} 待同步</span>}
      </div>

      {/* Last sync time */}
      <div className="last-sync-time">上次同步: {formatTime(status.lastSyncTime)}</div>

      {/* Error display */}
      {status.error && (
        <div className="sync-error">
          <span className="error-icon">⚠️</span>
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
              <span className="icon">🔄</span>
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
          <span className="icon">⬆️</span>
          上传全部
        </button>

        <button
          className="sync-button"
          onClick={forceDownload}
          disabled={status.isSyncing || !status.isOnline}
          title="从云端下载所有数据到本地"
        >
          <span className="icon">⬇️</span>
          下载全部
        </button>

        {status.pendingCount > 0 && (
          <button className="sync-button danger" onClick={clearPending} title="清除待同步操作（谨慎使用）">
            <span className="icon">🗑️</span>
            清除待同步
          </button>
        )}
      </div>

      <style>{`
        .sync-status-container {
          padding: 16px;
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.95));
          border-radius: 12px;
          border: 1px solid rgba(100, 116, 139, 0.3);
          margin-bottom: 16px;
        }

        .sync-status-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }

        .status-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          animation: pulse 2s infinite;
        }

        .status-dot.online {
          background: #22c55e;
          box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
        }

        .status-dot.offline {
          background: #ef4444;
          box-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
          animation: none;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .status-text {
          font-size: 14px;
          font-weight: 500;
          color: #e2e8f0;
        }

        .pending-badge {
          background: #f59e0b;
          color: #1e293b;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
        }

        .last-sync-time {
          font-size: 12px;
          color: #94a3b8;
          margin-bottom: 12px;
        }

        .sync-error {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 8px;
          margin-bottom: 12px;
        }

        .error-icon {
          font-size: 14px;
        }

        .error-text {
          font-size: 12px;
          color: #fca5a5;
        }

        .sync-controls {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .sync-button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          border: 1px solid rgba(100, 116, 139, 0.3);
          background: rgba(51, 65, 85, 0.6);
          color: #e2e8f0;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .sync-button:hover:not(:disabled) {
          background: rgba(71, 85, 105, 0.7);
          transform: translateY(-1px);
        }

        .sync-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .sync-button.primary {
          background: linear-gradient(135deg, #3b82f6, #2563eb);
          border-color: #3b82f6;
        }

        .sync-button.primary:hover:not(:disabled) {
          background: linear-gradient(135deg, #60a5fa, #3b82f6);
        }

        .sync-button.danger {
          border-color: rgba(239, 68, 68, 0.3);
          color: #fca5a5;
        }

        .sync-button.danger:hover:not(:disabled) {
          background: rgba(239, 68, 68, 0.2);
        }

        .icon {
          font-size: 14px;
        }

        .spinner {
          width: 14px;
          height: 14px;
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
