import React, { useState, useEffect } from "react";
import { SyncControls } from "../SyncControls";

interface Props {
  title?: string;
  pageCount: number;
  currentFileIndex: number;
  totalFiles: number;
  viewMode: "preview" | "debug";
  onToggleView: (mode: "preview" | "debug") => void;
  onPrevFile?: () => void;
  onNextFile?: () => void;
  onJumpToIndex?: (index: number) => void;
  onClose: () => void;
  onReanalyze?: () => void;
  onDownloadZip?: () => void;
  onRefine?: () => void;
  onProcess?: () => void;
  onAnalyze?: () => void; // New Prop
  onStopAnalyze?: () => void; // Stop analysis
  analyzingTotal?: number; // New Prop
  analyzingDone?: number; // New Prop
  isZipping?: boolean;
  zippingProgress?: string;
  hasNextFile?: boolean;
  hasPrevFile?: boolean;
  isAutoAnalyze?: boolean;
  setIsAutoAnalyze?: (val: boolean) => void;
  onPush?: () => void;
  onPull?: () => void;
  recommendPush?: boolean;
  recommendPull?: boolean;
  showExplanations?: boolean;
  onToggleExplanations?: () => void;
}

export const DebugToolbar: React.FC<Props> = ({
  title,
  pageCount,
  currentFileIndex,
  totalFiles,
  viewMode,
  onToggleView,
  onPrevFile,
  onNextFile,
  onJumpToIndex,
  onClose,
  onReanalyze,
  onDownloadZip,
  onRefine,
  onProcess,
  onAnalyze,
  onStopAnalyze,
  analyzingTotal = 0,
  analyzingDone = 0,
  isZipping,
  zippingProgress,
  hasNextFile,
  hasPrevFile,
  isAutoAnalyze,
  setIsAutoAnalyze,
  onPush,
  onPull,
  recommendPush,
  recommendPull,
  showExplanations,
  onToggleExplanations,
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
    if (e.key === "Enter") {
      handleIndexSubmit();
      (e.target as HTMLInputElement).blur();
    }
  };

  const isAnalyzing = analyzingTotal > 0 && analyzingDone < analyzingTotal;

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
        {/* View Toggle */}
        <div className="bg-slate-800 p-1 rounded-xl flex items-center border border-slate-700 mr-2">
          <button
            onClick={() => onToggleView("preview")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
              viewMode === "preview"
                ? "bg-blue-600 text-white shadow-lg"
                : "text-slate-400 hover:text-white hover:bg-slate-700"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
              />
            </svg>
            Final Result
          </button>
          <button
            onClick={() => onToggleView("debug")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${
              viewMode === "debug"
                ? "bg-red-500 text-white shadow-lg"
                : "text-slate-400 hover:text-white hover:bg-slate-700"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
              />
            </svg>
            Debug Boxes
          </button>
        </div>

        {/* Explanations Toggle */}
        {onToggleExplanations && (
          <button
            onClick={onToggleExplanations}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border border-transparent mr-2 flex items-center gap-2 ${
              showExplanations
                ? "bg-slate-800 text-slate-300 border-slate-700 hover:text-white"
                : "bg-slate-800/50 text-slate-500 hover:text-slate-400"
            }`}
            title={showExplanations ? "Hide Analysis/Answers" : "Show Analysis/Answers"}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {showExplanations ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              )}
            </svg>
            {showExplanations ? "Hide Answers" : "Show Answers"}
          </button>
        )}

        {/* 1. Settings */}
        {onRefine && (
          <button
            onClick={onRefine}
            className="bg-slate-800 text-slate-300 border border-slate-700 px-3 py-2 rounded-xl font-bold text-xs hover:bg-slate-700 hover:text-white transition-colors flex items-center gap-2"
            title="Adjust Crop Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
              />
            </svg>
            Settings
          </button>
        )}

        {/* 2. Re-Scan (Layout) - Was missing */}
        {onReanalyze && (
          <button
            onClick={onReanalyze}
            className="bg-orange-600 text-white px-3 py-2 rounded-xl font-bold text-xs hover:bg-orange-500 transition-colors flex items-center gap-2 shadow-lg shadow-orange-900/20"
            title="Re-run AI Layout Detection (Consumes Quota)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
              />
            </svg>
            Re-Scan
          </button>
        )}

        {/* 3. Recrop (Local) */}
        {onProcess && (
          <button
            onClick={onProcess}
            className="bg-indigo-600 text-white px-3 py-2 rounded-xl font-bold text-xs hover:bg-indigo-500 transition-colors flex items-center gap-2 shadow-lg shadow-indigo-900/20"
            title="Recrop images using current boxes and settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Recrop
          </button>
        )}

        {/* 4. AI Solve (Content) */}
        {onAnalyze && (
          <div className="flex items-center gap-2">
            <button
              onClick={onAnalyze}
              disabled={isAnalyzing}
              className={`px-3 py-2 rounded-xl font-bold text-xs transition-colors flex items-center gap-2 shadow-lg min-w-[100px] justify-center ${
                isAnalyzing
                  ? "bg-purple-900/50 text-purple-200 cursor-wait"
                  : "bg-purple-600 text-white hover:bg-purple-500 shadow-purple-900/20"
              }`}
              title="Analyze question content (Solution, Tags, Difficulty)"
            >
              {isAnalyzing ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
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
                  <span>
                    {analyzingDone}/{analyzingTotal}
                  </span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                    />
                  </svg>
                  AI Solve
                </>
              )}
            </button>
            {isAnalyzing && onStopAnalyze && (
              <button
                onClick={onStopAnalyze}
                className="bg-red-600 text-white px-3 py-2 rounded-xl font-bold text-xs hover:bg-red-500 transition-colors flex items-center gap-2 shadow-lg shadow-red-900/20"
                title="停止分析"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h6v4H9z" />
                </svg>
                停止
              </button>
            )}
            {setIsAutoAnalyze && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isAutoAnalyze}
                  onChange={(e) => setIsAutoAnalyze(e.target.checked)}
                  className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 bg-slate-700 border-slate-600 cursor-pointer"
                />
                <span className="text-slate-400 text-xs font-bold uppercase">Auto-Next</span>
              </label>
            )}
          </div>
        )}

        {/* 5. Sync Actions */}
        <SyncControls
          onPush={onPush}
          onPull={onPull}
          recommendPush={recommendPush}
          recommendPull={recommendPull}
          variant="labeled"
        />

        {/* 6. ZIP */}
        {onDownloadZip && (
          <button
            onClick={onDownloadZip}
            disabled={isZipping}
            className="bg-emerald-600 text-white px-3 py-2 rounded-xl font-bold text-xs hover:bg-emerald-500 transition-colors flex items-center gap-2 shadow-lg shadow-emerald-900/20 disabled:opacity-50 disabled:cursor-wait min-w-[80px] justify-center"
          >
            {isZipping ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                {zippingProgress && <span className="hidden sm:inline">{zippingProgress}</span>}
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                ZIP
              </>
            )}
          </button>
        )}

        <div className="flex items-center mr-4 bg-slate-800 rounded-lg p-1 border border-slate-700">
          <button
            onClick={onPrevFile}
            disabled={!hasPrevFile}
            className={`p-1.5 rounded-md transition-colors ${hasPrevFile ? "text-white hover:bg-slate-700" : "text-slate-600 cursor-not-allowed"}`}
            title="Previous PDF File"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div
            className="flex items-center gap-0.5 px-2 cursor-text"
            onClick={() => document.getElementById("file-index-input")?.focus()}
          >
            <input
              id="file-index-input"
              type="text"
              value={fileIndexInput}
              onChange={(e) => setFileIndexInput(e.target.value)}
              onKeyDown={handleIndexKeyDown}
              onBlur={handleIndexSubmit}
              className="bg-transparent text-slate-500 font-bold text-center border-none outline-none focus:ring-0 p-0 text-xs appearance-none caret-white w-[3ch] hover:text-slate-400 focus:text-slate-300 transition-colors"
              style={{ MozAppearance: "textfield" }}
            />
            <span className="text-slate-500 text-xs font-bold">/ {totalFiles}</span>
          </div>

          <button
            onClick={onNextFile}
            disabled={!hasNextFile}
            className={`p-1.5 rounded-md transition-colors ${hasNextFile ? "text-white hover:bg-slate-700" : "text-slate-600 cursor-not-allowed"}`}
            title="Next PDF File"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <button
          onClick={onClose}
          className="bg-white text-slate-900 px-4 py-2 rounded-xl font-bold text-sm hover:bg-slate-200 transition-colors flex items-center gap-2 shadow-lg shadow-white/5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Close
        </button>
      </div>
    </div>
  );
};
