import React, { useState, useMemo } from "react";
import { HistoryMetadata } from "../types";
import { deleteExamResult, deleteExamResults } from "../services/storageService";
import { ConfirmDialog } from "./ConfirmDialog";
import { CircularProgress } from "./CircularProgress";
import SyncStatus from "./SyncStatus";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  historyList: HistoryMetadata[];
  isLoading: boolean;
  loadingText?: string;
  progress?: number;
  onLoadHistory: (id: string) => void;
  onBatchLoadHistory: (ids: string[]) => void;
  onBatchReprocessHistory: (ids: string[]) => void;
  onRefreshList: () => void;
  onCleanupAll: () => void;
  onDeleteHistory: (id: string, name?: string) => Promise<void>;
  onBatchDelete: (ids: string[]) => Promise<void>;
  onFilesUpdated?: (pulledNames: string[]) => void;
}

type SortOption = "name_asc" | "name_desc" | "date_newest" | "date_oldest";

const formatDate = (ts: number): string => {
  return new Date(ts).toLocaleString();
};

export const HistorySidebar: React.FC<Props> = ({
  isOpen,
  onClose,
  historyList,
  isLoading,
  loadingText,
  progress = 0,
  onLoadHistory,
  onBatchLoadHistory,
  onBatchReprocessHistory,
  onRefreshList,
  onCleanupAll,
  onDeleteHistory,
  onBatchDelete,
  onFilesUpdated,
}) => {
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
  const [isCleaning, setIsCleaning] = useState(false);
  const [sortOption, setSortOption] = useState<SortOption>("name_asc");

  // Confirmation State
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

  // Sort Logic
  const sortedHistoryList = useMemo(() => {
    const sorted = [...historyList];
    switch (sortOption) {
      case "name_asc":
        return sorted.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        );
      case "name_desc":
        return sorted.sort((a, b) =>
          b.name.localeCompare(a.name, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        );
      case "date_newest":
        return sorted.sort((a, b) => b.timestamp - a.timestamp);
      case "date_oldest":
        return sorted.sort((a, b) => a.timestamp - b.timestamp);
      default:
        return sorted;
    }
  }, [historyList, sortOption]);

  const handleToggleHistorySelection = (id: string) => {
    const newSet = new Set(selectedHistoryIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedHistoryIds(newSet);
  };

  const handleSelectAllHistory = () => {
    if (selectedHistoryIds.size === historyList.length) {
      setSelectedHistoryIds(new Set());
    } else {
      setSelectedHistoryIds(new Set(historyList.map((h) => h.id)));
    }
  };

  const handleDeleteSelectedHistory = () => {
    if (selectedHistoryIds.size === 0) return;

    setConfirmState({
      isOpen: true,
      title: "Delete Multiple Records",
      message: `Are you sure you want to delete ${selectedHistoryIds.size} records? This action cannot be undone.`,
      isDestructive: true,
      action: async () => {
        await onBatchDelete(Array.from(selectedHistoryIds));
        setSelectedHistoryIds(new Set());
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  const handleReprocessSelectedHistory = () => {
    if (selectedHistoryIds.size === 0) return;
    onBatchReprocessHistory(Array.from(selectedHistoryIds));
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    setConfirmState({
      isOpen: true,
      title: "Delete Record",
      message: "Are you sure you want to delete this exam history? This action cannot be undone.",
      isDestructive: true,
      action: async () => {
        // Single delete
        const item = historyList.find((h) => h.id === id);
        await onDeleteHistory(id, item?.name);
        setSelectedHistoryIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
        setConfirmState((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  const handleGlobalCleanup = async () => {
    setIsCleaning(true);
    try {
      await onCleanupAll();
    } finally {
      setIsCleaning(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[200] overflow-hidden">
        <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}></div>
        <div className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl animate-[fade-in_0.3s_ease-out] flex flex-col">
          <div className="p-6 border-b border-slate-100 bg-slate-50">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight">Processing History</h2>
                <p className="text-slate-400 text-xs font-bold mb-2">Local History (Stored in Browser)</p>

                {false && (
                  <button
                    onClick={handleGlobalCleanup}
                    disabled={isCleaning || historyList.length === 0}
                    className={`
                      text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-all flex items-center gap-2
                      ${
                        isCleaning
                          ? "bg-orange-50 text-orange-400 border-orange-100"
                          : "bg-white text-slate-500 border-slate-200 hover:text-orange-500 hover:border-orange-200 hover:bg-orange-50"
                      }
                    `}
                  >
                    {isCleaning ? (
                      <>
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                        Cleaning All Duplicates...
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                          />
                        </svg>
                        Deep Clean
                      </>
                    )}
                  </button>
                )}
              </div>
              <button
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-slate-600 bg-white rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              {/* Sync Status Section */}
              <SyncStatus onSyncComplete={onRefreshList} onFilesUpdated={onFilesUpdated} />

              {/* Sorting Controls */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase text-slate-400">Sort By:</span>
                <select
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value as SortOption)}
                  className="text-xs font-bold text-slate-600 bg-slate-100 border-transparent rounded-lg py-1.5 pl-3 pr-8 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer outline-none appearance-none"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                    backgroundPosition: `right 0.5rem center`,
                    backgroundRepeat: `no-repeat`,
                    backgroundSize: `1.5em 1.5em`,
                  }}
                >
                  <option value="name_asc">Name (A-Z)</option>
                  <option value="name_desc">Name (Z-A)</option>
                  <option value="date_newest">Date (Newest)</option>
                  <option value="date_oldest">Date (Oldest)</option>
                </select>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200/50 pt-3 mt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    checked={sortedHistoryList.length > 0 && selectedHistoryIds.size === sortedHistoryList.length}
                    onChange={handleSelectAllHistory}
                    disabled={sortedHistoryList.length === 0}
                  />
                  <span className="text-xs font-bold text-slate-500">Select All</span>
                </label>

                {selectedHistoryIds.size > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleReprocessSelectedHistory}
                      className="text-xs font-bold text-orange-600 bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-100 hover:bg-orange-100 transition-colors flex items-center gap-1"
                      title="Reprocess selected files with current crop settings"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                      Process
                    </button>
                    <button
                      onClick={() => onBatchLoadHistory(Array.from(selectedHistoryIds))}
                      className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                      </svg>
                      Load
                    </button>
                    <button
                      onClick={handleDeleteSelectedHistory}
                      className="text-xs font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100 hover:bg-red-100 transition-colors flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                      Del
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
            {sortedHistoryList.length === 0 ? (
              <div className="text-center py-20 text-slate-400">
                <p className="text-sm font-bold">No history records found.</p>
              </div>
            ) : (
              sortedHistoryList.map((item) => (
                <div
                  key={item.id}
                  className={`bg-white p-4 rounded-2xl border transition-all group relative ${selectedHistoryIds.has(item.id) ? "border-blue-400 ring-1 ring-blue-400 bg-blue-50/10" : "border-slate-200 shadow-sm hover:shadow-md"}`}
                >
                  <div className="absolute left-4 top-5 z-10">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      checked={selectedHistoryIds.has(item.id)}
                      onChange={() => handleToggleHistorySelection(item.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>

                  <div className="pl-8">
                    <div className="flex justify-between items-start mb-3">
                      <div
                        className="flex-1 overflow-hidden cursor-pointer"
                        onClick={() => handleToggleHistorySelection(item.id)}
                      >
                        <h3 className="font-bold text-slate-800 truncate" title={item.name}>
                          {item.name}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-black uppercase text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                            {item.pageCount} Pages
                          </span>
                          <span className="text-[10px] text-slate-400">{formatDate(item.timestamp)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => deleteHistoryItem(item.id, e)}
                          className="text-slate-300 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                          title="Delete"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => onLoadHistory(item.id)}
                      className="w-full py-2.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                      Load
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {isLoading && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-10 animate-fade-in p-8">
              <div className="flex flex-col items-center gap-6 bg-white p-8 rounded-3xl shadow-2xl border border-slate-100 w-full">
                <CircularProgress progress={progress || 0} size="5rem" />
                <div className="text-center w-full">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    Processing Batch
                  </p>
                  <p className="text-sm font-bold text-slate-900 w-full break-words">
                    {loadingText || "Please wait..."}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        onConfirm={confirmState.action}
        onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
        isDestructive={confirmState.isDestructive}
        confirmLabel="Delete"
      />
    </>
  );
};
