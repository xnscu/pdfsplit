
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import { getTrimmedBounds, trimWhitespace, isContained } from '../shared/canvas-utils.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

export interface CropSettings {
  cropPadding: number; // Raw crop buffer (unified for X and Y)
  canvasPadding: number; // Final aesthetic padding (unified for all sides)
  mergeOverlap: number;
  debugExportPadding?: number; // Optional: Padding for the debug 'raw' image export
}

export interface TrimBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Helper: Create a Smart Canvas (Offscreen if available)
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
      // Fallback
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
  
  // Cleanup
  canvas.width = 0;
  canvas.height = 0;

  return { dataUrl, width: w, height: h };
};

/**
 * PHASE 1: Extract & Stitch (Construction)
 * Gets the question content from the page, trims FRAGMENTS (to remove inter-box gaps), 
 * and stitches them together.
 * Does NOT apply final padding or alignment.
 */
export const constructQuestionCanvas = (
  sourceDataUrl: string, 
  boxes: [number, number, number, number][],
  originalWidth: number, 
  originalHeight: number,
  settings: CropSettings,
  onStatus?: (msg: string) => void
): Promise<{ canvas: HTMLCanvasElement | OffscreenCanvas | null, width: number, height: number, originalDataUrl?: string }> => {
  return new Promise((resolve) => {
    if (!boxes || boxes.length === 0) {
      resolve({ canvas: null, width: 0, height: 0 });
      return;
    }

    // Filter nested boxes
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
      // Use unified crop padding (aligned with backend)
      const CROP_PADDING = settings.cropPadding;

      // 2. Process each fragment (Crop -> Trim)
      const processedFragments = finalBoxes.map((box, idx) => {
        const [ymin, xmin, ymax, xmax] = box;

        // Calculate raw crop coordinates
        const x = Math.max(0, (xmin / 1000) * originalWidth - CROP_PADDING);
        const y = Math.max(0, (ymin / 1000) * originalHeight - CROP_PADDING);
        const rawW = ((xmax - xmin) / 1000) * originalWidth + (CROP_PADDING * 2);
        const rawH = ((ymax - ymin) / 1000) * originalHeight + (CROP_PADDING * 2);
        const w = Math.min(originalWidth - x, rawW);
        const h = Math.min(originalHeight - y, rawH);

        if (w < 1 || h < 1) return null;

        // Draw raw crop
        const { canvas: tempCanvas, context: tempCtx } = createSmartCanvas(Math.floor(w), Math.floor(h));
        tempCtx.drawImage(img, x, y, w, h, 0, 0, w, h);

        if (onStatus) onStatus(`Refining ${idx + 1}/${finalBoxes.length}...`);

        // EDGE TRIM: Use getTrimmedBounds for edge peel algorithm (aligned with backend)
        const trim = getTrimmedBounds(tempCtx, Math.floor(w), Math.floor(h));

        return {
          sourceCanvas: tempCanvas,
          trim: trim,
          absInkX: x + trim.x, // Used for relative alignment
          rawW: w,
          rawH: h
        };
      }).filter((item) => item !== null);

      if (processedFragments.length === 0) {
        resolve({ canvas: null, width: 0, height: 0 });
        return;
      }

      // 3. Calculate Stitched Dimensions (Tight Fit)
      const minAbsInkX = Math.min(...processedFragments.map(f => f!.absInkX));
      // Max width required to hold fragments relative to leftmost ink
      const maxContentWidth = Math.max(...processedFragments.map(f => (f!.absInkX - minAbsInkX) + f!.trim.w));

      const fragmentGap = 10; // Aligned with backend 
      const totalContentHeight = processedFragments.reduce((acc, f) => acc + f!.trim.h, 0) + (fragmentGap * (Math.max(0, processedFragments.length - 1)));

      // Canvas size is exactly the content size (no padding yet)
      const { canvas, context: ctx } = createSmartCanvas(maxContentWidth, totalContentHeight);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, maxContentWidth, totalContentHeight);

      // 4. Draw Fragments (Stitched)
      let currentY = 0;
      processedFragments.forEach((f) => {
        if (!f) return;
        const relativeOffset = f.absInkX - minAbsInkX;
        
        ctx.drawImage(
          f.sourceCanvas as any, 
          f.trim.x, f.trim.y, f.trim.w, f.trim.h,
          relativeOffset, currentY, f.trim.w, f.trim.h
        );
        currentY += f.trim.h + fragmentGap;
      });

      // 5. Generate Original for debug/comparison
      // ALWAYS generate this to allow the user to see "Raw Gemini Box" vs "Processed Result"
      let originalDataUrl: string | undefined;
      
      const exportPadding = settings.debugExportPadding !== undefined ? settings.debugExportPadding : 10;

      // Re-stitch raw fragments without trim for comparison
      const maxRawWidth = Math.max(...processedFragments.map(f => f ? (f.sourceCanvas as any).width : 0));
      const finalRawWidth = maxRawWidth + (exportPadding * 2);
      const finalRawHeight = processedFragments.reduce((acc, f) => acc + (f ? (f.sourceCanvas as any).height : 0), 0) + (fragmentGap * (Math.max(0, processedFragments.length - 1))) + (exportPadding * 2);

      const { canvas: rawCanvas, context: rawCtx } = createSmartCanvas(finalRawWidth, finalRawHeight);
      rawCtx.fillStyle = '#ffffff';
      rawCtx.fillRect(0, 0, finalRawWidth, finalRawHeight);
      
      let currentRawY = exportPadding;
      processedFragments.forEach(f => {
          if (f) {
            rawCtx.drawImage(f.sourceCanvas as any, exportPadding, currentRawY);
            currentRawY += (f.sourceCanvas as any).height + fragmentGap;
          }
      });
      
      if ('toDataURL' in rawCanvas) {
          originalDataUrl = (rawCanvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.8);
      } else {
          const blob = await (rawCanvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.8 });
          originalDataUrl = await new Promise(r => {
              const reader = new FileReader();
              reader.onloadend = () => r(reader.result as string);
              reader.readAsDataURL(blob);
          });
      }

      resolve({ canvas, width: maxContentWidth, height: totalContentHeight, originalDataUrl });
    };
    img.src = sourceDataUrl;
  });
};

