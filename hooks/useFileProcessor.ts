import { useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { ProcessingStatus, DebugPageData, QuestionImage, SourcePage } from '../types';
import { renderPageToImage } from '../services/pdfService';
import { detectQuestionsOnPage } from '../services/geminiService';
import { loadExamResult, saveExamResult, getHistoryList } from '../services/storageService';
import { generateQuestionsFromRawPages } from '../services/generationService';

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
    cropSettings, concurrency, selectedModel, useHistoryCache
  } = state;

  const {
    setStatus, setDetailedStatus, setError, setQuestions, setRawPages, setSourcePages,
    setTotal, setCompletedCount, setProgress, setCroppingTotal, setCroppingDone,
    setCurrentRound, setFailedCount, setStartTime
  } = setters;

  const { abortControllerRef, stopRequestedRef } = refs;

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
                const base64 = await loadedZip.file(key)!.async('base64');
                const ext = key.split('.').pop()?.toLowerCase();
                const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
                const pathParts = key.split('/');
                const fileNameWithExt = pathParts[pathParts.length - 1];
                let qId = "0";
                let qFileName = zipRawPages.length > 0 ? zipRawPages[0].fileName : "unknown";

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
            allQuestions.push(...loadedQuestions);
          }
        } catch (e) { console.error(`Failed to parse ZIP ${file.name}:`, e); }
      }

      setRawPages(allRawPages);
      setSourcePages(allRawPages.map(({detections, ...rest}) => rest));
      setTotal(allRawPages.length);
      
      const uniqueFiles = new Set(allRawPages.map(p => p.fileName));
      
      if (allQuestions.length > 0) {
        allQuestions.sort((a, b) => {
            if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
            return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
        });
        setQuestions(allQuestions);
        setCompletedCount(allRawPages.length);
        setStatus(ProcessingStatus.COMPLETED);

        // Save questions to DB
        const savePromises = Array.from(uniqueFiles).map(fileName => {
           const filePages = allRawPages.filter(p => p.fileName === fileName);
           const fileQuestions = allQuestions.filter(q => q.fileName === fileName);
           return saveExamResult(fileName, filePages, fileQuestions);
        });
        await Promise.all(savePromises);
        
      } else {
         if (allRawPages.length > 0) {
            // Updated to use user-defined concurrency strictly
            const qs = await generateQuestionsFromRawPages(
                allRawPages, 
                cropSettings, 
                new AbortController().signal,
                undefined, // no callback for zip load needed usually, or add if wanted
                concurrency
            );
            setQuestions(qs);
            setCompletedCount(allRawPages.length);
            setStatus(ProcessingStatus.COMPLETED);

            const savePromises = Array.from(uniqueFiles).map(fileName => {
                const filePages = allRawPages.filter(p => p.fileName === fileName);
                const fileQuestions = qs.filter(q => q.fileName === fileName);
                return saveExamResult(fileName, filePages, fileQuestions);
            });
            await Promise.all(savePromises);
         } else {
            throw new Error("No valid data found in ZIP");
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
    
    // Reset State (Partial)
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

    const filesToProcess: File[] = [];
    const cachedRawPages: DebugPageData[] = [];
    const cachedQuestions: QuestionImage[] = [];

    if (useHistoryCache) {
      setDetailedStatus("Checking history for existing files...");
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
             // Updated usage
             const generated = await generateQuestionsFromRawPages(
                 pagesToGen, 
                 cropSettings, 
                 signal,
                 undefined, 
                 concurrency
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
            setSourcePages((prev: any) => [...prev, sourcePage]);
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
                ? `Analyzing pages with AI... (Threads: ${concurrency})` 
                : `Round ${round}: Retrying ${queue.length} failed pages... (Threads: ${concurrency})`);
             
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

                         setRawPages((prev: any) => [...prev, resultPage]);
                         setCompletedCount((prev: number) => prev + 1);
                         setCroppingTotal((prev: number) => prev + detections.length);

                         if (fileMeta[pageData.fileName]) {
                             fileMeta[pageData.fileName].processedPages++;
                             const meta = fileMeta[pageData.fileName];
                             
                             if (!meta.cropped && meta.processedPages === meta.totalPages) {
                                 meta.cropped = true;
                                 
                                 setRawPages((current: any) => {
                                     const filePages = current.filter((p: any) => p.fileName === pageData.fileName);
                                     filePages.sort((a: any,b: any) => a.pageNumber - b.pageNumber);
                                     
                                     // Use callback to update questions in real-time
                                     generateQuestionsFromRawPages(
                                        filePages, 
                                        cropSettings, 
                                        signal,
                                        {
                                            onProgress: () => setCroppingDone((p: number) => p + 1),
                                            onResult: (img) => {
                                                setQuestions((prevQ: any) => {
                                                    const next = [...prevQ, img];
                                                    // Basic sort to keep sanity
                                                    return next.sort((a: any,b: any) => {
                                                        if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
                                                        // Fallback sort
                                                        return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
                                                    });
                                                });
                                            }
                                        },
                                        concurrency
                                     ).then(newQuestions => {
                                        if (!signal.aborted && !stopRequestedRef.current) {
                                            // Final save (questions already in state)
                                            saveExamResult(pageData.fileName, filePages, newQuestions)
                                                .then(() => refreshHistoryList());
                                        }
                                     });
                                     return current;
                                 });
                             }
                         }

                     } catch (err: any) {
                         console.warn(`Failed ${pageData.fileName} P${pageData.pageNumber} in Round ${round}`, err);
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

  return { processZipFiles, handleFileChange };
};