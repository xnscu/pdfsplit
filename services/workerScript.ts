
// This file contains the worker code as a string to avoid bundler configuration issues in the browser environment.
// It replicates the logic from canvas-utils.js and pdfService.ts adapted for a Worker environment (OffscreenCanvas).

const WORKER_CODE = `
/**
 * SHARED CANVAS UTILS (Inlined for Worker)
 */
const checkCanvasEdges = (ctx, width, height, threshold = 240, depth = 2) => {
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

const trimWhitespace = (ctx, width, height) => {
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

  while (top < h && !rowHasInk(top)) { top++; }
  while (bottom > top && !rowHasInk(bottom - 1)) { bottom--; }
  while (left < w && !colHasInk(left)) { left++; }
  while (right > left && !colHasInk(right - 1)) { right--; }

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

const scanVerticalBounds = (ctx, w, h) => {
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const threshold = 242;

    const isRowEmpty = (y) => {
        for(let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
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
  const res = await fetch(dataUrl);
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

// constructQuestionCanvas equivalent
const processParts = async (sourceDataUrl, boxes, originalWidth, originalHeight, settings) => {
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

        // Intelligent Padding Logic
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
            const edges = checkCanvasEdges(checkCtx, uW, uH, 240, 2); 
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

    // Stitch
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
    const exportPadding = 10; // Default or from settings if we passed it
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

const processLogicalQuestion = async (task, settings) => {
    // 1. Crop Parts
    const partsCanvas = [];
    for (const part of task.parts) {
         let boxes = part.detection.boxes_2d;
         if (!Array.isArray(boxes[0])) boxes = [boxes];

         const res = await processParts(
             part.pageObj.dataUrl,
             boxes,
             part.pageObj.width,
             part.pageObj.height,
             settings
         );
         if (res) partsCanvas.push({ canvas: res.canvas, originalDataUrl: res.originalDataUrl });
    }

    if (partsCanvas.length === 0) return null;

    // 2. Merge Vertical
    let finalCanvas = partsCanvas[0].canvas;
    const originalDataUrl = partsCanvas[0].originalDataUrl;

    for (let k = 1; k < partsCanvas.length; k++) {
         const next = partsCanvas[k];
         const topCanvas = finalCanvas;
         const bottomCanvas = next.canvas;
         const gap = -settings.mergeOverlap;

         // Merge Logic (Inlined)
         const { context: topCtx } = createSmartCanvas(topCanvas.width, topCanvas.height);
         topCtx.drawImage(topCanvas, 0, 0);
         const { context: bottomCtx } = createSmartCanvas(bottomCanvas.width, bottomCanvas.height);
         bottomCtx.drawImage(bottomCanvas, 0, 0);

         const topV = scanVerticalBounds(topCtx, topCanvas.width, topCanvas.height);
         const bottomV = scanVerticalBounds(bottomCtx, bottomCanvas.width, bottomCanvas.height);

         const width = Math.max(topCanvas.width, bottomCanvas.width);
         const height = Math.max(0, topV.h + bottomV.h + gap);

         const { canvas: mergedC, context: mergedCtx } = createSmartCanvas(width, height);
         mergedCtx.fillStyle = '#ffffff';
         mergedCtx.fillRect(0, 0, width, height);

         mergedCtx.drawImage(topCanvas, 0, topV.y, topCanvas.width, topV.h, 0, 0, topCanvas.width, topV.h);
         mergedCtx.drawImage(bottomCanvas, 0, bottomV.y, bottomCanvas.width, bottomV.h, 0, topV.h + gap, bottomCanvas.width, bottomV.h);
         
         finalCanvas = mergedC;
    }

    // 3. Export Final
    const trim = trimWhitespace(finalCanvas.getContext('2d'), finalCanvas.width, finalCanvas.height);
    const padding = settings.canvasPadding;
    const finalWidth = trim.w + (padding * 2);
    const finalHeight = trim.h + (padding * 2);
    
    const { canvas: exportCanvas, context: exportCtx } = createSmartCanvas(finalWidth, finalHeight);
    exportCtx.fillStyle = '#ffffff';
    exportCtx.fillRect(0, 0, finalWidth, finalHeight);
    
    exportCtx.drawImage(
        finalCanvas,
        trim.x, trim.y, trim.w, trim.h,
        padding, padding, trim.w, trim.h
    );

    const blob = await exportCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
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
        originalDataUrl: originalDataUrl
    };
};

const generateDebugPreviews = async (sourceDataUrl, boxes, originalWidth, originalHeight, settings) => {
    const imgBitmap = await loadImageBitmapFromDataUrl(sourceDataUrl);
    
    // Stage 1: Raw AI Detection (Exact Box)
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

    // Stage 2: Crop Padding
    const { canvas: s2Canvas, context: s2Ctx } = createSmartCanvas(1, 1);
    const s2Fragments = boxes.map(box => {
         const [ymin, xmin, ymax, xmax] = box;
         const p = settings.cropPadding;
         const rawX = (xmin / 1000) * originalWidth;
         const rawY = (ymin / 1000) * originalHeight;
         const rawW = ((xmax - xmin) / 1000) * originalWidth;
         const rawH = ((ymax - ymin) / 1000) * originalHeight;
         
         const x = Math.max(0, rawX - p);
         const y = Math.max(0, rawY - p);
         const w = Math.min(originalWidth - x, rawW + (p * 2));
         const h = Math.min(originalHeight - y, rawH + (p * 2));
         return { x, y, w, h };
    });
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

    // Stage 3: Trim Whitespace
    const result3 = await processParts(sourceDataUrl, boxes, originalWidth, originalHeight, settings);
    const stage3 = result3 && result3.canvas ? await canvasToDataURL(result3.canvas) : '';
    
    // Stage 4: Aligned (Final)
    // We reuse logic from processLogicalQuestion's final step
    let stage4 = '';
    if (result3 && result3.canvas) {
         const finalCanvas = result3.canvas;
         const trim = trimWhitespace(finalCanvas.getContext('2d'), finalCanvas.width, finalCanvas.height);
         const padding = settings.canvasPadding;
         const finalWidth = trim.w + (padding * 2);
         const finalHeight = trim.h + (padding * 2);
         const { canvas: exportCanvas, context: exportCtx } = createSmartCanvas(finalWidth, finalHeight);
         exportCtx.fillStyle = '#ffffff';
         exportCtx.fillRect(0, 0, finalWidth, finalHeight);
         exportCtx.drawImage(
            finalCanvas,
            trim.x, trim.y, trim.w, trim.h,
            padding, padding, trim.w, trim.h
         );
         stage4 = await canvasToDataURL(exportCanvas);
    }

    return { stage1, stage2, stage3, stage4 };
};


self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  
  if (type === 'PROCESS_QUESTION') {
     try {
        const result = await processLogicalQuestion(payload.task, payload.settings);
        self.postMessage({ id, success: true, result });
     } catch (err) {
        console.error("Worker Error:", err);
        self.postMessage({ id, success: false, error: err.message });
     }
  } 
  else if (type === 'GENERATE_DEBUG') {
      try {
          const { sourceDataUrl, boxes, originalWidth, originalHeight, settings } = payload;
          const result = await generateDebugPreviews(sourceDataUrl, boxes, originalWidth, originalHeight, settings);
          self.postMessage({ id, success: true, result });
      } catch (err) {
          console.error("Worker Preview Error:", err);
          self.postMessage({ id, success: false, error: err.message });
      }
  }
};
`;

const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
export const WORKER_BLOB_URL = URL.createObjectURL(blob);
