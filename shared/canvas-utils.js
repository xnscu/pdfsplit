

/**
 * Shared Canvas Logic for "Smart Trim" algorithm.
 * Works in both Browser (DOM Canvas) and Node.js (node-canvas).
 */

/**
 * Standard "Trim Whitespace" Trimming.
 * Scans from edges inwards removing TRANSPARENT or WHITE pixels until INK is found.
 * 
 * @param {any} ctx 
 * @param {number} width 
 * @param {number} height 
 * @param {function(string): void} [onStatus]
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export const getTrimmedBounds = (ctx, width, height, onStatus = null) => {
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w <= 0 || h <= 0) return { x: 0, y: 0, w: 0, h: 0 };

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  // Threshold: pixels darker than this are considered "Ink".
  // 240 allows faint gray noise to be cropped, but keeps text.
  const threshold = 240; 

  // Helper: Checks if a row has any pixel darker than threshold
  const rowHasInk = (y) => {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Alpha > 0 AND (R or G or B < threshold)
      if (data[i + 3] > 0 && (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold)) {
        return true;
      }
    }
    return false;
  };

  // Helper: Checks if a column has any pixel darker than threshold
  const colHasInk = (x) => {
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 0 && (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold)) {
        return true;
      }
    }
    return false;
  };

  let top = 0;
  let bottom = h;
  let left = 0;
  let right = w;

  // OLD LOGIC (Buggy): while (hasInk) -> Crop. This ate the number "1".
  // NEW LOGIC (Correct): while (!hasInk) -> Crop. Remove whitespace only.

  if (onStatus) onStatus("Trimming Top Whitespace...");
  while (top < h && !rowHasInk(top)) { top++; }
  
  if (onStatus) onStatus("Trimming Bottom Whitespace...");
  while (bottom > top && !rowHasInk(bottom - 1)) { bottom--; }
  
  if (onStatus) onStatus("Trimming Left Whitespace...");
  while (left < w && !colHasInk(left)) { left++; }
  
  if (onStatus) onStatus("Trimming Right Whitespace...");
  while (right > left && !colHasInk(right - 1)) { right--; }

  // Fallback: If we trimmed everything away (blank image), return original or zero
  if (left >= right || top >= bottom) {
      return { x: 0, y: 0, w: w, h: h };
  }

  // Optional: Add a tiny bit of padding back (e.g. 5px) so text doesn't touch the edge
  const PADDING = 5;
  const finalX = Math.max(0, left - PADDING);
  const finalY = Math.max(0, top - PADDING);
  const finalW = Math.min(w - finalX, (right - left) + (PADDING * 2));
  const finalH = Math.min(h - finalY, (bottom - top) + (PADDING * 2));

  return {
    x: finalX,
    y: finalY,
    w: finalW,
    h: finalH
  };
};

/**
 * Checks if box A is contained within or equal to box B.
 * Box format: [ymin, xmin, ymax, xmax] (0-1000)
 * 
 * @param {number[]} a 
 * @param {number[]} b 
 * @returns {boolean}
 */
export const isContained = (a, b) => {
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