/**
 * Scan ONLY vertical bounds (Top and Bottom) to trim vertical whitespace.
 * Preserves X-axis/horizontal whitespace completely.
 */
const scanVerticalBounds = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number) => {
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    // Aggressive threshold matching other utilities (242)
    const threshold = 242;

    const isRowEmpty = (y: number) => {
        for(let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            // Check pixel darkness and alpha
            if (data[i+3] > 10 && (data[i] < threshold || data[i+1] < threshold || data[i+2] < threshold)) {
                return false;
            }
        }
        return true;
    };

    let top = 0;
    let bottom = h;

    while(top < h && isRowEmpty(top)) top++;
    while(bottom > top && isRowEmpty(bottom - 1)) bottom--;

    return { y: top, h: Math.max(0, bottom - top) };
};

/**
 * Merge two canvases vertically (for continuation).
 * 
 * OPTIMIZED STRATEGY: 
 * We ONLY trim vertical whitespace (top/bottom) to remove gaps between merged parts.
 * We DO NOT trim horizontal whitespace. This ensures that right-aligned content (like geometry figures 
 * in a continuation block) maintains its relative position if the input canvas captured the layout correctly.
 * 
 * @param gap - Gap between trimmed contents. Use negative value for overlap.
 */
export const mergeCanvasesVertical = (
  topCanvas: HTMLCanvasElement | OffscreenCanvas,
  bottomCanvas: HTMLCanvasElement | OffscreenCanvas,
  gap: number = 0
): { canvas: HTMLCanvasElement | OffscreenCanvas, width: number, height: number } => {
    // 1. Prepare contexts to read data
    const { context: topCtx } = createSmartCanvas(topCanvas.width, topCanvas.height);
    topCtx.drawImage(topCanvas as any, 0, 0);

    const { context: bottomCtx } = createSmartCanvas(bottomCanvas.width, bottomCanvas.height);
    bottomCtx.drawImage(bottomCanvas as any, 0, 0);

    // 2. Get Vertical Bounds ONLY (preserve horizontal layout)
    const topV = scanVerticalBounds(topCtx as any, topCanvas.width, topCanvas.height);
    const bottomV = scanVerticalBounds(bottomCtx as any, bottomCanvas.width, bottomCanvas.height);

    // 3. Calculate final dimensions
    // Width is determined by the widest element (preserving full width of inputs)
    const width = Math.max(topCanvas.width, bottomCanvas.width);
    const height = Math.max(0, topV.h + bottomV.h + gap);

    const { canvas, context: ctx } = createSmartCanvas(width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 4. Draw Trimmed Content
    // We draw using the full width of the source, but only the vertical slice of content.
    // X is drawn at 0 to maintain original alignment relative to the box capture.
    
    // Draw Top
    ctx.drawImage(
      topCanvas as any,
      0, topV.y, topCanvas.width, topV.h,  // Source: Full Width, Vert Slice
      0, 0, topCanvas.width, topV.h        // Dest: 0, 0
    );

    // Draw Bottom
    ctx.drawImage(
      bottomCanvas as any,
      0, bottomV.y, bottomCanvas.width, bottomV.h, // Source: Full Width, Vert Slice
      0, topV.h + gap, bottomCanvas.width, bottomV.h // Dest: 0, after top
    );

    return { canvas, width, height };
};

/**
 * PHASE 2: Analyze Content
 * Returns the trim bounds of the constructed canvas.
 */
export const analyzeCanvasContent = (canvas: HTMLCanvasElement | OffscreenCanvas): TrimBounds => {
    const w = canvas.width;
    const h = canvas.height;
    if (w === 0 || h === 0) return { x: 0, y: 0, w: 0, h: 0 };
    
    // Create temp context to read data
    const { context } = createSmartCanvas(w, h);
    context.drawImage(canvas as any, 0, 0);
    
    // Use trimWhitespace to find the bounding box of non-white pixels
    return trimWhitespace(context, w, h);
};

/**
 * PHASE 3: Align and Export
 * Draws the content (defined by trimBounds) into a new canvas of (targetContentWidth + padding).
 * 
 * Logic:
 * 1. Create canvas of width = targetContentWidth + LeftPad + RightPad
 * 2. Draw image at x = LeftPad.
 * 3. If targetContentWidth > trimBounds.w, the extra space effectively becomes Right Padding.
 */
export const generateAlignedImage = async (
    sourceCanvas: HTMLCanvasElement | OffscreenCanvas, 
    trimBounds: TrimBounds,
    targetContentWidth: number,
    settings: CropSettings
): Promise<string> => {
    // Final dimensions
    const padding = settings.canvasPadding;
    const finalWidth = targetContentWidth + (padding * 2);
    const finalHeight = trimBounds.h + (padding * 2);
    
    const { canvas, context: ctx } = createSmartCanvas(finalWidth, finalHeight);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, finalWidth, finalHeight);
    
    // Draw specific trim area from source to destination with padding
    ctx.drawImage(
        sourceCanvas as any,
        trimBounds.x, trimBounds.y, trimBounds.w, trimBounds.h, // Source Slice
        padding, padding, trimBounds.w, trimBounds.h // Dest Rect
    );
    
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

/**
 * Legacy wrapper if needed
 */
export const cropAndStitchImage = async (
  sourceDataUrl: string, 
  boxes: [number, number, number, number][],
  originalWidth: number, 
  originalHeight: number,
  settings: CropSettings
): Promise<{ final: string, original?: string }> => {
    // This legacy function mimics the old one-shot behavior roughly
    const { canvas, originalDataUrl } = await constructQuestionCanvas(sourceDataUrl, boxes, originalWidth, originalHeight, settings);
    if (!canvas) return { final: '' };
    
    const trim = analyzeCanvasContent(canvas);
    const final = await generateAlignedImage(canvas, trim, trim.w, settings);
    return { final, original: originalDataUrl };
};
