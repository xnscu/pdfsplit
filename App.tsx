
import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { ProcessingStatus, QuestionImage, DebugPageData, ProcessedCanvas } from './types';
import { ProcessingState } from './components/ProcessingState';
import { QuestionGrid } from './components/QuestionGrid';
import { DebugRawView } from './components/DebugRawView';
import { renderPageToImage, constructQuestionCanvas, mergeCanvasesVertical, analyzeCanvasContent, generateAlignedImage, CropSettings } from './services/pdfService';
import { detectQuestionsOnPage } from './services/geminiService';

const DEFAULT_SETTINGS: CropSettings = {
  cropPadding: 25,
  canvasPaddingLeft: 0,
  canvasPaddingRight: 0,
  canvasPaddingY: 0,
  mergeOverlap: 0
};

const STORAGE_KEYS = {
  CROP_SETTINGS: 'exam_splitter_crop_settings_v3',
  CONCURRENCY: 'exam_splitter_concurrency_v3',
  MODEL: 'exam_splitter_selected_model_v3'
};

interface SourcePage {
  dataUrl: string;
  width: number;
  height: number;
  pageNumber: number;
  fileName: string;
}

const normalizeBoxes = (boxes2d: any): [number, number, number, number][] => {
  if (Array.isArray(boxes2d[0])) {
    return boxes2d as [number, number, number, number][];
  }
  return [boxes2d] as [number, number, number, number][];
};

