
import { useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { ProcessingStatus, DebugPageData, QuestionImage, SourcePage } from '../types';
import { renderPageToImage } from '../services/pdfService';
import { detectQuestionsOnPage } from '../services/geminiService';
import { loadExamResult, saveExamResult, getHistoryList } from '../services/storageService';
import { generateQuestionsFromRawPages, CropQueue, createLogicalQuestions, processLogicalQuestion } from '../services/generationService';

// We need a subset of the full state/setters
interface ProcessorProps {
  state: any;
  setters: any;
  refs: any;
  actions: any;
  refreshHistoryList: () => Promise<void>;
}

export const useFileProcessor = ({ state, setters, refs, actions, refreshHistoryList }: ProcessorProps) => {
  const {
    cropSettings, concurrency, selectedModel, useHistoryCache, batchSize, apiKey
  } = state;

  const {
    setStatus, setDetailedStatus, setError, setQuestions, setRawPages, setSourcePages,
    setTotal, setCompletedCount, setProgress, setCroppingTotal, setCroppingDone,
    setCurrentRound, setFailedCount, setStartTime
  } = setters;

  const { abortControllerRef, stopRequestedRef } = refs;

  // Global Queue for cropping tasks to ensure flattened concurrency
  const cropQueueRef = useRef(new CropQueue());
  
  // Track per-file progress to save results when file is done
  const fileResultsRef = useRef<Record<string, QuestionImage[]>>({});
  const fileCropMetaRef = useRef<Record<string, { totalQs: number, processedQs: number, saved: boolean }>>({});

  // Update queue concurrency when settings change
  useEffect(() => {
    cropQueueRef.current.concurrency = batchSize || 10;
  }, [batchSize]);

  const processZipFiles = async (files: { blob: Blob, name: string }[]) => {
    try {
      setStartTime(Date.now());
      setStatus(ProcessingStatus.LOADING_PDF);
      setDetailedStatus('Scanning ZIP contents...');
      
      const allRawPages: DebugPageData[] = [];
      const allQuestions: QuestionImage[] = [];
      
      // Phase 1: Pre-scan to determine total work (pages)
      let totalWorkItems = 0;
      const workQueue: {
          zip: JSZip,
          name: string,
          analysisEntries: { key: string, pages: DebugPageData[] }[],
          imageKeys: string[]
      }[] = [];

      for (const file of files) {
          try {
              const zip = new JSZip();
              const loadedZip = await zip.loadAsync(file.blob);
              
              const analysisFileKeys = Object.keys(loadedZip.files).filter(key => key.match(/(^|\/)analysis_data\.json$/i));
              const analysisEntries: { key: string, pages: DebugPageData[] }[] = [];
              
              if (analysisFileKeys.length > 0) {
                  for (const key of analysisFileKeys) {
                      const jsonText = await loadedZip.file(key)!.async('text');
                      const pages = JSON.parse(jsonText) as DebugPageData[];
                      analysisEntries.push({ key, pages });
                      totalWorkItems += pages.length;
                  }
              }
              
              const potentialImageKeys = Object.keys(loadedZip.files).filter(k => 
                !loadedZip.files[k].dir && /\.(jpg|jpeg|png)$/i.test(k) && !k.includes('full_pages/')
              );
              
              if (analysisEntries.length > 0 || potentialImageKeys.length > 0) {
                   workQueue.push({ 
                       zip: loadedZip, 
                       name: file.name, 
                       analysisEntries, 
                       imageKeys: potentialImageKeys 
                   });
              }

          } catch (e) {
              console.error(`Failed to scan ${file.name}`, e);
          }
      }

      // Initialize counters
      setTotal(totalWorkItems > 0 ? totalWorkItems : 1); 
      setCompletedCount(0);
      setProgress(0);
      
      // Phase 2: Extraction
      let processedCount = 0;

      for (const work of workQueue) {
          const zipBaseName = work.name.replace(/\.[^/.]+$/, "");
          
          // Process Pages
          for (const entry of work.analysisEntries) {
              const dirPrefix = entry.key.substring(0, entry.key.lastIndexOf("analysis_data.json"));
              setDetailedStatus(`Extracting: ${dirPrefix || zipBaseName}`);

              for (const page of entry.pages) {
                  // Normalize filename
                  let rawFileName = page.fileName;
                  if (!rawFileName || rawFileName === "unknown_file") {
                    if (dirPrefix) rawFileName = dirPrefix.replace(/\/$/, "");
                    else rawFileName = zipBaseName || "unknown_file";
                  }
                  page.fileName = rawFileName;

                  // Find full page image
                  let foundKey: string | undefined = undefined;
                  const candidates = [
                      `${dirPrefix}full_pages/Page_${page.pageNumber}.jpg`,
                      `${dirPrefix}full_pages/Page_${page.pageNumber}.jpeg`,
                      `${dirPrefix}full_pages/Page_${page.pageNumber}.png`
                  ];

                  for (const c of candidates) {
                      if (work.zip.files[c]) {
                          foundKey = c;
                          break;
                      }
                  }

                  if (!foundKey) {
                      // Regex fallback for loose structures
                      foundKey = Object.keys(work.zip.files).find(k => 
                          k.startsWith(dirPrefix) &&
                          !work.zip.files[k].dir &&
                          (k.match(new RegExp(`full_pages/.*Page_${page.pageNumber}\\.(jpg|jpeg|png)$`, 'i')))
                      );
                  }

                  if (foundKey) {
                    const base64 = await work.zip.file(foundKey)!.async('base64');
                    const ext = foundKey.split('.').pop()?.toLowerCase();
                    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
                    page.dataUrl = `data:${mime};base64,${base64}`;
                  }

                  // Update Progress
                  processedCount++;
                  setCompletedCount(processedCount);
                  setProgress(processedCount);
                  
                  // Yield to UI thread every few items to keep browser responsive
                  if (processedCount % 5 === 0) await new Promise(r => setTimeout(r, 0));
              }
              allRawPages.push(...entry.pages);
          }

          // Process Pre-cut Questions (if any)
          if (work.imageKeys.length > 0) {
             setDetailedStatus(`Linking pre-cut images...`);
             const loadedQuestions: QuestionImage[] = [];
             
             // Process in chunks to avoid blocking
             const chunkSize = 20;
             for (let i = 0; i < work.imageKeys.length; i += chunkSize) {
                 const chunk = work.imageKeys.slice(i, i + chunkSize);
                 await Promise.all(chunk.map(async (key) => {
                    const base64 = await work.zip.file(key)!.async('base64');
                    const ext = key.split('.').pop()?.toLowerCase();
                    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
                    const pathParts = key.split('/');
                    const fileNameWithExt = pathParts[pathParts.length - 1];
                    let qId = "0";
                    let qFileName = allRawPages.length > 0 ? allRawPages[0].fileName : "unknown";

                    // Heuristic extraction of ID and Filename
                    const flatMatch = fileNameWithExt.match(/^(.+)_Q(\d+(?:_\d+)?)\.(jpg|jpeg|png)$/i);
                    if (flatMatch) {
                        qFileName = flatMatch[1];
                        qId = flatMatch[2];
                    } else {
                        const nestedMatch = fileNameWithExt.match(/^Q(\d+(?:_\d+)?)\.(jpg|jpeg|png)$/i);
                        if (nestedMatch) qId = nestedMatch[1];
                    }

                    loadedQuestions.push({
                        id: qId,
                        pageNumber: 1,
                        fileName: qFileName,
                        dataUrl: `data:${mime};base64,${base64}`
                    });
                 }));
                 await new Promise(r => setTimeout(r, 0));
             }
             allQuestions.push(...loadedQuestions);
          }
      }

      // Finalize State
      setRawPages(allRawPages);
      setSourcePages(allRawPages.map(({detections, ...rest}) => rest));
      
      // Ensure 100% at end
      setCompletedCount(totalWorkItems > 0 ? totalWorkItems : 1);
      
      const uniqueFiles = new Set(allRawPages.map(p => p.fileName));
      
      if (allQuestions.length > 0) {
         setDetailedStatus('Syncing results...');
         allQuestions.sort((a, b) => {
            if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
            return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
        });
        setQuestions(allQuestions);
        setStatus(ProcessingStatus.COMPLETED);

        // Save Results
        const savePromises = Array.from(uniqueFiles).map(fileName => {
           const filePages = allRawPages.filter(p => p.fileName === fileName);
           const fileQuestions = allQuestions.filter(q => q.fileName === fileName);
           return saveExamResult(fileName, filePages, fileQuestions);
        });
        await Promise.all(savePromises);
        
      } else {
         if (allRawPages.length > 0) {
            // Regenerate Crops if only raw pages found
            setStatus(ProcessingStatus.CROPPING);
            const totalQs = allRawPages.reduce((acc, p) => acc + p.detections.length, 0);
            setCroppingTotal(totalQs);
            setCroppingDone(0);
            setDetailedStatus('Regenerating images...');

            const qs = await generateQuestionsFromRawPages(
                allRawPages, 
                cropSettings, 
                new AbortController().signal,
                {
                  onProgress: () => setCroppingDone((prev: number) => prev + 1)
                },
                batchSize || 10
            );
            
            setQuestions(qs);
            setStatus(ProcessingStatus.COMPLETED);

            const savePromises = Array.from(uniqueFiles).map(fileName => {
                const filePages = allRawPages.filter(p => p.fileName === fileName);
                const fileQuestions = qs.filter(q => q.fileName === fileName);
                return saveExamResult(fileName, filePages, fileQuestions);
            });
            await Promise.all(savePromises);
         } else {
             throw new Error("No valid data found in ZIP.");
         }
      }
      await refreshHistoryList();
    } catch (err: any) {
      setError("Batch ZIP load failed: " + err.message);
      setStatus(ProcessingStatus.ERROR);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []) as File[];
    if (fileList.length === 0) return;
    
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
    setters.setProcessingFiles(new Set());
    
    cropQueueRef.current.clear();
    fileResultsRef.current = {};
    fileCropMetaRef.current = {};

    const filesToProcess: File[] = [];
    const cachedRawPages: DebugPageData[] = [];
    const cachedQuestions: QuestionImage[] = [];

    if (useHistoryCache) {
      setDetailedStatus("Checking history...");
      const historyList = await getHistoryList();
      for (const file of pdfFiles) {
        const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        const historyItem = historyList.find(h => h.name === fileNameWithoutExt);
        let loadedFromCache = false;
        if (historyItem) {
          try {
            const result = await loadExamResult(historyItem.id);
            if (result && result.rawPages.length > 0) {
               cachedRawPages.push(...result.rawPages);
               if (result.questions && result.questions.length > 0) {
                   cachedQuestions.push(...result.questions);
               }
               loadedFromCache = true;
            }
          } catch (err) {
             console.warn(`Failed to load history for ${fileNameWithoutExt}`, err);
          }
        }
        if (!loadedFromCache) filesToProcess.push(file);
      }
    } else {
       filesToProcess.push(...pdfFiles);
    }

    try {
      if (cachedRawPages.length > 0) {
         setDetailedStatus("Restoring cache...");
         const uniqueCached = Array.from(new Map(cachedRawPages.map(p => [`${p.fileName}-${p.pageNumber}`, p])).values());
         setRawPages((prev: any) => [...prev, ...uniqueCached]);
         
         const recoveredSourcePages = uniqueCached.map(rp => ({
            dataUrl: rp.dataUrl,
            width: rp.width,
            height: rp.height,
            pageNumber: rp.pageNumber,
            fileName: rp.fileName
         }));
         setSourcePages((prev: any) => [...prev, ...recoveredSourcePages]);
         
         let questionsFromCache = cachedQuestions;
         const cachedFiles = new Set(uniqueCached.map(p => p.fileName));
         const filesWithQs = new Set(cachedQuestions.map(q => q.fileName));
         const filesNeedingGen = Array.from(cachedFiles).filter(f => !filesWithQs.has(f));

         if (filesNeedingGen.length > 0) {
             const pagesToGen = uniqueCached.filter(p => filesNeedingGen.includes(p.fileName));
             const generated = await generateQuestionsFromRawPages(
                 pagesToGen, 
                 cropSettings, 
                 signal,
                 undefined, 
                 batchSize || 10
             );
             questionsFromCache = [...questionsFromCache, ...generated];
         }

         if (!signal.aborted) {
            setQuestions((prev: any) => {
                const combined = [...prev, ...questionsFromCache];
                return combined.sort((a: any, b: any) => a.fileName.localeCompare(b.fileName));
            });
            setCompletedCount((prev: number) => prev + uniqueCached.length);
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
         
         setDetailedStatus(`Rendering: ${file.name}`);
         
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
            setSourcePages((prev: any) => [...prev, sourcePage]);
         }
      }

      setTotal(cachedRawPages.length + allNewPages.length);
      setProgress(cachedRawPages.length);

      if (allNewPages.length > 0 && !stopRequestedRef.current && !signal.aborted) {
         setStatus(ProcessingStatus.DETECTING_QUESTIONS);
         const detectionMeta: Record<string, { totalPages: number, processedPages: number }> = {};
         allNewPages.forEach(p => {
             if (!detectionMeta[p.fileName]) {
                 detectionMeta[p.fileName] = { 
                    totalPages: allNewPages.filter(x => x.fileName === p.fileName).length, 
                    processedPages: 0
                 };
             }
         });

         let queue = [...allNewPages];
         let round = 1;
         while (queue.length > 0) {
             if (stopRequestedRef.current || signal.aborted) break;
             setCurrentRound(round);
             setDetailedStatus(round === 1 ? `Analyzing pages...` : `Round ${round}: Retrying...`);
             const nextRoundQueue: SourcePage[] = [];
             const executing = new Set<Promise<void>>();
             for (const pageData of queue) {
                 if (stopRequestedRef.current || signal.aborted) break;
                 const task = (async () => {
                     try {
                         const detections = await detectQuestionsOnPage(pageData.dataUrl, selectedModel, undefined, apiKey);
                         const resultPage: DebugPageData = {
                             pageNumber: pageData.pageNumber, fileName: pageData.fileName,
                             dataUrl: pageData.dataUrl, width: pageData.width,
                             height: pageData.height, detections
                         };
                         setRawPages((prev: any) => [...prev, resultPage]);
                         setCompletedCount((prev: number) => prev + 1);
                         setCroppingTotal((prev: number) => prev + detections.length);
                         if (detectionMeta[pageData.fileName]) {
                             detectionMeta[pageData.fileName].processedPages++;
                             const dMeta = detectionMeta[pageData.fileName];
                             if (dMeta.processedPages === dMeta.totalPages) {
                                 setRawPages((currentRaw: any) => {
                                     const filePages = currentRaw.filter((p: any) => p.fileName === pageData.fileName);
                                     filePages.sort((a: any,b: any) => a.pageNumber - b.pageNumber);
                                     const logicalQs = createLogicalQuestions(filePages);
                                     fileCropMetaRef.current[pageData.fileName] = { totalQs: logicalQs.length, processedQs: 0, saved: false };
                                     fileResultsRef.current[pageData.fileName] = [];
                                     logicalQs.forEach(lq => {
                                         cropQueueRef.current.enqueue(async () => {
                                            if (signal.aborted) return;
                                            const result = await processLogicalQuestion(lq, cropSettings);
                                            if (result) {
                                                setQuestions((prevQ: any) => {
                                                    const next = [...prevQ, result];
                                                    return next.sort((a: any,b: any) => {
                                                        if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
                                                        return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
                                                    });
                                                });
                                                setCroppingDone((p: number) => p + 1);
                                                const fMeta = fileCropMetaRef.current[pageData.fileName];
                                                const fRes = fileResultsRef.current[pageData.fileName];
                                                if (fMeta && fRes) {
                                                    fRes.push(result);
                                                    fMeta.processedQs++;
                                                    if (fMeta.processedQs >= fMeta.totalQs && !fMeta.saved) {
                                                        fMeta.saved = true;
                                                        saveExamResult(pageData.fileName, filePages, fRes).then(() => refreshHistoryList());
                                                    }
                                                }
                                            }
                                         });
                                     });
                                     return currentRaw;
                                 });
                             }
                         }
                     } catch (err: any) {
                         nextRoundQueue.push(pageData);
                         setFailedCount((prev: number) => prev + 1);
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
             } else queue = [];
         }
      }

      if (stopRequestedRef.current) {
          setStatus(ProcessingStatus.STOPPED);
      } else {
          if (cropQueueRef.current.size > 0) {
              setStatus(ProcessingStatus.CROPPING);
              setDetailedStatus("Finalizing crops...");
              await cropQueueRef.current.onIdle();
          }
          setStatus(ProcessingStatus.COMPLETED);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') { setStatus(ProcessingStatus.STOPPED); return; }
      setError(err.message || "Processing failed.");
      setStatus(ProcessingStatus.ERROR);
    }
  };

  return { processZipFiles, handleFileChange };
};
