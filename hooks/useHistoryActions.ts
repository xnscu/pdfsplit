
import { ProcessingStatus, DebugPageData, QuestionImage } from '../types';
import { loadExamResult, getHistoryList, saveExamResult, updateExamQuestionsOnly, cleanupAllHistory, reSaveExamResult } from '../services/storageService';
import { generateQuestionsFromRawPages, pMap, createLogicalQuestions, processLogicalQuestion } from '../services/generationService';

interface HistoryProps {
  state: any;
  setters: any;
  refs: any;
  actions: any;
}

export const useHistoryActions = ({ state, setters, refs, actions }: HistoryProps) => {
  const { batchSize, cropSettings, legacySyncFiles, questions, rawPages, concurrency } = state;
  const {
    setStatus, setDetailedStatus, setError, setQuestions, setRawPages, setSourcePages,
    setTotal, setCompletedCount, setCroppingTotal, setCroppingDone, setLegacySyncFiles, setIsSyncingLegacy,
    setStartTime
  } = setters;
  const { abortControllerRef } = refs;
  const { resetState, addNotification } = actions;

  const refreshHistoryList = async () => {
    try {
      const list = await getHistoryList();
      setters.setHistoryList(list);
    } catch (e) {
      console.error("Failed to load history list", e);
    }
  };

  const handleCleanupAllHistory = async () => {
      try {
          const removedCount = await cleanupAllHistory();
          if (removedCount > 0) {
              setDetailedStatus(`Maintenance complete. Cleaned ${removedCount} duplicate pages.`);
              await refreshHistoryList();
          } else {
              setDetailedStatus(`Maintenance complete. No duplicate pages found.`);
          }
          setTimeout(() => {
             if (state.status === ProcessingStatus.IDLE) setDetailedStatus('');
          }, 4000);
      } catch (e) {
          console.error(e);
          setError("Failed to cleanup history.");
          setStatus(ProcessingStatus.ERROR);
      }
  };

  const handleBatchReprocessHistory = async (ids: string[]) => {
      setters.setIsLoadingHistory(true);
      const startTimeLocal = Date.now();
      setStartTime(startTimeLocal);
      const threads = batchSize || 5;
      
      try {
         // 1. Gather all pages from all selected files first
         const allSourcePages: DebugPageData[] = [];
         const fileIdToName = new Map<string, string>();
         
         setDetailedStatus(`Loading data for ${ids.length} files...`);
         for (const id of ids) {
             const record = await loadExamResult(id);
             if (record) {
                 allSourcePages.push(...record.rawPages);
                 fileIdToName.set(id, record.name);
             }
         }

         // 2. Flatten all logical questions across ALL files
         const allLogicalQuestions = createLogicalQuestions(allSourcePages);
         const totalItems = allLogicalQuestions.length;
         let currentFinished = 0;
         let changedImagesCount = 0;

         const updateStatus = () => {
             setDetailedStatus(`Processing: ${currentFinished}/${totalItems}`);
         };

         updateStatus();

         // 3. Global parallel processing (Ignore PDF boundaries)
         const allResults = await pMap(allLogicalQuestions, async (task) => {
             const res = await processLogicalQuestion(task, cropSettings);
             currentFinished++;
             updateStatus();
             return res;
         }, threads);

         const validResults = allResults.filter((r): r is QuestionImage => r !== null);

         // 4. Group results back by file to update database
         const resultsByFile = new Map<string, QuestionImage[]>();
         validResults.forEach(q => {
             if (!resultsByFile.has(q.fileName)) resultsByFile.set(q.fileName, []);
             resultsByFile.get(q.fileName)!.push(q);
         });

         // 5. Save updates and compare changes
         for (const id of ids) {
             const fileName = fileIdToName.get(id);
             if (!fileName) continue;

             const fileQuestions = resultsByFile.get(fileName) || [];
             const filePages = allSourcePages.filter(p => p.fileName === fileName);
             
             const record = await loadExamResult(id);
             const oldUrls = new Set((record?.questions || []).map(q => q.dataUrl));
             fileQuestions.forEach(q => {
                 if (!oldUrls.has(q.dataUrl)) changedImagesCount++;
             });

             await reSaveExamResult(fileName, filePages, fileQuestions);
         }

         const endTime = Date.now();
         const durationSeconds = (endTime - startTimeLocal) / 1000;
         const speed = (totalItems / durationSeconds).toFixed(2);
         const timeFormatted = durationSeconds.toFixed(1);

         addNotification(
             null, 
             "success", 
             `Batch complete: ${totalItems} items in ${timeFormatted}s (${speed} items/sec). ${changedImagesCount} new images created.`
         );
         await refreshHistoryList();
         
      } catch (e: any) {
         console.error(e);
         addNotification(null, "error", `Batch process failed: ${e.message}`);
      } finally {
         setters.setIsLoadingHistory(false);
         setDetailedStatus("");
      }
  };

  const handleLoadHistory = async (id: string) => {
    resetState();
    setters.setShowHistory(false);
    setters.setIsLoadingHistory(true);
    setStartTime(Date.now());
    setStatus(ProcessingStatus.LOADING_PDF);
    setDetailedStatus('Restoring from history...');

    try {
      const result = await loadExamResult(id);
      if (!result) throw new Error("History record not found.");

      const uniquePages = Array.from(new Map(result.rawPages.map((p: any) => [p.pageNumber, p])).values()) as DebugPageData[];
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

      if (result.questions && result.questions.length > 0) {
          setQuestions(result.questions);
          setCompletedCount(uniquePages.length);
          setTotal(uniquePages.length);
          setStatus(ProcessingStatus.COMPLETED);
          setDetailedStatus("Loaded successfully from cache.");
      } else {
          setStatus(ProcessingStatus.CROPPING);
          setDetailedStatus('Generating questions from raw data...');
          
          const totalDetections = uniquePages.reduce((acc, p) => acc + p.detections.length, 0);
          setCroppingTotal(totalDetections);
          setCroppingDone(0);
          setTotal(uniquePages.length);
          setCompletedCount(uniquePages.length);

          abortControllerRef.current = new AbortController();
          const generatedQuestions = await generateQuestionsFromRawPages(
            uniquePages, 
            cropSettings, 
            abortControllerRef.current.signal,
            {
                onProgress: () => setCroppingDone((p: number) => p + 1)
            },
            batchSize || 10
          );

          setQuestions(generatedQuestions);
          setStatus(ProcessingStatus.COMPLETED);
          setLegacySyncFiles(new Set([result.name]));
      }

    } catch (e: any) {
      setError("Failed to load history: " + e.message);
      setStatus(ProcessingStatus.ERROR);
    } finally {
      setters.setIsLoadingHistory(false);
    }
  };

  const handleBatchLoadHistory = async (ids: string[]) => {
    resetState();
    setters.setShowHistory(false);
    setters.setIsLoadingHistory(true);
    setStartTime(Date.now());
    setStatus(ProcessingStatus.LOADING_PDF);
    setDetailedStatus(`Queuing ${ids.length} exams from history...`);

    try {
      const CHUNK_SIZE = 10;
      const combinedPages: DebugPageData[] = [];
      const combinedQuestions: QuestionImage[] = [];
      const legacyFilesFound = new Set<string>();
      
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
         const chunk = ids.slice(i, i + CHUNK_SIZE);
         const results = await Promise.all(chunk.map(id => loadExamResult(id)));
         results.forEach(res => {
            if (res && res.rawPages) {
                combinedPages.push(...res.rawPages);
                if (res.questions && res.questions.length > 0) {
                    combinedQuestions.push(...res.questions);
                } else {
                    legacyFilesFound.add(res.name);
                }
            }
         });
      }

      if (combinedPages.length === 0) throw new Error("No valid data found.");

      const uniquePages = Array.from(new Map(combinedPages.map(p => [`${p.fileName}#${p.pageNumber}`, p])).values());
      uniquePages.sort((a, b) => {
         if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
         return a.pageNumber - b.pageNumber;
      });

      setRawPages(uniquePages);
      setSourcePages(uniquePages.map(rp => ({ dataUrl: rp.dataUrl, width: rp.width, height: rp.height, pageNumber: rp.pageNumber, fileName: rp.fileName })));

      if (legacyFilesFound.size > 0) {
          setStatus(ProcessingStatus.CROPPING);
          const legacyPages = uniquePages.filter(p => legacyFilesFound.has(p.fileName));
          setCroppingTotal(legacyPages.reduce((acc, p) => acc + p.detections.length, 0));
          setCroppingDone(0);

          abortControllerRef.current = new AbortController();
          const generatedLegacyQuestions = await generateQuestionsFromRawPages(
            legacyPages, cropSettings, abortControllerRef.current.signal,
            { onProgress: () => setCroppingDone((p: number) => p + 1) }, 
            batchSize || 10
          );
          setQuestions([...combinedQuestions, ...generatedLegacyQuestions]);
          setLegacySyncFiles(legacyFilesFound);
      } else {
          setQuestions(combinedQuestions);
      }

      setTotal(uniquePages.length);
      setCompletedCount(uniquePages.length);
      setStatus(ProcessingStatus.COMPLETED);

    } catch (e: any) {
      setError("Batch load failed: " + e.message);
      setStatus(ProcessingStatus.ERROR);
    } finally {
      setters.setIsLoadingHistory(false);
    }
  };

  const handleSyncLegacyData = async () => {
     const syncSet = legacySyncFiles as Set<string>;
     if (syncSet.size === 0) return;
     setIsSyncingLegacy(true);
     try {
         const history = await getHistoryList();
         await Promise.all(Array.from(syncSet).map(async (fileName) => {
             const fileQuestions = questions.filter((q: any) => q.fileName === fileName);
             const historyItem = history.find(h => h.name === fileName);
             if (historyItem) await updateExamQuestionsOnly(historyItem.id, fileQuestions);
         }));
         setLegacySyncFiles(new Set()); 
         addNotification(null, "success", "All images saved to database.");
         await refreshHistoryList();
     } catch (e: any) {
         setError("Sync failed: " + e.message);
     } finally {
         setIsSyncingLegacy(false);
     }
  };

  return { handleCleanupAllHistory, handleLoadHistory, handleBatchLoadHistory, handleSyncLegacyData, handleBatchReprocessHistory, refreshHistoryList };
};
