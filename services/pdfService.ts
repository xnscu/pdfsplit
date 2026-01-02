
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

export interface CropSettings {
  cropPadding: number;
  canvasPaddingLeft: number;
  canvasPaddingRight: number;
  canvasPaddingY: number;
}

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

  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.9),
    width: canvas.width,
    height: canvas.height
  };
};

/**
 * Helper to check if box A is roughly contained inside box B
 */
const isContained = (inner: number[], outer: number[]) => {
  const buffer = 10; // 1% buffer
  return (
    inner[0] >= outer[0] - buffer && // ymin
    inner[1] >= outer[1] - buffer && // xmin
    inner[2] <= outer[2] + buffer && // ymax
    inner[3] <= outer[3] + buffer    // xmax
  );
};

/**
 * The "Edge Peel" Algorithm (User's Design).
 * 
 * Logic:
 * 1. Start from the outermost 1px line (Top/Bottom/Left/Right).
 * 2. Scan the line. If ANY black pixel is found -> This line is "dirty" (artifact or padding).
 * 3. Move to the next line inwards.
 * 4. Repeat until a line is found that contains NO black pixels (Clean Whitespace).
 * 5. STOP IMMEDIATELY. Do not trim the remaining whitespace.
 * 
 * Includes a safety limit to prevent erasing the question if the crop was too tight initially.
 */
const getTrimmedBounds = (
  ctx: CanvasRenderingContext2D, 
  width: number, 
  height: number,
  onStatus?: (msg: string) => void
): { x: number, y: number, w: number, h: number } => {
  const w = Math.floor(width);
  const h = Math.floor(height);

  if (w <= 0 || h <= 0) return { x: 0, y: 0, w: 0, h: 0 };

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const threshold = 200; // RGB < 200 is ink

  // Optimized Helper: Returns true IMMEDIATELY if any pixel in row y is ink.
  const rowHasInk = (y: number) => {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Alpha > 0 AND is Dark
      if (data[i + 3] > 0 && (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold)) {
        return true; 
      }
    }
    return false;
  };

  // Optimized Helper: Returns true IMMEDIATELY if any pixel in col x is ink.
  const colHasInk = (x: number) => {
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 0 && (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold)) {
        return true;
      }
    }
    return false;
  };

  // Safety: Don't peel more than 30% of the image. 
  // If we peel that much and still hit ink, assume the "edge ink" was actually the question itself.
  const SAFETY_Y = Math.floor(h * 0.3);
  const SAFETY_X = Math.floor(w * 0.3);

  let top = 0;
  let bottom = h;
  let left = 0;
  let right = w;

  // --- PEEL TOP ---
  if (onStatus) onStatus("Peeling Top Artifacts...");
  // Eat rows ONLY IF they have ink. Stop at the first white row.
  while (top < SAFETY_Y && rowHasInk(top)) {
    top++;
  }

  // --- PEEL BOTTOM ---
  if (onStatus) onStatus("Peeling Bottom Artifacts...");
  // Eat rows ONLY IF they have ink. Stop at the first white row.
  // Note: 'bottom' is exclusive index (height), so check bottom-1
  while (bottom > h - SAFETY_Y && bottom > top && rowHasInk(bottom - 1)) {
    bottom--;
  }

  // --- PEEL LEFT ---
  if (onStatus) onStatus("Peeling Left Artifacts...");
  while (left < SAFETY_X && colHasInk(left)) {
    left++;
  }

  // --- PEEL RIGHT ---
  if (onStatus) onStatus("Peeling Right Artifacts...");
  while (right > w - SAFETY_X && right > left && colHasInk(right - 1)) {
    right--;
  }

  return {
    x: left,
    y: top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top)
  };
};

/**
 * Crops multiple segments from the source, trims black artifacts, and stitches them vertically.
 * Handles deduplication of nested boxes.
 * 
 * Returns { final: string, original?: string }
 */
