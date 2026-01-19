
import React, { useState } from 'react';
import { HistoryMetadata } from '../types';
import { deleteExamResult, deleteExamResults, cleanupHistoryItem } from '../services/storageService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  historyList: HistoryMetadata[];
  isLoading: boolean;
  onLoadHistory: (id: string) => void;
  onBatchLoadHistory: (ids: string[]) => void;
  onRefreshList: () => void;
}

const formatDate = (ts: number): string => {
  return new Date(ts).toLocaleString();
};

export const HistorySidebar: React.FC<Props> = ({ 
  isOpen, 
  onClose, 
  historyList, 
  isLoading, 
  onLoadHistory,
  onBatchLoadHistory,
  onRefreshList 
}) => {
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
  const [isCleaning, setIsCleaning] = useState<string | null>(null);

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
      setSelectedHistoryIds(new Set(historyList.map(h => h.id)));
    }
  };

  const handleDeleteSelectedHistory = async () => {
    if (selectedHistoryIds.size === 0) return;
    if (confirm(`Are you sure you want to delete ${selectedHistoryIds.size} records?`)) {
        await deleteExamResults(Array.from(selectedHistoryIds));
        setSelectedHistoryIds(new Set());
        onRefreshList();
    }
  };

  const deleteHistoryItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this record?")) {
      await deleteExamResult(id);
      setSelectedHistoryIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
      onRefreshList();
    }
  };

  const handleCleanupItem = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setIsCleaning(id);
      try {
          await cleanupHistoryItem(id);
          onRefreshList();
      } catch (error) {
          console.error("Cleanup failed", error);
          alert("Cleanup failed.");
      } finally {
          setIsCleaning(null);
      }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] overflow-hidden">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}></div>
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl animate-[fade-in_0.3s_ease-out] flex flex-col">
         <div className="p-6 border-b border-slate-100 bg-slate-50">
           <div className="flex justify-between items-center mb-4">
             <div>
               <h2 className="text-xl font-black text-slate-900 tracking-tight">Processing History</h2>
               <p className="text-slate-400 text-xs font-bold">Local History (Stored in Browser)</p>
             </div>
             <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 bg-white rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors">
               <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
             </button>
           </div>

           <div className="flex items-center justify-between pt-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input 
                      type="checkbox" 
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      checked={historyList.length > 0 && selectedHistoryIds.size === historyList.length}
                      onChange={handleSelectAllHistory}
                      disabled={historyList.length === 0}
                  />
                  <span className="text-xs font-bold text-slate-500">Select All</span>
              </label>
              
              {selectedHistoryIds.size > 0 && (
                <div className="flex items-center gap-2">
                   <button 
                      onClick={() => onBatchLoadHistory(Array.from(selectedHistoryIds))}
                      className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors flex items-center gap-1"
                   >
                       <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                       Load ({selectedHistoryIds.size})
                   </button>
                   <button 
                      onClick={handleDeleteSelectedHistory}
                      className="text-xs font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100 hover:bg-red-100 transition-colors flex items-center gap-1"
                  >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      Delete
                  </button>
                </div>
              )}
           </div>
         </div>
         
         <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
           {historyList.length === 0 ? (
             <div className="text-center py-20 text-slate-400">
               <p className="text-sm font-bold">No history records found.</p>
             </div>
           ) : (
             historyList.map(item => (
               <div 
                  key={item.id} 
                  className={`bg-white p-4 rounded-2xl border transition-all group relative ${selectedHistoryIds.has(item.id) ? 'border-blue-400 ring-1 ring-blue-400 bg-blue-50/10' : 'border-slate-200 shadow-sm hover:shadow-md'}`}
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
                      <div className="flex-1 overflow-hidden cursor-pointer" onClick={() => handleToggleHistorySelection(item.id)}>
                        <h3 className="font-bold text-slate-800 truncate" title={item.name}>{item.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-black uppercase text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{item.pageCount} Pages</span>
                          <span className="text-[10px] text-slate-400">{formatDate(item.timestamp)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                          <button 
                            onClick={(e) => handleCleanupItem(item.id, e)}
                            disabled={isCleaning === item.id}
                            className={`text-slate-300 hover:text-orange-500 p-1.5 rounded-lg hover:bg-orange-50 transition-colors ${isCleaning === item.id ? 'animate-pulse text-orange-400' : ''}`}
                            title="Clean Duplicates"
                          >
                             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                          </button>
                          <button 
                              onClick={(e) => deleteHistoryItem(item.id, e)}
                              className="text-slate-300 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                              title="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                      </div>
                    </div>
                    <button 
                      onClick={() => onLoadHistory(item.id)}
                      className="w-full py-2.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                      Load & Re-Crop
                    </button>
                  </div>
               </div>
             ))
           )}
         </div>
         {isLoading && (
           <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-10">
             <div className="flex flex-col items-center gap-3">
               <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
               <p className="text-sm font-bold text-slate-600">Loading Data...</p>
             </div>
           </div>
         )}
      </div>
    </div>
  );
};
