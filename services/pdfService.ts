
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import { getTrimmedBounds, isContained } from '../shared/canvas-utils.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

export interface CropSettings {
  cropPadding: number;
  canvasPaddingLeft: number;
  canvasPaddingRight: number;
  canvasPaddingY: number;
  mergeOverlap: number;
}

/**
 * 助手函数：创建一个 Canvas，如果支持则优先使用 OffscreenCanvas
 */
const createSmartCanvas = (width: number, height: number): { canvas: HTMLCanvasElement | OffscreenCanvas, context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } => {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));

  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(safeWidth, safeHeight);
      const context = canvas.getContext('2d');
      if (!context) throw new Error("OffscreenCanvas context failed");
      return { canvas, context: context as OffscreenCanvasRenderingContext2D };
    } catch (e) {
      // Fallback to DOM canvas if OffscreenCanvas fails (e.g. invalid size or OOM)
    }
  } 
  
  const canvas = document.createElement('canvas');
  canvas.width = safeWidth;
  canvas.height = safeHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error("Canvas context failed");
  return { canvas, context };
};

export const renderPageToImage = async (page: any, scale: number = 3): Promise<{ dataUrl: string, width: number, height: number }> => {
  const viewport = page.getViewport({ scale });
  
  // PDF.js 渲染目前仍需 DOM Canvas，但我们通过立即转换 DataURL 来减少对 UI 帧的依赖
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  
  if (!context) throw new Error("Canvas context failed");
  
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({
    canvasContext: context,
    viewport: viewport
  }).promise;

  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const w = canvas.width;
  const h = canvas.height;
  
  // 清理临时 Canvas
  canvas.width = 0;
  canvas.height = 0;

  return { dataUrl, width: w, height: h };
};

/**
 * Creates a lower resolution copy for faster AI processing.
 */
export const createLowResCopy = async (base64: string, scaleFactor: number = 0.5): Promise<{ dataUrl: string, width: number, height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.floor(img.width * scaleFactor);
      const h = Math.floor(img.height * scaleFactor);
      const { canvas, context: ctx } = createSmartCanvas(w, h);
      
      ctx.drawImage(img, 0, 0, w, h);
      
      const result = {
        dataUrl: (canvas as HTMLCanvasElement).toDataURL ? (canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.8) : '', // Fallback for pure Offscreen
        width: w,
        height: h
      };
      
      // Handle OffscreenCanvas blob conversion if needed
      if (!result.dataUrl && 'convertToBlob' in canvas) {
        (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.8 }).then(blob => {
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve({ dataUrl: reader.result as string, width: w, height: h });
          };
          reader.readAsDataURL(blob);
        });
      } else {
        resolve(result);
      }
    };
    img.onerror = reject;
    img.src = base64;
  });
};

export const mergePdfPagesToSingleImage = async (
  pdf: any, 
  totalPages: number, 
  scale: number = 2.5,
  onProgress?: (current: number, total: number) => void
): Promise<{ dataUrl: string, width: number, height: number }> => {
  
  const pageImages: { img: HTMLImageElement, width: number, height: number }[] = [];
  let totalHeight = 0;
  let maxWidth = 0;

  for (let i = 1; i <= totalPages; i++) {
    if (onProgress) onProgress(i, totalPages);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      await page.render({ canvasContext: ctx, viewport }).promise;
      const img = new Image();
      img.src = canvas.toDataURL('image/jpeg', 0.85);
      await new Promise(r => img.onload = r);
      
      pageImages.push({ img, width: viewport.width, height: viewport.height });
      totalHeight += viewport.height;
      maxWidth = Math.max(maxWidth, viewport.width);
      
      canvas.width = 0; canvas.height = 0; // Release memory
    }
  }

  const { canvas, context: ctx } = createSmartCanvas(maxWidth, totalHeight);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, maxWidth, totalHeight);

  let currentY = 0;
  for (const p of pageImages) {
    const x = (maxWidth - p.width) / 2;
    ctx.drawImage(p.img, x, currentY);
    currentY += p.height;
  }

  if ('toDataURL' in canvas) {
    return {
      dataUrl: (canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.85),
      width: maxWidth,
      height: totalHeight
    };
  } else {
    const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve({ dataUrl: reader.result as string, width: maxWidth, height: totalHeight });
      reader.readAsDataURL(blob);
    });
  }
};

