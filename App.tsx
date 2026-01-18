
import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { ProcessingStatus, QuestionImage, DebugPageData, ProcessedCanvas, HistoryMetadata } from './types';
import { ProcessingState } from './components/ProcessingState';
import { QuestionGrid } from './components/QuestionGrid';
import { DebugRawView } from './components/DebugRawView';
import { renderPageToImage, constructQuestionCanvas, mergeCanvasesVertical, analyzeCanvasContent, generateAlignedImage, CropSettings } from './services/pdfService';
import { detectQuestionsOnPage } from './services/geminiService';
import { saveExamResult, getHistoryList, loadExamResult, deleteExamResult, deleteExamResults } from './services/storageService';

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
  MODEL: 'exam_splitter_selected_model_v3',
  USE_HISTORY_CACHE: 'exam_splitter_use_history_cache_v1'
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

const formatTime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const formatDate = (ts: number): string => {
  return new Date(ts).toLocaleString();
};

const App: React.FC = () => {
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [questions, setQuestions] = useState<QuestionImage[]>([]);
  const [rawPages, setRawPages] = useState<DebugPageData[]>([]);
  const [sourcePages, setSourcePages] = useState<SourcePage[]>([]);
  
  // State for specific file interactions
  const [debugFile, setDebugFile] = useState<string | null>(null);
  const [refiningFile, setRefiningFile] = useState<string | null>(null);
  const [localSettings, setLocalSettings] = useState<CropSettings>(DEFAULT_SETTINGS);

  // History State
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryMetadata[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());

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

  const [useHistoryCache, setUseHistoryCache] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.USE_HISTORY_CACHE) === 'true';
  });

  // Progress States
  const [progress, setProgress] = useState(0); 
  const [total, setTotal] = useState(0);
  const [completedCount, setCompletedCount] = useState(0); 
  const [error, setError] = useState<string | undefined>();
  const [detailedStatus, setDetailedStatus] = useState<string>('');
  const [croppingTotal, setCroppingTotal] = useState(0);
  const [croppingDone, setCroppingDone] = useState(0);
  
  // Retry / Round States
  const [currentRound, setCurrentRound] = useState(1);
  const [failedCount, setFailedCount] = useState(0);
  const stopRequestedRef = useRef(false);

  // Timer State
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState("00:00");

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
    localStorage.setItem(STORAGE_KEYS.USE_HISTORY_CACHE, String(useHistoryCache));
  }, [useHistoryCache]);

  // Load History List on Mount
  useEffect(() => {
    loadHistoryList();
  }, []);

  const loadHistoryList = async () => {
    try {
      const list = await getHistoryList();
      setHistoryList(list);
    } catch (e) {
      console.error("Failed to load history list", e);
    }
  };

  // Timer Effect
  useEffect(() => {
    let interval: number;
    const activeStates = [ProcessingStatus.LOADING_PDF, ProcessingStatus.DETECTING_QUESTIONS, ProcessingStatus.CROPPING];
    if (activeStates.includes(status) && startTime) {
      interval = window.setInterval(() => {
        const now = Date.now();
        const diff = Math.floor((now - startTime) / 1000);
        setElapsedTime(formatTime(diff));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [status, startTime]);

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
        } catch (err: any) {
          setError(err.message || "Remote ZIP download failed");
          setStatus(ProcessingStatus.ERROR);
        }
      };
      loadRemoteZip();
    }
  }, []);

  const handleStop = () => {
    stopRequestedRef.current = true;
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
    }
    setDetailedStatus("Stopping... Current requests will finish.");
  };

  const handleReset = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    stopRequestedRef.current = false;
    setStatus(ProcessingStatus.IDLE);
    setQuestions([]);
    setRawPages([]);
    setSourcePages([]);
    setProgress(0);
    setTotal(0);
    setCompletedCount(0);
    setCroppingTotal(0);
    setCroppingDone(0);
    setError(undefined);
    setDetailedStatus('');
    setDebugFile(null);
    setRefiningFile(null);
    setStartTime(null);
    setElapsedTime("00:00");
    setCurrentRound(1);
    setFailedCount(0);
    if (window.location.search) window.history.pushState({}, '', window.location.pathname);
  };

  // History Actions
  const handleToggleHistorySelection = (id: string) => {
    const newSet = new Set(selectedHistoryIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedHistoryIds(newSet);
  };

  const handleSelectAllHistory = () => {
    if (selectedHistoryIds.size === historyList.length) {
      setSelectedHistoryIds(new Set());
    } else {
      setSelectedHistoryIds(new Set(historyList.map(h => h.id)));
    }
  };

  const handleDeleteSelectedHistory = async () => {
    if (selectedHistoryIds.size === 0) return;
    if (confirm(`Are you sure you want to delete ${selectedHistoryIds.size} records?`)) {
        await deleteExamResults(Array.from(selectedHistoryIds));
        setSelectedHistoryIds(new Set());
        await loadHistoryList();
    }
  };

  const deleteHistoryItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this record?")) {
      await deleteExamResult(id);
      setSelectedHistoryIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
      await loadHistoryList();
    }
  };

  const handleLoadHistory = async (id: string) => {
    handleReset();
    setShowHistory(false);
    setIsLoadingHistory(true);
    setStatus(ProcessingStatus.LOADING_PDF);
    setDetailedStatus('Restoring from history...');

    try {
      const result = await loadExamResult(id);
      if (!result) throw new Error("History record not found.");

      setRawPages(result.rawPages);
      
      // Reconstruct source pages from raw pages for UI state consistency
      const recoveredSourcePages = result.rawPages.map(rp => ({
        dataUrl: rp.dataUrl,
        width: rp.width,
        height: rp.height,
        pageNumber: rp.pageNumber,
        fileName: rp.fileName
      }));
      setSourcePages(recoveredSourcePages);

      // Now immediately trigger cropping with CURRENT settings
      setStatus(ProcessingStatus.CROPPING);
      setDetailedStatus('Applying current crop settings...');
      
      const totalDetections = result.rawPages.reduce((acc, p) => acc + p.detections.length, 0);
      setCroppingTotal(totalDetections);
      setCroppingDone(0);
      setTotal(result.rawPages.length);
      setCompletedCount(result.rawPages.length);

      abortControllerRef.current = new AbortController();
      const generatedQuestions = await generateQuestionsFromRawPages(
        result.rawPages, 
        cropSettings, 
        abortControllerRef.current.signal
      );

      setQuestions(generatedQuestions);
      setStatus(ProcessingStatus.COMPLETED);

    } catch (e: any) {
      setError("Failed to load history: " + e.message);
      setStatus(ProcessingStatus.ERROR);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  /**
   * Generates processed questions from raw debug data.
   */
  const generateQuestionsFromRawPages = async (pages: DebugPageData[], settings: CropSettings, signal: AbortSignal): Promise<QuestionImage[]> => {
    const pagesByFile: Record<string, DebugPageData[]> = {};
    pages.forEach(p => {
      if (!pagesByFile[p.fileName]) pagesByFile[p.fileName] = [];
      pagesByFile[p.fileName].push(p);
    });

    // Sort pages by pageNumber to ensure correct order
    Object.values(pagesByFile).forEach(list => list.sort((a, b) => a.pageNumber - b.pageNumber));

    const finalQuestions: QuestionImage[] = [];

    for (const [fileName, filePages] of Object.entries(pagesByFile)) {
      if (signal.aborted) return [];
      const fileItems: ProcessedCanvas[] = [];
      
      for (let i = 0; i < filePages.length; i++) {
        if (signal.aborted) return [];
        const page = filePages[i];
        
        for (const detection of page.detections) {
           if (signal.aborted) return [];
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

      if (fileItems.length > 0) {
          const itemsWithTrim = fileItems.map(item => ({
             ...item,
             trim: analyzeCanvasContent(item.canvas)
          }));
          const maxContentWidth = Math.max(...itemsWithTrim.map(i => i.trim.w));
          
          for (const item of itemsWithTrim) {
              if (signal.aborted) return [];
              const finalDataUrl = await generateAlignedImage(item.canvas, item.trim, maxContentWidth, settings);
              finalQuestions.push({
                 id: item.id,
                 pageNumber: item.pageNumber,
                 fileName: item.fileName,
                 dataUrl: finalDataUrl,
                 originalDataUrl: item.originalDataUrl
              });
          }
      }
    }
    return finalQuestions;
  };

  /**
   * Re-runs cropping for a specific file using specific settings.
   */
  const handleRecropFile = async (fileName: string, specificSettings: CropSettings) => {
    const targetPages = rawPages.filter(p => p.fileName === fileName);
    if (targetPages.length === 0) return;

    abortControllerRef.current = new AbortController();
    setStatus(ProcessingStatus.CROPPING);
    setStartTime(Date.now());
    
    const detectionsInFile = targetPages.reduce((acc, p) => acc + p.detections.length, 0);
    setCroppingTotal(detectionsInFile);
    setCroppingDone(0);
    setDetailedStatus(`Refining ${fileName}...`);

    try {
       const newQuestions = await generateQuestionsFromRawPages(targetPages, specificSettings, abortControllerRef.current.signal);
       
       if (!abortControllerRef.current.signal.aborted) {
         setQuestions(prev => {
            const others = prev.filter(q => q.fileName !== fileName);
            return [...others, ...newQuestions];
         });
         setStatus(ProcessingStatus.COMPLETED);
         setRefiningFile(null); 
       }
    } catch (e: any) {
       setError(e.message);
       setStatus(ProcessingStatus.ERROR);
    }
  };

  const processZipFiles = async (files: { blob: Blob, name: string }[]) => {
    // ZIP Processing logic remains largely the same as it handles ready-made data
    // It doesn't use the Gemini retry queue.
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
          const analysisFileKeys = Object.keys(loadedZip.files).filter(key => key.match(/(^|\/)analysis_data\.json$/i));
          
          if (analysisFileKeys.length === 0) continue;

          const zipBaseName = file.name.replace(/\.[^/.]+$/, "");
          const zipRawPages: DebugPageData[] = [];

          for (const analysisKey of analysisFileKeys) {
              const dirPrefix = analysisKey.substring(0, analysisKey.lastIndexOf("analysis_data.json"));
              const jsonText = await loadedZip.file(analysisKey)!.async('text');
              const loadedRawPages = JSON.parse(jsonText) as DebugPageData[];
              
              for (const page of loadedRawPages) {
                let rawFileName = page.fileName;
                if (!rawFileName || rawFileName === "unknown_file") {
                  if (dirPrefix) {
                      rawFileName = dirPrefix.replace(/\/$/, "");
                  } else {
                      rawFileName = zipBaseName || "unknown_file";
                  }
                }
                page.fileName = rawFileName;
                
                let foundKey: string | undefined = undefined;
                const candidates = [
                    `${dirPrefix}full_pages/Page_${page.pageNumber}.jpg`,
                    `${dirPrefix}full_pages/Page_${page.pageNumber}.jpeg`,
                    `${dirPrefix}full_pages/Page_${page.pageNumber}.png`
                ];

                for (const c of candidates) {
                    if (loadedZip.files[c]) {
                        foundKey = c;
                        break;
                    }
                }

                if (!foundKey) {
                    foundKey = Object.keys(loadedZip.files).find(k => 
                        k.startsWith(dirPrefix) &&
                        !loadedZip.files[k].dir &&
                        (k.match(new RegExp(`full_pages/.*Page_${page.pageNumber}\\.(jpg|jpeg|png)$`, 'i')))
                    );
                }

                if (foundKey) {
                  const base64 = await loadedZip.file(foundKey)!.async('base64');
                  const ext = foundKey.split('.').pop()?.toLowerCase();
                  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
                  page.dataUrl = `data:${mime};base64,${base64}`;
                }
              }
              zipRawPages.push(...loadedRawPages);
          }
          
          allRawPages.push(...zipRawPages);

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
                          else if (zipRawPages.length > 0) qFileName = zipRawPages[0].fileName; 
                        }
                        if (qFileName === "unknown" && zipRawPages.length > 0) {
                             const uniqueFiles = new Set(zipRawPages.map(p => p.fileName));
                             if (uniqueFiles.size === 1) {
                                 qFileName = Array.from(uniqueFiles)[0];
                             }
                        }
                        matched = true;
                    }
                }

                if (matched) {
                    const base64 = await loadedZip.file(key)!.async('base64');
                    const ext = key.split('.').pop()?.toLowerCase();
                    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
                    const targetPage = zipRawPages.find(p => (p.fileName === qFileName && p.detections.some(d => d.id === qId)) || (p.fileName === qFileName));
                    
                    if (targetPage) {
                        loadedQuestions.push({
                            id: qId,
                            pageNumber: targetPage.detections.find(d => d.id === qId) ? targetPage.pageNumber : targetPage.pageNumber,
                            fileName: qFileName,
                            dataUrl: `data:${mime};base64,${base64}`
                        });
                    }
                }
            }));
            allQuestions.push(...loadedQuestions);
          }
        } catch (e) { console.error(`Failed to parse ZIP ${file.name}:`, e); }
      }

      setRawPages(allRawPages);
      setSourcePages(allRawPages.map(({detections, ...rest}) => rest));
      setTotal(allRawPages.length);
      
      try {
        const uniqueFiles = new Set(allRawPages.map(p => p.fileName));
        const savePromises = Array.from(uniqueFiles).map(fileName => {
           const filePages = allRawPages.filter(p => p.fileName === fileName);
           return saveExamResult(fileName, filePages);
        });
        await Promise.all(savePromises);
        await loadHistoryList(); 
      } catch (saveErr) {
        console.warn("History auto-save encountered an issue:", saveErr);
      }

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
      } else {
         if (allRawPages.length > 0) {
            const qs = await generateQuestionsFromRawPages(allRawPages, cropSettings, new AbortController().signal);
            setQuestions(qs);
            setCompletedCount(allRawPages.length);
            setStatus(ProcessingStatus.COMPLETED);
         } else {
            throw new Error("No valid data found in ZIP");
         }
      }
    } catch (err: any) {
      setError("Batch ZIP load failed: " + err.message);
      setStatus(ProcessingStatus.ERROR);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []) as File[];
    if (fileList.length === 0) return;
    
    // Handle ZIPs
    const zipFiles = fileList.filter(f => f.name.toLowerCase().endsWith('.zip'));
    if (zipFiles.length > 0) {
      await processZipFiles(zipFiles.map(f => ({ blob: f, name: f.name })));
      return;
    }

    const pdfFiles = fileList.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfFiles.length === 0) return;

    abortControllerRef.current = new AbortController();
    stopRequestedRef.current = false;
    const signal = abortControllerRef.current.signal;
    
    // Reset State
    setStartTime(Date.now());
    setStatus(ProcessingStatus.LOADING_PDF);
    setError(undefined);
    setSourcePages([]);
    setRawPages([]);
    setQuestions([]);
    setCompletedCount(0);
    setCroppingTotal(0);
    setCroppingDone(0);
    setCurrentRound(1);
    setFailedCount(0);

    const filesToProcess: File[] = [];
    const cachedRawPages: DebugPageData[] = [];

    // Check History Cache
    if (useHistoryCache) {
      setDetailedStatus("Checking history for existing files...");
      for (const file of pdfFiles) {
        const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        const historyItem = historyList.find(h => h.name === fileNameWithoutExt);
        let loadedFromCache = false;
        if (historyItem) {
          try {
            const result = await loadExamResult(historyItem.id);
            if (result && result.rawPages.length > 0) {
               cachedRawPages.push(...result.rawPages);
               loadedFromCache = true;
               console.log(`Loaded ${fileNameWithoutExt} from history cache.`);
            }
          } catch (err) {
             console.warn(`Failed to load history for ${fileNameWithoutExt}`, err);
          }
        }
        if (!loadedFromCache) {
          filesToProcess.push(file);
        }
      }
    } else {
       filesToProcess.push(...pdfFiles);
    }

    try {
      // ---------------------------------------------------------
      // PHASE 0: RESTORE CACHED DATA
      // ---------------------------------------------------------
      if (cachedRawPages.length > 0) {
         setDetailedStatus("Restoring cached files...");
         setRawPages(prev => [...prev, ...cachedRawPages]);
         
         const recoveredSourcePages = cachedRawPages.map(rp => ({
            dataUrl: rp.dataUrl,
            width: rp.width,
            height: rp.height,
            pageNumber: rp.pageNumber,
            fileName: rp.fileName
         }));
         setSourcePages(prev => [...prev, ...recoveredSourcePages]);
         
         const cachedQuestions = await generateQuestionsFromRawPages(cachedRawPages, cropSettings, signal);
         if (!signal.aborted) {
            setQuestions(prev => {
                const combined = [...prev, ...cachedQuestions];
                return combined.sort((a,b) => a.fileName.localeCompare(b.fileName));
            });
            setCompletedCount(prev => prev + cachedRawPages.length);
         }
      }

      if (filesToProcess.length === 0) {
         setStatus(ProcessingStatus.COMPLETED);
         setDetailedStatus(`Loaded ${cachedRawPages.length} pages from history.`);
         return;
      }

      // ---------------------------------------------------------
      // PHASE 1: RENDER NEW PDFS (Pre-processing)
      // ---------------------------------------------------------
      // We render ALL pages first to have a definitive queue
      const allNewPages: SourcePage[] = [];
      let cumulativeRendered = 0;
      
      // Init total to an estimate, update as we parse
      setTotal(cachedRawPages.length + (filesToProcess.length * 3));

      for (let fIdx = 0; fIdx < filesToProcess.length; fIdx++) {
         if (signal.aborted || stopRequestedRef.current) break;
         const file = filesToProcess[fIdx];
         const fileName = file.name.replace(/\.[^/.]+$/, "");
         
         setDetailedStatus(`Rendering (${fIdx + 1}/${filesToProcess.length}): ${file.name}...`);
         
         const loadingTask = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
         const pdf = await loadingTask.promise;
         
         cumulativeRendered += pdf.numPages;
         setTotal(cachedRawPages.length + cumulativeRendered + (filesToProcess.length - fIdx - 1) * 3);
         
         for (let i = 1; i <= pdf.numPages; i++) {
            if (signal.aborted || stopRequestedRef.current) break;
            const page = await pdf.getPage(i);
            const rendered = await renderPageToImage(page, 3);
            const sourcePage = { ...rendered, pageNumber: i, fileName };
            allNewPages.push(sourcePage);
            setSourcePages(prev => [...prev, sourcePage]);
         }
      }

      setTotal(cachedRawPages.length + allNewPages.length);
      setProgress(cachedRawPages.length);

      // ---------------------------------------------------------
      // PHASE 2: QUEUE PROCESSING WITH RETRY LOOPS
      // ---------------------------------------------------------
      if (allNewPages.length > 0 && !stopRequestedRef.current && !signal.aborted) {
         setStatus(ProcessingStatus.DETECTING_QUESTIONS);
         
         // Helper to track processing per file to know when to crop
         // We must track this across rounds.
         const fileMeta: Record<string, { totalPages: number, processedPages: number, cropped: boolean }> = {};
         allNewPages.forEach(p => {
             if (!fileMeta[p.fileName]) {
                 fileMeta[p.fileName] = { 
                    totalPages: allNewPages.filter(x => x.fileName === p.fileName).length, 
                    processedPages: 0, 
                    cropped: false 
                 };
             }
         });

         let queue = [...allNewPages];
         let round = 1;

         // Infinite loop for retries until queue empty or stopped
         while (queue.length > 0) {
             if (stopRequestedRef.current || signal.aborted) break;

             setCurrentRound(round);
             setDetailedStatus(round === 1 
                ? "Analyzing pages with AI..." 
                : `Round ${round}: Retrying ${queue.length} failed pages...`);
             
             // Process current queue
             const nextRoundQueue: SourcePage[] = [];
             
             // Concurrency Loop for the current batch
             const executing = new Set<Promise<void>>();
             
             for (const pageData of queue) {
                 if (stopRequestedRef.current || signal.aborted) break;

                 const task = (async () => {
                     try {
                         // Attempt Detection
                         const detections = await detectQuestionsOnPage(pageData.dataUrl, selectedModel);
                         
                         const resultPage: DebugPageData = {
                             pageNumber: pageData.pageNumber,
                             fileName: pageData.fileName,
                             dataUrl: pageData.dataUrl,
                             width: pageData.width,
                             height: pageData.height,
                             detections
                         };

                         setRawPages(prev => [...prev, resultPage]);
                         setCompletedCount(prev => prev + 1);
                         setCroppingTotal(prev => prev + detections.length);

                         // Check File Completion
                         if (fileMeta[pageData.fileName]) {
                             fileMeta[pageData.fileName].processedPages++;
                             const meta = fileMeta[pageData.fileName];
                             
                             // If all pages for this file are done (across all rounds so far), crop it.
                             if (!meta.cropped && meta.processedPages === meta.totalPages) {
                                 meta.cropped = true;
                                 
                                 // We need to fetch ALL pages for this file from state (including those from previous rounds)
                                 // Note: state updates are async, so we use a functional update logic or local aggregator if needed.
                                 // However, here we are inside an async task. We can't rely on 'rawPages' state being perfectly up to date immediately for *this* specific page insertion.
                                 // Best practice: Pass the complete list or rely on `setRawPages` callback, but for cropping we need the data.
                                 // Let's grab the latest from state in a slightly unsafe way or wait?
                                 // Actually, we can just grab from `rawPages` state which might miss the *current* page if React hasn't rendered.
                                 // To fix: We can push to a local `accumulatedRawPages` ref if needed, but for now let's use the functional updater pattern combined with a separate tracker?
                                 // Simplification: We wait for the next render cycle or just execute cropping separately? 
                                 // BETTER: Just trigger the crop. The logic in `handleLoadHistory` does this well.
                                 
                                 // We need to fetch all debug pages for this file. 
                                 // Since `setRawPages` is async, we can't guarantee `rawPages` has `resultPage` yet.
                                 // So we pass it explicitly alongside the existing ones.
                                 setRawPages(current => {
                                     const filePages = [...current.filter(p => p.fileName === pageData.fileName), resultPage];
                                     filePages.sort((a,b) => a.pageNumber - b.pageNumber);
                                     
                                     // Save to history
                                     saveExamResult(pageData.fileName, filePages).then(() => loadHistoryList());
                                     
                                     // Trigger crop
                                     generateQuestionsFromRawPages(filePages, cropSettings, signal).then(newQuestions => {
                                        if (!signal.aborted && !stopRequestedRef.current) {
                                            setQuestions(prevQ => [...prevQ, ...newQuestions]);
                                        }
                                     });
                                     
                                     return current; // Return current because we already did the update via setRawPages(prev => ...) above? 
                                     // Wait, we called setRawPages above. This logic is slightly duplicated.
                                     // Let's NOT call setRawPages above, and do it here inside the check?
                                     // No, because we want to see progress even if file not complete.
                                     // Let's just assume React updates are fast enough or use a mutable Ref for the accumulator logic if strictness required.
                                     // For this UI, eventually cropping will happen. 
                                 });
                                 // NOTE: The above `setRawPages` inside the check is complex. 
                                 // Simplified: `fileMeta` tracks count. We know when it's done. 
                                 // We initiate a standalone "finish file" routine.
                             }
                         }

                     } catch (err: any) {
                         // Failed! Add to next round queue.
                         console.warn(`Failed ${pageData.fileName} P${pageData.pageNumber} in Round ${round}`, err);
                         nextRoundQueue.push(pageData);
                         setFailedCount(prev => prev + 1); // Aggregate total failures encountered
                     }
                 })();

                 executing.add(task);
                 task.then(() => executing.delete(task));
                 if (executing.size >= concurrency) await Promise.race(executing);
             }

             // Wait for current batch to finish
             await Promise.all(executing);

             // Prepare for next round
             if (nextRoundQueue.length > 0 && !stopRequestedRef.current && !signal.aborted) {
                 queue = nextRoundQueue;
                 round++;
                 // Small delay to let system breathe
                 await new Promise(r => setTimeout(r, 1000));
             } else {
                 queue = []; // Done
             }
         }
      }

      if (stopRequestedRef.current) {
          setStatus(ProcessingStatus.STOPPED);
      } else {
          setStatus(ProcessingStatus.COMPLETED);
      }

    } catch (err: any) {
      if (err.name === 'AbortError') {
          setStatus(ProcessingStatus.STOPPED);
          return;
      }
      setError(err.message || "Processing failed.");
      setStatus(ProcessingStatus.ERROR);
    }
  };

  const startRefineFile = (fileName: string) => {
      setLocalSettings(cropSettings);
      setRefiningFile(fileName);
  };

  // Compute filtered raw pages for the debug view
  const debugPages = useMemo(() => {
    if (!debugFile) return [];
    return rawPages.filter(p => p.fileName === debugFile);
  }, [rawPages, debugFile]);

  // Compute filtered questions for the debug view
  const debugQuestions = useMemo(() => {
    if (!debugFile) return [];
    return questions.filter(q => q.fileName === debugFile);
  }, [questions, debugFile]);

  const isWideLayout = debugFile !== null || questions.length > 0 || sourcePages.length > 0;
  const isProcessing = status === ProcessingStatus.LOADING_PDF || status === ProcessingStatus.DETECTING_QUESTIONS || status === ProcessingStatus.CROPPING;
  const showInitialUI = status === ProcessingStatus.IDLE || (status === ProcessingStatus.ERROR && sourcePages.length === 0);

  return (
    <div className={`min-h-screen px-4 md:px-8 bg-slate-50 relative transition-all duration-300 pb-32`}>
      <header className="max-w-6xl mx-auto py-10 text-center relative z-50 bg-slate-50">
        <div className="absolute right-0 top-10 hidden md:block">
           <button 
             onClick={() => setShowHistory(true)}
             className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl hover:bg-slate-50 hover:text-blue-600 transition-colors flex items-center gap-2 font-bold text-xs shadow-sm uppercase tracking-wider"
           >
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
             History
           </button>
        </div>

        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-2 tracking-tight">
          Exam <span className="text-blue-600">Smart</span> Splitter
        </h1>
        <p className="text-slate-400 font-medium mb-8">AI-powered Batch Question Extraction Tool</p>

        {sourcePages.length > 0 && !isProcessing && (
          <div className="flex flex-col md:flex-row justify-center items-center gap-4 mt-4 animate-fade-in flex-wrap">
            <button onClick={handleReset} className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 transition-all flex items-center gap-2 shadow-sm">Reset</button>
          </div>
        )}
        <div className="md:hidden mt-4 flex justify-center">
            <button 
             onClick={() => setShowHistory(true)}
             className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl hover:bg-slate-50 hover:text-blue-600 transition-colors flex items-center gap-2 font-bold text-xs shadow-sm uppercase tracking-wider"
           >
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
             History
           </button>
        </div>
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

            {/* Minimalist Configuration Section */}
            <section className="bg-white rounded-[2rem] p-8 md:p-10 border border-slate-200 shadow-xl shadow-slate-200/50">
               <div className="flex items-center gap-3 mb-10 pb-4 border-b border-slate-100">
                  <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c-.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
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

                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Smart History</label>
                    </div>
                    <label className="flex items-center gap-3 cursor-pointer group p-3 bg-slate-50 rounded-2xl border border-slate-200 hover:border-blue-300 transition-all">
                        <div className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={useHistoryCache} onChange={(e) => setUseHistoryCache(e.target.checked)} />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </div>
                        <span className="text-xs font-bold text-slate-600 group-hover:text-blue-600 transition-colors">
                            Use Cached Data
                        </span>
                    </label>
                  </div>
               </div>
            </section>
          </div>
        )}

        <ProcessingState 
          status={status} 
          progress={progress} 
          total={total} 
          completedCount={completedCount} 
          error={error} 
          detailedStatus={detailedStatus} 
          croppingTotal={croppingTotal} 
          croppingDone={croppingDone} 
          elapsedTime={elapsedTime}
          currentRound={currentRound}
          failedCount={failedCount}
          onAbort={isProcessing ? handleStop : undefined}
        />
        
        {debugFile && (
            <DebugRawView 
                pages={debugPages} 
                questions={debugQuestions} 
                onClose={() => setDebugFile(null)} 
                title={debugFile}
            />
        )}

        {!debugFile && questions.length > 0 && (
            <QuestionGrid 
                questions={questions} 
                rawPages={rawPages} 
                onDebug={(fileName) => setDebugFile(fileName)}
                onRefine={(fileName) => startRefineFile(fileName)}
            />
        )}

      </main>

      {/* History Sidebar */}
      {showHistory && (
        <div className="fixed inset-0 z-[200] overflow-hidden">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowHistory(false)}></div>
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl animate-[fade-in_0.3s_ease-out] flex flex-col">
             <div className="p-6 border-b border-slate-100 bg-slate-50">
               <div className="flex justify-between items-center mb-4">
                 <div>
                   <h2 className="text-xl font-black text-slate-900 tracking-tight">Processing History</h2>
                   <p className="text-slate-400 text-xs font-bold">Local History (Stored in Browser)</p>
                 </div>
                 <button onClick={() => setShowHistory(false)} className="p-2 text-slate-400 hover:text-slate-600 bg-white rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors">
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
               </div>

               <div className="flex items-center justify-between pt-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input 
                          type="checkbox" 
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          checked={historyList.length > 0 && selectedHistoryIds.size === historyList.length}
                          onChange={handleSelectAllHistory}
                          disabled={historyList.length === 0}
                      />
                      <span className="text-xs font-bold text-slate-500">Select All</span>
                  </label>
                  
                  {selectedHistoryIds.size > 0 && (
                      <button 
                          onClick={handleDeleteSelectedHistory}
                          className="text-xs font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100 hover:bg-red-100 transition-colors flex items-center gap-1"
                      >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          Delete ({selectedHistoryIds.size})
                      </button>
                  )}
               </div>
             </div>
             
             <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
               {historyList.length === 0 ? (
                 <div className="text-center py-20 text-slate-400">
                   <p className="text-sm font-bold">No history records found.</p>
                 </div>
               ) : (
                 historyList.map(item => (
                   <div 
                      key={item.id} 
                      className={`bg-white p-4 rounded-2xl border transition-all group relative ${selectedHistoryIds.has(item.id) ? 'border-blue-400 ring-1 ring-blue-400 bg-blue-50/10' : 'border-slate-200 shadow-sm hover:shadow-md'}`}
                   >
                      <div className="absolute left-4 top-5 z-10">
                           <input 
                               type="checkbox"
                               className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                               checked={selectedHistoryIds.has(item.id)}
                               onChange={() => handleToggleHistorySelection(item.id)}
                               onClick={(e) => e.stopPropagation()} 
                           />
                      </div>

                      <div className="pl-8">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex-1 overflow-hidden cursor-pointer" onClick={() => handleToggleHistorySelection(item.id)}>
                            <h3 className="font-bold text-slate-800 truncate" title={item.name}>{item.name}</h3>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] font-black uppercase text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{item.pageCount} Pages</span>
                              <span className="text-[10px] text-slate-400">{formatDate(item.timestamp)}</span>
                            </div>
                          </div>
                          <button 
                              onClick={(e) => deleteHistoryItem(item.id, e)}
                              className="text-slate-300 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                              title="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                        <button 
                          onClick={() => handleLoadHistory(item.id)}
                          className="w-full py-2.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                          Load & Re-Crop
                        </button>
                      </div>
                   </div>
                 ))
               )}
             </div>
             {isLoadingHistory && (
               <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-10">
                 <div className="flex flex-col items-center gap-3">
                   <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                   <p className="text-sm font-bold text-slate-600">Loading Data...</p>
                 </div>
               </div>
             )}
          </div>
        </div>
      )}
      
      {/* Refinement Modal - File Specific */}
      {refiningFile && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm animate-[fade-in_0.2s_ease-out]">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden scale-100 animate-[scale-in_0.2s_cubic-bezier(0.175,0.885,0.32,1.275)]">
            <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h3 className="font-black text-slate-800 text-lg tracking-tight">Refine Settings</h3>
                <p className="text-slate-400 text-xs font-bold truncate max-w-[250px]">{refiningFile}</p>
              </div>
              <button 
                onClick={() => setRefiningFile(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-xl hover:bg-slate-200/50"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Crop Padding</label>
                <div className="flex items-center gap-3 relative group">
                  <input type="number" value={localSettings.cropPadding} onChange={(e) => setLocalSettings(prev => ({ ...prev, cropPadding: Number(e.target.value) }))} className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-base" />
                  <span className="absolute right-5 text-xs text-slate-400 font-black uppercase select-none">px</span>
                </div>
                <p className="text-[10px] text-slate-400">Buffer around the AI detection box.</p>
              </div>
              
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Inner Padding</label>
                <div className="flex items-center gap-3 relative group">
                  <input type="number" value={localSettings.canvasPaddingLeft} onChange={(e) => { const v = Number(e.target.value); setLocalSettings(p => ({ ...p, canvasPaddingLeft: v, canvasPaddingRight: v, canvasPaddingY: v })); }} className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-base" />
                  <span className="absolute right-5 text-xs text-slate-400 font-black uppercase select-none">px</span>
                </div>
                 <p className="text-[10px] text-slate-400">Aesthetic whitespace added to the final image.</p>
              </div>
              
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Merge Overlap</label>
                <div className="flex items-center gap-3 relative group">
                  <input type="number" value={localSettings.mergeOverlap} onChange={(e) => setLocalSettings(p => ({ ...p, mergeOverlap: Number(e.target.value) }))} className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-base" />
                  <span className="absolute right-5 text-xs text-slate-400 font-black uppercase select-none">px</span>
                </div>
                <p className="text-[10px] text-slate-400">Vertical overlap when stitching split questions.</p>
              </div>

              <div className="pt-4">
                <button 
                  onClick={() => handleRecropFile(refiningFile!, localSettings)} 
                  disabled={isProcessing} 
                  className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-2xl shadow-xl shadow-blue-200 transition-all active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50 text-base"
                >
                  {status === ProcessingStatus.CROPPING ? (
                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> 
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  )}
                  Apply & Recrop File
                </button>
              </div>
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
