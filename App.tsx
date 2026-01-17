import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { ProcessingStatus, QuestionImage, DetectedQuestion, DebugPageData } from './types';
import { ProcessingState } from './components/ProcessingState';
import { QuestionGrid } from './components/QuestionGrid';
import { DebugRawView } from './components/DebugRawView';
import { renderPageToImage, cropAndStitchImage, CropSettings, mergeBase64Images } from './services/pdfService';
import { detectQuestionsOnPage } from './services/geminiService';

const CONCURRENCY_LIMIT = 5; 

// Initial default settings
const DEFAULT_SETTINGS: CropSettings = {
  cropPadding: 15,
  canvasPaddingLeft: 10,
  canvasPaddingRight: 10,
  canvasPaddingY: 10,
  mergeOverlap: 20
};

interface SourcePage {
  dataUrl: string;
  width: number;
  height: number;
  pageNumber: number;
  fileName: string;
}

const normalizeBoxes = (boxes2d: any): [number, number, number, number][] => {
  // Check if the first element is an array (nested) or a number (flat)
  if (Array.isArray(boxes2d[0])) {
    return boxes2d as [number, number, number, number][];
  }
  return [boxes2d] as [number, number, number, number][];
};

const App: React.FC = () => {
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [questions, setQuestions] = useState<QuestionImage[]>([]);
  const [rawPages, setRawPages] = useState<DebugPageData[]>([]);
  const [sourcePages, setSourcePages] = useState<SourcePage[]>([]); // Store original pages for re-processing
  const [uploadedFileNames, setUploadedFileNames] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  
  // Settings State
  const [cropSettings, setCropSettings] = useState<CropSettings>(DEFAULT_SETTINGS);
  const [showSettingsPanel, setShowSettingsPanel] = useState(true);

  // 核心进度状态
  const [progress, setProgress] = useState(0); 
  const [total, setTotal] = useState(0);
  const [completedCount, setCompletedCount] = useState(0); 

  const [error, setError] = useState<string | undefined>();
  const [detailedStatus, setDetailedStatus] = useState<string>('');
  
  // 裁剪阶段专属计数
  const [croppingTotal, setCroppingTotal] = useState(0);
  const [croppingDone, setCroppingDone] = useState(0);

  const [selectedModel, setSelectedModel] = useState<string>('gemini-3-flash-preview');
  
  const abortControllerRef = useRef<AbortController | null>(null);

  // 初始化检查 URL query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const zipUrl = params.get('zip');

    if (zipUrl) {
      const loadRemoteZip = async () => {
        try {
          setStatus(ProcessingStatus.LOADING_PDF);
          setDetailedStatus(`正在下载远程数据: ${zipUrl}`);
          
          const response = await fetch(zipUrl);
          if (!response.ok) {
            throw new Error(`无法下载文件 (Status: ${response.status})`);
          }
          
          const blob = await response.blob();
          const fileName = zipUrl.split('/').pop() || 'remote_debug.zip';
          
          await processZipData(blob, fileName);
          setShowDebug(true); // 自动切换到调试视图
        } catch (err: any) {
          console.error("Remote ZIP load failed:", err);
          setError(err.message || "远程 ZIP 下载失败");
          setStatus(ProcessingStatus.ERROR);
        }
      };
      
      loadRemoteZip();
    }
  }, []);

  const handleReset = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
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
    
    // Clear URL params on reset if present
    if (window.location.search) {
      window.history.pushState({}, '', window.location.pathname);
    }
  };

  /**
   * Phase 2: Cropping (Local only)
   * Can be re-run with different settings
   */
  const runCroppingPhase = async (pages: DebugPageData[], settings: CropSettings, signal: AbortSignal) => {
    setStatus(ProcessingStatus.CROPPING);
    const totalDetections = pages.reduce((acc, p) => acc + p.detections.length, 0);
    setCroppingTotal(totalDetections);
    setCroppingDone(0);
    setProgress(0); 
    setCompletedCount(0);
    setDetailedStatus('正在根据参数切割题目图片...');

    let allExtractedQuestions: QuestionImage[] = [];

    try {
      for (let i = 0; i < pages.length; i++) {
        if (signal.aborted) return;
        const page = pages[i];
        setProgress(i + 1);

        // Grouping logic for "continuation" needs to be file-aware
        // We filter the current list of extracted questions to only find the last one belonging to THIS file
        const getSameFileQuestions = () => allExtractedQuestions.filter(q => q.fileName === page.fileName);

        for (const detection of page.detections) {
          if (signal.aborted) return;
          
          const boxes = normalizeBoxes(detection.boxes_2d);

          const { final, original } = await cropAndStitchImage(
            page.dataUrl, 
            boxes, 
            page.width, 
            page.height,
            settings
          );
          
          if (final) {
            const sameFileQuestions = getSameFileQuestions();
            
            if (detection.id === 'continuation' && sameFileQuestions.length > 0) {
              // Find the very last question extracted for this file to merge with
              // We need to find the actual object in the main array to update it
              const lastQIndex = allExtractedQuestions.lastIndexOf(sameFileQuestions[sameFileQuestions.length - 1]);
              
              if (lastQIndex !== -1) {
                const lastQ = allExtractedQuestions[lastQIndex];
                const stitchedImg = await mergeBase64Images(lastQ.dataUrl, final, -settings.mergeOverlap);
                
                // Update the existing question in the main array
                allExtractedQuestions[lastQIndex] = {
                    ...lastQ,
                    dataUrl: stitchedImg
                };
              }
            } else {
              allExtractedQuestions.push({
                id: detection.id,
                pageNumber: page.pageNumber,
                fileName: page.fileName,
                dataUrl: final,
                originalDataUrl: original
              });
            }
          }
          setCroppingDone(prev => prev + 1);
        }
        setCompletedCount(i + 1);
        await new Promise(r => setTimeout(r, 0));
      }

      setQuestions(allExtractedQuestions);
      setStatus(ProcessingStatus.COMPLETED);
      setDetailedStatus('');
    } catch (e: any) {
      if (signal.aborted) return;
      console.error(e);
      setError("切割过程出错: " + e.message);
      setStatus(ProcessingStatus.ERROR);
    }
  };

  /**
   * Full Process: Detection -> Cropping
   */
  const runAIDetectionAndCropping = async (pages: SourcePage[], signal: AbortSignal) => {
    try {
      setStatus(ProcessingStatus.DETECTING_QUESTIONS);
      setProgress(0);
      setCompletedCount(0);
      setDetailedStatus(`AI 正在智能分析 ${pages.length} 页试卷 (${selectedModel === 'gemini-3-flash-preview' ? 'Flash' : 'Pro'})...`);

      const numPages = pages.length;
      const results: DebugPageData[] = new Array(numPages);
      
      for (let i = 0; i < pages.length; i += CONCURRENCY_LIMIT) {
        if (signal.aborted) return;
        const batch = pages.slice(i, i + CONCURRENCY_LIMIT);
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
            console.error(`Error on file ${pageData.fileName} page ${pageData.pageNumber}:`, err);
            return {
              pageNumber: pageData.pageNumber,
              fileName: pageData.fileName,
              dataUrl: pageData.dataUrl,
              width: pageData.width,
              height: pageData.height,
              detections: []
            };
          }
        }));

        batchResults.forEach((res, idx) => {
          results[i + idx] = res;
        });
      }

      setRawPages(results);
      if (signal.aborted) return;

      // Automatically start cropping with current settings
      await runCroppingPhase(results, cropSettings, signal);

    } catch (err: any) {
       if (err.name === 'AbortError') return;
       console.error(err);
       setError(err.message || "处理失败。");
       setStatus(ProcessingStatus.ERROR);
    }
  };

  const handleRecropOnly = async () => {
    if (rawPages.length === 0) return;
    abortControllerRef.current = new AbortController();
    await runCroppingPhase(rawPages, cropSettings, abortControllerRef.current.signal);
  };

  const processZipData = async (blob: Blob, fileName: string) => {
    try {
      setStatus(ProcessingStatus.LOADING_PDF);
      setDetailedStatus('正在解析 ZIP 文件...');
      
      const zip = new JSZip();
      const loadedZip = await zip.loadAsync(blob);
      
      // Look for analysis_data.json
      let analysisJsonFile: JSZip.JSZipObject | null = null;
      loadedZip.forEach((relativePath, zipEntry) => {
        if (relativePath.endsWith('analysis_data.json')) {
          analysisJsonFile = zipEntry;
        }
      });

      if (!analysisJsonFile) {
        throw new Error('ZIP 中未找到 analysis_data.json，无法恢复数据。');
      }

      const jsonText = await (analysisJsonFile as JSZip.JSZipObject).async('text');
      const loadedRawPages = JSON.parse(jsonText) as DebugPageData[];
      
      setDetailedStatus('正在加载图片资源...');
      
      // Try to reconstruct images from full_pages/
      // The path might be flat "full_pages/Page_1.jpg" or structured "full_pages/FileName/Page_1.jpg"
      // We will try to find matches broadly
      for (const page of loadedRawPages) {
        // Safe regex to find the file
        const safeFileName = page.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Try precise match first, then loose match
        let imgFile = loadedZip.file(new RegExp(`full_pages/${safeFileName}/Page_${page.pageNumber}\\.jpg$`, 'i'))[0];
        
        if (!imgFile) {
            // Fallback for old zips (no folders)
            imgFile = loadedZip.file(new RegExp(`full_pages/Page_${page.pageNumber}\\.jpg$`, 'i'))[0];
        }

        if (imgFile) {
          const base64 = await imgFile.async('base64');
          page.dataUrl = `data:image/jpeg;base64,${base64}`;
        }
      }

      setRawPages(loadedRawPages);
      setSourcePages(loadedRawPages.map(({detections, ...rest}) => rest));
      setTotal(loadedRawPages.length);
      
      const uniqueNames = Array.from(new Set(loadedRawPages.map(p => p.fileName)));
      setUploadedFileNames(uniqueNames.length > 0 ? uniqueNames : [fileName.replace(/\.[^/.]+$/, "")]);

      // Process questions from ZIP if available, OR re-crop
      await runCroppingPhase(loadedRawPages, cropSettings, new AbortController().signal);

    } catch (err: any) {
      console.error(err);
      setError(err.message || "ZIP 加载失败。");
      setStatus(ProcessingStatus.ERROR);
      throw err;
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Explicitly type `files` as `File[]` to avoid unknown[] inference if necessary
    const files: File[] = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Special case for single ZIP upload
    if (files.length === 1 && files[0].name.endsWith('.zip')) {
      processZipData(files[0], files[0].name);
      return;
    }

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      setStatus(ProcessingStatus.LOADING_PDF);
      setError(undefined);
      setDetailedStatus('正在初始化 PDF 引擎...');
      setQuestions([]);
      setRawPages([]);
      setSourcePages([]);
      setProgress(0);
      setCompletedCount(0);
      setCroppingTotal(0);
      setCroppingDone(0);
      
      const fileNames = files.map(f => f.name.replace(/\.[^/.]+$/, ""));
      setUploadedFileNames(fileNames);

      const allRenderedPages: SourcePage[] = [];
      let totalPageCount = 0;

      for (let fIdx = 0; fIdx < files.length; fIdx++) {
        if (signal.aborted) return;
        const file = files[fIdx];
        const fileName = fileNames[fIdx];
        
        setDetailedStatus(`正在读取文件 (${fIdx + 1}/${files.length}): ${file.name}...`);

        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        const numPages = pdf.numPages;
        totalPageCount += numPages;

        for (let i = 1; i <= numPages; i++) {
            if (signal.aborted) return;
            // Update progress relative to cumulative
            setProgress(allRenderedPages.length); 
            setTotal(totalPageCount); // Total keeps growing as we parse more files, or we could calculate all pages first. 
            // Better UX: Show "Rendering page X of File Y"
            setDetailedStatus(`正在渲染: ${file.name} - 第 ${i} / ${numPages} 页...`);
            
            const page = await pdf.getPage(i);
            const rendered = await renderPageToImage(page, 3);
            allRenderedPages.push({ 
                ...rendered, 
                pageNumber: i,
                fileName: fileName
            });
            setCompletedCount(allRenderedPages.length);
        }
      }

      setSourcePages(allRenderedPages);
      setTotal(allRenderedPages.length);
      
      // Trigger the AI processing chain
      await runAIDetectionAndCropping(allRenderedPages, signal);

    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error(err);
      setError(err.message || "处理失败。");
      setStatus(ProcessingStatus.ERROR);
    }
  };

  const handleReidentify = async () => {
    if (sourcePages.length === 0) return;
    abortControllerRef.current = new AbortController();
    setQuestions([]);
    setRawPages([]);
    await runAIDetectionAndCropping(sourcePages, abortControllerRef.current.signal);
  };

  const isWideLayout = showDebug || questions.length > 0 || sourcePages.length > 0;
  const canReidentify = sourcePages.length > 0 && status !== ProcessingStatus.LOADING_PDF && status !== ProcessingStatus.DETECTING_QUESTIONS;
  const isProcessing = status === ProcessingStatus.LOADING_PDF || status === ProcessingStatus.DETECTING_QUESTIONS || status === ProcessingStatus.CROPPING;

  return (
    <div className={`min-h-screen px-4 md:px-8 bg-slate-50 relative transition-all duration-300 ${rawPages.length > 0 && showSettingsPanel ? 'pb-64' : 'pb-32'}`}>
      <header className="max-w-6xl mx-auto py-10 text-center relative">
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4 tracking-tight">
          试卷 <span className="text-blue-600">智能</span> 切割
        </h1>

        {canReidentify && !isProcessing && (
          <div className="flex flex-col md:flex-row justify-center items-center gap-4 mt-8 animate-fade-in flex-wrap">
            <div className="bg-white p-1 rounded-xl border border-slate-200 shadow-sm inline-flex">
              <button
                onClick={() => setShowDebug(false)}
                className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
                  !showDebug ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                切割结果
              </button>
              <button
                onClick={() => setShowDebug(true)}
                className={`px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${
                  showDebug ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                调试视图
              </button>
            </div>

             <div className="flex items-center gap-2 p-1 bg-white rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center px-2 border-r border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mr-2">Model</span>
                  <select 
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="text-xs font-bold text-slate-700 bg-transparent outline-none cursor-pointer py-2 hover:text-blue-600"
                  >
                    <option value="gemini-3-flash-preview">⚡ Flash (Fast)</option>
                    <option value="gemini-3-pro-preview">🧠 Pro (Accurate)</option>
                  </select>
                </div>
                
                <button 
                  onClick={handleReidentify}
                  className="px-4 py-2 text-sm font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-1.5"
                  title="使用当前选中的模型重新识别所有页面"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  重新识别
                </button>
             </div>

            <button
              onClick={handleReset}
              className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-100 transition-all shadow-sm flex items-center gap-2 group"
            >
               <svg className="w-4 h-4 text-slate-400 group-hover:text-red-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
               </svg>
               重置
            </button>
          </div>
        )}
      </header>

      <main className={`mx-auto transition-all duration-300 ${isWideLayout ? 'w-full max-w-[98vw]' : 'max-w-7xl'}`}>
        {!canReidentify && (status === ProcessingStatus.IDLE || (status === ProcessingStatus.ERROR && sourcePages.length === 0)) ? (
          <div className="relative group max-w-2xl mx-auto flex flex-col items-center">
            <div className="w-full mb-8 relative bg-white border-2 border-dashed border-slate-200 rounded-3xl p-16 text-center hover:border-blue-400 transition-colors z-10 shadow-lg shadow-slate-200/50">
              <input 
                type="file" 
                accept="application/pdf,application/zip"
                onChange={handleFileChange}
                multiple // Enable multiple files
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="mb-6">
                <div className="w-24 h-24 bg-blue-50 rounded-3xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-500 shadow-inner">
                  <svg className="w-12 h-12 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11v-2a2 2 0 00-2-2H7a2 2 0 00-2 2v2" className="opacity-50" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-slate-800 mb-2">上传试卷 PDF (支持多选)</h2>
                <p className="text-slate-400 font-medium">支持批量 PDF 解析或单个 ZIP 回放调试</p>
              </div>
            </div>
            {/* Model Selection for Upload Screen */}
             <div className="flex flex-col items-center gap-4 mb-4 z-20 w-full">
              <div className="flex items-center bg-white p-2 rounded-2xl border border-slate-200 shadow-md">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-4 mr-4">AI 模型</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedModel('gemini-3-flash-preview')}
                    className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      selectedModel === 'gemini-3-flash-preview' ? 'bg-amber-100 text-amber-700 shadow-inner' : 'text-slate-500 hover:bg-slate-50'
                    }`}
                  >⚡ Flash (极速)</button>
                  <button
                    onClick={() => setSelectedModel('gemini-3-pro-preview')}
                    className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      selectedModel === 'gemini-3-pro-preview' ? 'bg-indigo-100 text-indigo-700 shadow-inner' : 'text-slate-500 hover:bg-slate-50'
                    }`}
                  >🧠 Pro (高精)</button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <ProcessingState 
          status={status} 
          progress={progress} 
          total={total} 
          completedCount={completedCount}
          error={error} 
          detailedStatus={detailedStatus}
          croppingTotal={croppingTotal}
          croppingDone={croppingDone}
        />

        {showDebug ? (
          <DebugRawView pages={rawPages} />
        ) : (
          questions.length > 0 && (
            <QuestionGrid questions={questions} rawPages={rawPages} />
          )
        )}
      </main>
      
      {/* Settings Panel - Fixed at Bottom */}
      {rawPages.length > 0 && (
        <div className={`fixed bottom-0 left-0 right-0 z-[100] transition-transform duration-300 ease-in-out ${showSettingsPanel ? 'translate-y-0' : 'translate-y-[calc(100%-48px)]'}`}>
          <div className="max-w-4xl mx-auto bg-white rounded-t-2xl shadow-[0_-10px_40px_rgba(0,0,0,0.1)] border border-slate-200">
            {/* Toggle Header */}
            <div 
              className="flex items-center justify-between px-6 py-3 cursor-pointer bg-slate-50 rounded-t-2xl border-b border-slate-100 hover:bg-slate-100 transition-colors"
              onClick={() => setShowSettingsPanel(!showSettingsPanel)}
            >
              <div className="flex items-center gap-2">
                 <div className={`w-2 h-2 rounded-full ${showSettingsPanel ? 'bg-blue-500' : 'bg-slate-300'}`}></div>
                 <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide">参数调整 (Advanced Settings)</h3>
              </div>
              <button className="text-slate-400 hover:text-slate-600">
                {showSettingsPanel ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                )}
              </button>
            </div>

            {/* Panel Content */}
            <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                  裁剪内缩 (Crop Padding)
                </label>
                <div className="flex items-center gap-2">
                  <input 
                    type="number" 
                    value={cropSettings.cropPadding}
                    onChange={(e) => setCropSettings(prev => ({ ...prev, cropPadding: Number(e.target.value) }))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <span className="text-xs text-slate-400 font-bold">px</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">坐标框向内/外扩展的像素值，正数向外。</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                  画布留白 (Padding X)
                </label>
                <div className="flex items-center gap-2">
                  <input 
                    type="number" 
                    value={cropSettings.canvasPaddingLeft}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setCropSettings(prev => ({ ...prev, canvasPaddingLeft: val, canvasPaddingRight: val }));
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <span className="text-xs text-slate-400 font-bold">px</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">最终图片左右两侧的留白宽度。</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                  拼接重叠 (Merge Overlap)
                </label>
                <div className="flex items-center gap-2">
                  <input 
                    type="number" 
                    value={cropSettings.mergeOverlap}
                    onChange={(e) => setCropSettings(prev => ({ ...prev, mergeOverlap: Number(e.target.value) }))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <span className="text-xs text-slate-400 font-bold">px</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">跨页/跨栏拼接时的重叠消除量。</p>
              </div>

              <button 
                onClick={handleRecropOnly}
                disabled={isProcessing}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 disabled:scale-100 text-white font-bold rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
              >
                {status === ProcessingStatus.CROPPING ? (
                   <>
                    <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>处理中...</span>
                   </>
                ) : (
                   <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    <span>应用并重新裁剪</span>
                   </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="mt-20 text-center text-slate-400 text-sm py-10 border-t border-slate-100">
        <p>© 2024 AI 试卷助手</p>
      </footer>
    </div>
  );
};

export default App;