/**
 * Merges two base64 images vertically with an optional gap.
 * A negative gap allows for overlapping (removing internal paddings).
 */
export const mergeBase64Images = async (topBase64: string, bottomBase64: string, gap: number = 0): Promise<string> => {
  const loadImg = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  };

  const [imgTop, imgBottom] = await Promise.all([loadImg(topBase64), loadImg(bottomBase64)]);
  const width = Math.max(imgTop.width, imgBottom.width);
  // Calculate final height including the gap/overlap
  const height = Math.max(0, imgTop.height + imgBottom.height + gap);

  const { canvas, context: ctx } = createSmartCanvas(width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  
  // Draw top image
  ctx.drawImage(imgTop, (width - imgTop.width) / 2, 0);
  
  // Draw bottom image starting after the top image plus the gap
  ctx.drawImage(imgBottom, (width - imgBottom.width) / 2, imgTop.height + gap);

  if ('toDataURL' in canvas) {
    return (canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.95);
  } else {
    const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }
};

export const cropAndStitchImage = (
  sourceDataUrl: string, 
  boxes: [number, number, number, number][],
  originalWidth: number, 
  originalHeight: number,
  settings: CropSettings,
  onStatus?: (msg: string) => void
): Promise<{ final: string, original?: string }> => {
  return new Promise((resolve) => {
    if (!boxes || boxes.length === 0) {
      resolve({ final: '' });
      return;
    }

    const indicesToDrop = new Set<number>();
    for (let i = 0; i < boxes.length; i++) {
      for (let j = 0; j < boxes.length; j++) {
        if (i === j) continue;
        if (isContained(boxes[i], boxes[j])) {
           if (isContained(boxes[j], boxes[i]) && i > j) {
              indicesToDrop.add(i);
              break;
           } else if (!isContained(boxes[j], boxes[i])) {
              indicesToDrop.add(i);
              break;
           }
        }
      }
    }

    const finalBoxes = boxes.filter((_, i) => !indicesToDrop.has(i));
    const img = new Image();
    img.onload = async () => {
      const CROP_PADDING = settings.cropPadding; 
      const CANVAS_PADDING_LEFT = settings.canvasPaddingLeft;
      const CANVAS_PADDING_RIGHT = settings.canvasPaddingRight;
      const CANVAS_PADDING_Y = settings.canvasPaddingY;

      const processedFragments = finalBoxes.map((box, idx) => {
        const [ymin, xmin, ymax, xmax] = box;
        const x = Math.max(0, (xmin / 1000) * originalWidth - CROP_PADDING);
        const y = Math.max(0, (ymin / 1000) * originalHeight - CROP_PADDING);
        const rawW = ((xmax - xmin) / 1000) * originalWidth + (CROP_PADDING * 2);
        const rawH = ((ymax - ymin) / 1000) * originalHeight + (CROP_PADDING * 2);
        const w = Math.min(originalWidth - x, rawW);
        const h = Math.min(originalHeight - y, rawH);

        // Safety check: skip invalid or empty dimensions to prevent OffscreenCanvas constructor errors
        if (w < 1 || h < 1) return null;

        const { canvas: tempCanvas, context: tempCtx } = createSmartCanvas(Math.floor(w), Math.floor(h));
        tempCtx.drawImage(img, x, y, w, h, 0, 0, w, h);

        if (onStatus) onStatus(`Refining ${idx + 1}/${finalBoxes.length}...`);
        const trim = getTrimmedBounds(tempCtx, Math.floor(w), Math.floor(h), onStatus);

        return {
          sourceCanvas: tempCanvas,
          trim: trim,
          absInkX: x + trim.x 
        };
      }).filter((item) => item !== null);

      if (processedFragments.length === 0) {
        resolve({ final: '' });
        return;
      }

      const minAbsInkX = Math.min(...processedFragments.map(f => f!.absInkX));
      const maxRightEdge = Math.max(...processedFragments.map(f => (f!.absInkX - minAbsInkX) + f!.trim.w));
      const finalWidth = maxRightEdge + CANVAS_PADDING_LEFT + CANVAS_PADDING_RIGHT;
      const fragmentGap = 10; 
      const totalContentHeight = processedFragments.reduce((acc, f) => acc + f!.trim.h, 0) + (fragmentGap * (Math.max(0, processedFragments.length - 1)));
      const finalHeight = totalContentHeight + (CANVAS_PADDING_Y * 2);

      const { canvas, context: ctx } = createSmartCanvas(finalWidth, finalHeight);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, finalWidth, finalHeight);

      let currentY = CANVAS_PADDING_Y;
      processedFragments.forEach((f) => {
        if (!f) return;
        const relativeOffset = f.absInkX - minAbsInkX;
        const offsetX = CANVAS_PADDING_LEFT + relativeOffset;
        ctx.drawImage(
          f.sourceCanvas as any, 
          f.trim.x, f.trim.y, f.trim.w, f.trim.h,
          offsetX, currentY, f.trim.w, f.trim.h
        );
        currentY += f.trim.h + fragmentGap;
      });

      let finalDataUrl = '';
      if ('toDataURL' in canvas) {
        finalDataUrl = (canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.95);
      } else {
        const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.95 });
        finalDataUrl = await new Promise(r => {
          const reader = new FileReader();
          reader.onloadend = () => r(reader.result as string);
          reader.readAsDataURL(blob);
        });
      }

      const wasTrimmed = processedFragments.some(f => 
        f && (f.trim.w < (f.sourceCanvas as any).width || f.trim.h < (f.sourceCanvas as any).height)
      );

      let originalDataUrl: string | undefined;
      if (wasTrimmed) {
         const maxRawWidth = Math.max(...processedFragments.map(f => f ? (f.sourceCanvas as any).width : 0));
         const finalRawWidth = maxRawWidth + CANVAS_PADDING_LEFT + CANVAS_PADDING_RIGHT;
         const totalRawHeight = processedFragments.reduce((acc, f) => acc + (f ? (f.sourceCanvas as any).height : 0), 0) + (fragmentGap * (Math.max(0, processedFragments.length - 1)));
         const finalRawHeight = totalRawHeight + (CANVAS_PADDING_Y * 2);

         const { canvas: rawCanvas, context: rawCtx } = createSmartCanvas(finalRawWidth, finalRawHeight);
         rawCtx.fillStyle = '#ffffff';
         rawCtx.fillRect(0, 0, finalRawWidth, finalRawHeight);
         
         let currentRawY = CANVAS_PADDING_Y;
         processedFragments.forEach(f => {
             if (f) {
                rawCtx.drawImage(f.sourceCanvas as any, CANVAS_PADDING_LEFT, currentRawY);
                currentRawY += (f.sourceCanvas as any).height + fragmentGap;
             }
         });

         if ('toDataURL' in rawCanvas) {
           originalDataUrl = (rawCanvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.95);
         } else {
           const blob = await (rawCanvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.95 });
           originalDataUrl = await new Promise(r => {
             const reader = new FileReader();
             reader.onloadend = () => r(reader.result as string);
             reader.readAsDataURL(blob);
           });
         }
      }

      resolve({ final: finalDataUrl, original: originalDataUrl });
    };
    img.src = sourceDataUrl;
  });
};