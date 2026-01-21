
import React, { useState, useEffect } from 'react';

interface Props {
  title?: string;
  pageCount: number;
  currentFileIndex: number;
  totalFiles: number;
  onPrevFile?: () => void;
  onNextFile?: () => void;
  onJumpToIndex?: (index: number) => void;
  onClose: () => void;
  onReanalyze?: () => void;
  onDownloadZip?: () => void;
  onRefine?: () => void;
  isZipping?: boolean;
  hasNextFile?: boolean;
  hasPrevFile?: boolean;
}

export const DebugToolbar: React.FC<Props> = ({
  title,
  pageCount,
  currentFileIndex,
  totalFiles,
  onPrevFile,
  onNextFile,
  onJumpToIndex,
  onClose,
  onReanalyze,
  onDownloadZip,
  onRefine,
  isZipping,
  hasNextFile,
  hasPrevFile
}) => {
  const [fileIndexInput, setFileIndexInput] = useState(currentFileIndex.toString());

  // Sync input when props change
  useEffect(() => {
    setFileIndexInput(currentFileIndex.toString());
  }, [currentFileIndex]);

  const handleIndexSubmit = () => {
    if (!onJumpToIndex) return;
    let val = parseInt(fileIndexInput, 10);
    if (isNaN(val)) {
      setFileIndexInput(currentFileIndex.toString());
      return;
    }
    val = Math.max(1, Math.min(totalFiles, val));
    onJumpToIndex(val);
  };

  const handleIndexKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleIndexSubmit();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex-none h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 shadow-xl z-50">
      <div className="flex items-center gap-4 min-w-0">
        <h2 className="text-white font-black text-xl tracking-tight hidden sm:block">Debug Inspector</h2>
        {title && (
          <span className="text-slate-500 font-bold text-sm bg-slate-800 px-3 py-1 rounded-lg border border-slate-700 truncate max-w-[200px] sm:max-w-[300px]">
            {title}
          </span>
        )}
        <div className="hidden lg:flex px-3 py-1 bg-slate-800 rounded-lg border border-slate-700 items-center gap-2">
          <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
          <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">{pageCount} Pages</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {onRefine && (
           <button
             onClick={onRefine}
             className="bg-slate-800 text-slate-300 border border-slate-700 px-3 py-2 rounded-xl font-bold text-xs hover:bg-slate-700 hover:text-white transition-colors flex items-center gap-2"
           >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
              Refine Settings
           </button>
        )}
        
        {onDownloadZip && (
           <button
             onClick={onDownloadZip}
             disabled={isZipping}
             className="bg-emerald-600 text-white px-3 py-2 rounded-xl font-bold text-xs hover:bg-emerald-500 transition-colors flex items-center gap-2 shadow-lg shadow-emerald-900/20 disabled:opacity-50 disabled:cursor-wait"
           >
              {isZipping ? (
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              )}
              Download ZIP
           </button>
        )}

        {onReanalyze && (
           <button
             onClick={onReanalyze}
             className="bg-blue-600 text-white px-3 py-2 rounded-xl font-bold text-xs hover:bg-blue-500 transition-colors flex items-center gap-2 shadow-lg shadow-blue-900/20 mr-2"
             title="Re-run AI detection for this file"
           >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              <span className="hidden sm:inline">Re-analyze</span>
           </button>
        )}

        <div className="flex items-center mr-4 bg-slate-800 rounded-lg p-1 border border-slate-700">
          <button
            onClick={onPrevFile}
            disabled={!hasPrevFile}
            className={`p-1.5 rounded-md transition-colors ${hasPrevFile ? 'text-white hover:bg-slate-700' : 'text-slate-600 cursor-not-allowed'}`}
            title="Previous PDF File"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>

          <div className="flex items-center gap-1.5 px-3">
            <input
              type="number"
              value={fileIndexInput}
              onChange={(e) => setFileIndexInput(e.target.value)}
              onKeyDown={handleIndexKeyDown}
              onBlur={handleIndexSubmit}
              className="w-10 bg-transparent text-white font-bold text-center border-b border-slate-500 focus:border-blue-500 outline-none text-sm appearance-none p-0"
              min={1}
              max={totalFiles}
            />
            <span className="text-slate-500 text-xs font-bold">/ {totalFiles}</span>
          </div>

          <button
            onClick={onNextFile}
            disabled={!hasNextFile}
            className={`p-1.5 rounded-md transition-colors ${hasNextFile ? 'text-white hover:bg-slate-700' : 'text-slate-600 cursor-not-allowed'}`}
            title="Next PDF File"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>

        <button
          onClick={onClose}
          className="bg-white text-slate-900 px-4 py-2 rounded-xl font-bold text-sm hover:bg-slate-200 transition-colors flex items-center gap-2 shadow-lg shadow-white/5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          Close
        </button>
      </div>
    </div>
  );
};
