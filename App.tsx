
import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { ProcessingStatus, QuestionImage, DetectedQuestion, DebugPageData } from './types';
import { ProcessingState } from './components/ProcessingState';
import { QuestionGrid } from './components/QuestionGrid';
import { DebugRawView } from './components/DebugRawView';
import { renderPageToImage, cropAndStitchImage, CropSettings, mergeBase64Images } from './services/pdfService';
import { detectQuestionsOnPage } from './services/geminiService';

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
  
  // Settings State
  const [cropSettings, setCropSettings] = useState<CropSettings>(DEFAULT_SETTINGS);
  const [concurrency, setConcurrency] = useState(5);
  const [showSettingsPanel, setShowSettingsPanel] = useState(true);

  // 进度状态
  const [progress, setProgress] = useState(0); 
  const [total, setTotal] = useState(0);
  const [completedCount, setCompletedCount] = useState(0); 

  const [error, setError] = useState<string | undefined>();
  const [detailedStatus, setDetailedStatus] = useState<string>('');
  
  const [croppingTotal, setCroppingTotal] = useState(0);
  const [croppingDone, setCroppingDone] = useState(0);

  const [selectedModel, setSelectedModel] = useState<string>('gemini-3-flash-preview');
  
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const zipUrl = params.get('zip');

    if (zipUrl) {
      const loadRemoteZip = async () => {
        try {
          setStatus(ProcessingStatus.LOADING_PDF);
          setDetailedStatus(`正在下载远程数据: ${zipUrl}`);
          const response = await fetch(zipUrl);
          if (!response.ok) throw new Error(`无法下载文件 (Status: ${response.status})`);
          const blob = await response.blob();
          const fileName = zipUrl.split('/').pop() || 'remote_debug.zip';
          await processZipData(blob, fileName);
          setShowDebug(true);
        } catch (err: any) {
          setError(err.message || "远程 ZIP 下载失败");
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
    setDetailedStatus('正在根据参数切割题目图片...');

    let allExtractedQuestions: QuestionImage[] = [];

    try {
      for (let i = 0; i < pages.length; i++) {
        if (signal.aborted) return;
        const page = pages[i];
        setProgress(i + 1);
        const getSameFileQuestions = () => allExtractedQuestions.filter(q => q.fileName === page.fileName);

        for (const detection of page.detections) {
          if (signal.aborted) return;
          const boxes = normalizeBoxes(detection.boxes_2d);
          const { final, original } = await cropAndStitchImage(page.dataUrl, boxes, page.width, page.height, settings);
          
          if (final) {
            const sameFileQuestions = getSameFileQuestions();
            if (detection.id === 'continuation' && sameFileQuestions.length > 0) {
              const lastQIndex = allExtractedQuestions.lastIndexOf(sameFileQuestions[sameFileQuestions.length - 1]);
              if (lastQIndex !== -1) {
                const lastQ = allExtractedQuestions[lastQIndex];
                const stitchedImg = await mergeBase64Images(lastQ.dataUrl, final, -settings.mergeOverlap);
                allExtractedQuestions[lastQIndex] = { ...lastQ, dataUrl: stitchedImg };
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
    } catch (e: any) {
      if (signal.aborted) return;
      setError("切割过程出错: " + e.message);
      setStatus(ProcessingStatus.ERROR);
    }
  };

  const runAIDetectionAndCropping = async (pages: SourcePage[], signal: AbortSignal) => {
    try {
      setStatus(ProcessingStatus.DETECTING_QUESTIONS);
      setProgress(0);
      setCompletedCount(0);
      setDetailedStatus(`AI 正在智能分析 ${pages.length} 页试卷...`);

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
      let analysisJsonFile = loadedZip.file(/analysis_data\.json$/i)[0];

      if (!analysisJsonFile) throw new Error('ZIP 中未找到 analysis_data.json');
      const jsonText = await analysisJsonFile.async('text');
      const loadedRawPages = JSON.parse(jsonText) as DebugPageData[];
      
      for (const page of loadedRawPages) {
        const safeFileName = page.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let imgFile = loadedZip.file(new RegExp(`full_pages/${safeFileName}/Page_${page.pageNumber}\\.jpg$`, 'i'))[0] 
                     || loadedZip.file(new RegExp(`full_pages/Page_${page.pageNumber}\\.jpg$`, 'i'))[0];
        if (imgFile) {
          const base64 = await imgFile.async('base64');
          page.dataUrl = `data:image/jpeg;base64,${base64}`;
        }
      }
      setRawPages(loadedRawPages);
      setSourcePages(loadedRawPages.map(({detections, ...rest}) => rest));
      setTotal(loadedRawPages.length);
      await runCroppingPhase(loadedRawPages, cropSettings, new AbortController().signal);
    } catch (err: any) {
      setError(err.message || "ZIP 加载失败。");
      setStatus(ProcessingStatus.ERROR);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Explicitly cast to File[] to fix errors where files were being inferred as unknown[]
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;
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
            setDetailedStatus(`正在渲染: ${file.name} - 第 ${i} / ${pdf.numPages} 页...`);
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
      setError(err.message || "处理失败。");
      setStatus(ProcessingStatus.ERROR);
    }
  };

  const isWideLayout = showDebug || questions.length > 0 || sourcePages.length > 0;
  const isProcessing = status === ProcessingStatus.LOADING_PDF || status === ProcessingStatus.DETECTING_QUESTIONS || status === ProcessingStatus.CROPPING;
  const showInitialUI = status === ProcessingStatus.IDLE || (status === ProcessingStatus.ERROR && sourcePages.length === 0);

  return (
    <div className={`min-h-screen px-4 md:px-8 bg-slate-50 relative transition-all duration-300 ${rawPages.length > 0 && showSettingsPanel ? 'pb-64' : 'pb-32'}`}>
      <header className="max-w-6xl mx-auto py-10 text-center relative">
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-2 tracking-tight">
          试卷 <span className="text-blue-600">智能</span> 切割
        </h1>
        <p className="text-slate-400 font-medium mb-8">精准、高效、批量的题目提取工具</p>

        {sourcePages.length > 0 && !isProcessing && (
          <div className="flex flex-col md:flex-row justify-center items-center gap-4 mt-4 animate-fade-in flex-wrap">
            <div className="bg-white p-1 rounded-xl border border-slate-200 shadow-sm inline-flex">
              <button onClick={() => setShowDebug(false)} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${!showDebug ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>切割结果</button>
              <button onClick={() => setShowDebug(true)} className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${showDebug ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>调试视图</button>
            </div>
            <button onClick={handleReset} className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 transition-all flex items-center gap-2">重置</button>
          </div>
        )}
      </header>

      <main className={`mx-auto transition-all duration-300 ${isWideLayout ? 'w-full max-w-[98vw]' : 'max-w-4xl'}`}>
        {showInitialUI && (
          <div className="space-y-12 animate-fade-in">
            {/* 参数配置区 */}
            <section className="bg-white rounded-3xl p-8 border border-slate-200 shadow-xl shadow-slate-200/50">
               <div className="flex items-center gap-3 mb-8 pb-4 border-b border-slate-100">
                  <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                  </div>
                  <h2 className="text-xl font-bold text-slate-800">全局参数配置 (Configuration)</h2>
               </div>
               
               <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="space-y-3">
                    <label className="text-sm font-bold text-slate-500 uppercase flex items-center gap-2">
                       <span className="w-1.5 h-1.5 bg-amber-400 rounded-full"></span>
                       AI 识别模型
                    </label>
                    <div className="flex p-1 bg-slate-50 rounded-xl border border-slate-200">
                      <button onClick={() => setSelectedModel('gemini-3-flash-preview')} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${selectedModel === 'gemini-3-flash-preview' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Flash (快)</button>
                      <button onClick={() => setSelectedModel('gemini-3-pro-preview')} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${selectedModel === 'gemini-3-pro-preview' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>Pro (精)</button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-bold text-slate-500 uppercase flex items-center gap-2">
                       <span className="w-1.5 h-1.5 bg-blue-400 rounded-full"></span>
                       并发处理数
                    </label>
                    <div className="flex items-center gap-4">
                      <input type="range" min="1" max="10" value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} className="flex-1 accent-blue-600 h-1.5 bg-slate-200 rounded-lg cursor-pointer" />
                      <span className="w-8 text-center font-black text-blue-600 bg-blue-50 py-1 rounded-lg border border-blue-100">{concurrency}</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-bold text-slate-500 uppercase flex items-center gap-2">
                       <span className="w-1.5 h-1.5 bg-green-400 rounded-full"></span>
                       裁剪边距 (Padding)
                    </label>
                    <div className="flex items-center gap-2">
                      <input type="number" value={cropSettings.cropPadding} onChange={(e) => setCropSettings(s => ({...s, cropPadding: Number(e.target.value)}))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500" />
                      <span className="text-xs text-slate-400 font-bold whitespace-nowrap">px</span>
                    </div>
                  </div>
               </div>
            </section>

            {/* 上传区域 */}
            <div className="relative group overflow-hidden bg-white border-2 border-dashed border-slate-300 rounded-[2.5rem] p-16 text-center hover:border-blue-500 hover:bg-blue-50/30 transition-all duration-500 shadow-2xl shadow-slate-200/30">
              <input type="file" accept="application/pdf,application/zip" onChange={handleFileChange} multiple className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20" />
              <div className="relative z-10">
                <div className="w-24 h-24 bg-blue-600 text-white rounded-[2rem] flex items-center justify-center mx-auto mb-8 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-500 shadow-xl shadow-blue-200">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v12m0 0l-4-4m4 4l4-4M4 17a3 3 0 003 3h10a3 3 0 003-3v-1" />
                  </svg>
                </div>
                <h2 className="text-3xl font-black text-slate-900 mb-3">开始处理试卷</h2>
                <p className="text-slate-400 text-lg font-medium">点击或将 PDF 文件拖拽至此处 (支持多选)</p>
                <div className="mt-8 flex justify-center gap-3">
                   <span className="px-4 py-1.5 bg-slate-100 text-slate-500 text-xs font-bold rounded-full border border-slate-200 uppercase tracking-widest">Supports PDF</span>
                   <span className="px-4 py-1.5 bg-slate-100 text-slate-500 text-xs font-bold rounded-full border border-slate-200 uppercase tracking-widest">Supports ZIP</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <ProcessingState status={status} progress={progress} total={total} completedCount={completedCount} error={error} detailedStatus={detailedStatus} croppingTotal={croppingTotal} croppingDone={croppingDone} />
        {showDebug ? <DebugRawView pages={rawPages} /> : (questions.length > 0 && <QuestionGrid questions={questions} rawPages={rawPages} />)}
      </main>
      
      {/* 快捷设置栏 - 仅在处理完后作为微调使用 */}
      {rawPages.length > 0 && (
        <div className={`fixed bottom-0 left-0 right-0 z-[100] transition-transform duration-300 ease-in-out ${showSettingsPanel ? 'translate-y-0' : 'translate-y-[calc(100%-48px)]'}`}>
          <div className="max-w-4xl mx-auto bg-white rounded-t-3xl shadow-[0_-15px_50px_rgba(0,0,0,0.15)] border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-8 py-4 cursor-pointer bg-slate-50 border-b border-slate-100 hover:bg-slate-100 transition-colors" onClick={() => setShowSettingsPanel(!showSettingsPanel)}>
              <div className="flex items-center gap-3">
                 <div className={`w-2.5 h-2.5 rounded-full ${showSettingsPanel ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'}`}></div>
                 <h3 className="font-black text-slate-700 text-sm uppercase tracking-widest">结果参数微调 (Refine Results)</h3>
              </div>
              <button className="text-slate-400">{showSettingsPanel ? <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg> : <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>}</button>
            </div>
            <div className="p-8 grid grid-cols-1 md:grid-cols-4 gap-8 items-end">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">裁剪内缩</label>
                <div className="flex items-center gap-2">
                  <input type="number" value={cropSettings.cropPadding} onChange={(e) => setCropSettings(prev => ({ ...prev, cropPadding: Number(e.target.value) }))} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500" />
                  <span className="text-xs text-slate-400 font-bold">px</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">画布留白</label>
                <div className="flex items-center gap-2">
                  <input type="number" value={cropSettings.canvasPaddingLeft} onChange={(e) => { const v = Number(e.target.value); setCropSettings(p => ({ ...p, canvasPaddingLeft: v, canvasPaddingRight: v })); }} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500" />
                  <span className="text-xs text-slate-400 font-bold">px</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">拼接重叠</label>
                <div className="flex items-center gap-2">
                  <input type="number" value={cropSettings.mergeOverlap} onChange={(e) => setCropSettings(p => ({ ...p, mergeOverlap: Number(e.target.value) }))} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500" />
                  <span className="text-xs text-slate-400 font-bold">px</span>
                </div>
              </div>
              <button onClick={handleRecropOnly} disabled={isProcessing} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                {status === ProcessingStatus.CROPPING ? <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> : <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>重新裁剪</>}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="mt-20 text-center text-slate-400 text-sm py-10 border-t border-slate-100">
        <p className="font-bold">© 2025 AI 试卷助手 | 为教育数字化而生</p>
      </footer>
    </div>
  );
};

export default App;
