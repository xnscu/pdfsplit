
import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { ProcessingStatus, QuestionImage, DebugPageData, ProcessedCanvas, HistoryMetadata, DetectedQuestion } from './types';
import { ProcessingState } from './components/ProcessingState';
import { QuestionGrid } from './components/QuestionGrid';
import { DebugRawView } from './components/DebugRawView';
import { Header } from './components/Header';
import { UploadSection } from './components/UploadSection';
import { ConfigurationPanel } from './components/ConfigurationPanel';
import { HistorySidebar } from './components/HistorySidebar';
import { RefinementModal } from './components/RefinementModal';
import { renderPageToImage, constructQuestionCanvas, mergeCanvasesVertical, analyzeCanvasContent, generateAlignedImage, CropSettings } from './services/pdfService';
import { detectQuestionsOnPage } from './services/geminiService';
import { saveExamResult, getHistoryList, loadExamResult, cleanupAllHistory, updatePageDetections } from './services/storageService';

const DEFAULT_SETTINGS: CropSettings = {
  cropPadding: 25,
  canvasPadding: 10,
  mergeOverlap: -5
};

const STORAGE_KEYS = {
  CROP_SETTINGS: 'exam_splitter_crop_settings_v3',
  CONCURRENCY: 'exam_splitter_concurrency_v3',
  MODEL: 'exam_splitter_selected_model_v3',
  USE_HISTORY_CACHE: 'exam_splitter_use_history_cache_v1',
  BATCH_SIZE: 'exam_splitter_batch_size_v1'
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

// Helper for auto-detect batch size based on RAM
const getAutoBatchSize = (): number => {
  if (typeof navigator !== 'undefined' && 'deviceMemory' in navigator) {
    // @ts-ignore
    const ram = navigator.deviceMemory as number; 
    // Conservative scaling: 
    // <= 4GB: 10 items
    // <= 8GB: 25 items
    // > 8GB: 50 items
    if (ram <= 4) return 10;
    if (ram <= 8) return 25;
    return 50;
  }
  return 20; // Default fallback
};

// Helper for parallel processing with concurrency control
const pMap = async <T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number,
  signal?: AbortSignal
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let currentIndex = 0;
  
  const worker = async () => {
    while (currentIndex < items.length) {
      if (signal?.aborted) return;
      const index = currentIndex++;
      try {
        results[index] = await mapper(items[index], index);
      } catch (err) {
        if (signal?.aborted) return;
        throw err;
      }
    }
  };

  const workers = Array(Math.min(items.length, concurrency)).fill(null).map(worker);
  await Promise.all(workers);
  
  if (signal?.aborted) throw new Error("Aborted");
  return results;
};

