
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

interface LogicalQuestion {
  id: string;
  fileId: string;
  parts: {
    pageObj: DebugPageData;
    detection: DetectedQuestion;
    indexInFile: number;
  }[];
}

/**
 * Generates processed questions from raw debug data with ITEM-LEVEL Concurrency.
 */
export const generateQuestionsFromRawPages = async (
  pages: DebugPageData[], 
  settings: CropSettings, 
  signal: AbortSignal,
  callbacks?: {
    onProgress?: () => void;
    onResult?: (image: QuestionImage) => void;
  },
  concurrency: number = 3
): Promise<QuestionImage[]> => {
  
  // 1. Group by file to handle continuations order correctly
  const files = new Map<string, DebugPageData[]>();
  pages.forEach(p => {
    if (!files.has(p.fileName)) files.set(p.fileName, []);
    files.get(p.fileName)!.push(p);
  });

  const logicalQuestions: LogicalQuestion[] = [];

  for (const [fileId, filePages] of files) {
      // Sort pages
      filePages.sort((a,b) => a.pageNumber - b.pageNumber);
      
      let currentQ: LogicalQuestion | null = null;

      for (const page of filePages) {
          for (const [idx, det] of page.detections.entries()) {
               if (det.id === 'continuation') {
                   if (currentQ) {
                       currentQ.parts.push({ pageObj: page, detection: det, indexInFile: idx });
                   } else {
                       // Orphan continuation: Treat as separate or skip.
                       // Creating separate to ensure visibility.
                       currentQ = {
                           id: `cont_${page.pageNumber}_${idx}`,
                           fileId,
                           parts: [{ pageObj: page, detection: det, indexInFile: idx }]
                       };
                       logicalQuestions.push(currentQ);
                   }
               } else {
                   currentQ = {
                       id: det.id,
                       fileId,
                       parts: [{ pageObj: page, detection: det, indexInFile: idx }]
                   };
                   logicalQuestions.push(currentQ);
               }
          }
      }
  }

  if (logicalQuestions.length === 0) return [];

  // 2. Process Logical Questions in Parallel
  const results = await pMap(logicalQuestions, async (task, i) => {
     if (signal.aborted) return null;
     
     console.log(`[Start Task] Processing Question ${task.id} from ${task.fileId}`);

     try {
         // A. Crop Parts
         const partsCanvas = [];
         for (const part of task.parts) {
             const boxes = normalizeBoxes(part.detection.boxes_2d);
             const res = await constructQuestionCanvas(
                 part.pageObj.dataUrl,
                 boxes,
                 part.pageObj.width,
                 part.pageObj.height,
                 settings
             );
             if (res.canvas) partsCanvas.push({ canvas: res.canvas, originalDataUrl: res.originalDataUrl });
         }

         if (partsCanvas.length === 0) {
            console.log(`[End Task] Processing Question ${task.id} - No content`);
            return null;
         }

         // B. Merge (Sequential Vertical)
         let finalCanvas = partsCanvas[0].canvas;
         // Use first part's original as the "main" reference for Before/After view
         const originalDataUrl = partsCanvas[0].originalDataUrl;

         for (let k = 1; k < partsCanvas.length; k++) {
             const next = partsCanvas[k];
             const merged = mergeCanvasesVertical(finalCanvas, next.canvas, -settings.mergeOverlap);
             finalCanvas = merged.canvas;
         }

         // C. Export
         // Note: We use intrinsic trim width to allow independent parallel processing 
         // without waiting for full-file analysis.
         const trim = analyzeCanvasContent(finalCanvas);
         const finalDataUrl = await generateAlignedImage(finalCanvas, trim, trim.w, settings);
         
         const qImage: QuestionImage = {
             id: task.id,
             pageNumber: task.parts[0].pageObj.pageNumber,
             fileName: task.fileId,
             dataUrl: finalDataUrl,
             originalDataUrl: originalDataUrl
         };

         // Real-time updates
         if (callbacks?.onResult) callbacks.onResult(qImage);
         if (callbacks?.onProgress) callbacks.onProgress();

         console.log(`[End Task] Processing Question ${task.id} from ${task.fileId}`);
         
         // Help GC
         if ('width' in finalCanvas) { finalCanvas.width = 0; finalCanvas.height = 0; }

         return qImage;

     } catch (e) {
         console.error(`Error processing question ${task.id}`, e);
         console.log(`[End Task] Processing Question ${task.id} - Failed`);
         return null;
     }

  }, concurrency, signal);

  return results.filter((r): r is QuestionImage => r !== null);
};
