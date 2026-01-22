
import { ProcessingStatus, DebugPageData, QuestionImage } from '../types';
import { loadExamResult, getHistoryList, saveExamResult, updateExamQuestionsOnly, cleanupAllHistory, reSaveExamResult } from '../services/storageService';
import { generateQuestionsFromRawPages, pMap } from '../services/generationService';

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
    setTotal, setCompletedCount, setCroppingTotal, setCroppingDone, setLegacySyncFiles, setIsSyncingLegacy
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
          // Callers will need to refresh list manually if needed
          if (removedCount > 0) {
              setDetailedStatus(`Maintenance complete. Cleaned ${removedCount} duplicate pages.`);
              await refreshHistoryList(); // Refresh list to show updated page counts
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
      const totalFiles = ids.length;
      let filesProcessedCount = 0;
      let totalQuestionsProcessed = 0;
      let changedImagesCount = 0;

      // Use user-defined Batch Size for the internal parallel processing items as requested.
      // This allows the "Batch Process Size" slider to control how many questions are processed in parallel per file.
      const internalItemConcurrency = batchSize || 5;

      console.log(`Batch Processing: User BatchSize=${internalItemConcurrency}. Strategy: Sequential Files (1) x Parallel Items (${internalItemConcurrency}).`);

      try {
         const updateStatus = () => {
             const percent = totalFiles > 0 ? Math.round((filesProcessedCount / totalFiles) * 100) : 0;
             setDetailedStatus(`Batch Reprocessing: Completed ${totalQuestionsProcessed} items... (File ${filesProcessedCount + 1}/${totalFiles}) · Threads: ${internalItemConcurrency}`);
         };

         updateStatus();

         await pMap(ids, async (id) => {
            // 1. Load record
            const record = await loadExamResult(id);
            if (!record) return;

            // 2. Recrop with current settings
            // Pass 'internalItemConcurrency' to use full CPU power for this single file.
            // Add onResult callback to update global item progress.
            const newQuestions = await generateQuestionsFromRawPages(
               record.rawPages,
               cropSettings,
               new AbortController().signal,
               {
                 onResult: () => {
                   totalQuestionsProcessed++;
                   // Debounce status updates slightly to prevent react churn if super fast
                   // But for now direct update is fine for visual feedback
                   updateStatus();
                 }
               }, 
               internalItemConcurrency
            );

            // 3. Count changes
            const oldQuestions = record.questions || [];
            const oldMap = new Map(oldQuestions.map(q => [`${q.fileName}-${q.id}`, q.dataUrl]));
            
            let currentFileChanges = 0;
            // Check for changed content
            newQuestions.forEach(nq => {
                const key = `${nq.fileName}-${nq.id}`;
                const oldUrl = oldMap.get(key);
                if (!oldUrl || oldUrl !== nq.dataUrl) {
                    currentFileChanges++;
                }
            });
            // Check for deleted content
            const newKeys = new Set(newQuestions.map(q => `${q.fileName}-${q.id}`));
            oldQuestions.forEach(oq => {
                 const key = `${oq.fileName}-${oq.id}`;
                 if (!newKeys.has(key)) {
                     currentFileChanges++;
                 }
            });
            
            changedImagesCount += currentFileChanges;

            // 4. Save Updates
            await reSaveExamResult(record.name, record.rawPages, newQuestions);
            
            filesProcessedCount++;
            updateStatus();
            
            // Critical: Yield to event loop to allow UI render between items in the concurrency pool.
            await new Promise(resolve => setTimeout(resolve, 0));

         }, 1);

         addNotification(null, "success", `Reprocessed ${filesProcessedCount} files. ${changedImagesCount} images changed.`);
         await refreshHistoryList(); // Refreshes metadata if any counts changed
         
      } catch (e: any) {
         console.error(e);
         addNotification(null, "error", e.message);
      } finally {
         setters.setIsLoadingHistory(false);
         setDetailedStatus("");
      }
  };

  const handleLoadHistory = async (id: string) => {
    resetState();
    setters.setShowHistory(false);
    setters.setIsLoadingHistory(true);
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
            concurrency
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
    setStatus(ProcessingStatus.LOADING_PDF);
    setDetailedStatus(`Queuing ${ids.length} exams from history...`);

    try {
      const CHUNK_SIZE = batchSize || 10;
      const combinedPages: DebugPageData[] = [];
      const combinedQuestions: QuestionImage[] = [];
      const legacyFilesFound = new Set<string>();
      
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
         const chunk = ids.slice(i, i + CHUNK_SIZE);
         setDetailedStatus(`Restoring data batch ${Math.min(i + CHUNK_SIZE, ids.length)}/${ids.length}...`);
         
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
         
         await new Promise(r => setTimeout(r, 10));
      }

      if (combinedPages.length === 0) {
        throw new Error("No valid data found in selected items.");
      }

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

      if (legacyFilesFound.size > 0) {
          setStatus(ProcessingStatus.CROPPING);
          setDetailedStatus(`Generating images for ${legacyFilesFound.size} legacy files...`);

          const legacyPages = uniquePages.filter(p => legacyFilesFound.has(p.fileName));
          const totalDetections = legacyPages.reduce((acc, p) => acc + p.detections.length, 0);
          setCroppingTotal(totalDetections);
          setCroppingDone(0);

          abortControllerRef.current = new AbortController();
          const generatedLegacyQuestions = await generateQuestionsFromRawPages(
            legacyPages, 
            cropSettings, 
            abortControllerRef.current.signal,
            {
                onProgress: () => setCroppingDone((p: number) => p + 1)
            },
            concurrency
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
     // Cast legacySyncFiles to Set<string> since it comes from untyped state
     const syncSet = legacySyncFiles as Set<string>;
     if (syncSet.size === 0) return;
     
     setIsSyncingLegacy(true);
     setDetailedStatus("Syncing processed images to database...");
     
     try {
         const history = await getHistoryList();
         const filesToSync = Array.from(syncSet);
         
         await Promise.all(filesToSync.map(async (fileName) => {
             const fileQuestions = questions.filter((q: any) => q.fileName === fileName);
             if (fileQuestions.length === 0) return;

             const historyItem = history.find(h => h.name === fileName);
             if (historyItem) {
                 await updateExamQuestionsOnly(historyItem.id, fileQuestions);
             } else {
                 const filePages = rawPages.filter((p: any) => p.fileName === fileName);
                 await saveExamResult(fileName, filePages, fileQuestions);
             }
         }));

         setLegacySyncFiles(new Set()); 
         setDetailedStatus("Sync complete!");
         addNotification(null, "success", "All images saved to database for future instant loading.");
         
         await refreshHistoryList(); // Refresh list after syncing
         
         setTimeout(() => {
             if (state.status === ProcessingStatus.COMPLETED) setDetailedStatus("");
         }, 3000);

     } catch (e: any) {
         console.error(e);
         setError("Failed to sync legacy data: " + e.message);
     } finally {
         setIsSyncingLegacy(false);
     }
  };

  return { handleCleanupAllHistory, handleLoadHistory, handleBatchLoadHistory, handleSyncLegacyData, handleBatchReprocessHistory, refreshHistoryList };
};
