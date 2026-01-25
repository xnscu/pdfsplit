import { CropSettings } from "../services/pdfService";
import { DetectedQuestion, DebugPageData, QuestionImage } from "../types";
import {
  generateQuestionsFromRawPages,
  createLogicalQuestions,
  processLogicalQuestion,
  globalWorkerPool,
} from "../services/generationService";
import { detectQuestionsOnPage } from "../services/geminiService";
import {
  reSaveExamResultWithSync,
  updatePageDetectionsAndQuestionsWithSync,
} from "../services/syncService";

interface RefinementProps {
  state: any;
  setters: any;
  actions: any;
  refreshHistoryList: () => Promise<void>;
}

export const useRefinementActions = ({
  state,
  setters,
  actions,
  refreshHistoryList,
}: RefinementProps) => {
  const {
    rawPages,
    concurrency,
    selectedModel,
    cropSettings,
    batchSize,
    apiKey,
    questions,
  } = state;
  const { setQuestions, setRawPages, setProcessingFiles, setCroppingDone } =
    setters;
  const { addNotification } = actions;

  // Helper to preserve analysis data across regenerations
  const mergeExistingAnalysis = (newQuestions: any[], fileName: string) => {
    const existingFileQuestions = questions.filter(
      (q: any) => q.fileName === fileName,
    );
    const analysisMap = new Map();
    existingFileQuestions.forEach((q: any) => {
      if (q.analysis) analysisMap.set(q.id, q.analysis);
    });

    newQuestions.forEach((q: any) => {
      if (analysisMap.has(q.id)) {
        q.analysis = analysisMap.get(q.id);
      }
    });
    return newQuestions;
  };

  const handleRecropFile = async (
    fileName: string,
    specificSettings: CropSettings,
  ) => {
    const startTimeLocal = Date.now();
    const targetPages = rawPages.filter((p: any) => p.fileName === fileName);
    if (targetPages.length === 0) return;

    const taskController = new AbortController();

    setProcessingFiles((prev: any) => new Set(prev).add(fileName));
    setters.setRefiningFile(null);

    try {
      let newQuestions = await generateQuestionsFromRawPages(
        targetPages,
        specificSettings,
        taskController.signal,
        {
          onProgress: () => setCroppingDone((p: number) => p + 1),
        },
        batchSize || 10,
      );

      if (!taskController.signal.aborted) {
        newQuestions = mergeExistingAnalysis(newQuestions, fileName);

        setQuestions((prev: any) => {
          const others = prev.filter((q: any) => q.fileName !== fileName);
          const combined = [...others, ...newQuestions];
          return combined.sort((a: any, b: any) => {
            if (a.fileName !== b.fileName)
              return a.fileName.localeCompare(b.fileName);
            if (a.pageNumber !== b.pageNumber)
              return a.pageNumber - b.pageNumber;
            return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
          });
        });

        await reSaveExamResultWithSync(fileName, targetPages, newQuestions);
        await refreshHistoryList();
        const duration = ((Date.now() - startTimeLocal) / 1000).toFixed(1);
        addNotification(
          fileName,
          "success",
          `Refined ${fileName} in ${duration}s`,
        );
      }
    } catch (e: any) {
      console.error(e);
      addNotification(
        fileName,
        "error",
        `Failed to refine ${fileName}: ${e.message}`,
      );
    } finally {
      setProcessingFiles((prev: any) => {
        const next = new Set(prev);
        next.delete(fileName);
        return next;
      });
    }
  };

  const executeReanalysis = async (fileName: string) => {
    const startTimeLocal = Date.now();
    const filePages = rawPages
      .filter((p: any) => p.fileName === fileName)
      .sort((a: any, b: any) => a.pageNumber - b.pageNumber);
    if (filePages.length === 0) return;

    const taskController = new AbortController();
    const signal = taskController.signal;

    setProcessingFiles((prev: any) => new Set(prev).add(fileName));

    try {
      const updatedRawPages = [...rawPages];

      const chunks = [];
      for (let i = 0; i < filePages.length; i += concurrency) {
        chunks.push(filePages.slice(i, i + concurrency));
      }

      const newResults: DebugPageData[] = [];

      for (const chunk of chunks) {
        if (signal.aborted) break;

        await Promise.all(
          chunk.map(async (page: DebugPageData) => {
            const detections = await detectQuestionsOnPage(
              page.dataUrl,
              selectedModel,
              undefined,
              apiKey,
            );
            const newPage = { ...page, detections };
            newResults.push(newPage);
          }),
        );
      }

      if (signal.aborted) return;

      const mergedRawPages = updatedRawPages.map((p) => {
        const match = newResults.find(
          (n) => n.fileName === p.fileName && n.pageNumber === p.pageNumber,
        );
        return match ? match : p;
      });

      setRawPages(mergedRawPages);

      const finalFilePages = mergedRawPages.filter(
        (p) => p.fileName === fileName,
      );

      let newQuestions = await generateQuestionsFromRawPages(
        finalFilePages,
        cropSettings,
        signal,
        {
          onProgress: () => setCroppingDone((p: number) => p + 1),
        },
        batchSize || 10,
      );

      if (!signal.aborted) {
        newQuestions = mergeExistingAnalysis(newQuestions, fileName);

        setQuestions((prev: any) => {
          const others = prev.filter((q: any) => q.fileName !== fileName);
          const combined = [...others, ...newQuestions];
          return combined.sort((a: any, b: any) => {
            if (a.fileName !== b.fileName)
              return a.fileName.localeCompare(b.fileName);
            if (a.pageNumber !== b.pageNumber)
              return a.pageNumber - b.pageNumber;
            return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
          });
        });

        await reSaveExamResultWithSync(fileName, finalFilePages, newQuestions);
        await refreshHistoryList();
        const duration = ((Date.now() - startTimeLocal) / 1000).toFixed(1);
        addNotification(
          fileName,
          "success",
          `Re-scan complete for ${fileName} in ${duration}s`,
        );
      }
    } catch (error: any) {
      console.error(error);
      addNotification(
        fileName,
        "error",
        `Re-analysis failed for ${fileName}: ${error.message}`,
      );
    } finally {
      setProcessingFiles((prev: any) => {
        const next = new Set(prev);
        next.delete(fileName);
        return next;
      });
    }
  };

  /**
   * Precise regeneration: only regenerate questions affected by detection changes
   * This significantly reduces the number of images uploaded to R2
   */
  const handleUpdateDetections = async (
    fileName: string,
    pageNumber: number,
    newDetections: DetectedQuestion[],
  ) => {
    const startTimeLocal = Date.now();

    // Find the old page to compare detections
    const oldPage = rawPages.find(
      (p: DebugPageData) => p.fileName === fileName && p.pageNumber === pageNumber,
    );
    const oldDetections = oldPage?.detections || [];

    // Find which detection IDs were modified by comparing old vs new
    const affectedDetectionIds = new Set<string>();
    
    newDetections.forEach((newDet, idx) => {
      const oldDet = oldDetections[idx];
      if (!oldDet) {
        // New detection added
        affectedDetectionIds.add(newDet.id);
        return;
      }

      // Compare boxes_2d
      const newBoxes = JSON.stringify(newDet.boxes_2d);
      const oldBoxes = JSON.stringify(oldDet.boxes_2d);
      if (newBoxes !== oldBoxes) {
        affectedDetectionIds.add(newDet.id);
        // Also mark continuations that follow this detection as affected
        // (because they might be stitched together)
      }
    });

    // Handle continuations: if a detection is affected, its following continuations are also affected
    let lastAffected = false;
    newDetections.forEach((det) => {
      if (affectedDetectionIds.has(det.id)) {
        lastAffected = true;
      } else if (det.id === "continuation" && lastAffected) {
        affectedDetectionIds.add(`continuation_affected_${det.id}_${Math.random()}`);
        // We need to mark the parent question as affected instead
      } else {
        lastAffected = false;
      }
    });

    console.log(`[Refinement] Affected detection IDs on page ${pageNumber}:`, [...affectedDetectionIds]);

    // Update rawPages with new detections
    const updatedPages = rawPages.map((p: DebugPageData) => {
      if (p.fileName === fileName && p.pageNumber === pageNumber) {
        return { ...p, detections: newDetections };
      }
      return p;
    });

    setRawPages(updatedPages);
    setProcessingFiles((prev: any) => new Set(prev).add(fileName));

    try {
      const targetPages = updatedPages.filter(
        (p: DebugPageData) => p.fileName === fileName,
      );
      if (targetPages.length === 0) {
        setProcessingFiles((prev: any) => {
          const n = new Set(prev);
          n.delete(fileName);
          return n;
        });
        return;
      }

      // Get existing questions for this file (to preserve unchanged ones)
      const existingFileQuestions = questions.filter(
        (q: QuestionImage) => q.fileName === fileName,
      ) as QuestionImage[];

      // Build a map of detection ID -> existing question (for hash preservation)
      const existingQuestionMap = new Map<string, QuestionImage>();
      existingFileQuestions.forEach((q: QuestionImage) => {
        existingQuestionMap.set(q.id, q);
      });

      // Create logical questions from the updated pages
      const logicalQuestions = createLogicalQuestions(targetPages);

      // Calculate max widths for alignment (same logic as generateQuestionsFromRawPages)
      const pageMaxWidths = new Map<string, number>();
      for (const page of targetPages) {
        let maxW = 0;
        for (const det of page.detections) {
          const boxes = Array.isArray(det.boxes_2d[0])
            ? det.boxes_2d
            : [det.boxes_2d];
          for (const box of boxes) {
            const w = (((box as number[])[3] - (box as number[])[1]) / 1000) * page.width;
            if (w > maxW) maxW = w;
          }
        }
        const key = `${page.fileName}#${page.pageNumber}`;
        pageMaxWidths.set(key, Math.ceil(maxW));
      }

      // Process only affected questions, keep others unchanged
      globalWorkerPool.concurrency = batchSize || 10;
      const newQuestions: QuestionImage[] = [];

      for (const task of logicalQuestions) {
        // Check if any part of this logical question was affected
        const isAffected = task.parts.some((part) => {
          // Check if this detection was on the modified page and was affected
          if (part.pageObj.pageNumber === pageNumber) {
            return affectedDetectionIds.has(part.detection.id);
          }
          return false;
        });

        if (isAffected) {
          // Regenerate this question
          const pObj = task.parts[0].pageObj;
          const key = `${pObj.fileName}#${pObj.pageNumber}`;
          const targetWidth = pageMaxWidths.get(key) || 0;

          console.log(`[Refinement] Regenerating question: ${task.id}`);
          const regenerated = await processLogicalQuestion(task, cropSettings, targetWidth);
          
          if (regenerated) {
            // Preserve existing analysis if any
            const existingQ = existingQuestionMap.get(task.id);
            if (existingQ?.analysis) {
              regenerated.analysis = existingQ.analysis;
            }
            newQuestions.push(regenerated);
          }
        } else {
          // Keep existing question unchanged (preserves hash reference)
          const existingQ = existingQuestionMap.get(task.id);
          if (existingQ) {
            console.log(`[Refinement] Keeping unchanged question: ${task.id}`);
            newQuestions.push(existingQ);
          } else {
            // Question didn't exist before, generate it
            const pObj = task.parts[0].pageObj;
            const key = `${pObj.fileName}#${pObj.pageNumber}`;
            const targetWidth = pageMaxWidths.get(key) || 0;

            console.log(`[Refinement] Generating new question: ${task.id}`);
            const generated = await processLogicalQuestion(task, cropSettings, targetWidth);
            if (generated) {
              newQuestions.push(generated);
            }
          }
        }
      }

      // Sort questions
      newQuestions.sort((a, b) => {
        if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
        return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
      });

      console.log(`[Refinement] Total questions: ${newQuestions.length}, affected: ${affectedDetectionIds.size}`);

      await updatePageDetectionsAndQuestionsWithSync(
        fileName,
        pageNumber,
        newDetections,
        newQuestions,
      );

      setQuestions((prev: any) => {
        const others = prev.filter((q: any) => q.fileName !== fileName);
        const combined = [...others, ...newQuestions];
        return combined.sort((a: any, b: any) => {
          if (a.fileName !== b.fileName)
            return a.fileName.localeCompare(b.fileName);
          if (a.pageNumber !== b.pageNumber)
            return a.pageNumber - b.pageNumber;
          return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
        });
      });

      const affectedCount = [...affectedDetectionIds].filter(id => !id.startsWith('continuation_affected_')).length;
      const duration = ((Date.now() - startTimeLocal) / 1000).toFixed(1);
      console.log(`[Refinement] Completed in ${duration}s, regenerated ${affectedCount} questions`);
    } catch (err: any) {
      console.error("Failed to save or recrop", err);
      addNotification(
        fileName,
        "error",
        `Failed to save changes: ${err.message}`,
      );
    } finally {
      setProcessingFiles((prev: any) => {
        const next = new Set(prev);
        next.delete(fileName);
        return next;
      });
    }
  };

  return { handleRecropFile, executeReanalysis, handleUpdateDetections };
};
