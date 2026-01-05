
import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ProcessingStatus, QuestionImage, DetectedQuestion, DebugPageData } from './types';
import { ProcessingState } from './components/ProcessingState';
import { QuestionGrid } from './components/QuestionGrid';
import { DebugRawView } from './components/DebugRawView';
import { renderPageToImage, cropAndStitchImage, CropSettings, mergePdfPagesToSingleImage, mergeBase64Images } from './services/pdfService';
import { detectQuestionsOnPage } from './services/geminiService';

const CONCURRENCY_LIMIT = 5; 

const App: React.FC = () => {
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [questions, setQuestions] = useState<QuestionImage[]>([]);
  const [rawPages, setRawPages] = useState<DebugPageData[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string>('exam_paper');
  const [showDebug, setShowDebug] = useState(false);
  
  // 核心进度状态
  const [progress, setProgress] = useState(0); // 这里的 progress 代表“已启动/已发起”的数量
  const [total, setTotal] = useState(0);
  const [completedCount, setCompletedCount] = useState(0); // 真正收到回复的数量

  const [error, setError] = useState<string | undefined>();
  const [detailedStatus, setDetailedStatus] = useState<string>('');
  
  // 裁剪阶段专属计数
  const [croppingTotal, setCroppingTotal] = useState(0);
  const [croppingDone, setCroppingDone] = useState(0);

  const [selectedModel, setSelectedModel] = useState<string>('gemini-3-flash-preview');
  const [cropSettings, setCropSettings] = useState<CropSettings>({
    cropPadding: 25,
    canvasPaddingLeft: 10,
    canvasPaddingRight: 10,
    canvasPaddingY: 10,
    mergeOverlap: 20
  });
  
  const [isReprocessing, setIsReprocessing] = useState(false);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleReset = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setStatus(ProcessingStatus.IDLE);
    setQuestions([]);
    setRawPages([]);
    setUploadedFileName('exam_paper');
    setProgress(0);
    setTotal(0);
    setCompletedCount(0);
    setCroppingTotal(0);
    setCroppingDone(0);
    setError(undefined);
    setDetailedStatus('');
    setShowDebug(false);
  };

  useEffect(() => {
    if (rawPages.length === 0 || status === ProcessingStatus.LOADING_PDF || status === ProcessingStatus.DETECTING_QUESTIONS || status === ProcessingStatus.CROPPING) {
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
    
    for (let i = 0; i < rawPages.length; i++) {
      const page = rawPages[i];
      let detections = page.detections;

      // Handle continuation logic during reprocessing to maintain merge consistency
      if (detections.length > 0 && detections[0].id === 'continuation') {
        const orphan = detections[0];
        const { final: orphanImg } = await cropAndStitchImage(
          page.dataUrl, 
          orphan.boxes_2d, 
          page.width, 
          page.height, 
          cropSettings
        );
        if (updatedQuestions.length > 0 && orphanImg) {
          const lastQ = updatedQuestions[updatedQuestions.length - 1];
          // Use user-defined mergeOverlap
          const stitchedImg = await mergeBase64Images(lastQ.dataUrl, orphanImg, -cropSettings.mergeOverlap);
          lastQ.dataUrl = stitchedImg;
        }
        detections = detections.slice(1);
      }

      for (const detection of detections) {
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

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      setStatus(ProcessingStatus.LOADING_PDF);
      setError(undefined);
      setDetailedStatus('正在初始化 PDF 引擎...');
      setQuestions([]);
      setRawPages([]);
      setProgress(0);
      setCompletedCount(0);
      setCroppingTotal(0);
      setCroppingDone(0);
      
      const name = file.name.replace(/\.[^/.]+$/, "");
      setUploadedFileName(name);

      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;
      setTotal(numPages);

      if (signal.aborted) return;

      // Phase 1: Rendering
      setDetailedStatus('正在渲染 PDF 页面...');
      const renderedPages: { dataUrl: string, width: number, height: number, pageNumber: number }[] = [];
      for (let i = 1; i <= numPages; i++) {
        if (signal.aborted) return;
        const page = await pdf.getPage(i);
        const rendered = await renderPageToImage(page, 3);
        renderedPages.push({ ...rendered, pageNumber: i });
        setProgress(i);
        setCompletedCount(i);
      }

      // Phase 2: AI Detection
      setStatus(ProcessingStatus.DETECTING_QUESTIONS);
      setProgress(0);
      setCompletedCount(0);
      setDetailedStatus(`AI 正在智能分析试卷，失败将自动重试...`);

      const results: DebugPageData[] = new Array(numPages);
      
      for (let i = 0; i < renderedPages.length; i += CONCURRENCY_LIMIT) {
        if (signal.aborted) return;
        const batch = renderedPages.slice(i, i + CONCURRENCY_LIMIT);
        
        // 关键改进：一旦进入循环，立即更新“已启动/已发起”的数量
        setProgress(Math.min(numPages, i + batch.length));

        const batchResults = await Promise.all(batch.map(async (pageData) => {
          try {
            const detections = await detectQuestionsOnPage(pageData.dataUrl, selectedModel);
            // 每一页完成时更新完成计数
            setCompletedCount(prev => prev + 1);
            return {
              pageNumber: pageData.pageNumber,
              dataUrl: pageData.dataUrl,
              width: pageData.width,
              height: pageData.height,
              detections
            };
          } catch (err: any) {
            if (signal.aborted) throw err;
            setCompletedCount(prev => prev + 1); // 报错也算作一页结束
            console.error(`Error on page ${pageData.pageNumber}:`, err);
            return {
              pageNumber: pageData.pageNumber,
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

      // Phase 3: Cropping
      setStatus(ProcessingStatus.CROPPING);
      
      const totalDetections = results.reduce((acc, p) => acc + p.detections.length, 0);
      setCroppingTotal(totalDetections);
      setCroppingDone(0);
      setProgress(0); 
      setCompletedCount(0);
      setDetailedStatus('正在根据 AI 坐标切割题目图片...');

      let allExtractedQuestions: QuestionImage[] = [];

      for (let i = 0; i < results.length; i++) {
        if (signal.aborted) return;
        const page = results[i];
        let detections = page.detections;

        // 更新当前正在处理的页码
        setProgress(i + 1);

        if (detections.length > 0 && detections[0].id === 'continuation') {
          const orphan = detections[0];
          const { final: orphanImg } = await cropAndStitchImage(
            page.dataUrl, 
            orphan.boxes_2d, 
            page.width, 
            page.height, 
            cropSettings
          );
          if (allExtractedQuestions.length > 0 && orphanImg) {
            const lastQ = allExtractedQuestions[allExtractedQuestions.length - 1];
            // Use user-defined mergeOverlap
            const stitchedImg = await mergeBase64Images(lastQ.dataUrl, orphanImg, -cropSettings.mergeOverlap);
            lastQ.dataUrl = stitchedImg;
          }
          setCroppingDone(prev => prev + 1);
          detections = detections.slice(1);
        }

        for (const detection of detections) {
          if (signal.aborted) return;
          const { final, original } = await cropAndStitchImage(
            page.dataUrl, 
            detection.boxes_2d, 
            page.width, 
            page.height,
            cropSettings
          );
          if (final) {
            allExtractedQuestions.push({
              id: detection.id,
              pageNumber: page.pageNumber,
              dataUrl: final,
              originalDataUrl: original
            });
          }
          setCroppingDone(prev => prev + 1);
        }
        setCompletedCount(i + 1);
        await new Promise(r => setTimeout(r, 0));
      }

      setQuestions(allExtractedQuestions);
      setStatus(ProcessingStatus.COMPLETED);
      setDetailedStatus('');
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error(err);
      setError(err.message || "处理失败。");
      setStatus(ProcessingStatus.ERROR);
    }
  };

  const isWideLayout = showDebug || questions.length > 0;

  return (
    <div className="min-h-screen pb-48 px-4 md:px-8 bg-slate-50 relative">
      <header className="max-w-6xl mx-auto py-10 text-center relative">
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4 tracking-tight">
          试卷 <span className="text-blue-600">智能</span> 切割
        </h1>

        {(questions.length > 0 || rawPages.length > 0) && (
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mt-8 animate-fade-in">
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
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                调试视图
              </button>
            </div>
            <button
              onClick={handleReset}
              className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition-all shadow-sm flex items-center gap-2 group"
            >
               <svg className="w-4 h-4 text-slate-400 group-hover:text-red-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
               </svg>
               {status === ProcessingStatus.COMPLETED ? '重新开始' : '取消并重置'}
            </button>
          </div>
        )}
      </header>

      <main className={`mx-auto transition-all duration-300 ${isWideLayout ? 'w-full max-w-[98vw]' : 'max-w-7xl'}`}>
        {status === ProcessingStatus.IDLE || (status === ProcessingStatus.ERROR && !isWideLayout) ? (
          <div className="relative group max-w-2xl mx-auto flex flex-col items-center">
            <div className="w-full mb-8 relative bg-white border-2 border-dashed border-slate-200 rounded-3xl p-16 text-center hover:border-blue-400 transition-colors z-10 shadow-lg shadow-slate-200/50">
              <input 
                type="file" 
                accept="application/pdf"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="mb-6">
                <div className="w-24 h-24 bg-blue-50 rounded-3xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-500 shadow-inner">
                  <svg className="w-12 h-12 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-slate-800 mb-2">上传试卷 PDF</h2>
                <p className="text-slate-400 font-medium">点击或拖拽文件到此处开始</p>
              </div>
            </div>
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
            <div className="relative">
              {isReprocessing && (
                 <div className="absolute inset-0 z-50 bg-white/50 backdrop-blur-[1px] flex items-start justify-center pt-20">
                    <div className="bg-black/80 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-3 animate-bounce">
                       <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                       <span className="font-bold">更新参数中...</span>
                    </div>
                 </div>
              )}
              <QuestionGrid questions={questions} sourceFileName={uploadedFileName} rawPages={rawPages} />
            </div>
          )
        )}
      </main>
      
      {!showDebug && questions.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-t border-slate-200 shadow-2xl">
          <div className="max-w-7xl mx-auto px-4 py-5">
             <div className="flex flex-col xl:flex-row items-center gap-8 justify-between">
                <div className="flex items-center gap-4 min-w-[180px]">
                   <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 shadow-sm">
                     <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                   </div>
                   <div>
                     <h3 className="text-base font-bold text-slate-800">微调参数</h3>
                     <p className="text-[10px] text-slate-400 font-medium">调整切割边缘效果</p>
                   </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-x-10 gap-y-3 flex-grow w-full">
                    <div className="flex flex-col gap-1.5">
                       <div className="flex justify-between items-center"><label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">检测扩展</label><span className="text-xs font-mono text-blue-600 font-bold">{cropSettings.cropPadding}px</span></div>
                       <input type="range" min="0" max="100" value={cropSettings.cropPadding} onChange={(e) => setCropSettings(p => ({...p, cropPadding: parseInt(e.target.value)}))} className="h-2 accent-blue-600 cursor-pointer"/>
                    </div>
                    <div className="flex flex-col gap-1.5">
                       <div className="flex justify-between items-center"><label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">上下留白</label><span className="text-xs font-mono text-blue-600 font-bold">{cropSettings.canvasPaddingY}px</span></div>
                       <input type="range" min="0" max="100" value={cropSettings.canvasPaddingY} onChange={(e) => setCropSettings(p => ({...p, canvasPaddingY: parseInt(e.target.value)}))} className="h-2 accent-blue-600 cursor-pointer"/>
                    </div>
                    <div className="flex flex-col gap-1.5">
                       <div className="flex justify-between items-center"><label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">跨页重叠</label><span className="text-xs font-mono text-blue-600 font-bold">{cropSettings.mergeOverlap}px</span></div>
                       <input type="range" min="0" max="100" value={cropSettings.mergeOverlap} onChange={(e) => setCropSettings(p => ({...p, mergeOverlap: parseInt(e.target.value)}))} className="h-2 accent-blue-600 cursor-pointer"/>
                    </div>
                    <div className="flex flex-col gap-1.5">
                       <div className="flex justify-between items-center"><label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">左侧边距</label><span className="text-xs font-mono text-blue-600 font-bold">{cropSettings.canvasPaddingLeft}px</span></div>
                       <input type="range" min="0" max="100" value={cropSettings.canvasPaddingLeft} onChange={(e) => setCropSettings(p => ({...p, canvasPaddingLeft: parseInt(e.target.value)}))} className="h-2 accent-blue-600 cursor-pointer"/>
                    </div>
                    <div className="flex flex-col gap-1.5">
                       <div className="flex justify-between items-center"><label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">右侧边距</label><span className="text-xs font-mono text-blue-600 font-bold">{cropSettings.canvasPaddingRight}px</span></div>
                       <input type="range" min="0" max="100" value={cropSettings.canvasPaddingRight} onChange={(e) => setCropSettings(p => ({...p, canvasPaddingRight: parseInt(e.target.value)}))} className="h-2 accent-blue-600 cursor-pointer"/>
                    </div>
                </div>
                <button 
                  onClick={() => setCropSettings({ cropPadding: 25, canvasPaddingLeft: 10, canvasPaddingRight: 10, canvasPaddingY: 10, mergeOverlap: 20 })} 
                  className="p-3 bg-slate-50 hover:bg-slate-100 rounded-xl text-slate-400 hover:text-red-500 transition-colors border border-slate-200"
                  title="重置"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
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
