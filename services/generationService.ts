
import { DebugPageData, QuestionImage, DetectedQuestion } from "../types";
import { CropSettings, constructQuestionCanvas, mergeCanvasesVertical, analyzeCanvasContent, generateAlignedImage } from "./pdfService";

export const normalizeBoxes = (boxes2d: any): [number, number, number, number][] => {
  if (Array.isArray(boxes2d[0])) {
    return boxes2d as [number, number, number, number][];
  }
  return [boxes2d] as [number, number, number, number][];
};

export const formatTime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// Helper for parallel processing with concurrency control
export const pMap = async <T, R>(
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

/**
 * Generates processed questions from raw debug data with PIPELINED Processing.
 */
export const generateQuestionsFromRawPages = async (
  pages: DebugPageData[], 
  settings: CropSettings, 
  signal: AbortSignal,
  onProgress?: () => void
): Promise<QuestionImage[]> => {
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

  const FILE_CONCURRENCY = 4;
  const fileList = Array.from(tasksByFile.entries());

  // Process files in parallel batches
  const fileResults = await pMap(fileList, async ([fileId, fileTasks]) => {
      if (signal.aborted) return [];

      // --- SUB-PIPELINE FOR SINGLE FILE ---

      // 1. Parallel Crop (Construct Canvas) for items in THIS file
      const cropResults = await Promise.all(fileTasks.map(async (task) => {
          const boxes = normalizeBoxes(task.detection.boxes_2d);
          const result = await constructQuestionCanvas(
              task.pageObj.dataUrl,
              boxes,
              task.pageObj.width,
              task.pageObj.height,
              settings
          );
          
          if (onProgress) onProgress();
          
          return { ...result, task };
      }));

      // 2. Sequential Merging (Sort & Merge)
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
               const merged = mergeCanvasesVertical(lastQ.canvas, item.canvas, -settings.mergeOverlap);
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
      let maxFileWidth = 0;
      const analyzedTasks = fileExportTasks.map(item => {
           const trim = analyzeCanvasContent(item.canvas);
           if (trim.w > maxFileWidth) maxFileWidth = trim.w;
           return { ...item, trim };
      });

      const finalImages = await Promise.all(analyzedTasks.map(async (q) => {
          const finalDataUrl = await generateAlignedImage(q.canvas, q.trim, maxFileWidth, settings);
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
