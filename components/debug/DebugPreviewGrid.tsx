import React, { useMemo } from "react";
import { QuestionImage } from "../../types";
import { QuestionDisplayCard } from "../QuestionDisplayCard";

interface Props {
  questions: QuestionImage[];
  onQuestionClick: (q: QuestionImage) => void;
  onReSolveQuestion?: (q: QuestionImage, modelType: "flash" | "pro") => Promise<void>;
  onDeleteAnalysis?: (q: QuestionImage, type: "standard" | "pro") => void;
  onCopyAnalysis?: (q: QuestionImage, fromType: "standard" | "pro") => void;
  onEditAnalysis?: (q: QuestionImage, type: "standard" | "pro", field: string, value: string) => Promise<void>;
  enableAnchors?: boolean; // Enable anchor links for each question
  showExplanations?: boolean;
}

export const DebugPreviewGrid: React.FC<Props> = ({
  questions,
  onQuestionClick,
  onReSolveQuestion,
  onDeleteAnalysis,
  onCopyAnalysis,
  onEditAnalysis,
  enableAnchors = false,
  showExplanations = true,
}) => {
  const sortedQuestions = useMemo(() => {
    return [...questions].sort((a, b) => {
      // Natural sort for IDs like "1", "2", "10", "1.1"
      return a.id.localeCompare(b.id, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  }, [questions]);

  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-60 bg-white">
        <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <p className="font-bold text-lg">No processed images yet</p>
        <p className="text-xs">Click "Process" in the toolbar to generate crops.</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-y-auto bg-white custom-scrollbar">
      {/*
         Simulate final paper width (e.g. A4 constrained or responsive max-width).
         Centered content with white background.
      */}
      <div className="mx-auto min-h-full py-10 px-6 md:px-12 bg-white max-w-5xl">
        <div className="flex flex-col items-start w-full">
          {sortedQuestions.map((q) => (
            <QuestionDisplayCard
              key={q.id}
              question={q}
              onQuestionClick={onQuestionClick}
              onReSolve={onReSolveQuestion}
              onDeleteAnalysis={onDeleteAnalysis}
              onCopyAnalysis={onCopyAnalysis}
              onEditAnalysis={onEditAnalysis}
              enableAnchors={enableAnchors}
              showExplanations={showExplanations}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