const App: React.FC = () => {
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [questions, setQuestions] = useState<QuestionImage[]>([]);
  const [rawPages, setRawPages] = useState<DebugPageData[]>([]);
  const [sourcePages, setSourcePages] = useState<SourcePage[]>([]);
  const [uploadedFileNames, setUploadedFileNames] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  
  // Settings State with Persistence
  const [cropSettings, setCropSettings] = useState<CropSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CROP_SETTINGS);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  
  const [concurrency, setConcurrency] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CONCURRENCY);
      return saved ? Math.min(10, Math.max(1, parseInt(saved, 10))) : 5;
    } catch {
      return 5;
    }
  });

  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.MODEL) || 'gemini-3-flash-preview';
  });

  const [showSettingsPanel, setShowSettingsPanel] = useState(false);

  // Progress States
  const [progress, setProgress] = useState(0); 
  const [total, setTotal] = useState(0);
  const [completedCount, setCompletedCount] = useState(0); 
  const [error, setError] = useState<string | undefined>();
  const [detailedStatus, setDetailedStatus] = useState<string>('');
  const [croppingTotal, setCroppingTotal] = useState(0);
  const [croppingDone, setCroppingDone] = useState(0);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Persistence Effects
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CROP_SETTINGS, JSON.stringify(cropSettings));
  }, [cropSettings]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CONCURRENCY, concurrency.toString());
  }, [concurrency]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.MODEL, selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const zipUrl = params.get('zip');

    if (zipUrl) {
      const loadRemoteZip = async () => {
        try {
          setStatus(ProcessingStatus.LOADING_PDF);
          setDetailedStatus(`Downloading: ${zipUrl}`);
          const response = await fetch(zipUrl);
          if (!response.ok) throw new Error(`Fetch failed (Status: ${response.status})`);
          const blob = await response.blob();
          const fileName = zipUrl.split('/').pop() || 'remote_debug.zip';
          await processZipFiles([{ blob, name: fileName }]);
          setShowDebug(true);
        } catch (err: any) {
          setError(err.message || "Remote ZIP download failed");
          setStatus(ProcessingStatus.ERROR);
        }
      };
      loadRemoteZip();
    }
  }, []);

  const handleReset = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setStatus(ProcessingStatus.IDLE);
    setQuestions([]);
    setRawPages([]);
    setSourcePages([]);
    setUploadedFileNames([]);
    setProgress(0);
    setTotal(0);
    setCompletedCount(0);
    setCroppingTotal(0);
    setCroppingDone(0);
    setError(undefined);
    setDetailedStatus('');
    setShowDebug(false);
    if (window.location.search) window.history.pushState({}, '', window.location.pathname);
  };

  const runCroppingPhase = async (pages: DebugPageData[], settings: CropSettings, signal: AbortSignal) => {
    setStatus(ProcessingStatus.CROPPING);
    const totalDetections = pages.reduce((acc, p) => acc + p.detections.length, 0);
    setCroppingTotal(totalDetections);
    setCroppingDone(0);
    setProgress(0); 
    setCompletedCount(0);
    setDetailedStatus('Cropping and aligning question images...');

    const pagesByFile: Record<string, DebugPageData[]> = {};
    pages.forEach(p => {
      if (!pagesByFile[p.fileName]) pagesByFile[p.fileName] = [];
      pagesByFile[p.fileName].push(p);
    });

    const allConstructedItems: ProcessedCanvas[] = [];

    try {
      for (const [fileName, filePages] of Object.entries(pagesByFile)) {
        if (signal.aborted) return;
        const fileItems: ProcessedCanvas[] = [];
        for (let i = 0; i < filePages.length; i++) {
          if (signal.aborted) return;
          const page = filePages[i];
          setProgress(prev => prev + 1);

          for (const detection of page.detections) {
            const boxes = normalizeBoxes(detection.boxes_2d);
            const result = await constructQuestionCanvas(page.dataUrl, boxes, page.width, page.height, settings);
            
            if (result.canvas) {
              if (detection.id === 'continuation' && fileItems.length > 0) {
                 const lastIdx = fileItems.length - 1;
                 const lastQ = fileItems[lastIdx];
                 const merged = mergeCanvasesVertical(lastQ.canvas, result.canvas, -settings.mergeOverlap);
                 fileItems[lastIdx] = {
                   ...lastQ,
                   canvas: merged.canvas,
                   width: merged.width,
                   height: merged.height
                 };
              } else {
                 fileItems.push({
                   id: detection.id,
                   pageNumber: page.pageNumber,
                   fileName: page.fileName,
                   canvas: result.canvas,
                   width: result.width,
                   height: result.height,
                   originalDataUrl: result.originalDataUrl
                 });
              }
            }
            setCroppingDone(prev => prev + 1);
          }
        }
        allConstructedItems.push(...fileItems);
      }

      if (allConstructedItems.length > 0) {
          setDetailedStatus('Analyzing image dimensions...');
          const itemsWithTrim = allConstructedItems.map(item => ({
             ...item,
             trim: analyzeCanvasContent(item.canvas)
          }));
          const maxContentWidth = Math.max(...itemsWithTrim.map(i => i.trim.w));
          setDetailedStatus(`Exporting aligned images (Width: ${maxContentWidth}px)...`);
          const finalQuestions: QuestionImage[] = [];
          for (const item of itemsWithTrim) {
              if (signal.aborted) return;
              const finalDataUrl = await generateAlignedImage(item.canvas, item.trim, maxContentWidth, settings);
              finalQuestions.push({
                 id: item.id,
                 pageNumber: item.pageNumber,
                 fileName: item.fileName,
                 dataUrl: finalDataUrl,
                 originalDataUrl: item.originalDataUrl
              });
          }
          setQuestions(finalQuestions);
      } else {
          setQuestions([]);
      }
      setStatus(ProcessingStatus.COMPLETED);
    } catch (e: any) {
      if (signal.aborted) return;
      setError("Cropping failed: " + e.message);
      setStatus(ProcessingStatus.ERROR);
    }
  };

  const runAIDetectionAndCropping = async (pages: SourcePage[], signal: AbortSignal) => {
    try {
      setStatus(ProcessingStatus.DETECTING_QUESTIONS);
      setProgress(0);
      setCompletedCount(0);
      setDetailedStatus(`Analyzing ${pages.length} pages...`);

      const numPages = pages.length;
      const results: DebugPageData[] = new Array(numPages);
      
      for (let i = 0; i < pages.length; i += concurrency) {
        if (signal.aborted) return;
        const batch = pages.slice(i, i + concurrency);
        setProgress(Math.min(numPages, i + batch.length));

        const batchResults = await Promise.all(batch.map(async (pageData) => {
          try {
            const detections = await detectQuestionsOnPage(pageData.dataUrl, selectedModel);
            setCompletedCount(prev => prev + 1);
            return {
              pageNumber: pageData.pageNumber,
              fileName: pageData.fileName,
              dataUrl: pageData.dataUrl,
              width: pageData.width,
              height: pageData.height,
              detections
            };
          } catch (err: any) {
            if (signal.aborted) throw err;
            setCompletedCount(prev => prev + 1);
            return { ...pageData, detections: [] };
          }
        }));

        batchResults.forEach((res, idx) => { results[i + idx] = res as DebugPageData; });
      }

      setRawPages(results);
      if (signal.aborted) return;
      await runCroppingPhase(results, cropSettings, signal);
    } catch (err: any) {
       if (err.name === 'AbortError') return;
       setError(err.message || "Processing failed.");
       setStatus(ProcessingStatus.ERROR);
    }
  };

  const handleRecropOnly = async () => {
    if (rawPages.length === 0) return;
    abortControllerRef.current = new AbortController();
    await runCroppingPhase(rawPages, cropSettings, abortControllerRef.current.signal);
  };

  const processZipFiles = async (files: { blob: Blob, name: string }[]) => {
    try {
      setStatus(ProcessingStatus.LOADING_PDF);
      setDetailedStatus('Reading ZIP contents...');
      const allRawPages: DebugPageData[] = [];
      const allQuestions: QuestionImage[] = [];
      const totalFiles = files.length;
      let filesProcessed = 0;

      for (const file of files) {
        setDetailedStatus(`Parsing ZIP (${filesProcessed + 1}/${totalFiles}): ${file.name}`);
        filesProcessed++;
        try {
          const zip = new JSZip();
          const loadedZip = await zip.loadAsync(file.blob);
          const analysisFileKey = Object.keys(loadedZip.files).find(key => key.match(/(^|\/)analysis_data\.json$/i));
          if (!analysisFileKey) continue;

          // Determine fallback filename from ZIP name
          const zipBaseName = file.name.replace(/\.[^/.]+$/, "");

          const jsonText = await loadedZip.file(analysisFileKey)!.async('text');
          const loadedRawPages = JSON.parse(jsonText) as DebugPageData[];
          for (const page of loadedRawPages) {
            // Fix: Use ZIP filename if internal filename is missing or generic
            let rawFileName = page.fileName;
            if (!rawFileName || rawFileName === "unknown_file") {
              rawFileName = zipBaseName || "unknown_file";
            }
            page.fileName = rawFileName;
            
            const safeFileName = rawFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const imgKey = Object.keys(loadedZip.files).find(k => 
                !loadedZip.files[k].dir &&
                (k.match(new RegExp(`full_pages/${safeFileName}/Page_${page.pageNumber}\\.jpg$`, 'i')) ||
                 k.match(new RegExp(`full_pages/Page_${page.pageNumber}\\.jpg$`, 'i')))
            );
            if (imgKey) {
              const base64 = await loadedZip.file(imgKey)!.async('base64');
              page.dataUrl = `data:image/jpeg;base64,${base64}`;
            }
          }
          allRawPages.push(...loadedRawPages);

          const potentialImageKeys = Object.keys(loadedZip.files).filter(k => 
            !loadedZip.files[k].dir && /\.(jpg|jpeg|png)$/i.test(k) && !k.includes('full_pages/')
          );

          if (potentialImageKeys.length > 0) {
            const loadedQuestions: QuestionImage[] = [];
            await Promise.all(potentialImageKeys.map(async (key) => {
                const pathParts = key.split('/');
                const fileNameWithExt = pathParts[pathParts.length - 1];
                let qFileName = "unknown";
                let qId = "0";
                let matched = false;
                const flatMatch = fileNameWithExt.match(/^(.+)_Q(\d+(?:_\d+)?)\.(jpg|jpeg|png)$/i);
                if (flatMatch) {
                    qFileName = flatMatch[1];
                    qId = flatMatch[2];
                    matched = true;
                } else {
                    const nestedMatch = fileNameWithExt.match(/^Q(\d+(?:_\d+)?)\.(jpg|jpeg|png)$/i);
                    if (nestedMatch) {
                        qId = nestedMatch[1];
                        if (pathParts.length >= 2) {
                          const parent = pathParts[pathParts.length - 2];
                          if (parent.toLowerCase() !== 'questions') qFileName = parent;
                          else if (loadedRawPages.length > 0) qFileName = loadedRawPages[0].fileName;
                        }
                        // If we still don't have a filename, use the zip fallback
                        if (qFileName === "unknown" && loadedRawPages.length > 0) {
                            qFileName = loadedRawPages[0].fileName;
                        }
                        matched = true;
                    }
                }
                if (matched) {
                    const base64 = await loadedZip.file(key)!.async('base64');
                    // Find target page to match filenames if possible
                    const targetPage = loadedRawPages.find(p => (p.fileName === qFileName && p.detections.some(d => d.id === qId)) || p.detections.some(d => d.id === qId));
                    
                    loadedQuestions.push({
                      id: qId,
                      pageNumber: targetPage?.pageNumber || 0,
                      fileName: qFileName === "unknown" && targetPage ? targetPage.fileName : qFileName,
                      dataUrl: `data:image/jpeg;base64,${base64}`
                    });
                }
            }));
            allQuestions.push(...loadedQuestions);
          }
        } catch (e) { console.error(`Failed to parse ZIP ${file.name}:`, e); }
      }

      setRawPages(allRawPages);
      setSourcePages(allRawPages.map(({detections, ...rest}) => rest));
      setTotal(allRawPages.length);

      if (allQuestions.length > 0) {
        allQuestions.sort((a, b) => {
            if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
            if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
            const na = parseFloat(a.id);
            const nb = parseFloat(b.id);
            return (!isNaN(na) && !isNaN(nb)) ? na - nb : a.id.localeCompare(b.id);
        });
        setQuestions(allQuestions);
        setCompletedCount(allRawPages.length);
        setStatus(ProcessingStatus.COMPLETED);
      } else if (allRawPages.length > 0) {
         await runCroppingPhase(allRawPages, cropSettings, new AbortController().signal);
      } else {
         throw new Error("No valid data found in ZIP");
      }
    } catch (err: any) {
      setError("Batch ZIP load failed: " + err.message);
      setStatus(ProcessingStatus.ERROR);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;
    const zipFiles = files.filter(f => f.name.toLowerCase().endsWith('.zip'));
    if (zipFiles.length > 0) {
      await processZipFiles(zipFiles.map(f => ({ blob: f, name: f.name })));
      return;
    }

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      setStatus(ProcessingStatus.LOADING_PDF);
      setError(undefined);
      setDetailedStatus('Initializing PDF engine...');
      const fileNames = files.map(f => f.name.replace(/\.[^/.]+$/, ""));
      setUploadedFileNames(fileNames);
      const allRenderedPages: SourcePage[] = [];
      let totalPageCount = 0;

      for (let fIdx = 0; fIdx < files.length; fIdx++) {
        if (signal.aborted) return;
        const file = files[fIdx];
        const loadingTask = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
        const pdf = await loadingTask.promise;
        totalPageCount += pdf.numPages;

        for (let i = 1; i <= pdf.numPages; i++) {
            if (signal.aborted) return;
            setDetailedStatus(`Rendering: ${file.name} (Page ${i}/${pdf.numPages})...`);
            const page = await pdf.getPage(i);
            const rendered = await renderPageToImage(page, 3);
            allRenderedPages.push({ ...rendered, pageNumber: i, fileName: fileNames[fIdx] });
            setCompletedCount(allRenderedPages.length);
            setTotal(totalPageCount);
        }
      }
      setSourcePages(allRenderedPages);
      await runAIDetectionAndCropping(allRenderedPages, signal);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.message || "Processing failed.");
      setStatus(ProcessingStatus.ERROR);
    }
  };

  const isWideLayout = showDebug || questions.length > 0 || sourcePages.length > 0;
  const isProcessing = status === ProcessingStatus.LOADING_PDF || status === ProcessingStatus.DETECTING_QUESTIONS || status === ProcessingStatus.CROPPING;
  const showInitialUI = status === ProcessingStatus.IDLE || (status === ProcessingStatus.ERROR && sourcePages.length === 0);

  return (
    <div className={`min-h-screen px-4 md:px-8 bg-slate-50 relative transition-all duration-300 pb-32`}>
      <header className="max-w-6xl mx-auto py-10 text-center relative">
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-2 tracking-tight">
          Exam <span className="text-blue-600">Smart</span> Splitter
        </h1>
        <p className="text-slate-400 font-medium mb-8">AI-powered Batch Question Extraction Tool</p>

        {sourcePages.length > 0 && !isProcessing && (
          <div className="flex flex-col md:flex-row justify-center items-center gap-4 mt-4 animate-fade-in flex-wrap">
            <div className="bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm inline-flex">
              <button onClick={() => setShowDebug(false)} className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${!showDebug ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>Results</button>
              <button onClick={() => setShowDebug(true)} className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${showDebug ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>Debug View</button>
            </div>
            
            {rawPages.length > 0 && (
              <button
                onClick={() => setShowSettingsPanel(!showSettingsPanel)}
                className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 shadow-sm border ${showSettingsPanel ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                Refine
              </button>
            )}

            <button onClick={handleReset} className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 transition-all flex items-center gap-2 shadow-sm">Reset</button>
          </div>
        )}
      </header>

      <main className={`mx-auto transition-all duration-300 ${isWideLayout ? 'w-full max-w-[98vw]' : 'max-w-4xl'}`}>
        {showInitialUI && (
          <div className="space-y-8 animate-fade-in">
            {/* Drop Zone moved to top */}
            <div className="relative group overflow-hidden bg-white border-2 border-dashed border-slate-300 rounded-[3rem] p-20 text-center hover:border-blue-500 hover:bg-blue-50/20 transition-all duration-500 shadow-2xl shadow-slate-200/20">
              <input type="file" accept="application/pdf,application/zip" onChange={handleFileChange} multiple className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20" />
              <div className="relative z-10">
                <div className="w-24 h-24 bg-blue-600 text-white rounded-[2rem] flex items-center justify-center mx-auto mb-8 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-500 shadow-2xl shadow-blue-200">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v12m0 0l-4-4m4 4l4-4M4 17a3 3 0 003 3h10a3 3 0 003-3v-1" /></svg>
                </div>
                <h2 className="text-3xl font-black text-slate-900 mb-3 tracking-tight">Process Documents</h2>
                <p className="text-slate-400 text-lg font-medium">Click or drag PDF files here (Batch supported)</p>
                <div className="mt-10 flex justify-center gap-4">
                   <span className="px-5 py-2 bg-slate-50 text-slate-400 text-[10px] font-black rounded-xl border border-slate-200 uppercase tracking-widest shadow-sm">PDF Files</span>
                   <span className="px-5 py-2 bg-slate-50 text-slate-400 text-[10px] font-black rounded-xl border border-slate-200 uppercase tracking-widest shadow-sm">Data ZIPs</span>
                </div>
              </div>
            </div>

            {/* Minimalist Configuration Section moved below Drop Zone */}
            <section className="bg-white rounded-[2rem] p-8 md:p-10 border border-slate-200 shadow-xl shadow-slate-200/50">
               <div className="flex items-center gap-3 mb-10 pb-4 border-b border-slate-100">
                  <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                  </div>
                  <h2 className="text-2xl font-black text-slate-800 tracking-tight">Configuration</h2>
               </div>
               
               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-x-12 gap-y-10">
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">AI Model</label>
                    <div className="flex p-1.5 bg-slate-50 rounded-2xl border border-slate-200">
                      <button onClick={() => setSelectedModel('gemini-3-flash-preview')} className={`flex-1 py-2.5 text-[10px] font-black uppercase rounded-xl transition-all ${selectedModel === 'gemini-3-flash-preview' ? 'bg-white text-blue-600 shadow-md ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-600'}`}>Flash</button>
                      <button onClick={() => setSelectedModel('gemini-3-pro-preview')} className={`flex-1 py-2.5 text-[10px] font-black uppercase rounded-xl transition-all ${selectedModel === 'gemini-3-pro-preview' ? 'bg-white text-blue-600 shadow-md ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-600'}`}>Pro</button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Concurrency</label>
                      <span className="text-xs font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">{concurrency} Threads</span>
                    </div>
                    <div className="pt-2 px-1">
                      <input type="range" min="1" max="10" value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} className="w-full accent-blue-600 h-2 bg-slate-100 rounded-lg cursor-pointer appearance-none" />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Crop Padding</label>
                    <div className="relative group">
                      <input type="number" value={cropSettings.cropPadding} onChange={(e) => setCropSettings(s => ({...s, cropPadding: Number(e.target.value)}))} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300 uppercase select-none group-focus-within:text-blue-400 transition-colors">px</div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Merge Overlap</label>
                    <div className="relative group">
                      <input type="number" value={cropSettings.mergeOverlap} onChange={(e) => setCropSettings(s => ({...s, mergeOverlap: Number(e.target.value)}))} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300 uppercase select-none group-focus-within:text-blue-400 transition-colors">px</div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Inner Padding</label>
                    <div className="relative group">
                      <input type="number" value={cropSettings.canvasPaddingLeft} onChange={(e) => {
                          const v = Number(e.target.value);
                          setCropSettings(s => ({...s, canvasPaddingLeft: v, canvasPaddingRight: v, canvasPaddingY: v}));
                      }} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300 uppercase select-none group-focus-within:text-blue-400 transition-colors">px</div>
                    </div>
                  </div>
               </div>
            </section>
          </div>
        )}

        <ProcessingState status={status} progress={progress} total={total} completedCount={completedCount} error={error} detailedStatus={detailedStatus} croppingTotal={croppingTotal} croppingDone={croppingDone} />
        {showDebug ? <DebugRawView pages={rawPages} questions={questions} /> : (questions.length > 0 && <QuestionGrid questions={questions} rawPages={rawPages} />)}
      </main>
      
      {/* Refinement Panel - Moved to Top Right Floating Dialog */}
      {showSettingsPanel && rawPages.length > 0 && (
        <div className="fixed top-24 right-4 z-[100] w-80 bg-white rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] border border-slate-200 overflow-hidden animate-[fade-in_0.2s_ease-out]">
          <div className="p-5 bg-slate-50/50 border-b border-slate-100 flex justify-between items-center backdrop-blur-sm">
            <h3 className="font-black text-slate-700 text-xs uppercase tracking-[0.2em]">Refine Settings</h3>
            <button 
              onClick={() => setShowSettingsPanel(false)}
              className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg hover:bg-slate-100"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="p-6 space-y-5">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Crop Padding</label>
              <div className="flex items-center gap-3 relative group">
                <input type="number" value={cropSettings.cropPadding} onChange={(e) => setCropSettings(prev => ({ ...prev, cropPadding: Number(e.target.value) }))} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm" />
                <span className="absolute right-4 text-[10px] text-slate-400 font-black uppercase select-none">px</span>
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Inner Pad</label>
              <div className="flex items-center gap-3 relative group">
                <input type="number" value={cropSettings.canvasPaddingLeft} onChange={(e) => { const v = Number(e.target.value); setCropSettings(p => ({ ...p, canvasPaddingLeft: v, canvasPaddingRight: v, canvasPaddingY: v })); }} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm" />
                <span className="absolute right-4 text-[10px] text-slate-400 font-black uppercase select-none">px</span>
              </div>
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Overlap</label>
              <div className="flex items-center gap-3 relative group">
                <input type="number" value={cropSettings.mergeOverlap} onChange={(e) => setCropSettings(p => ({ ...p, mergeOverlap: Number(e.target.value) }))} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm" />
                <span className="absolute right-4 text-[10px] text-slate-400 font-black uppercase select-none">px</span>
              </div>
            </div>

            <div className="pt-2">
              <button 
                onClick={handleRecropOnly} 
                disabled={isProcessing} 
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl shadow-lg shadow-blue-200 transition-all active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50 text-sm"
              >
                {status === ProcessingStatus.CROPPING ? (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> 
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                )}
                Recrop Images
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="mt-24 text-center text-slate-400 text-xs py-12 border-t border-slate-100 font-bold tracking-widest uppercase">
        <p>© 2025 AI Exam Splitter | Precision Tooling</p>
      </footer>
    </div>
  );
};

export default App;
