export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface DetectedQuestion {
  id: string;
  // Support both single box [y,x,y,x] and multiple boxes [[y,x,y,x], [y,x,y,x]]
  boxes_2d:
    | [number, number, number, number]
    | [number, number, number, number][];
}

export interface QuestionAnalysis {
  difficulty: number;
  question_type: string;
  tags: {
    level0: string;
    level1: string;
    level2?: string;
    level3?: string;
  }[];
  question_md: string;
  solution_md: string;
  analysis_md: string;
  breakthrough_md?: string;
  pitfalls_md?: string;
}

export interface QuestionImage {
  id: string;
  pageNumber: number;
  fileName: string; // Added to track which PDF this question belongs to
  dataUrl: string;
  analysis?: QuestionAnalysis; // New optional field
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
}

export interface HistoryMetadata {
  id: string;
  name: string;
  timestamp: number;
  pageCount: number;
}

export interface ExamRecord {
  id: string;
  name: string;
  timestamp: number;
  pageCount: number;
  rawPages: DebugPageData[];
  questions: QuestionImage[];
}

export interface SourcePage {
  dataUrl: string;
  width: number;
  height: number;
  pageNumber: number;
  fileName: string;
}

export enum ProcessingStatus {
  IDLE = "IDLE",
  LOADING_PDF = "LOADING_PDF",
  DETECTING_QUESTIONS = "DETECTING_QUESTIONS",
  CROPPING = "CROPPING",
  ANALYZING = "ANALYZING", // New Status
  COMPLETED = "COMPLETED",
  ERROR = "ERROR",
  STOPPED = "STOPPED",
}
