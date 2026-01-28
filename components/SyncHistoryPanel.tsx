/**
 * Sync History Panel Component
 * Displays sync history records with time, action type, and file names
 */

import React, { useState, useEffect } from "react";
import { SyncHistoryRecord, getSyncHistory, clearSyncHistory } from "../services/syncHistoryService";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onLoadHistoryByName?: (fileName: string) => void;
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return "刚刚";
  } else if (diffMins < 60) {
    return `${diffMins}分钟前`;
  } else if (diffHours < 24) {
    return `${diffHours}小时前`;
  } else if (diffDays < 7) {
    return `${diffDays}天前`;
  } else {
    return date.toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
};

const formatFullTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const getActionLabel = (actionType: "push" | "pull" | "full_sync"): string => {
  switch (actionType) {
    case "push":
      return "推送";
    case "pull":
      return "拉取";
    case "full_sync":
      return "双向同步";
    default:
      return actionType;
  }
};

const getActionColor = (actionType: "push" | "pull" | "full_sync"): string => {
  switch (actionType) {
    case "push":
      return "bg-blue-100 text-blue-700 border-blue-300";
    case "pull":
      return "bg-green-100 text-green-700 border-green-300";
    case "full_sync":
      return "bg-purple-100 text-purple-700 border-purple-300";
    default:
      return "bg-slate-100 text-slate-700 border-slate-300";
  }
};

export const SyncHistoryPanel: React.FC<Props> = ({ isOpen, onClose, onLoadHistoryByName }) => {
  const [historyRecords, setHistoryRecords] = useState<SyncHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
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

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      const records = await getSyncHistory(100); // Load last 100 records
      setHistoryRecords(records);
    } catch (error) {
      console.error("Failed to load sync history:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen]);

  const toggleExpand = (id: string) => {
    const newSet = new Set(expandedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedIds(newSet);
  };

  const handleClearHistory = () => {
    setConfirmState({
      isOpen: true,
      title: "清空同步记录",
      message: "确定要清空所有同步历史记录吗？此操作不可恢复。",
      action: async () => {
        try {
          await clearSyncHistory();
          await loadHistory();
        } catch (error) {
          console.error("Failed to clear sync history:", error);
        }
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
      },
      isDestructive: true,
    });
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[200] backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl z-[201] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-slate-50">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">同步记录</h2>
            <p className="text-xs text-slate-400 mt-1">查看自动同步的文件历史</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClearHistory}
              className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-red-600 bg-white border border-slate-200 rounded-lg hover:bg-red-50 transition-colors uppercase tracking-wider"
            >
              清空
            </button>
            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
          {isLoading ? (
            <div className="text-center py-20">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent"></div>
              <p className="text-sm text-slate-400 mt-4">加载中...</p>
            </div>
          ) : historyRecords.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <svg
                className="w-16 h-16 mx-auto mb-4 text-slate-300"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-sm font-bold">暂无同步记录</p>
              <p className="text-xs mt-2">同步操作将自动记录在这里</p>
            </div>
          ) : (
            historyRecords.map((record) => {
              const isExpanded = expandedIds.has(record.id);
              const hasFiles = record.fileNames.length > 0;

              return (
                <div
                  key={record.id}
                  className={`bg-white rounded-2xl border transition-all ${
                    record.success
                      ? "border-slate-200 shadow-sm hover:shadow-md"
                      : "border-red-200 bg-red-50/30"
                  }`}
                >
                  <div className="p-4">
                    {/* Header Row */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${getActionColor(
                              record.actionType,
                            )}`}
                          >
                            {getActionLabel(record.actionType)}
                          </span>
                          {!record.success && (
                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-red-100 text-red-700 border border-red-300">
                              失败
                            </span>
                          )}
                          <span className="text-xs text-slate-400 font-medium">{formatTime(record.syncTime)}</span>
                        </div>
                        <div className="text-xs text-slate-500 font-medium mb-1">
                          {formatFullTime(record.syncTime)}
                        </div>
                        {record.fileCount > 0 && (
                          <div className="text-xs text-slate-400">
                            {record.fileCount} 个文件
                          </div>
                        )}
                        {record.errorMessage && (
                          <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded-lg border border-red-200">
                            {record.errorMessage}
                          </div>
                        )}
                      </div>
                      {hasFiles && (
                        <button
                          onClick={() => toggleExpand(record.id)}
                          className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                          <svg
                            className={`w-5 h-5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Expanded File List */}
                    {isExpanded && hasFiles && (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <div className="space-y-1.5">
                          {record.fileNames.map((fileName, idx) => (
                            <button
                              key={idx}
                              className="w-full text-left text-xs text-slate-600 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 font-mono truncate hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 transition-colors cursor-pointer flex items-center justify-between group"
                              title={`点击查看: ${fileName}`}
                              onClick={() => {
                                if (onLoadHistoryByName) {
                                  onLoadHistoryByName(fileName);
                                  onClose();
                                }
                              }}
                            >
                              <span className="truncate">{fileName}</span>
                              {onLoadHistoryByName && (
                                <svg
                                  className="w-4 h-4 text-slate-400 group-hover:text-blue-500 flex-shrink-0 ml-2"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 5l7 7-7 7"
                                  />
                                </svg>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-white">
          <button
            onClick={loadHistory}
            className="w-full px-4 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-slate-700 transition-colors"
          >
            刷新
          </button>
        </div>
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
    </>
  );
};
