import React, { useMemo, useState, useCallback } from "react";
import { QuestionImage } from "../../types";
import { AnalysisContent } from "./AnalysisContent";
import { resolveImageUrl } from "../../services/r2Service";

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
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Handle re-solve with specific model type
  const handleReSolve = useCallback(
    async (q: QuestionImage, modelType: "flash" | "pro") => {
      if (!onReSolveQuestion) return;
      const uniqueId = `${q.fileName}-${q.id}-${modelType}`;
      if (resolvingId === uniqueId) return;
      setResolvingId(uniqueId);
      try {
        await onReSolveQuestion(q, modelType);
      } finally {
        setResolvingId(null);
      }
    },
    [onReSolveQuestion, resolvingId],
  );

  const sortedQuestions = useMemo(() => {
    return [...questions].sort((a, b) => {
      // Natural sort for IDs like "1", "2", "10", "1.1"
      return a.id.localeCompare(b.id, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  }, [questions]);

  // Copy anchor link to clipboard
  // For HashRouter, the URL format is: origin/#/inspect/examId
  // We append the question anchor using the format: origin/#/inspect/examId#question-{id}
  const handleCopyLink = useCallback((questionId: string) => {
    // Get current location which includes the hash route
    const currentUrl = window.location.href;
    // Remove any existing question anchor (after the second #)
    const baseUrl = currentUrl.split("#question-")[0];
    // Append the question anchor
    const url = `${baseUrl}#question-${questionId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(questionId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

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
      <div
        className={`mx-auto min-h-full py-10 px-6 md:px-12 bg-white ${questions.some((q) => q.pro_analysis) ? "max-w-[95vw]" : "max-w-5xl"}`}
      >
        <div className="flex flex-col items-start w-full">
          {sortedQuestions.map((q) => (
            <div
              key={q.id}
              id={enableAnchors ? `question-${q.id}` : undefined}
              className="w-full mb-8 border-b border-slate-100 pb-8 last:border-0 scroll-mt-4"
            >
              {/* Question Header with Anchor */}
              <div className="flex items-center gap-3 mb-4">
                <span className="text-lg font-black text-slate-800">Q{q.id}</span>
                {enableAnchors && (
                  <button
                    onClick={() => handleCopyLink(q.id)}
                    className={`p-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                      copiedId === q.id
                        ? "bg-green-100 text-green-600"
                        : "bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                    }`}
                    title="复制题目链接"
                  >
                    {copiedId === q.id ? (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        已复制
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                          />
                        </svg>
                        复制链接
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Image - Click to debug */}
              <div className="mb-4">
                <div
                  onClick={() => onQuestionClick(q)}
                  className="cursor-pointer group relative rounded-lg overflow-hidden border border-transparent hover:border-slate-200 transition-all inline-block"
                  title={`Click to debug Question ${q.id}`}
                >
                  <img
                    src={resolveImageUrl(q.dataUrl)}
                    alt=""
                    className="max-w-full h-auto object-contain block select-none max-h-[400px]"
                    loading="lazy"
                  />
                </div>
              </div>

              {/* Analysis Block(s) */}
              {(q.analysis || q.pro_analysis) && showExplanations && (
                <div className="mt-4 animate-[fade-in_0.3s_ease-out]">
                  {q.pro_analysis ? (
                    // Grid View for Comparison
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 pl-1">
                          Standard Analysis
                        </div>
                        <AnalysisContent
                          analysis={q.analysis}
                          title="Flash/Standard"
                          isResolving={resolvingId === `${q.fileName}-${q.id}-flash`}
                          onReSolve={onReSolveQuestion ? () => handleReSolve(q, "flash") : undefined}
                          onDelete={onDeleteAnalysis ? () => onDeleteAnalysis(q, "standard") : undefined}
                          onCopy={onCopyAnalysis ? () => onCopyAnalysis(q, "standard") : undefined}
                          onEdit={
                            onEditAnalysis ? (field, value) => onEditAnalysis(q, "standard", field, value) : undefined
                          }
                        />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-2 pl-1">
                          Pro Analysis
                        </div>
                        <AnalysisContent
                          analysis={q.pro_analysis}
                          title="Gemini Pro"
                          isPro
                          isResolving={resolvingId === `${q.fileName}-${q.id}-pro`}
                          onReSolve={onReSolveQuestion ? () => handleReSolve(q, "pro") : undefined}
                          onDelete={onDeleteAnalysis ? () => onDeleteAnalysis(q, "pro") : undefined}
                          onCopy={onCopyAnalysis ? () => onCopyAnalysis(q, "pro") : undefined}
                          onEdit={onEditAnalysis ? (field, value) => onEditAnalysis(q, "pro", field, value) : undefined}
                        />
                      </div>
                    </div>
                  ) : (
                    // Single View
                    <AnalysisContent
                      analysis={q.analysis}
                      isResolving={resolvingId === `${q.fileName}-${q.id}-flash`}
                      onReSolve={onReSolveQuestion ? () => handleReSolve(q, "flash") : undefined}
                      onDelete={onDeleteAnalysis ? () => onDeleteAnalysis(q, "standard") : undefined}
                      onCopy={onCopyAnalysis ? () => onCopyAnalysis(q, "standard") : undefined}
                      onEdit={
                        onEditAnalysis ? (field, value) => onEditAnalysis(q, "standard", field, value) : undefined
                      }
                    />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
