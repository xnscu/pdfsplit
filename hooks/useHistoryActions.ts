import { ProcessingStatus, DebugPageData, QuestionImage } from "../types";
import {
  loadExamResult,
  getHistoryList,
  saveExamResult,
  updateExamQuestionsOnly,
  cleanupAllHistory,
  reSaveExamResult,
  deleteExamResult,
  deleteExamResults,
} from "../services/storageService";
import {
  generateQuestionsFromRawPages,
  pMap,
  createLogicalQuestions,
  processLogicalQuestion,
} from "../services/generationService";

interface HistoryProps {
  state: any;
  setters: any;
  refs: any;
  actions: any;
}

export const useHistoryActions = ({ state, setters, refs, actions }: HistoryProps) => {
  const { batchSize, cropSettings, legacySyncFiles, questions, rawPages, concurrency } = state;
  const {
    setStatus,
    setDetailedStatus,
    setError,
    setQuestions,
    setRawPages,
    setSourcePages,
    setTotal,
    setCompletedCount,
    setCroppingTotal,
    setCroppingDone,
    setLegacySyncFiles,
    setIsSyncingLegacy,
    setStartTime,
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
        if (state.status === ProcessingStatus.IDLE) setDetailedStatus("");
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

    const workerConcurrency = batchSize || 5;

    let totalFilesProcessed = 0;
    let totalChangedImages = 0;
    const totalFiles = ids.length;

    setTotal(totalFiles);
    setCompletedCount(0);

    try {
      for (let i = 0; i < totalFiles; i++) {
        const id = ids[i];

        // 1. Load Data for just THIS file
        const record = await loadExamResult(id);

        if (!record || !record.rawPages || record.rawPages.length === 0) {
          setCompletedCount(i + 1);
          continue;
        }

        const fileName = record.name;
        setDetailedStatus(fileName);

        // 2. Process
        const generatedQuestions = await generateQuestionsFromRawPages(
          record.rawPages,
          cropSettings,
          new AbortController().signal, // Isolated signal for batch task
          undefined,
          workerConcurrency,
        );

        // 3. Update Active State if this file is currently loaded
        const isFileLoaded = rawPages.some((p: any) => p.fileName === fileName);

        if (isFileLoaded) {
          setQuestions((prev: QuestionImage[]) => {
            const others = prev.filter((q) => q.fileName !== fileName);
            const combined = [...others, ...generatedQuestions];
            return combined.sort((a, b) => {
              if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
              if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
              return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
            });
          });
        }

        // 4. Stats & Save
        const oldUrls = new Set((record.questions || []).map((q) => q.dataUrl));
        let fileChangedCount = 0;
        generatedQuestions.forEach((q) => {
          if (!oldUrls.has(q.dataUrl)) fileChangedCount++;
        });

        totalChangedImages += fileChangedCount;
        totalFilesProcessed++;

        await reSaveExamResult(fileName, record.rawPages, generatedQuestions);

        setCompletedCount(i + 1);

        // 5. Force GC Opportunity / UI Refresh
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const duration = ((Date.now() - startTimeLocal) / 1000).toFixed(1);
      addNotification(
        null,
        "success",
        `Batch complete: ${totalFilesProcessed} files processed in ${duration}s. ${totalChangedImages} images updated.`,
      );
      await refreshHistoryList();
    } catch (e: any) {
      console.error(e);
      addNotification(null, "error", `Batch process failed: ${e.message}`);
    } finally {
      setters.setIsLoadingHistory(false);
      setDetailedStatus("");
      setTotal(0);
      setCompletedCount(0);
    }
  };

  const handleLoadHistory = async (id: string) => {
    resetState();
    setters.setShowHistory(false);
    setters.setIsLoadingHistory(true);
    const startTimeLocal = Date.now();
    setStartTime(startTimeLocal);
    setStatus(ProcessingStatus.LOADING_PDF);
    setDetailedStatus("Restoring from history...");

    try {
      const result = await loadExamResult(id);
      if (!result) throw new Error("History record not found.");

      const uniquePages = Array.from(
        new Map(result.rawPages.map((p: any) => [p.pageNumber, p])).values(),
      ) as DebugPageData[];
      uniquePages.sort((a, b) => a.pageNumber - b.pageNumber);

      setRawPages(uniquePages);

      const recoveredSourcePages = uniquePages.map((rp) => ({
        dataUrl: rp.dataUrl,
        width: rp.width,
        height: rp.height,
        pageNumber: rp.pageNumber,
        fileName: rp.fileName,
      }));
      setSourcePages(recoveredSourcePages);

      if (result.questions && result.questions.length > 0) {
        setQuestions(result.questions);
        setCompletedCount(uniquePages.length);
        setTotal(uniquePages.length);
        setStatus(ProcessingStatus.IDLE);
        const duration = ((Date.now() - startTimeLocal) / 1000).toFixed(1);
        addNotification(result.name, "success", `Loaded in ${duration}s`);
      } else {
        setStatus(ProcessingStatus.CROPPING);
        setDetailedStatus("Generating questions from raw data...");

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
            onProgress: () => setCroppingDone((p: number) => p + 1),
          },
          batchSize || 10,
        );

        setQuestions(generatedQuestions);
        const duration = ((Date.now() - startTimeLocal) / 1000).toFixed(1);
        addNotification(result.name, "success", `Loaded and cropped in ${duration}s`);
        setStatus(ProcessingStatus.IDLE);
        setLegacySyncFiles(new Set([result.name]));
      }

      // Auto-navigate to this file
      setters.setDebugFile(result.name);
      setters.setLastViewedFile(result.name);
    } catch (e: any) {
      setError("Failed to load history: " + e.message);
      setStatus(ProcessingStatus.ERROR);
    } finally {
      setters.setIsLoadingHistory(false);
    }
  };

  const handleBatchLoadHistory = async (ids: string[]) => {
    // Safety check for large batches
    if (ids.length > 50) {
      const confirm = window.confirm(
        `Warning: Loading ${ids.length} files into the viewer may cause performance issues or crash the browser. Do you want to proceed?`,
      );
      if (!confirm) return;
    }

    resetState();
    setters.setShowHistory(false);
    setters.setIsLoadingHistory(true);
    const startTimeLocal = Date.now();
    setStartTime(startTimeLocal);
    setStatus(ProcessingStatus.LOADING_PDF);
    setDetailedStatus(`Queuing ${ids.length} exams...`);

    try {
      const CHUNK_SIZE = 5; // Reduced chunk size for safety
      const combinedPages: DebugPageData[] = [];
      const combinedQuestions: QuestionImage[] = [];
      const legacyFilesFound = new Set<string>();

      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        setDetailedStatus(`Loading batch ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(ids.length / CHUNK_SIZE)}`);
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        const results = await Promise.all(chunk.map((id) => loadExamResult(id)));

        results.forEach((res) => {
          if (res && res.rawPages) {
            combinedPages.push(...res.rawPages);
            if (res.questions && res.questions.length > 0) {
              combinedQuestions.push(...res.questions);
            } else {
              legacyFilesFound.add(res.name);
            }
          }
        });

        // Yield to main thread
        await new Promise((r) => setTimeout(r, 10));
      }

      if (combinedPages.length === 0) throw new Error("No valid data found.");

      const uniquePages = Array.from(new Map(combinedPages.map((p) => [`${p.fileName}#${p.pageNumber}`, p])).values());
      uniquePages.sort((a, b) => {
        if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
        return a.pageNumber - b.pageNumber;
      });

      setRawPages(uniquePages);
      setSourcePages(
        uniquePages.map((rp) => ({
          dataUrl: rp.dataUrl,
          width: rp.width,
          height: rp.height,
          pageNumber: rp.pageNumber,
          fileName: rp.fileName,
        })),
      );

      if (legacyFilesFound.size > 0) {
        setStatus(ProcessingStatus.CROPPING);
        const legacyPages = uniquePages.filter((p) => legacyFilesFound.has(p.fileName));
        setCroppingTotal(legacyPages.reduce((acc, p) => acc + p.detections.length, 0));
        setCroppingDone(0);

        abortControllerRef.current = new AbortController();
        const generatedLegacyQuestions = await generateQuestionsFromRawPages(
          legacyPages,
          cropSettings,
          abortControllerRef.current.signal,
          { onProgress: () => setCroppingDone((p: number) => p + 1) },
          batchSize || 10,
        );
        setQuestions([...combinedQuestions, ...generatedLegacyQuestions]);
        setLegacySyncFiles(legacyFilesFound);
      } else {
        setQuestions(combinedQuestions);
      }

      setTotal(uniquePages.length);
      setCompletedCount(uniquePages.length);
      const duration = ((Date.now() - startTimeLocal) / 1000).toFixed(1);
      addNotification(null, "success", `Batch loaded in ${duration}s`);

      // Auto-navigate to first file (sorted alphabetically)
      const allFiles = Array.from(new Set(uniquePages.map((p) => p.fileName)));
      if (allFiles.length > 0) {
        allFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
        setters.setDebugFile(allFiles[0]);
        setters.setLastViewedFile(allFiles[0]);
      }

      setStatus(ProcessingStatus.IDLE);
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
    const startTimeLocal = Date.now();
    try {
      const history = await getHistoryList();
      await Promise.all(
        Array.from(syncSet).map(async (fileName) => {
          const fileQuestions = questions.filter((q: any) => q.fileName === fileName);
          const historyItem = history.find((h) => h.name === fileName);
          if (historyItem) await updateExamQuestionsOnly(historyItem.id, fileQuestions);
        }),
      );
      setLegacySyncFiles(new Set());
      const duration = ((Date.now() - startTimeLocal) / 1000).toFixed(1);
      addNotification(null, "success", `Synced in ${duration}s`);
      await refreshHistoryList();
    } catch (e: any) {
      setError("Sync failed: " + e.message);
    } finally {
      setIsSyncingLegacy(false);
    }
  };

  const handleDeleteHistoryItem = async (id: string, name?: string) => {
    try {
      let fileName = name;

      // If name not provided, try to look it up
      if (!fileName) {
        const list = await getHistoryList();
        const item = list.find((h) => h.id === id);
        fileName = item?.name;
      }

      await deleteExamResult(id);

      if (fileName) {
        // Clear from active state if matches
        setQuestions((prev: QuestionImage[]) => prev.filter((q) => q.fileName !== fileName));
        setRawPages((prev: DebugPageData[]) => prev.filter((p) => p.fileName !== fileName));
        setSourcePages((prev: any[]) => prev.filter((p: any) => p.fileName !== fileName));
        setLegacySyncFiles((prev: Set<string>) => {
          const next = new Set(prev);
          next.delete(fileName);
          return next;
        });

        // If it was the debug file, clear it
        if (state.debugFile === fileName) {
          setters.setDebugFile(null);
        }

        addNotification(null, "success", "Item removed from history and workspace.");
      }

      await refreshHistoryList();
    } catch (e: any) {
      console.error("Failed to delete item", e);
      setError("Failed to delete item: " + e.message);
    }
  };

  const handleBatchDeleteHistoryItems = async (ids: string[]) => {
    try {
      // Get names before deleting
      const list = await getHistoryList();
      const filesToDelete = new Set<string>();
      ids.forEach((id) => {
        const item = list.find((h) => h.id === id);
        if (item?.name) filesToDelete.add(item.name);
      });

      await deleteExamResults(ids);

      if (filesToDelete.size > 0) {
        // Clear from active state if matches
        setQuestions((prev: QuestionImage[]) => prev.filter((q) => !filesToDelete.has(q.fileName)));
        setRawPages((prev: DebugPageData[]) => prev.filter((p) => !filesToDelete.has(p.fileName)));
        setSourcePages((prev: any[]) => prev.filter((p: any) => !filesToDelete.has(p.fileName)));
        setLegacySyncFiles((prev: Set<string>) => {
          const next = new Set(prev);
          filesToDelete.forEach((f) => next.delete(f));
          return next;
        });

        // If debug file was deleted, clear it
        if (state.debugFile && filesToDelete.has(state.debugFile)) {
          setters.setDebugFile(null);
        }

        addNotification(null, "success", `${filesToDelete.size} items removed from history and workspace.`);
      }

      await refreshHistoryList();
    } catch (e: any) {
      console.error("Failed to batch delete items", e);
      setError("Failed to batch delete: " + e.message);
    }
  };

  /**
   * Handle files that were updated during sync
   * If any of the pulled files match currently loaded files, reload their data
   */
  const handleFilesUpdated = async (pulledNames: string[]) => {
    if (pulledNames.length === 0) return;

    // Get list of currently loaded file names
    const loadedFileNames = new Set(rawPages.map((p: DebugPageData) => p.fileName));

    // Find files that were updated and are currently loaded
    const filesToReload = pulledNames.filter((name) => loadedFileNames.has(name));

    if (filesToReload.length === 0) return;

    console.log("[Sync] Reloading updated files:", filesToReload);

    try {
      // Get the history list to find IDs for the file names
      const history = await getHistoryList();

      for (const fileName of filesToReload) {
        const historyItem = history.find((h) => h.name === fileName);
        if (!historyItem) continue;

        const result = await loadExamResult(historyItem.id);
        if (!result) continue;

        // Update rawPages for this file
        setRawPages((prev: DebugPageData[]) => {
          const others = prev.filter((p) => p.fileName !== fileName);
          const uniqueNewPages = Array.from(
            new Map(result.rawPages.map((p: any) => [p.pageNumber, p])).values(),
          ) as DebugPageData[];
          uniqueNewPages.sort((a, b) => a.pageNumber - b.pageNumber);
          return [...others, ...uniqueNewPages].sort((a, b) => {
            if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
            return a.pageNumber - b.pageNumber;
          });
        });

        // Update questions for this file
        if (result.questions && result.questions.length > 0) {
          setQuestions((prev: QuestionImage[]) => {
            const others = prev.filter((q) => q.fileName !== fileName);
            return [...others, ...result.questions].sort((a, b) => {
              if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
              if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
              return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
            });
          });
        }

        // Update sourcePages for this file
        setSourcePages((prev: any[]) => {
          const others = prev.filter((p: any) => p.fileName !== fileName);
          const newSourcePages = result.rawPages.map((rp: any) => ({
            dataUrl: rp.dataUrl,
            width: rp.width,
            height: rp.height,
            pageNumber: rp.pageNumber,
            fileName: rp.fileName,
          }));
          return [...others, ...newSourcePages].sort((a: any, b: any) => {
            if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
            return a.pageNumber - b.pageNumber;
          });
        });

        addNotification(fileName, "success", "已从云端同步更新");
      }
    } catch (e: any) {
      console.error("[Sync] Failed to reload updated files:", e);
    }
  };

  return {
    handleCleanupAllHistory,
    handleLoadHistory,
    handleBatchLoadHistory,
    handleSyncLegacyData,
    handleBatchReprocessHistory,
    refreshHistoryList,
    handleDeleteHistoryItem,
    handleBatchDeleteHistoryItems,
    handleFilesUpdated,
  };
};
