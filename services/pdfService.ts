
import * as pdfjsLib from 'pdfjs-dist';

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
