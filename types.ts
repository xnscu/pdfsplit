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

export interface QuestionAnalysis {
  picture_ok: boolean;
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
}

export type ReviewVerdict =
  | "correct" // Claude and Gemini reached the same conclusion
  | "minor_issue" // Same answer, but Gemini's reasoning has a flaw
  | "incorrect" // Gemini's final answer is wrong
  | "unverifiable"; // Image unreadable, or the question is ill-posed

export interface ReviewIssue {
  severity: "typo" | "calculation" | "logic" | "answer";
  location: string; // Where in Gemini's solution, e.g. "(2) 第三步"
  description: string;
}

export interface ClaudeReview {
  verdict: ReviewVerdict;
  confidence: number; // 0-1
  claude_answer: string; // Claude's final answer, normalized for comparison
  gemini_answer: string; // Gemini's final answer, normalized for comparison
  issues: ReviewIssue[];
  corrected_solution_md?: string; // Only when verdict is 'incorrect'
  model_id: string; // e.g. 'claude-opus-4-8'
  // Self-reported reasoning depth. Cloud routines cannot select a thinking
  // effort, so a routine-produced review reports 'ultrathink' rather than one
  // of the CLI effort levels.
  effort: "high" | "xhigh" | "max" | "ultrathink" | "triage";
  reviewed_at: string; // UTC ISO timestamp
}

export interface QuestionImage {
  id: string;
  pageNumber: number;
  fileName: string; // Added to track which PDF this question belongs to
  dataUrl: string;
  analysis?: QuestionAnalysis; // New optional field
  pro_analysis?: QuestionAnalysis; // Storage for Gemini Pro results
  claude_analysis?: QuestionAnalysis; // Claude solving independently of pro_analysis
  claude_review?: ClaudeReview; // Verdict on pro_analysis, from comparing the two
  exam_name?: string; // Name of the exam this question belongs to
  exam_id?: string; // ID of the exam this question belongs to
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