export const cropAndStitchImage = (
  sourceDataUrl: string, 
  boxes: [number, number, number, number][], // Array of [ymin, xmin, ymax, xmax] 0-1000
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

    // 1. Filter out contained boxes (Deduplication)
    const getArea = (b: number[]) => (b[2] - b[0]) * (b[3] - b[1]);
    const sortedBySize = [...boxes].sort((a, b) => getArea(b) - getArea(a));
    
    const finalBoxes: [number, number, number, number][] = [];
    
    for (const box of sortedBySize) {
      const isRedundant = finalBoxes.some(keeper => isContained(box, keeper));
      if (!isRedundant) {
        finalBoxes.push(box);
      }
    }

    // 2. Sorting Logic: Priority to Left-to-Right (Columns), then Top-to-Bottom
    finalBoxes.sort((a, b) => {
      const centerXA = (a[1] + a[3]) / 2;
      const centerXB = (b[1] + b[3]) / 2;
      
      if (Math.abs(centerXA - centerXB) > 150) {
        return centerXA - centerXB; // Left comes first
      }
      return a[0] - b[0];
    });

    const img = new Image();
    img.onload = () => {
      // 3. Define padding parameters from Settings
      // We grab EXTRA CROP_PADDING to ensure we capture the full question. 
      // The intelligent `getTrimmedBounds` will peel off the neighbors ONLY if they are artifacts.
      const CROP_PADDING = settings.cropPadding; 
      const CANVAS_PADDING_LEFT = settings.canvasPaddingLeft;
      const CANVAS_PADDING_RIGHT = settings.canvasPaddingRight;
      const CANVAS_PADDING_Y = settings.canvasPaddingY;

      // 4. Extract and Trim each fragment
      const processedFragments = finalBoxes.map((box, idx) => {
        const [ymin, xmin, ymax, xmax] = box;
        
        // Initial coarse crop coordinates
        const x = Math.max(0, (xmin / 1000) * originalWidth - CROP_PADDING);
        const y = Math.max(0, (ymin / 1000) * originalHeight - CROP_PADDING);
        
        const rawW = ((xmax - xmin) / 1000) * originalWidth + (CROP_PADDING * 2);
        const rawH = ((ymax - ymin) / 1000) * originalHeight + (CROP_PADDING * 2);

        const w = Math.min(originalWidth - x, rawW);
        const h = Math.min(originalHeight - y, rawH);

        // Create a temporary canvas for this specific fragment
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = Math.floor(w);
        tempCanvas.height = Math.floor(h);
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return null;

        // Draw the raw coarse crop onto temp canvas
        tempCtx.drawImage(img, x, y, w, h, 0, 0, w, h);

        if (onStatus) onStatus(`Refining fragment ${idx + 1}/${finalBoxes.length}...`);

        // Apply User's "Edge Peel" Logic
        const trim = getTrimmedBounds(tempCtx, Math.floor(w), Math.floor(h), onStatus);

        return {
          sourceCanvas: tempCanvas,
          trim: trim, 
        };
      }).filter(Boolean) as { sourceCanvas: HTMLCanvasElement, trim: {x: number, y: number, w: number, h: number} }[];

      if (processedFragments.length === 0) {
        resolve({ final: '' });
        return;
      }

      // 5. Determine final canvas size based on TRIMMED sizes
      const maxFragmentWidth = Math.max(...processedFragments.map(f => f.trim.w));
      const finalWidth = maxFragmentWidth + CANVAS_PADDING_LEFT + CANVAS_PADDING_RIGHT;
      
      const gap = settings.canvasPaddingY; // Use Y Padding as gap as well for consistency? Or keep fixed? Let's use it as gap too or fixed. 
      // Let's keep gap somewhat related to Y padding or fixed. For now, let's use a fixed gap of 10 or make it adjustable? 
      // User asked for "CANVAS_PADDING_Y" to be adjustable. Let's assume it affects top/bottom margins.
      // We'll use a fixed gap of 10 for between fragments to avoid confusion, or use Y padding.
      const fragmentGap = 10; 

      const totalContentHeight = processedFragments.reduce((acc, f) => acc + f.trim.h, 0) + (fragmentGap * (Math.max(0, processedFragments.length - 1)));
      const finalHeight = totalContentHeight + (CANVAS_PADDING_Y * 2);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve({ final: '' });

      canvas.width = finalWidth;
      canvas.height = finalHeight;

      // Fill background white
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 6. Draw each fragment using the trimmed coordinates
      let currentY = CANVAS_PADDING_Y;
      processedFragments.forEach((f) => {
        // Center relative to widest fragment
        const centerOffset = (maxFragmentWidth - f.trim.w) / 2;
        const offsetX = CANVAS_PADDING_LEFT + centerOffset;
        
        ctx.drawImage(
          f.sourceCanvas, 
          f.trim.x, f.trim.y, f.trim.w, f.trim.h, // Source
          offsetX, currentY, f.trim.w, f.trim.h   // Destination
        );
        currentY += f.trim.h + fragmentGap;
      });

      const finalDataUrl = canvas.toDataURL('image/jpeg', 0.95);

      // --- 7. Generate Original (Unpeeled) Image for Comparison (Only if trimmed) ---
      // We check if we peeled MORE than 0 pixels.
      const wasTrimmed = processedFragments.some(f => 
        f.trim.w < f.sourceCanvas.width || f.trim.h < f.sourceCanvas.height
      );

      let originalDataUrl: string | undefined;

      if (wasTrimmed) {
         const maxRawWidth = Math.max(...processedFragments.map(f => f.sourceCanvas.width));
         const finalRawWidth = maxRawWidth + CANVAS_PADDING_LEFT + CANVAS_PADDING_RIGHT;
         const totalRawHeight = processedFragments.reduce((acc, f) => acc + f.sourceCanvas.height, 0) + (fragmentGap * (Math.max(0, processedFragments.length - 1)));
         const finalRawHeight = totalRawHeight + (CANVAS_PADDING_Y * 2);

         const rawCanvas = document.createElement('canvas');
         rawCanvas.width = finalRawWidth;
         rawCanvas.height = finalRawHeight;
         const rawCtx = rawCanvas.getContext('2d');
         
         if (rawCtx) {
             rawCtx.fillStyle = '#ffffff';
             rawCtx.fillRect(0, 0, rawCanvas.width, rawCanvas.height);
             
             let currentRawY = CANVAS_PADDING_Y;
             processedFragments.forEach(f => {
                 const centerOffset = (maxRawWidth - f.sourceCanvas.width) / 2;
                 const offsetX = CANVAS_PADDING_LEFT + centerOffset;
                 // Draw full source without trim coordinates
                 rawCtx.drawImage(f.sourceCanvas, offsetX, currentRawY);
                 currentRawY += f.sourceCanvas.height + fragmentGap;
             });
             originalDataUrl = rawCanvas.toDataURL('image/jpeg', 0.95);
         }
      }

      resolve({ final: finalDataUrl, original: originalDataUrl });
    };
    img.src = sourceDataUrl;
  });
};
