// This file contains the worker code as a string to avoid bundler configuration issues in the browser environment.
// It replicates the logic from canvas-utils.js and pdfService.ts adapted for a Worker environment (OffscreenCanvas).

// Keep in sync with services/r2Service.ts (Vite env injection)
const getApiUrl = (): string => {
  // @ts-ignore - Vite injects import.meta.env
  const envUrl =
    typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_URL;
  return envUrl || "/api";
};

const API_BASE_URL = getApiUrl();
const ORIGIN =
  typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "";

const WORKER_CODE = `
/**
 * SHARED CANVAS UTILS (Inlined for Worker)
 */

const API_BASE_URL = ${JSON.stringify(API_BASE_URL)};
const ORIGIN = ${JSON.stringify(ORIGIN)};
const toAbsoluteUrl = (url) => {
  if (!url) return url;
  if (/^https?:\\/\\//i.test(url)) return url;
  if (url.startsWith('/') && ORIGIN) return ORIGIN + url;
  return url;
};
const ABS_API_BASE_URL = toAbsoluteUrl(API_BASE_URL);
const isImageHash = (value) => /^[a-f0-9]{64}$/i.test(value);
const joinBase = (base, path) => {
  const b = (base || '').replace(/\\/$/, '');
  return b + path;
};
const resolveImageUrl = (value) => (isImageHash(value) ? joinBase(ABS_API_BASE_URL, '/r2/' + value) : value);

const checkCanvasEdges = (ctx, width, height, threshold = 230, depth = 2) => {
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w <= 0 || h <= 0) return { top: true, bottom: true, left: true, right: true };

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const isInk = (idx) => {
    return data[idx + 3] > 10 && (data[idx] < threshold || data[idx + 1] < threshold || data[idx + 2] < threshold);
  };

  let topHasInk = false;
  let bottomHasInk = false;
  let leftHasInk = false;
  let rightHasInk = false;

  const d = Math.min(depth, Math.floor(h / 2), Math.floor(w / 2));

  // Check Top
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < w; x++) {
      if (isInk((y * w + x) * 4)) { topHasInk = true; break; }
    }
    if (topHasInk) break;
  }
  
  // Check Bottom
  for (let y = h - d; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isInk((y * w + x) * 4)) { bottomHasInk = true; break; }
    }
    if (bottomHasInk) break;
  }

  // Check Left
  for (let x = 0; x < d; x++) {
    for (let y = 0; y < h; y++) {
      if (isInk((y * w + x) * 4)) { leftHasInk = true; break; }
    }
    if (leftHasInk) break;
  }

  // Check Right
  for (let x = w - d; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (isInk((y * w + x) * 4)) { rightHasInk = true; break; }
    }
    if (rightHasInk) break;
  }

  return {
    top: !topHasInk,
    bottom: !bottomHasInk,
    left: !leftHasInk,
    right: !rightHasInk
  };
};

const getTrimmedBounds = (ctx, width, height) => {
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w <= 0 || h <= 0) return { x: 0, y: 0, w: 0, h: 0 };

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const threshold = 220; 

  const rowHasInk = (y) => {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 10 && (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold)) {
        return true;
      }
    }
    return false;
  };

  const colHasInk = (x) => {
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 10 && (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold)) {
        return true;
      }
    }
    return false;
  };

  const SAFETY_Y = Math.floor(h * 0.15);
  const SAFETY_X = Math.floor(w * 0.15);

  let top = 0;
  let bottom = h;
  let left = 0;
  let right = w;

  while (top < SAFETY_Y && rowHasInk(top)) { top++; }
  while (bottom > h - SAFETY_Y && bottom > top && rowHasInk(bottom - 1)) { bottom--; }
  while (left < SAFETY_X && colHasInk(left)) { left++; }
  while (right > w - SAFETY_X && right > left && colHasInk(right - 1)) { right--; }

  return {
    x: left,
    y: top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top)
  };
};

/**
 * Enhanced Trim Whitespace with Threshold Limit (Max Cut Depth)
 * @param limit - Max pixels to remove from any side. 
 *                If whitespace > limit, we remove 'limit' pixels and keep the rest.
 *                If whitespace < limit, we remove all of it.
 *                This preserves RELATIVE indentation if the common margin > limit.
 */
const trimWhitespace = (ctx, width, height, limit = 0) => {
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w <= 0 || h <= 0) return { x: 0, y: 0, w: 0, h: 0 };

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const threshold = 242; 

  const isInkPixel = (x, y) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 10) return false;
    return data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold;
  };

  const rowHasInk = (y) => {
    for (let x = 0; x < w; x++) {
      if (isInkPixel(x, y)) return true;
    }
    return false;
  };

  const colHasInk = (x) => {
    for (let y = 0; y < h; y++) {
      if (isInkPixel(x, y)) return true;
    }
    return false;
  };

  let top = 0;
  let bottom = h;
  let left = 0;
  let right = w;

  // Trim Top
  while (top < h && !rowHasInk(top)) { top++; }
  if (limit > 0 && top > limit) top = limit; // Stop trimming if we exceeded limit

  // Trim Bottom
  while (bottom > top && !rowHasInk(bottom - 1)) { bottom--; }
  // bottom is the y-coord (exclusive). So (h - bottom) is the whitespace height.
  if (limit > 0 && (h - bottom) > limit) bottom = h - limit;

  // Trim Left
  while (left < w && !colHasInk(left)) { left++; }
  if (limit > 0 && left > limit) left = limit;

  // Trim Right
  while (right > left && !colHasInk(right - 1)) { right--; }
  if (limit > 0 && (w - right) > limit) right = w - limit;

  return {
    x: left,
    y: top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top)
  };
};

const isContained = (a, b) => {
  const [yminA, xminA, ymaxA, xmaxA] = a;
  const [yminB, xminB, ymaxB, xmaxB] = b;
  const tolerance = 5;
  return (
    xminA >= xminB - tolerance &&
    xmaxA <= xmaxB + tolerance &&
    yminA >= yminB - tolerance &&
    ymaxA <= ymaxB + tolerance
  );
};

/**
 * CORE LOGIC
 */

const createSmartCanvas = (width, height) => {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const canvas = new OffscreenCanvas(safeWidth, safeHeight);
  const context = canvas.getContext('2d');
  return { canvas, context };
};

const loadImageBitmapFromDataUrl = async (dataUrl) => {
  const res = await fetch(toAbsoluteUrl(resolveImageUrl(dataUrl)));
  const blob = await res.blob();
  return await createImageBitmap(blob);
};

const canvasToDataURL = async (canvas) => {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return new Promise(r => {
        const reader = new FileReader();
        reader.onloadend = () => r(reader.result);
        reader.readAsDataURL(blob);
    });
};

/**
 * Process a single part (Step 1: Crop)
 * Handles stitching multiple detected boxes for a single part if needed.
 */
const processPartsRaw = async (sourceDataUrl, boxes, originalWidth, originalHeight, settings) => {
    if (!boxes || boxes.length === 0) return null;

    // Filter nested
    const indicesToDrop = new Set();
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
    
    const imgBitmap = await loadImageBitmapFromDataUrl(sourceDataUrl);
    const CROP_PADDING = settings.cropPadding;

    const processedFragments = [];
    
    for (const box of finalBoxes) {
        const [ymin, xmin, ymax, xmax] = box;

        // Intelligent Padding Logic for Step 1
        const uX = Math.floor((xmin / 1000) * originalWidth);
        const uY = Math.floor((ymin / 1000) * originalHeight);
        const uW = Math.ceil(((xmax - xmin) / 1000) * originalWidth);
        const uH = Math.ceil(((ymax - ymin) / 1000) * originalHeight);

        let pTop = CROP_PADDING;
        let pBottom = CROP_PADDING;
        let pLeft = CROP_PADDING;
        let pRight = CROP_PADDING;

        if (uW > 0 && uH > 0) {
            const { canvas: checkCanvas, context: checkCtx } = createSmartCanvas(uW, uH);
            checkCtx.drawImage(imgBitmap, uX, uY, uW, uH, 0, 0, uW, uH);
            const edges = checkCanvasEdges(checkCtx, uW, uH, 230, 2); 
            if (edges.top) pTop = 0;
            if (edges.bottom) pBottom = 0;
            if (edges.left) pLeft = 0;
            if (edges.right) pRight = 0;
        }

        const x = Math.max(0, (xmin / 1000) * originalWidth - pLeft);
        const y = Math.max(0, (ymin / 1000) * originalHeight - pTop);
        const rawW = ((xmax - xmin) / 1000) * originalWidth + pLeft + pRight;
        const rawH = ((ymax - ymin) / 1000) * originalHeight + pTop + pBottom;
        const w = Math.min(originalWidth - x, rawW);
        const h = Math.min(originalHeight - y, rawH);

        if (w < 1 || h < 1) continue;

        const { canvas: tempCanvas, context: tempCtx } = createSmartCanvas(Math.floor(w), Math.floor(h));
        tempCtx.drawImage(imgBitmap, x, y, w, h, 0, 0, w, h);

        const trim = getTrimmedBounds(tempCtx, Math.floor(w), Math.floor(h));

        processedFragments.push({
          sourceCanvas: tempCanvas,
          trim: trim,
          absInkX: x + trim.x,
          rawW: w,
          rawH: h
        });
    }

    if (processedFragments.length === 0) return null;

    // Stitch fragments (Step 1 internal stitching)
    const minAbsInkX = Math.min(...processedFragments.map(f => f.absInkX));
    const maxContentWidth = Math.max(...processedFragments.map(f => (f.absInkX - minAbsInkX) + f.trim.w));
    const fragmentGap = 10;
    const totalContentHeight = processedFragments.reduce((acc, f) => acc + f.trim.h, 0) + (fragmentGap * (Math.max(0, processedFragments.length - 1)));

    const { canvas, context: ctx } = createSmartCanvas(maxContentWidth, totalContentHeight);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, maxContentWidth, totalContentHeight);

    let currentY = 0;
    processedFragments.forEach((f) => {
        const relativeOffset = f.absInkX - minAbsInkX;
        ctx.drawImage(
          f.sourceCanvas, 
          f.trim.x, f.trim.y, f.trim.w, f.trim.h,
          relativeOffset, currentY, f.trim.w, f.trim.h
        );
        currentY += f.trim.h + fragmentGap;
    });

    // Generate Original (Raw) Data URL for comparison
    let originalDataUrl = undefined;
    const exportPadding = 10; 
    const maxRawWidth = Math.max(...processedFragments.map(f => f.sourceCanvas.width));
    const finalRawWidth = maxRawWidth + (exportPadding * 2);
    const finalRawHeight = processedFragments.reduce((acc, f) => acc + f.sourceCanvas.height, 0) + (fragmentGap * (Math.max(0, processedFragments.length - 1))) + (exportPadding * 2);

    const { canvas: rawCanvas, context: rawCtx } = createSmartCanvas(finalRawWidth, finalRawHeight);
    rawCtx.fillStyle = '#ffffff';
    rawCtx.fillRect(0, 0, finalRawWidth, finalRawHeight);
    let currentRawY = exportPadding;
    processedFragments.forEach(f => {
        rawCtx.drawImage(f.sourceCanvas, exportPadding, currentRawY);
        currentRawY += f.sourceCanvas.height + fragmentGap;
    });
    
    const blob = await rawCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    originalDataUrl = await new Promise(r => {
        const reader = new FileReader();
        reader.onloadend = () => r(reader.result);
        reader.readAsDataURL(blob);
    });

    return { canvas, originalDataUrl };
};

const processLogicalQuestion = async (task, settings, targetWidth = 0) => {
    const partsImages = []; 

    // Process each part individually using the 5-Step Pipeline
    for (const part of task.parts) {
         let boxes = part.detection.boxes_2d;
         if (!Array.isArray(boxes[0])) boxes = [boxes];

         // [STEP 1] Crop: Apply crop padding (cropPadding) and basic extraction
         const rawRes = await processPartsRaw(
             part.pageObj.dataUrl,
             boxes,
             part.pageObj.width,
             part.pageObj.height,
             settings
         );
         if (!rawRes) continue;

         // [STEP 2] Trim Whitespace (with Threshold):
         // Removes excess whitespace but STOPS if limit (50px) is reached.
         // This preserves relative alignment if margins are large.
         const TRIM_LIMIT = 50; 
         const trim = trimWhitespace(rawRes.canvas.getContext('2d'), rawRes.canvas.width, rawRes.canvas.height, TRIM_LIMIT);

         // [STEP 3] Inner Padding: Add consistent aesthetic padding (canvasPadding)
         const padding = settings.canvasPadding;
         
         const contentW = trim.w;
         const contentH = trim.h;
         
         // [STEP 4] Width Alignment: 
         // Force width to be at least targetWidth (Max AI Box Width).
         // Fill right side with whitespace.
         const finalW = Math.max(contentW, Math.floor(targetWidth)) + (padding * 2);
         const finalH = contentH + (padding * 2);

         const { canvas: partCanvas, context: partCtx } = createSmartCanvas(finalW, finalH);
         partCtx.fillStyle = '#ffffff';
         partCtx.fillRect(0, 0, finalW, finalH);

         // Draw aligned to left padding. Right space is automatically white due to fillRect.
         partCtx.drawImage(
            rawRes.canvas,
            trim.x, trim.y, trim.w, trim.h,
            padding, padding, trim.w, trim.h
         );

         partsImages.push({ canvas: partCanvas, originalDataUrl: rawRes.originalDataUrl });
    }

    if (partsImages.length === 0) return null;

    // [STEP 5] Merge Continuations
    // Vertically stack processed parts. No extra trimming here (relying on Step 2).
    let finalCanvas;
    if (partsImages.length === 1) {
        finalCanvas = partsImages[0].canvas;
    } else {
        const maxW = Math.max(...partsImages.map(p => p.canvas.width));
        
        let composedH = 0;
        partsImages.forEach((p, i) => {
            if (i === 0) composedH += p.canvas.height;
            // mergeOverlap is usually positive (amount to overlap), so subtract it
            else composedH += (p.canvas.height - settings.mergeOverlap); 
        });
        
        const { canvas: mergedC, context: mergedCtx } = createSmartCanvas(maxW, composedH);
        mergedCtx.fillStyle = '#ffffff';
        mergedCtx.fillRect(0, 0, maxW, composedH);
        
        let yPos = 0;
        partsImages.forEach((p, i) => {
            mergedCtx.drawImage(p.canvas, 0, yPos);
            // Don't apply overlap after the last one
            yPos += (p.canvas.height - settings.mergeOverlap);
        });
        finalCanvas = mergedC;
    }

    // Export
    const blob = await finalCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    const finalDataUrl = await new Promise(r => {
        const reader = new FileReader();
        reader.onloadend = () => r(reader.result);
        reader.readAsDataURL(blob);
    });

    return {
        id: task.id,
        pageNumber: task.parts[0].pageObj.pageNumber,
        fileName: task.fileId,
        dataUrl: finalDataUrl,
        originalDataUrl: partsImages[0].originalDataUrl
    };
};

const generateDebugPreviews = async (sourceDataUrl, boxes, originalWidth, originalHeight, settings, targetWidth = 0) => {
    const imgBitmap = await loadImageBitmapFromDataUrl(sourceDataUrl);
    
    // Stage 1: Raw AI Detection
    const { canvas: s1Canvas, context: s1Ctx } = createSmartCanvas(1, 1);
    const s1Fragments = boxes.map(box => {
         const [ymin, xmin, ymax, xmax] = box;
         const x = (xmin / 1000) * originalWidth;
         const y = (ymin / 1000) * originalHeight;
         const w = ((xmax - xmin) / 1000) * originalWidth;
         const h = ((ymax - ymin) / 1000) * originalHeight;
         return { x, y, w, h };
    });
    
    const minX = Math.min(...s1Fragments.map(f => f.x));
    const totalH = s1Fragments.reduce((acc, f) => acc + f.h + 5, 0); 
    const maxW = Math.max(...s1Fragments.map(f => f.w));
    
    s1Canvas.width = maxW;
    s1Canvas.height = totalH;
    s1Ctx.fillStyle = '#ffffff';
    s1Ctx.fillRect(0,0, maxW, totalH);
    let curY = 0;
    s1Fragments.forEach(f => {
        s1Ctx.drawImage(imgBitmap, f.x, f.y, f.w, f.h, 0, curY, f.w, f.h);
        curY += f.h + 5;
    });
    const stage1 = await canvasToDataURL(s1Canvas);

    // Stage 2: Smart Crop Padding
    const { canvas: s2Canvas, context: s2Ctx } = createSmartCanvas(1, 1);
    const s2Fragments = [];
    
    for (const box of boxes) {
         const [ymin, xmin, ymax, xmax] = box;
         const uX = Math.floor((xmin / 1000) * originalWidth);
         const uY = Math.floor((ymin / 1000) * originalHeight);
         const uW = Math.ceil(((xmax - xmin) / 1000) * originalWidth);
         const uH = Math.ceil(((ymax - ymin) / 1000) * originalHeight);

         let pTop = settings.cropPadding;
         let pBottom = settings.cropPadding;
         let pLeft = settings.cropPadding;
         let pRight = settings.cropPadding;

         if (uW > 0 && uH > 0) {
            const { canvas: checkCanvas, context: checkCtx } = createSmartCanvas(uW, uH);
            checkCtx.drawImage(imgBitmap, uX, uY, uW, uH, 0, 0, uW, uH);
            const edges = checkCanvasEdges(checkCtx, uW, uH, 230, 2); 
            if (edges.top) pTop = 0;
            if (edges.bottom) pBottom = 0;
            if (edges.left) pLeft = 0;
            if (edges.right) pRight = 0;
         }

         const rawX = (xmin / 1000) * originalWidth;
         const rawY = (ymin / 1000) * originalHeight;
         const rawW = ((xmax - xmin) / 1000) * originalWidth;
         const rawH = ((ymax - ymin) / 1000) * originalHeight;
         
         const x = Math.max(0, rawX - pLeft);
         const y = Math.max(0, rawY - pTop);
         const w = Math.min(originalWidth - x, rawW + pLeft + pRight);
         const h = Math.min(originalHeight - y, rawH + pTop + pBottom);
         s2Fragments.push({ x, y, w, h });
    }

    const s2MaxW = Math.max(...s2Fragments.map(f => f.w));
    const s2TotalH = s2Fragments.reduce((acc, f) => acc + f.h + 10, 0);
    s2Canvas.width = s2MaxW;
    s2Canvas.height = s2TotalH;
    s2Ctx.fillStyle = '#ffffff';
    s2Ctx.fillRect(0,0, s2MaxW, s2TotalH);
    curY = 0;
    s2Fragments.forEach(f => {
        s2Ctx.drawImage(imgBitmap, f.x, f.y, f.w, f.h, 0, curY, f.w, f.h);
        curY += f.h + 10;
    });
    const stage2 = await canvasToDataURL(s2Canvas);

    // Stage 3: Trim Whitespace with Threshold (Limit)
    // We reuse processPartsRaw logic (Step 1) then apply Trim (Step 2) for preview
    const result3 = await processPartsRaw(sourceDataUrl, boxes, originalWidth, originalHeight, settings);
    let stage3 = '';
    if (result3 && result3.canvas) {
         // Apply trim with limit (50px)
         const t = trimWhitespace(result3.canvas.getContext('2d'), result3.canvas.width, result3.canvas.height, 50);
         if (t.w > 0 && t.h > 0) {
            const { canvas: s3C, context: s3Ctx } = createSmartCanvas(t.w, t.h);
            s3Ctx.drawImage(result3.canvas, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
            stage3 = await canvasToDataURL(s3C);
         } else {
            stage3 = await canvasToDataURL(result3.canvas);
         }
    }
    
    // Stage 4: Aligned & Merged (Final)
    // To show true final output, we should run the full processLogicalQuestion logic for this part
    let stage4 = '';
    if (result3 && result3.canvas) {
         const t = trimWhitespace(result3.canvas.getContext('2d'), result3.canvas.width, result3.canvas.height, 50);
         const padding = settings.canvasPadding;
         const finalContentWidth = Math.max(t.w, Math.floor(targetWidth));
         const finalWidth = finalContentWidth + (padding * 2);
         const finalHeight = t.h + (padding * 2);
         
         const { canvas: exportCanvas, context: exportCtx } = createSmartCanvas(finalWidth, finalHeight);
         exportCtx.fillStyle = '#ffffff';
         exportCtx.fillRect(0, 0, finalWidth, finalHeight);
         
         exportCtx.drawImage(
            result3.canvas,
            t.x, t.y, t.w, t.h,
            padding, padding, t.w, t.h
         );
         stage4 = await canvasToDataURL(exportCanvas);
    }

    return { stage1, stage2, stage3, stage4 };
};


self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  
  if (type === 'PROCESS_QUESTION') {
     try {
        const result = await processLogicalQuestion(payload.task, payload.settings, payload.targetWidth);
        self.postMessage({ id, success: true, result });
     } catch (err) {
        console.error("Worker Error:", err);
        self.postMessage({ id, success: false, error: err.message });
     }
  } 
  else if (type === 'GENERATE_DEBUG') {
      try {
          const { sourceDataUrl, boxes, originalWidth, originalHeight, settings, targetWidth } = payload;
          const result = await generateDebugPreviews(sourceDataUrl, boxes, originalWidth, originalHeight, settings, targetWidth);
          self.postMessage({ id, success: true, result });
      } catch (err) {
          console.error("Worker Preview Error:", err);
          self.postMessage({ id, success: false, error: err.message });
      }
  }
};
`;
const blob = new Blob([WORKER_CODE], { type: "application/javascript" });
export const WORKER_BLOB_URL = URL.createObjectURL(blob);
