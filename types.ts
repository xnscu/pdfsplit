
export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface DetectedQuestion {
  id: string;
  // Support both single box [y,x,y,x] and multiple boxes [[y,x,y,x], [y,x,y,x]]
  boxes_2d: [number, number, number, number] | [number, number, number, number][]; 
}

export interface QuestionImage {
  id: string;
  pageNumber: number;
  fileName: string; // Added to track which PDF this question belongs to
  dataUrl: string;
  originalDataUrl?: string; // Used for "Before/After" comparison if trimming occurred
}

export interface DebugPageData {
  pageNumber: number;
  fileName: string; // Added to track source file
  dataUrl: string; // The full page image
  width: number;
  height: number;
  detections: DetectedQuestion[]; // Raw coordinates from Gemini
}

export interface ProcessedCanvas {
  id: string;
  pageNumber: number;
  fileName: string;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  originalDataUrl?: string;
}

export interface HistoryMetadata {
  id: string;
  name: string;
  timestamp: number;
  pageCount: number;
}

export interface SourcePage {
  dataUrl: string;
  width: number;
  height: number;
  pageNumber: number;
  fileName: string;
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  LOADING_PDF = 'LOADING_PDF',
  DETECTING_QUESTIONS = 'DETECTING_QUESTIONS',
  CROPPING = 'CROPPING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
  STOPPED = 'STOPPED'
}