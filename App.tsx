
import React, { useState, useEffect, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { ProcessingStatus } from './types';
import { ProcessingState } from './components/ProcessingState';
import { DebugRawView } from './components/DebugRawView';
import { Header } from './components/Header';
import { UploadSection } from './components/UploadSection';
import { ConfigurationPanel } from './components/ConfigurationPanel';
import { HistorySidebar } from './components/HistorySidebar';
import { RefinementModal } from './components/RefinementModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { NotificationToast } from './components/NotificationToast';

// Hooks
import { useExamState } from './hooks/useExamState';
import { useFileProcessor } from './hooks/useFileProcessor';
import { useHistoryActions } from './hooks/useHistoryActions';
import { useRefinementActions } from './hooks/useRefinementActions';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

const App: React.FC = () => {
  // 1. State Hook
  const { state, setters, refs, actions } = useExamState();
  
  // 2. Logic Hooks
  // Extract refreshHistoryList first as it is needed for useFileProcessor and useRefinementActions
  const { handleCleanupAllHistory, handleLoadHistory, handleBatchLoadHistory, handleSyncLegacyData, handleBatchReprocessHistory, refreshHistoryList } = useHistoryActions({ state, setters, refs, actions });
  const { processZipFiles, handleFileChange } = useFileProcessor({ state, setters, refs, actions, refreshHistoryList });
  const { handleRecropFile, executeReanalysis, handleUpdateDetections } = useRefinementActions({ state, setters, actions, refreshHistoryList });

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
    title: '',
    message: '',
    action: () => {},
    isDestructive: false
  });

  const [zippingFile, setZippingFile] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Load History List on Mount using the hook action
  useEffect(() => {
    refreshHistoryList();
  }, []);

  // Timer Effect
  useEffect(() => {
    let interval: number;
    const activeStates = [ProcessingStatus.LOADING_PDF, ProcessingStatus.DETECTING_QUESTIONS, ProcessingStatus.CROPPING];
    if (activeStates.includes(state.status) && state.startTime) {
      interval = window.setInterval(() => {
        const now = Date.now();
        const diff = Math.floor((now - state.startTime!) / 1000);
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;
        const timeStr = `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        setters.setElapsedTime(timeStr);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [state.status, state.startTime]);

  // Handle URL Params for ZIP
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const zipUrl = params.get('zip');

    if (zipUrl) {
      const loadRemoteZip = async () => {
        try {
          setters.setStatus(ProcessingStatus.LOADING_PDF);
          setters.setDetailedStatus(`Downloading: ${zipUrl}`);
          const response = await fetch(zipUrl);
          if (!response.ok) throw new Error(`Fetch failed (Status: ${response.status})`);
          const blob = await response.blob();
          const fileName = zipUrl.split('/').pop() || 'remote_debug.zip';
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
    return Array.from(new Set(state.rawPages.map(p => p.fileName)));
  }, [state.rawPages]);

  const sortedFileNames = useMemo(() => {
    return uniqueFileNames.sort((a, b) => 
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
  }, [uniqueFileNames]);

  const debugPages = useMemo(() => {
    if (!state.debugFile) return [];
    return state.rawPages.filter(p => p.fileName === state.debugFile);
  }, [state.rawPages, state.debugFile]);

  const debugQuestions = useMemo(() => {
    if (!state.debugFile) return [];
    return state.questions.filter(q => q.fileName === state.debugFile);
  }, [state.questions, state.debugFile]);

  // Navigation handlers
  const currentFileIndex = sortedFileNames.indexOf(state.debugFile || '');
  const hasNextFile = currentFileIndex !== -1 && currentFileIndex < sortedFileNames.length - 1;
  const hasPrevFile = currentFileIndex > 0;

  const updateDebugFile = (fileName: string | null) => {
     setters.setDebugFile(fileName);
     if (fileName) setters.setLastViewedFile(fileName);
  };

  const handleNextFile = () => {
    if (hasNextFile) updateDebugFile(sortedFileNames[currentFileIndex + 1]);
  };

  const handlePrevFile = () => {
    if (hasPrevFile) updateDebugFile(sortedFileNames[currentFileIndex - 1]);
  };
  
  const handleJumpToIndex = (oneBasedIndex: number) => {
    const zeroBasedIndex = oneBasedIndex - 1;
    if (zeroBasedIndex >= 0 && zeroBasedIndex < sortedFileNames.length) {
        updateDebugFile(sortedFileNames[zeroBasedIndex]);
    }
  };

  /**
   * Fully re-process a file (AI Detection + Crop) - Wrapper for Confirmation
   */
  const handleReanalyzeFile = (fileName: string) => {
    const filePages = state.rawPages.filter(p => p.fileName === fileName);
    if (filePages.length === 0) return;

    setConfirmState({
      isOpen: true,
      title: "Re-analyze File?",
      message: `Are you sure you want to re-analyze "${fileName}"?\n\nThis will consume AI quota and overwrite any manual edits for this file.`,
      action: () => executeReanalysis(fileName).then(() => refreshHistoryList()),
      isDestructive: true,
      confirmLabel: "Re-analyze"
    });
  };

  // ZIP Generation Logic
  const generateZip = async (targetFileName?: string) => {
    if (state.questions.length === 0) return;
    const fileNames = targetFileName ? [targetFileName] : sortedFileNames;
    if (fileNames.length === 0) return;

    if (targetFileName) setZippingFile(targetFileName);
    else setZippingFile('ALL');
    
    try {
      const zip = new JSZip();
      const isBatch = fileNames.length > 1;

      for (const fileName of fileNames) {
        const fileQs = state.questions.filter(q => q.fileName === fileName);
        if (fileQs.length === 0) continue;
        
        const fileRawPages = state.rawPages.filter(p => p.fileName === fileName);
        const folder = isBatch ? zip.folder(fileName) : zip;
        if (!folder) continue;

        // Lightweight JSON copy
        const lightweightRawPages = fileRawPages.map(({ dataUrl, ...rest }) => rest);
        folder.file("analysis_data.json", JSON.stringify(lightweightRawPages, null, 2));
        
        const fullPagesFolder = folder.folder("full_pages");
        fileRawPages.forEach((page) => {
          const base64Data = page.dataUrl.split(',')[1];
          fullPagesFolder?.file(`Page_${page.pageNumber}.jpg`, base64Data, { 
              base64: true,
              compression: "STORE" 
          });
        });

        const usedNames = new Set<string>();
        fileQs.forEach((q) => {
          const base64Data = q.dataUrl.split(',')[1];
          let finalName = `${q.fileName}_Q${q.id}.jpg`;
          if (usedNames.has(finalName)) {
             let counter = 1;
             const baseName = `${q.fileName}_Q${q.id}`;
             while(usedNames.has(`${baseName}_${counter}.jpg`)) counter++;
             finalName = `${baseName}_${counter}.jpg`;
          }
          usedNames.add(finalName);
          folder.file(finalName, base64Data, { 
              base64: true,
              compression: "STORE" 
          });
        });

        // Yield to UI
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      const content = await zip.generateAsync({ 
        type: "blob",
        compression: "STORE"
      });
      
      const url = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      let downloadName = targetFileName ? `${targetFileName}_processed.zip` : isBatch ? "exam_batch_processed.zip" : `${fileNames[0]}_processed.zip`;

      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("ZIP Error:", err);
      actions.addNotification("ZIP Error", 'error', "Failed to create zip file.");
    } finally {
      setZippingFile(null);
    }
  };

  const handleGlobalDownload = () => {
      setConfirmState({
          isOpen: true,
          title: "Download All Processed Files?",
          message: `This will create a single ZIP file containing all processed images from ${sortedFileNames.length} files.`,
          action: () => generateZip(),
          isDestructive: false,
          confirmLabel: "Download ZIP"
      });
  };

  const isWideLayout = state.debugFile !== null || state.questions.length > 0 || state.sourcePages.length > 0;
  const isGlobalProcessing = state.status === ProcessingStatus.LOADING_PDF || state.status === ProcessingStatus.DETECTING_QUESTIONS || state.status === ProcessingStatus.CROPPING;
  const showInitialUI = state.status === ProcessingStatus.IDLE || (state.status === ProcessingStatus.ERROR && state.sourcePages.length === 0);

  return (
    <div className={`min-h-screen px-4 md:px-8 bg-slate-50 relative transition-all duration-300 pb-32`}>
      
      {/* Floating Settings Button - Always Visible */}
      <div className="fixed top-6 right-6 z-[100]">
        <button 
          onClick={() => setShowSettings(true)}
          className="w-12 h-12 bg-white text-slate-700 rounded-2xl shadow-xl shadow-slate-200 border border-slate-200 hover:text-blue-600 hover:scale-105 transition-all flex items-center justify-center group"
          title="Settings"
        >
          <svg className="w-6 h-6 group-hover:rotate-45 transition-transform duration-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c-.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
        </button>
      </div>

      <Header 
        onShowHistory={() => setters.setShowHistory(true)} 
        onReset={actions.resetState} 
        showReset={state.sourcePages.length > 0 && !isGlobalProcessing}
      />

      <main className={`mx-auto transition-all duration-300 ${isWideLayout ? 'w-full max-w-[98vw]' : 'max-w-4xl'}`}>
        {showInitialUI && (
          <div className="space-y-8 animate-fade-in">
            <UploadSection onFileChange={handleFileChange} />
          </div>
        )}

        {/* Sync Legacy Data Button */}
        {state.legacySyncFiles.size > 0 && state.status === ProcessingStatus.COMPLETED && !state.debugFile && (
            <div className="mb-6 flex justify-center animate-fade-in">
                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex items-center gap-6 shadow-sm">
                    <div className="flex items-center gap-3">
                         <div className="w-10 h-10 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                         </div>
                         <div>
                             <h4 className="font-bold text-slate-800 text-sm">Optimization Available</h4>
                             <p className="text-xs text-slate-500 font-medium">Save processed images for {state.legacySyncFiles.size} file(s) to history for instant loading next time.</p>
                         </div>
                    </div>
                    <button 
                        onClick={handleSyncLegacyData}
                        disabled={state.isSyncingLegacy}
                        className="px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl text-xs uppercase tracking-widest transition-all shadow-lg shadow-orange-200 active:scale-95 disabled:opacity-50 flex items-center gap-2"
                    >
                        {state.isSyncingLegacy ? 'Saving...' : 'Sync to Database'}
                    </button>
                </div>
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
                hasNextFile={hasNextFile}
                hasPrevFile={hasPrevFile}
                onUpdateDetections={handleUpdateDetections}
                onReanalyzeFile={handleReanalyzeFile}
                onDownloadZip={generateZip}
                onRefineFile={(fileName) => setters.setRefiningFile(fileName)}
                isZipping={zippingFile !== null}
                isGlobalProcessing={isGlobalProcessing}
                processingFiles={state.processingFiles}
                currentFileIndex={currentFileIndex + 1}
                totalFiles={sortedFileNames.length}
            />
        ) : (
             state.status === ProcessingStatus.COMPLETED && sortedFileNames.length > 0 && (
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
                            className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-700 transition-colors shadow-lg flex items-center gap-2 disabled:opacity-50"
                        >
                            {zippingFile === 'ALL' ? 'Packaging...' : 'Download All (ZIP)'}
                        </button>
                    </div>
                    <div className="grid gap-4">
                        {sortedFileNames.map((fileName, idx) => (
                            <div key={fileName} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all flex items-center justify-between group">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-black text-sm">
                                        {idx + 1}
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-800 text-sm truncate max-w-[200px] md:max-w-md">{fileName}</h3>
                                        <p className="text-xs text-slate-400 font-medium">
                                            {state.questions.filter(q => q.fileName === fileName).length} Questions Extracted
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
        onLoadHistory={handleLoadHistory}
        onBatchLoadHistory={handleBatchLoadHistory}
        onBatchReprocessHistory={handleBatchReprocessHistory}
        onRefreshList={refreshHistoryList}
        onCleanupAll={handleCleanupAllHistory}
      />

      <ConfigurationPanel 
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        selectedModel={state.selectedModel}
        setSelectedModel={setters.setSelectedModel}
        concurrency={state.concurrency}
        setConcurrency={setters.setConcurrency}
        cropSettings={state.cropSettings}
        setCropSettings={setters.setCropSettings}
        useHistoryCache={state.useHistoryCache}
        setUseHistoryCache={setters.setUseHistoryCache}
        batchSize={state.batchSize}
        setBatchSize={setters.setBatchSize}
      />
      
      {state.refiningFile && (
        <RefinementModal 
          fileName={state.refiningFile}
          initialSettings={state.cropSettings}
          status={state.status}
          onClose={() => setters.setRefiningFile(null)}
          onApply={handleRecropFile}
        />
      )}

      {/* Confirmation Dialog for all generic confirms in App level */}
      <ConfirmDialog 
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        onConfirm={() => {
            confirmState.action();
            setConfirmState(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
        isDestructive={confirmState.isDestructive}
        confirmLabel={confirmState.confirmLabel}
      />

      <NotificationToast 
        notifications={state.notifications} 
        onDismiss={(id) => setters.setNotifications(prev => prev.filter(n => n.id !== id))}
        onView={(fileName) => updateDebugFile(fileName)}
      />

      <footer className="mt-24 text-center text-slate-400 text-xs py-12 border-t border-slate-100 font-bold tracking-widest uppercase">
        <p>© 2025 AI Exam Splitter | Precision Tooling</p>
      </footer>
    </div>
  );
};

export default App;