const App: React.FC = () => {
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [questions, setQuestions] = useState<QuestionImage[]>([]);
  const [rawPages, setRawPages] = useState<DebugPageData[]>([]);
  const [sourcePages, setSourcePages] = useState<SourcePage[]>([]);
  
  // State for specific file interactions
  const [debugFile, setDebugFile] = useState<string | null>(null);
  const [lastViewedFile, setLastViewedFile] = useState<string | null>(null); // Track last viewed file
  const [refiningFile, setRefiningFile] = useState<string | null>(null);

  // History State
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryMetadata[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [cropSettings, setCropSettings] = useState<CropSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CROP_SETTINGS);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Migration support for old format
        if (parsed.canvasPadding === undefined && parsed.canvasPaddingLeft !== undefined) {
             parsed.canvasPadding = parsed.canvasPaddingLeft;
        }
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
      return DEFAULT_SETTINGS;
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

  const [batchSize, setBatchSize] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.BATCH_SIZE);
      return saved ? Math.max(1, parseInt(saved, 10)) : getAutoBatchSize();
    } catch {
      return 20;
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
    localStorage.setItem(STORAGE_KEYS.BATCH_SIZE, batchSize.toString());
  }, [batchSize]);

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
    setLastViewedFile(null);
    setRefiningFile(null);
    setStartTime(null);
    setElapsedTime("00:00");
    setCurrentRound(1);
    setFailedCount(0);
    if (window.location.search) window.history.pushState({}, '', window.location.pathname);
  };

  const handleCleanupAllHistory = async () => {
      try {
          const removedCount = await cleanupAllHistory();
          await loadHistoryList();
          if (removedCount > 0) {
              setDetailedStatus(`Maintenance complete. Cleaned ${removedCount} duplicate pages.`);
          } else {
              setDetailedStatus(`Maintenance complete. No duplicate pages found.`);
          }
          // Reset status after a delay
          setTimeout(() => {
             if (status === ProcessingStatus.IDLE) setDetailedStatus('');
          }, 4000);
      } catch (e) {
          console.error(e);
          setError("Failed to cleanup history.");
          setStatus(ProcessingStatus.ERROR);
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

      // Cleanse loaded data for unique pages (in case loaded history is corrupted from before)
      const uniquePages = Array.from(new Map(result.rawPages.map(p => [p.pageNumber, p])).values());
      uniquePages.sort((a, b) => a.pageNumber - b.pageNumber);

      setRawPages(uniquePages);
      
      const recoveredSourcePages = uniquePages.map(rp => ({
        dataUrl: rp.dataUrl,
        width: rp.width,
        height: rp.height,
        pageNumber: rp.pageNumber,
        fileName: rp.fileName
      }));
      setSourcePages(recoveredSourcePages);

      setStatus(ProcessingStatus.CROPPING);
      setDetailedStatus('Applying current crop settings...');
      
      const totalDetections = uniquePages.reduce((acc, p) => acc + p.detections.length, 0);
      setCroppingTotal(totalDetections);
      setCroppingDone(0);
      setTotal(uniquePages.length);
      setCompletedCount(uniquePages.length);

      abortControllerRef.current = new AbortController();
      const generatedQuestions = await generateQuestionsFromRawPages(
        uniquePages, 
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

  const handleBatchLoadHistory = async (ids: string[]) => {
    handleReset();
    setShowHistory(false);
    setIsLoadingHistory(true);
    setStatus(ProcessingStatus.LOADING_PDF);
    setDetailedStatus(`Queuing ${ids.length} exams from history...`);

    try {
      // Chunk loading to prevent Memory Spikes and UI freeze when loading massive data from IDB
      // Using user-configured batch size
      const CHUNK_SIZE = batchSize;
      const combinedPages: DebugPageData[] = [];
      
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
         const chunk = ids.slice(i, i + CHUNK_SIZE);
         setDetailedStatus(`Restoring data batch ${Math.min(i + CHUNK_SIZE, ids.length)}/${ids.length}...`);
         
         const results = await Promise.all(chunk.map(id => loadExamResult(id)));
         results.forEach(res => {
            if (res && res.rawPages) {
                combinedPages.push(...res.rawPages);
            }
         });
         
         // Small delay to allow GC and UI update
         await new Promise(r => setTimeout(r, 10));
      }

      if (combinedPages.length === 0) {
        throw new Error("No valid data found in selected items.");
      }

      // Deduplicate based on fileName + pageNumber
      const uniqueMap = new Map<string, DebugPageData>();
      combinedPages.forEach(p => {
          const key = `${p.fileName}#${p.pageNumber}`;
          uniqueMap.set(key, p);
      });

      const uniquePages = Array.from(uniqueMap.values());
      uniquePages.sort((a, b) => {
         if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
         return a.pageNumber - b.pageNumber;
      });

      setRawPages(uniquePages);

      const recoveredSourcePages = uniquePages.map(rp => ({
        dataUrl: rp.dataUrl,
        width: rp.width,
        height: rp.height,
        pageNumber: rp.pageNumber,
        fileName: rp.fileName
      }));
      setSourcePages(recoveredSourcePages);

      setStatus(ProcessingStatus.CROPPING);
      setDetailedStatus('Maximizing concurrency for batch cropping...');

      const totalDetections = uniquePages.reduce((acc, p) => acc + p.detections.length, 0);
      setCroppingTotal(totalDetections);
      setCroppingDone(0);
      setTotal(uniquePages.length);
      setCompletedCount(uniquePages.length);

      abortControllerRef.current = new AbortController();
      const generatedQuestions = await generateQuestionsFromRawPages(
        uniquePages, 
        cropSettings, 
        abortControllerRef.current.signal
      );

      setQuestions(generatedQuestions);
      setStatus(ProcessingStatus.COMPLETED);

    } catch (e: any) {
      setError("Batch load failed: " + e.message);
      setStatus(ProcessingStatus.ERROR);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  /**
   * Generates processed questions from raw debug data with PIPELINED Processing.
   * Restructured to avoid OOM / Canvas Limit errors when processing hundreds of files.
   * Instead of "Crop All -> Merge All -> Export All", we do "Process File 1... Process File 2...".
   */
  const generateQuestionsFromRawPages = async (pages: DebugPageData[], settings: CropSettings, signal: AbortSignal): Promise<QuestionImage[]> => {
    // 1. Prepare Tasks grouped by File
    type CropTask = {
        pageIndex: number;
        detIndex: number;
        fileId: string;
        pageObj: DebugPageData;
        detection: DetectedQuestion;
    };

    const tasksByFile = new Map<string, CropTask[]>();

    pages.forEach((page, pIdx) => {
        page.detections.forEach((det, dIdx) => {
            if (!tasksByFile.has(page.fileName)) {
                tasksByFile.set(page.fileName, []);
            }
            tasksByFile.get(page.fileName)!.push({
                pageIndex: pIdx,
                detIndex: dIdx,
                fileId: page.fileName,
                pageObj: page,
                detection: det
            });
        });
    });

    if (tasksByFile.size === 0) return [];

    // FILE Level Concurrency. 
    // Since each file may spawn 10-20 canvases internally, we keep file concurrency low (e.g., 4)
    // to prevent hitting the browser's 4000-8000 canvas/context limit.
    const FILE_CONCURRENCY = 4;
    const fileList = Array.from(tasksByFile.entries());

    console.log(`Starting pipelined processing for ${fileList.length} files with concurrency ${FILE_CONCURRENCY}.`);

    // Process files in parallel batches
    const fileResults = await pMap(fileList, async ([fileId, fileTasks]) => {
        if (signal.aborted) return [];

        // --- SUB-PIPELINE FOR SINGLE FILE ---
        // This ensures all canvases for this file are created AND released within this scope.

        // 1. Parallel Crop (Construct Canvas) for items in THIS file
        // Can be higher concurrency since it's limited to one file's items
        const cropResults = await Promise.all(fileTasks.map(async (task) => {
            const boxes = normalizeBoxes(task.detection.boxes_2d);
            const result = await constructQuestionCanvas(
                task.pageObj.dataUrl,
                boxes,
                task.pageObj.width,
                task.pageObj.height,
                settings
            );
            setCroppingDone(prev => prev + 1);
            return { ...result, task };
        }));

        // 2. Sequential Merging (Sort & Merge)
        // Ensure strict order: Page -> Detection Index
        cropResults.sort((a, b) => {
            if (a.task.pageIndex !== b.task.pageIndex) return a.task.pageIndex - b.task.pageIndex;
            return a.task.detIndex - b.task.detIndex;
        });

        type ExportTask = {
            canvas: HTMLCanvasElement | OffscreenCanvas;
            id: string;
            pageNumber: number;
            fileName: string;
            originalDataUrl?: string;
        };
        
        const fileExportTasks: ExportTask[] = [];

        for (const item of cropResults) {
            if (!item.canvas) continue;
            const isContinuation = item.task.detection.id === 'continuation';
            
            if (isContinuation && fileExportTasks.length > 0) {
                 const lastIdx = fileExportTasks.length - 1;
                 const lastQ = fileExportTasks[lastIdx];
                 // Merge logic
                 const merged = mergeCanvasesVertical(lastQ.canvas, item.canvas, -settings.mergeOverlap);
                 // Replaces previous canvas, effectively releasing the old one for GC
                 fileExportTasks[lastIdx] = {
                     ...lastQ,
                     canvas: merged.canvas
                 };
            } else {
                fileExportTasks.push({
                    canvas: item.canvas,
                    id: item.task.detection.id,
                    pageNumber: item.task.pageObj.pageNumber,
                    fileName: fileId,
                    originalDataUrl: item.originalDataUrl
                });
            }
        }

        // 3. Analyze & Export to DataURL
        // Pre-calculate width for alignment
        let maxFileWidth = 0;
        const analyzedTasks = fileExportTasks.map(item => {
             const trim = analyzeCanvasContent(item.canvas);
             if (trim.w > maxFileWidth) maxFileWidth = trim.w;
             return { ...item, trim };
        });

        const finalImages = await Promise.all(analyzedTasks.map(async (q) => {
            const finalDataUrl = await generateAlignedImage(q.canvas, q.trim, maxFileWidth, settings);
            
            // Explicitly help GC if possible (though scope exit handles it mostly)
            if ('width' in q.canvas) { q.canvas.width = 0; q.canvas.height = 0; }

            return {
                id: q.id,
                pageNumber: q.pageNumber,
                fileName: q.fileName,
                dataUrl: finalDataUrl,
                originalDataUrl: q.originalDataUrl
            };
        }));

        return finalImages;

    }, FILE_CONCURRENCY, signal);

    if (signal.aborted) return [];

    // Flatten results
    return fileResults.flat();
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

  /**
   * Updates detections for a specific page via Debug View (Drag & Drop column adjustment).
   */
  const handleUpdateDetections = async (fileName: string, pageNumber: number, newDetections: DetectedQuestion[]) => {
      // 1. Calculate updated pages first to allow immediate usage
      const updatedPages = rawPages.map(p => {
          if (p.fileName === fileName && p.pageNumber === pageNumber) {
              return { ...p, detections: newDetections };
          }
          return p;
      });

      // 2. Update React State immediately for visual feedback
      setRawPages(updatedPages);

      // 3. Persist to IndexedDB and Trigger Recrop
      try {
          await updatePageDetections(fileName, pageNumber, newDetections);
          console.log(`Saved updated detections for ${fileName} Page ${pageNumber}`);
          
          // Trigger Re-Crop for this file to update actual images
          // We manually call the logic here to ensure we use 'updatedPages' locally
          const targetPages = updatedPages.filter(p => p.fileName === fileName);
          if (targetPages.length === 0) return;

          abortControllerRef.current = new AbortController();
          setStatus(ProcessingStatus.CROPPING);
          setStartTime(Date.now());
          
          const detectionsInFile = targetPages.reduce((acc, p) => acc + p.detections.length, 0);
          setCroppingTotal(detectionsInFile);
          setCroppingDone(0);
          setDetailedStatus(`Applying changes to ${fileName}...`);
          
          const newQuestions = await generateQuestionsFromRawPages(
              targetPages, 
              cropSettings, 
              abortControllerRef.current.signal
          );
          
          if (!abortControllerRef.current.signal.aborted) {
              setQuestions(prev => {
                  const others = prev.filter(q => q.fileName !== fileName);
                  const combined = [...others, ...newQuestions];
                  return combined.sort((a,b) => {
                     if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
                     if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
                     return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
                  });
              });
              setStatus(ProcessingStatus.COMPLETED);
          }

      } catch (err) {
          console.error("Failed to save or recrop", err);
          // Removed alert to avoid sandbox errors
          setDetailedStatus("Warning: Failed to apply changes completely.");
          setStatus(ProcessingStatus.ERROR);
      }
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
      if (cachedRawPages.length > 0) {
         setDetailedStatus("Restoring cached files...");
         // Dedup cached pages
         const uniqueCached = Array.from(new Map(cachedRawPages.map(p => [`${p.fileName}-${p.pageNumber}`, p])).values());
         setRawPages(prev => [...prev, ...uniqueCached]);
         
         const recoveredSourcePages = uniqueCached.map(rp => ({
            dataUrl: rp.dataUrl,
            width: rp.width,
            height: rp.height,
            pageNumber: rp.pageNumber,
            fileName: rp.fileName
         }));
         setSourcePages(prev => [...prev, ...recoveredSourcePages]);
         
         const cachedQuestions = await generateQuestionsFromRawPages(uniqueCached, cropSettings, signal);
         if (!signal.aborted) {
            setQuestions(prev => {
                const combined = [...prev, ...cachedQuestions];
                return combined.sort((a,b) => a.fileName.localeCompare(b.fileName));
            });
            setCompletedCount(prev => prev + uniqueCached.length);
         }
      }

      if (filesToProcess.length === 0) {
         setStatus(ProcessingStatus.COMPLETED);
         setDetailedStatus(`Loaded ${cachedRawPages.length} pages from history.`);
         return;
      }

      const allNewPages: SourcePage[] = [];
      let cumulativeRendered = 0;
      
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

      if (allNewPages.length > 0 && !stopRequestedRef.current && !signal.aborted) {
         setStatus(ProcessingStatus.DETECTING_QUESTIONS);
         
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

         while (queue.length > 0) {
             if (stopRequestedRef.current || signal.aborted) break;

             setCurrentRound(round);
             setDetailedStatus(round === 1 
                ? "Analyzing pages with AI..." 
                : `Round ${round}: Retrying ${queue.length} failed pages...`);
             
             const nextRoundQueue: SourcePage[] = [];
             const executing = new Set<Promise<void>>();
             
             for (const pageData of queue) {
                 if (stopRequestedRef.current || signal.aborted) break;

                 const task = (async () => {
                     try {
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

                         if (fileMeta[pageData.fileName]) {
                             fileMeta[pageData.fileName].processedPages++;
                             const meta = fileMeta[pageData.fileName];
                             
                             if (!meta.cropped && meta.processedPages === meta.totalPages) {
                                 meta.cropped = true;
                                 
                                 setRawPages(current => {
                                     // FILTER CURRENT RAW PAGES FOR THIS FILE
                                     const filePages = current.filter(p => p.fileName === pageData.fileName);
                                     filePages.sort((a,b) => a.pageNumber - b.pageNumber);
                                     
                                     saveExamResult(pageData.fileName, filePages).then(() => loadHistoryList());
                                     
                                     generateQuestionsFromRawPages(filePages, cropSettings, signal).then(newQuestions => {
                                        if (!signal.aborted && !stopRequestedRef.current) {
                                            setQuestions(prevQ => [...prevQ, ...newQuestions]);
                                        }
                                     });
                                     return current;
                                 });
                             }
                         }

                     } catch (err: any) {
                         console.warn(`Failed ${pageData.fileName} P${pageData.pageNumber} in Round ${round}`, err);
                         nextRoundQueue.push(pageData);
                         setFailedCount(prev => prev + 1);
                     }
                 })();

                 executing.add(task);
                 task.then(() => executing.delete(task));
                 if (executing.size >= concurrency) await Promise.race(executing);
             }

             await Promise.all(executing);

             if (nextRoundQueue.length > 0 && !stopRequestedRef.current && !signal.aborted) {
                 queue = nextRoundQueue;
                 round++;
                 await new Promise(r => setTimeout(r, 1000));
             } else {
                 queue = [];
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
      setRefiningFile(fileName);
  };

  // Determine unique file names for navigation
  const uniqueFileNames = useMemo(() => {
    return Array.from(new Set(rawPages.map(p => p.fileName)));
  }, [rawPages]);

  const debugPages = useMemo(() => {
    if (!debugFile) return [];
    return rawPages.filter(p => p.fileName === debugFile);
  }, [rawPages, debugFile]);

  const debugQuestions = useMemo(() => {
    if (!debugFile) return [];
    return questions.filter(q => q.fileName === debugFile);
  }, [questions, debugFile]);

  // Navigation handlers
  const currentFileIndex = uniqueFileNames.indexOf(debugFile || '');
  const hasNextFile = currentFileIndex !== -1 && currentFileIndex < uniqueFileNames.length - 1;
  const hasPrevFile = currentFileIndex > 0;

  // Helper to update debug file and track last viewed
  const updateDebugFile = (fileName: string | null) => {
     setDebugFile(fileName);
     if (fileName) setLastViewedFile(fileName);
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

  const isWideLayout = debugFile !== null || questions.length > 0 || sourcePages.length > 0;
  const isProcessing = status === ProcessingStatus.LOADING_PDF || status === ProcessingStatus.DETECTING_QUESTIONS || status === ProcessingStatus.CROPPING;
  const showInitialUI = status === ProcessingStatus.IDLE || (status === ProcessingStatus.ERROR && sourcePages.length === 0);

  return (
    <div className={`min-h-screen px-4 md:px-8 bg-slate-50 relative transition-all duration-300 pb-32`}>
      <Header 
        onShowHistory={() => setShowHistory(true)} 
        onReset={handleReset} 
        showReset={sourcePages.length > 0 && !isProcessing}
      />

      <main className={`mx-auto transition-all duration-300 ${isWideLayout ? 'w-full max-w-[98vw]' : 'max-w-4xl'}`}>
        {showInitialUI && (
          <div className="space-y-8 animate-fade-in">
            <UploadSection onFileChange={handleFileChange} />
            
            <ConfigurationPanel 
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              concurrency={concurrency}
              setConcurrency={setConcurrency}
              cropSettings={cropSettings}
              setCropSettings={setCropSettings}
              useHistoryCache={useHistoryCache}
              setUseHistoryCache={setUseHistoryCache}
              batchSize={batchSize}
              setBatchSize={setBatchSize}
            />
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
                onNextFile={handleNextFile}
                onPrevFile={handlePrevFile}
                onJumpToIndex={handleJumpToIndex}
                hasNextFile={hasNextFile}
                hasPrevFile={hasPrevFile}
                onUpdateDetections={handleUpdateDetections}
                isProcessing={isProcessing}
                currentFileIndex={currentFileIndex + 1}
                totalFiles={uniqueFileNames.length}
            />
        )}

        {!debugFile && questions.length > 0 && (
            <QuestionGrid 
                questions={questions} 
                rawPages={rawPages} 
                onDebug={(fileName) => updateDebugFile(fileName)}
                onRefine={(fileName) => startRefineFile(fileName)}
                lastViewedFile={lastViewedFile}
            />
        )}
        
        {!debugFile && uniqueFileNames.length > 0 && !isProcessing && (
           <div className="flex justify-end px-4 -mt-10 mb-4 sticky top-4 z-40 pointer-events-none">
              <button 
                  onClick={() => {
                     // Determine start file: Last viewed if available and valid, otherwise first
                     const target = (lastViewedFile && uniqueFileNames.includes(lastViewedFile)) 
                        ? lastViewedFile 
                        : uniqueFileNames[0];
                     updateDebugFile(target);
                  }}
                  className="pointer-events-auto bg-slate-900 text-white px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-700 transition-all shadow-lg flex items-center gap-2"
              >
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                 {lastViewedFile && uniqueFileNames.includes(lastViewedFile) ? 'Resume Inspection' : 'Inspect Files'}
              </button>
           </div>
        )}

      </main>

      <HistorySidebar 
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        historyList={historyList}
        isLoading={isLoadingHistory}
        onLoadHistory={handleLoadHistory}
        onBatchLoadHistory={handleBatchLoadHistory}
        onRefreshList={loadHistoryList}
        onCleanupAll={handleCleanupAllHistory}
      />
      
      {refiningFile && (
        <RefinementModal 
          fileName={refiningFile}
          initialSettings={cropSettings}
          status={status}
          onClose={() => setRefiningFile(null)}
          onApply={handleRecropFile}
        />
      )}

      <footer className="mt-24 text-center text-slate-400 text-xs py-12 border-t border-slate-100 font-bold tracking-widest uppercase">
        <p>© 2025 AI Exam Splitter | Precision Tooling</p>
      </footer>
    </div>
  );
};

export default App;
