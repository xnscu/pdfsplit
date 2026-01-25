import React, { useState, useEffect, useMemo, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import JSZip from "jszip";
import { ProcessingStatus } from "./types";
import { ProcessingState } from "./components/ProcessingState";
import { DebugRawView } from "./components/DebugRawView";
import { Header } from "./components/Header";
import { UploadSection } from "./components/UploadSection";
import { ConfigurationPanel } from "./components/ConfigurationPanel";
import { HistorySidebar } from "./components/HistorySidebar";
import { RefinementModal } from "./components/RefinementModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { NotificationToast } from "./components/NotificationToast";
import packageJson from "./package.json";
import SyncStatus from "./components/SyncStatus";

// Hooks
import { useExamState } from "./hooks/useExamState";
import { useFileProcessor } from "./hooks/useFileProcessor";
import { useHistoryActions } from "./hooks/useHistoryActions";
import { useRefinementActions } from "./hooks/useRefinementActions";
import { useAnalysisProcessor } from "./hooks/useAnalysisProcessor";
import { useSync } from "./hooks/useSync";
import { reSaveExamResult } from "./services/storageService"; // Needed for analysis save

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";

const App: React.FC = () => {
  // 1. State Hook
  const { state, setters, refs, actions } = useExamState();

  // 2. Logic Hooks
  const {
    handleCleanupAllHistory,
    handleLoadHistory,
    handleBatchLoadHistory,
    handleSyncLegacyData,
    handleBatchReprocessHistory,
    refreshHistoryList,
    handleDeleteHistoryItem,
    handleBatchDeleteHistoryItems,
  } = useHistoryActions({ state, setters, refs, actions });
  const { processZipFiles, handleFileChange } = useFileProcessor({
    state,
    setters,
    refs,
    actions,
    refreshHistoryList,
  });
  const { handleRecropFile, executeReanalysis, handleUpdateDetections } = useRefinementActions({
    state,
    setters,
    actions,
    refreshHistoryList,
  });

  // Analysis Hook
  const { handleStartAnalysis } = useAnalysisProcessor({
    state,
    setters,
    refs,
    actions,
  });

  // Sync Hook - Initialize sync service
  const syncHook = useSync();

  // 3. Local UI State
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    action: () => void;
    isDestructive: boolean;
    confirmLabel?: string;
  }>({
    isOpen: false,
    title: "",
    message: "",
    action: () => {},
    isDestructive: false,
  });

  const [zippingFile, setZippingFile] = useState<string | null>(null);
  const [zippingProgress, setZippingProgress] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);

  // Auto-Analyze Feature State
  const [isAutoAnalyze, setIsAutoAnalyze] = useState(false);
  // Ref to access current value inside async functions
  const isAutoAnalyzeRef = useRef(false);

  useEffect(() => {
    isAutoAnalyzeRef.current = isAutoAnalyze;
  }, [isAutoAnalyze]);

  // Load History List on Mount
  useEffect(() => {
    refreshHistoryList();
  }, []);

  // Timer Effect
  useEffect(() => {
    let interval: number;
    // 只要有开始时间且不是初始状态或错误状态，就运行计时器
    const shouldRunTimer =
      state.startTime &&
      [ProcessingStatus.LOADING_PDF, ProcessingStatus.DETECTING_QUESTIONS, ProcessingStatus.CROPPING].includes(
        state.status,
      );

    if (shouldRunTimer) {
      interval = window.setInterval(() => {
        const now = Date.now();
        const diff = Math.floor((now - state.startTime!) / 1000);
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;
        const timeStr = `${h > 0 ? h + ":" : ""}${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
        setters.setElapsedTime(timeStr);
      }, 1000);
    }

    return () => clearInterval(interval);
  }, [state.status, state.startTime]);

  // Handle URL Params for ZIP
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const zipUrl = params.get("zip");

    if (zipUrl) {
      const loadRemoteZip = async () => {
        try {
          setters.setStatus(ProcessingStatus.LOADING_PDF);
          setters.setDetailedStatus(`Downloading: ${zipUrl}`);
          const response = await fetch(zipUrl);
          if (!response.ok) throw new Error(`Fetch failed (Status: ${response.status})`);
          const blob = await response.blob();
          const fileName = zipUrl.split("/").pop() || "remote_debug.zip";
          await processZipFiles([{ blob, name: fileName }]);
        } catch (err: any) {
          setters.setError(err.message || "Remote ZIP download failed");
          setters.setStatus(ProcessingStatus.ERROR);
        }
      };
      loadRemoteZip();
    }
  }, []);

  // Determine unique file names for navigation
  const uniqueFileNames = useMemo(() => {
    return Array.from(new Set(state.rawPages.map((p) => p.fileName)));
  }, [state.rawPages]);

  const sortedFileNames = useMemo(() => {
    return uniqueFileNames.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  }, [uniqueFileNames]);

  const debugPages = useMemo(() => {
    if (!state.debugFile) return [];
    return state.rawPages.filter((p) => p.fileName === state.debugFile).sort((a, b) => a.pageNumber - b.pageNumber); // 确保页面按物理页码排序
  }, [state.rawPages, state.debugFile]);

  const debugQuestions = useMemo(() => {
    if (!state.debugFile) return [];
    return state.questions.filter((q) => q.fileName === state.debugFile);
  }, [state.questions, state.debugFile]);

  const updateDebugFile = (fileName: string | null) => {
    setters.setDebugFile(fileName);
    if (fileName) setters.setLastViewedFile(fileName);
  };

  // Wrap analysis start to include saving logic that relies on `reSaveExamResult` and auto-advance
  const handleAnalyzeWrapper = async (fileName: string) => {
    // The hook handles the process. We just trigger it.
    await handleStartAnalysis(fileName);
    await refreshHistoryList();

    // Auto-Advance Logic
    if (isAutoAnalyzeRef.current) {
      const currentIndex = sortedFileNames.indexOf(fileName);
      if (currentIndex !== -1 && currentIndex < sortedFileNames.length - 1) {
        const nextFile = sortedFileNames[currentIndex + 1];
        // Update UI to show next file
        updateDebugFile(nextFile);
        // Trigger analysis for next file with a small delay to let UI render
        setTimeout(() => {
          handleAnalyzeWrapper(nextFile);
        }, 100);
      }
    }
  };

  const handleNextFile = () => {
    const currentFileIndex = sortedFileNames.indexOf(state.debugFile || "");
    if (currentFileIndex !== -1 && currentFileIndex < sortedFileNames.length - 1) {
      updateDebugFile(sortedFileNames[currentFileIndex + 1]);
    }
  };

  const handlePrevFile = () => {
    const currentFileIndex = sortedFileNames.indexOf(state.debugFile || "");
    if (currentFileIndex > 0) {
      updateDebugFile(sortedFileNames[currentFileIndex - 1]);
    }
  };

  const handleJumpToIndex = (oneBasedIndex: number) => {
    const zeroBasedIndex = oneBasedIndex - 1;
    if (zeroBasedIndex >= 0 && zeroBasedIndex < sortedFileNames.length) {
      updateDebugFile(sortedFileNames[zeroBasedIndex]);
    }
  };

  const handleReanalyzeFile = (fileName: string) => {
    const filePages = state.rawPages.filter((p) => p.fileName === fileName);
    if (filePages.length === 0) return;

    setConfirmState({
      isOpen: true,
      title: "Re-analyze File?",
      message: `Are you sure you want to re-analyze "${fileName}"?\n\nThis will consume AI quota and overwrite any manual edits for this file.`,
      action: () => executeReanalysis(fileName).then(() => refreshHistoryList()),
      isDestructive: true,
      confirmLabel: "Re-analyze",
    });
  };

  const generateZip = async (targetFileName?: string) => {
    if (state.questions.length === 0) return;
    const fileNames = targetFileName ? [targetFileName] : sortedFileNames;
    if (fileNames.length === 0) return;

    if (targetFileName) setZippingFile(targetFileName);
    else setZippingFile("ALL");

    setZippingProgress("Initializing...");

    try {
      const zip = new JSZip();
      const isBatch = fileNames.length > 1;
      let processedCount = 0;
      const totalFiles = fileNames.length;

      for (const fileName of fileNames) {
        const fileQs = state.questions.filter((q) => q.fileName === fileName);
        if (fileQs.length === 0) continue;
        const fileRawPages = state.rawPages.filter((p) => p.fileName === fileName);
        const folder = zip.folder(fileName);
        if (!folder) continue;

        const lightweightRawPages = fileRawPages.map(({ dataUrl, ...rest }) => rest);
        folder.file("analysis_data.json", JSON.stringify(lightweightRawPages, null, 2));

        // Add Analysis JSON if present
        const analysisData = fileQs
          .map((q) => ({
            id: q.id,
            analysis: q.analysis,
          }))
          .filter((q) => q.analysis);
        if (analysisData.length > 0) {
          folder.file("math_analysis.json", JSON.stringify(analysisData, null, 2));
        }

        const fullPagesFolder = folder.folder("full_pages");
        fileRawPages.forEach((page) => {
          const base64Data = page.dataUrl.split(",")[1];
          fullPagesFolder?.file(`Page_${page.pageNumber}.jpg`, base64Data, {
            base64: true,
            compression: "STORE",
          });
        });

        const usedNames = new Set<string>();
        fileQs.forEach((q) => {
          const base64Data = q.dataUrl.split(",")[1];
          let finalName = `${q.fileName}_Q${q.id}.jpg`;
          if (usedNames.has(finalName)) {
            let counter = 1;
            const baseName = `${q.fileName}_Q${q.id}`;
            while (usedNames.has(`${baseName}_${counter}.jpg`)) counter++;
            finalName = `${baseName}_${counter}.jpg`;
          }
          usedNames.add(finalName);
          folder.file(finalName, base64Data, {
            base64: true,
            compression: "STORE",
          });
        });

        processedCount++;
        // Update progress text
        if (!targetFileName) {
          setZippingProgress(`Preparing ${processedCount}/${totalFiles}`);
          // Yield to UI thread
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      setZippingProgress("Compressing 0%");

      const content = await zip.generateAsync(
        {
          type: "blob",
          compression: "STORE",
        },
        (metadata) => {
          setZippingProgress(`Compressing ${metadata.percent.toFixed(0)}%`);
        },
      );

      setZippingProgress("Saving...");

      const url = window.URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = url;
      let downloadName = targetFileName
        ? `${targetFileName}_processed.zip`
        : isBatch
          ? "exam_batch_processed.zip"
          : `${fileNames[0]}_processed.zip`;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("ZIP Error:", err);
      actions.addNotification("ZIP Error", "error", "Failed to create zip file.");
    } finally {
      setZippingFile(null);
      setZippingProgress("");
    }
  };

  const handleGlobalDownload = () => {
    setConfirmState({
      isOpen: true,
      title: "Download All Processed Files?",
      message: `This will create a single ZIP file containing all processed images from ${sortedFileNames.length} files.`,
      action: () => generateZip(),
      isDestructive: false,
      confirmLabel: "Download ZIP",
    });
  };

  const isWideLayout = state.debugFile !== null || state.questions.length > 0 || state.sourcePages.length > 0;
  const isGlobalProcessing =
    state.status === ProcessingStatus.LOADING_PDF ||
    state.status === ProcessingStatus.DETECTING_QUESTIONS ||
    state.status === ProcessingStatus.CROPPING;
  const showInitialUI = state.status === ProcessingStatus.IDLE && state.sourcePages.length === 0;

  return (
    <div className={`min-h-screen px-4 md:px-8 bg-slate-50 relative transition-all duration-300 pb-32`}>
      <div className="fixed top-6 right-6 z-[100]">
        <button
          onClick={() => setShowSettings(true)}
          className="w-12 h-12 bg-white text-slate-700 rounded-2xl shadow-xl shadow-slate-200 border border-slate-200 hover:text-blue-600 hover:scale-105 transition-all flex items-center justify-center group"
          title="Settings"
        >
          <svg
            className="w-6 h-6 group-hover:rotate-45 transition-transform duration-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c-.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      <Header
        onShowHistory={() => setters.setShowHistory(true)}
        onReset={actions.resetState}
        showReset={state.sourcePages.length > 0 && !isGlobalProcessing}
      />

      <main className={`mx-auto transition-all duration-300 ${isWideLayout ? "w-full max-w-[98vw]" : "max-w-4xl"}`}>
        {showInitialUI && (
          <div className="space-y-8 animate-fade-in">
            <UploadSection onFileChange={handleFileChange} />
          </div>
        )}

        <ProcessingState
          status={state.status}
          progress={state.progress}
          total={state.total}
          completedCount={state.completedCount}
          error={state.error}
          detailedStatus={state.detailedStatus}
          croppingTotal={state.croppingTotal}
          croppingDone={state.croppingDone}
          elapsedTime={state.elapsedTime}
          currentRound={state.currentRound}
          failedCount={state.failedCount}
          onAbort={isGlobalProcessing ? actions.handleStop : undefined}
          onClose={() => setters.setStatus(ProcessingStatus.IDLE)}
        />

        {state.debugFile ? (
          <DebugRawView
            pages={debugPages}
            questions={debugQuestions}
            onClose={() => setters.setDebugFile(null)}
            title={state.debugFile}
            onNextFile={handleNextFile}
            onPrevFile={handlePrevFile}
            onJumpToIndex={handleJumpToIndex}
            hasNextFile={sortedFileNames.indexOf(state.debugFile) < sortedFileNames.length - 1}
            hasPrevFile={sortedFileNames.indexOf(state.debugFile) > 0}
            onUpdateDetections={handleUpdateDetections}
            onReanalyzeFile={handleReanalyzeFile}
            onDownloadZip={generateZip}
            onRefineFile={(fileName) => setters.setRefiningFile(fileName)}
            onProcessFile={(fileName) => handleRecropFile(fileName, state.cropSettings)}
            onAnalyzeFile={handleAnalyzeWrapper}
            analyzingTotal={state.analyzingTotal}
            analyzingDone={state.analyzingDone}
            isZipping={zippingFile !== null}
            zippingProgress={zippingProgress}
            isGlobalProcessing={isGlobalProcessing}
            processingFiles={state.processingFiles}
            currentFileIndex={sortedFileNames.indexOf(state.debugFile) + 1}
            totalFiles={sortedFileNames.length}
            cropSettings={state.cropSettings}
            isAutoAnalyze={isAutoAnalyze}
            setIsAutoAnalyze={setIsAutoAnalyze}
          />
        ) : (
          !isGlobalProcessing &&
          sortedFileNames.length > 0 && (
            <div className="w-full max-w-4xl mx-auto mt-8 animate-fade-in">
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight">Processed Files</h2>
                  <span className="bg-slate-100 text-slate-500 px-3 py-1 rounded-lg text-xs font-bold border border-slate-200 shadow-sm">
                    {sortedFileNames.length} Files · {state.rawPages.length} Pages
                  </span>
                </div>
                <button
                  onClick={handleGlobalDownload}
                  disabled={zippingFile !== null}
                  className={`bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-700 transition-colors shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait min-w-[200px] justify-center`}
                >
                  {zippingFile === "ALL" ? (
                    <>
                      <svg className="animate-spin w-4 h-4 text-white/50" fill="none" viewBox="0 0 24 24">
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
                      <span>{zippingProgress || "Processing..."}</span>
                    </>
                  ) : (
                    "Download All (ZIP)"
                  )}
                </button>
              </div>
              <div className="grid gap-4">
                {sortedFileNames.map((fileName, idx) => (
                  <div
                    key={fileName}
                    className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-black text-sm">
                        {idx + 1}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 text-sm truncate max-w-[200px] md:max-w-md">
                          {fileName}
                        </h3>
                        <p className="text-xs text-slate-400 font-medium">
                          {state.questions.filter((q) => q.fileName === fileName).length} Questions Extracted
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => updateDebugFile(fileName)}
                      className="px-4 py-2 bg-blue-50 text-blue-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-blue-100 transition-colors"
                    >
                      Inspect
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        )}
      </main>

      <HistorySidebar
        isOpen={state.showHistory}
        onClose={() => setters.setShowHistory(false)}
        historyList={state.historyList}
        isLoading={state.isLoadingHistory}
        loadingText={state.detailedStatus}
        progress={state.total > 0 ? (state.completedCount / state.total) * 100 : 0}
        onLoadHistory={handleLoadHistory}
        onBatchLoadHistory={handleBatchLoadHistory}
        onBatchReprocessHistory={handleBatchReprocessHistory}
        onRefreshList={refreshHistoryList}
        onCleanupAll={handleCleanupAllHistory}
        onDeleteHistory={handleDeleteHistoryItem}
        onBatchDelete={handleBatchDeleteHistoryItems}
      />
      <ConfigurationPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        selectedModel={state.selectedModel}
        setSelectedModel={setters.setSelectedModel}
        concurrency={state.concurrency}
        setConcurrency={setters.setConcurrency}
        analysisConcurrency={state.analysisConcurrency}
        setAnalysisConcurrency={setters.setAnalysisConcurrency}
        cropSettings={state.cropSettings}
        setCropSettings={setters.setCropSettings}
        useHistoryCache={state.useHistoryCache}
        setUseHistoryCache={setters.setUseHistoryCache}
        batchSize={state.batchSize}
        setBatchSize={setters.setBatchSize}
        apiKey={state.apiKey}
        setApiKey={setters.setApiKey}
      />
      {state.refiningFile && (
        <RefinementModal
          fileName={state.refiningFile}
          initialSettings={state.cropSettings}
          status={state.status}
          onClose={() => setters.setRefiningFile(null)}
          onApply={(fileName, settings) => {
            handleRecropFile(fileName, settings);
            setters.setCropSettings(settings);
          }}
        />
      )}
      <ConfirmDialog
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        onConfirm={() => {
          confirmState.action();
          setConfirmState((prev) => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
        isDestructive={confirmState.isDestructive}
        confirmLabel={confirmState.confirmLabel}
      />
      <NotificationToast
        notifications={state.notifications}
        onDismiss={(id) => setters.setNotifications((prev) => prev.filter((n) => n.id !== id))}
        onView={(fileName) => updateDebugFile(fileName)}
      />

      <footer className="mt-24 text-center text-slate-400 text-xs py-12 border-t border-slate-100 font-bold tracking-widest uppercase">
        <p>© 2025 AI Exam Splitter | Precision Tooling | v{packageJson.version}</p>
      </footer>
    </div>
  );
};

export default App;
