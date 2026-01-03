
import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ProcessingStatus, QuestionImage, DetectedQuestion, DebugPageData } from './types';
import { ProcessingState } from './components/ProcessingState';
import { QuestionGrid } from './components/QuestionGrid';
import { DebugRawView } from './components/DebugRawView';
import { renderPageToImage, cropAndStitchImage, CropSettings, mergePdfPagesToSingleImage, mergeBase64Images } from './services/pdfService';
import { detectQuestionsOnPage } from './services/geminiService';

const App: React.FC = () => {
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [questions, setQuestions] = useState<QuestionImage[]>([]);
  
  // Debug & Meta State
  const [rawPages, setRawPages] = useState<DebugPageData[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string>('exam_paper');
  const [showDebug, setShowDebug] = useState(false);

  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [detailedStatus, setDetailedStatus] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3-flash-preview');

  // Config State
  const [mergePageLimit, setMergePageLimit] = useState<number>(1); // <--- New State
  const [cropSettings, setCropSettings] = useState<CropSettings>({
    cropPadding: 25,
    canvasPaddingLeft: 0,
    canvasPaddingRight: 0,
    canvasPaddingY: 0
  });
  
  const [isReprocessing, setIsReprocessing] = useState(false);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const handleReset = () => {
    setStatus(ProcessingStatus.IDLE);
    setQuestions([]);
    setRawPages([]);
    setUploadedFileName('exam_paper');
    setProgress(0);
    setTotal(0);
    setError(undefined);
    setDetailedStatus('');
    setShowDebug(false);
  };

  useEffect(() => {
    if (rawPages.length === 0 || status === ProcessingStatus.LOADING_PDF || status === ProcessingStatus.DETECTING_QUESTIONS) {
      return;
    }

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    setIsReprocessing(true);
    debounceTimer.current = setTimeout(async () => {
      await reprocessAllCrops();
      setIsReprocessing(false);
    }, 500); 

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [cropSettings]); 

  const reprocessAllCrops = async () => {
    if (rawPages.length === 0) return;

    const updatedQuestions: QuestionImage[] = [];

    // Note: This naive reprocessing doesn't re-run the complex orphan stitching logic for "Page-by-Page" mode.
    // It assumes detections are final. If we have merged pages (Mode A), it works perfectly.
    // If we have separated pages (Mode B), this will just re-crop the original detections.
    // Ideally, we would store the "stitched" state, but for UI tuning, this is acceptable.

    for (const page of rawPages) {
      for (let j = 0; j < page.detections.length; j++) {
        const detection = page.detections[j];
        
        // Skip orphans during re-processing visualization as they are meant to be stitched
        if (detection.id === 'continuation') continue;

        const { final, original } = await cropAndStitchImage(
          page.dataUrl, 
          detection.boxes_2d, 
          page.width, 
          page.height,
          cropSettings 
        );
        
        if (final) {
          updatedQuestions.push({
            id: detection.id,
            pageNumber: page.pageNumber,
            dataUrl: final,
            originalDataUrl: original
          });
        }
      }
    }
    setQuestions(updatedQuestions);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setStatus(ProcessingStatus.LOADING_PDF);
      setError(undefined);
      setDetailedStatus('');
      setQuestions([]);
      setRawPages([]);
      setProgress(0);
      
      const name = file.name.replace(/\.[^/.]+$/, "");
      setUploadedFileName(name);

      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      setTotal(pdf.numPages);

      const allExtractedQuestions: QuestionImage[] = [];

      // --- BRANCH 1: Single Image Mode (Pages <= Threshold) ---
      if (pdf.numPages <= mergePageLimit) {
        setDetailedStatus(`Merging ${pdf.numPages} pages into one canvas...`);
        
        // Render giant image
        const mergedImage = await mergePdfPagesToSingleImage(pdf, pdf.numPages, 2.5, (c, t) => {
           setProgress(c);
           setDetailedStatus(`Rendering page ${c} of ${t}...`);
        });

        setStatus(ProcessingStatus.DETECTING_QUESTIONS);
        setDetailedStatus('AI analyzing entire document at once...');
        
        // Detect on giant image
        const detections = await detectQuestionsOnPage(mergedImage.dataUrl, selectedModel);
        
        // Store one "Giant" Raw Page
        setRawPages([{
          pageNumber: 1, // Logically page 1
          dataUrl: mergedImage.dataUrl,
          width: mergedImage.width,
          height: mergedImage.height,
          detections: detections
        }]);

        setStatus(ProcessingStatus.CROPPING);
        for (let j = 0; j < detections.length; j++) {
           const detection = detections[j];
           if (detection.id === 'continuation') continue; // Should rarely happen in single mode, but good safety

           setDetailedStatus(`Extracting Question ${detection.id}...`);
           const { final, original } = await cropAndStitchImage(
            mergedImage.dataUrl,
            detection.boxes_2d,
            mergedImage.width,
            mergedImage.height,
            cropSettings
           );

           if (final) {
             allExtractedQuestions.push({
               id: detection.id,
               pageNumber: 1,
               dataUrl: final,
               originalDataUrl: original
             });
           }
        }

      } else {
        // --- BRANCH 2: Page-by-Page Mode with Stitching (Pages > Threshold) ---
        for (let i = 1; i <= pdf.numPages; i++) {
          setProgress(i);
          setDetailedStatus(`Rendering page ${i}...`);
          
          const page = await pdf.getPage(i);
          const { dataUrl, width, height } = await renderPageToImage(page, 3);

          setStatus(ProcessingStatus.DETECTING_QUESTIONS);
          setDetailedStatus(`AI identifying questions on page ${i}...`);
          
          let detections: DetectedQuestion[] = await detectQuestionsOnPage(dataUrl, selectedModel);

          // Store Raw Data
          setRawPages(prev => [...prev, {
            pageNumber: i,
            dataUrl,
            width,
            height,
            detections
          }]);

          // --- ORPHAN STITCHING LOGIC ---
          // Check if the first detected item is a "continuation"
          if (detections.length > 0 && detections[0].id === 'continuation') {
             const orphan = detections[0];
             setDetailedStatus(`Found cross-page content on Page ${i}. Stitching...`);
             
             // Crop the orphan fragment
             const { final: orphanImg } = await cropAndStitchImage(
                dataUrl, 
                orphan.boxes_2d, 
                width, 
                height, 
                cropSettings
             );

             // Find previous question to attach to
             if (allExtractedQuestions.length > 0 && orphanImg) {
                const lastQ = allExtractedQuestions[allExtractedQuestions.length - 1];
                // Merge vertically
                const stitchedImg = await mergeBase64Images(lastQ.dataUrl, orphanImg);
                // Update the previous question
                lastQ.dataUrl = stitchedImg;
                // Note: We don't update 'originalDataUrl' here easily, but 'final' is updated.
             }

             // Remove orphan from list so it doesn't become its own question
             detections = detections.slice(1);
          }

          setStatus(ProcessingStatus.CROPPING);
          for (let j = 0; j < detections.length; j++) {
            const detection = detections[j];
            setDetailedStatus(`Page ${i}: Cutting Question ${detection.id}...`);
            
            const { final, original } = await cropAndStitchImage(
              dataUrl, 
              detection.boxes_2d, 
              width, 
              height,
              cropSettings, 
              (msg) => setDetailedStatus(`Q${detection.id}: ${msg}`) 
            );
            
            if (final) {
              allExtractedQuestions.push({
                id: detection.id,
                pageNumber: i,
                dataUrl: final,
                originalDataUrl: original
              });
            }
          }
          
          if (i < pdf.numPages) {
            setStatus(ProcessingStatus.LOADING_PDF);
          }
        }
      }

      setQuestions(allExtractedQuestions);
      setStatus(ProcessingStatus.COMPLETED);
      setDetailedStatus('');
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to process PDF.");
      setStatus(ProcessingStatus.ERROR);
    }
  };

  const isWideLayout = showDebug || questions.length > 0;

  return (
    <div className="min-h-screen pb-48 px-4 md:px-8 bg-slate-50 relative">
      <header className="max-w-6xl mx-auto py-10 text-center relative">
        <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-6">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          Smart Layout Reconstruction
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4 tracking-tight">
          Exam <span className="text-blue-600">Question</span> Splitter
        </h1>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Supports 2/3-column layouts. Auto-merges short PDFs into a single view for perfect question integrity.
        </p>

        {(questions.length > 0 || rawPages.length > 0) && (
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mt-8 animate-fade-in">
            <div className="bg-white p-1 rounded-xl border border-slate-200 shadow-sm inline-flex">
              <button
                onClick={() => setShowDebug(false)}
                className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
                  !showDebug ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                Final Results
              </button>
              <button
                onClick={() => setShowDebug(true)}
                className={`px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${
                  showDebug ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                Debug / Raw View
              </button>
            </div>

            <button
              onClick={handleReset}
              className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:text-blue-600 hover:border-blue-200 transition-all shadow-sm flex items-center gap-2 group"
            >
               <svg className="w-4 h-4 text-slate-400 group-hover:text-blue-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
               </svg>
               Upload New File
            </button>
          </div>
        )}
      </header>

      <main className={`mx-auto transition-all duration-300 ${isWideLayout ? 'w-full max-w-[98vw]' : 'max-w-7xl'}`}>
        {status === ProcessingStatus.IDLE || status === ProcessingStatus.COMPLETED || status === ProcessingStatus.ERROR ? (
          (!isWideLayout && questions.length === 0) && (
            <div className="relative group max-w-2xl mx-auto flex flex-col items-center">
              
              <div className="w-full mb-8 relative bg-white border-2 border-dashed border-slate-200 rounded-3xl p-12 text-center hover:border-blue-400 transition-colors z-10">
                <input 
                  type="file" 
                  accept="application/pdf"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="mb-6">
                  <div className="w-20 h-20 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                    <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold text-slate-800 mb-1">Upload Exam PDF</h2>
                  <p className="text-slate-500">Auto-detects multi-column content</p>
                </div>
              </div>

              <div className="flex flex-col items-center gap-4 mb-4 z-20 w-full">
                {/* Model Selection */}
                <div className="flex items-center bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-3 mr-3">Model</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setSelectedModel('gemini-3-flash-preview')}
                      className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
                        selectedModel === 'gemini-3-flash-preview' 
                          ? 'bg-amber-100 text-amber-700 shadow-sm' 
                          : 'text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <span>⚡ Flash</span>
                    </button>
                    <button
                      onClick={() => setSelectedModel('gemini-3-pro-preview')}
                      className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
                        selectedModel === 'gemini-3-pro-preview' 
                          ? 'bg-indigo-100 text-indigo-700 shadow-sm' 
                          : 'text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                     <span>🧠 Pro</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        ) : null}

        <ProcessingState 
          status={status} 
          progress={progress} 
          total={total} 
          error={error} 
          detailedStatus={detailedStatus}
        />

        {showDebug ? (
          <DebugRawView pages={rawPages} />
        ) : (
          questions.length > 0 && (
            <div className="relative">
              {isReprocessing && (
                 <div className="absolute inset-0 z-50 bg-white/50 backdrop-blur-[1px] flex items-start justify-center pt-20 transition-all">
                    <div className="bg-black/80 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-3 animate-bounce">
                       <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                       <span className="font-bold">Updating crops...</span>
                    </div>
                 </div>
              )}
              <QuestionGrid questions={questions} sourceFileName={uploadedFileName} rawPages={rawPages} />
            </div>
          )
        )}
      </main>
      
      {/* Floating Tuning Control Panel */}
      {!showDebug && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-t border-slate-200 shadow-[0_-5px_30px_rgba(0,0,0,0.1)] transition-transform duration-300 transform translate-y-0">
          <div className="max-w-7xl mx-auto px-4 py-4">
             <div className="flex flex-col xl:flex-row items-center gap-6 justify-between">
                
                <div className="flex items-center gap-3 min-w-[150px]">
                   <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600">
                     <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                   </div>
                   <div>
                     <h3 className="text-sm font-bold text-slate-800">Tuning</h3>
                     <p className="text-xs text-slate-500 hidden sm:block">Settings</p>
                   </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-x-8 gap-y-2 flex-grow w-full md:w-auto">
                    {/* Merge Limit */}
                    <div className="flex flex-col gap-1">
                       <div className="flex justify-between">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Merge Threshold</label>
                          <span className="text-[10px] font-mono bg-indigo-50 text-indigo-700 px-1 rounded">{mergePageLimit} pgs</span>
                       </div>
                       <input 
                         type="range" min="1" max="20" step="1" 
                         value={mergePageLimit}
                         onChange={(e) => setMergePageLimit(parseInt(e.target.value))}
                         className="h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                         title="PDFs smaller than this will be merged into one image"
                       />
                    </div>

                    {/* Crop Padding */}
                    <div className="flex flex-col gap-1">
                       <div className="flex justify-between">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Scan Padding</label>
                          <span className="text-[10px] font-mono bg-slate-100 px-1 rounded">{cropSettings.cropPadding}px</span>
                       </div>
                       <input 
                         type="range" min="0" max="100" step="1" 
                         value={cropSettings.cropPadding}
                         onChange={(e) => setCropSettings(p => ({...p, cropPadding: parseInt(e.target.value)}))}
                         className="h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                       />
                    </div>

                    {/* Canvas Y Padding */}
                    <div className="flex flex-col gap-1">
                       <div className="flex justify-between">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Vertical Space</label>
                          <span className="text-[10px] font-mono bg-slate-100 px-1 rounded">{cropSettings.canvasPaddingY}px</span>
                       </div>
                       <input 
                         type="range" min="0" max="100" step="5" 
                         value={cropSettings.canvasPaddingY}
                         onChange={(e) => setCropSettings(p => ({...p, canvasPaddingY: parseInt(e.target.value)}))}
                         className="h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                       />
                    </div>

                    {/* Canvas Left Padding */}
                    <div className="flex flex-col gap-1">
                       <div className="flex justify-between">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Left Margin</label>
                          <span className="text-[10px] font-mono bg-slate-100 px-1 rounded">{cropSettings.canvasPaddingLeft}px</span>
                       </div>
                       <input 
                         type="range" min="0" max="100" step="5" 
                         value={cropSettings.canvasPaddingLeft}
                         onChange={(e) => setCropSettings(p => ({...p, canvasPaddingLeft: parseInt(e.target.value)}))}
                         className="h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                       />
                    </div>

                    {/* Canvas Right Padding */}
                    <div className="flex flex-col gap-1">
                       <div className="flex justify-between">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Right Margin</label>
                          <span className="text-[10px] font-mono bg-slate-100 px-1 rounded">{cropSettings.canvasPaddingRight}px</span>
                       </div>
                       <input 
                         type="range" min="0" max="100" step="5" 
                         value={cropSettings.canvasPaddingRight}
                         onChange={(e) => setCropSettings(p => ({...p, canvasPaddingRight: parseInt(e.target.value)}))}
                         className="h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                       />
                    </div>
                </div>

                {/* Reset Button */}
                <button 
                  onClick={() => setCropSettings({ cropPadding: 20, canvasPaddingLeft: 10, canvasPaddingRight: 10, canvasPaddingY: 10 })}
                  className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-red-500 transition-colors"
                  title="Reset to defaults"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
             </div>
          </div>
        </div>
      )}

      <footer className="mt-20 text-center text-slate-400 text-sm">
        <p>© 2024 AI Exam Splitter • Smart Multi-Column Stitching</p>
      </footer>
    </div>
  );
};

export default App;
