
import React, { useState, useEffect, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ProcessingStatus } from './types';
import { ProcessingState } from './components/ProcessingState';
import { QuestionGrid } from './components/QuestionGrid';
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
  // Extract refreshHistoryList first as it is needed for useFileProcessor
  const { handleCleanupAllHistory, handleLoadHistory, handleBatchLoadHistory, handleSyncLegacyData, refreshHistoryList } = useHistoryActions({ state, setters, refs, actions });
  const { processZipFiles, handleFileChange } = useFileProcessor({ state, setters, refs, actions, refreshHistoryList });
  const { handleRecropFile, executeReanalysis, handleUpdateDetections } = useRefinementActions({ state, setters, actions });

  // 3. Local UI State
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    action: () => void;
    isDestructive: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    action: () => {},
    isDestructive: false
  });

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

  const debugPages = useMemo(() => {
    if (!state.debugFile) return [];
    return state.rawPages.filter(p => p.fileName === state.debugFile);
  }, [state.rawPages, state.debugFile]);

  const debugQuestions = useMemo(() => {
    if (!state.debugFile) return [];
    return state.questions.filter(q => q.fileName === state.debugFile);
  }, [state.questions, state.debugFile]);

  // Navigation handlers
  const currentFileIndex = uniqueFileNames.indexOf(state.debugFile || '');
  const hasNextFile = currentFileIndex !== -1 && currentFileIndex < uniqueFileNames.length - 1;
  const hasPrevFile = currentFileIndex > 0;

  const updateDebugFile = (fileName: string | null) => {
     setters.setDebugFile(fileName);
     if (fileName) setters.setLastViewedFile(fileName);
  };

  const handleNextFile = () => {
    if (hasNextFile) updateDebugFile(uniqueFileNames[currentFileIndex + 1]);
  };

  const handlePrevFile = () => {
    if (hasPrevFile) updateDebugFile(uniqueFileNames[currentFileIndex - 1]);
  };
  
  const handleJumpToIndex = (oneBasedIndex: number) => {
    const zeroBasedIndex = oneBasedIndex - 1;
    if (zeroBasedIndex >= 0 && zeroBasedIndex < uniqueFileNames.length) {
        updateDebugFile(uniqueFileNames[zeroBasedIndex]);
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
      isDestructive: true
    });
  };

  const isWideLayout = state.debugFile !== null || state.questions.length > 0 || state.sourcePages.length > 0;
  const isGlobalProcessing = state.status === ProcessingStatus.LOADING_PDF || state.status === ProcessingStatus.DETECTING_QUESTIONS || state.status === ProcessingStatus.CROPPING;
  const showInitialUI = state.status === ProcessingStatus.IDLE || (state.status === ProcessingStatus.ERROR && state.sourcePages.length === 0);

  return (
    <div className={`min-h-screen px-4 md:px-8 bg-slate-50 relative transition-all duration-300 pb-32`}>
      <Header 
        onShowHistory={() => setters.setShowHistory(true)} 
        onReset={actions.resetState} 
        showReset={state.sourcePages.length > 0 && !isGlobalProcessing}
      />

      <main className={`mx-auto transition-all duration-300 ${isWideLayout ? 'w-full max-w-[98vw]' : 'max-w-4xl'}`}>
        {showInitialUI && (
          <div className="space-y-8 animate-fade-in">
            <UploadSection onFileChange={handleFileChange} />
            
            <ConfigurationPanel 
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
                        {state.isSyncingLegacy ? (
                            <>
                               <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                               Saving...
                            </>
                        ) : 'Sync to Database'}
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
        
        {state.debugFile && (
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
                isGlobalProcessing={isGlobalProcessing}
                processingFiles={state.processingFiles}
                currentFileIndex={currentFileIndex + 1}
                totalFiles={uniqueFileNames.length}
            />
        )}

        {!state.debugFile && state.questions.length > 0 && (
            <QuestionGrid 
                questions={state.questions} 
                rawPages={state.rawPages} 
                onDebug={(fileName) => updateDebugFile(fileName)}
                onRefine={(fileName) => setters.setRefiningFile(fileName)}
                lastViewedFile={state.lastViewedFile}
            />
        )}

      </main>

      <HistorySidebar 
        isOpen={state.showHistory}
        onClose={() => setters.setShowHistory(false)}
        historyList={state.historyList}
        isLoading={state.isLoadingHistory}
        onLoadHistory={handleLoadHistory}
        onBatchLoadHistory={handleBatchLoadHistory}
        onRefreshList={refreshHistoryList}
        onCleanupAll={handleCleanupAllHistory}
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
