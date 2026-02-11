import React, { useState, useCallback } from "react";
import { QuestionImage } from "../types";
import { AnalysisContent } from "./debug/AnalysisContent";
import { resolveImageUrl } from "../services/r2Service";

interface QuestionDisplayCardProps {
  question: QuestionImage;
  enableAnchors?: boolean;
  showExplanations?: boolean;
  onQuestionClick?: (q: QuestionImage) => void;
  onReSolve?: (q: QuestionImage, modelType: "flash" | "pro") => Promise<void>;
  onDeleteAnalysis?: (q: QuestionImage, type: "standard" | "pro") => void;
  onCopyAnalysis?: (q: QuestionImage, fromType: "standard" | "pro") => void;
  onEditAnalysis?: (q: QuestionImage, type: "standard" | "pro", field: string, value: string) => Promise<void>;
  showExamName?: boolean; // Whether to show the exam name
}

export const QuestionDisplayCard: React.FC<QuestionDisplayCardProps> = ({
  question,
  enableAnchors = false,
  showExplanations = true,
  onQuestionClick,
  onReSolve,
  onDeleteAnalysis,
  onCopyAnalysis,
  onEditAnalysis,
  showExamName = false,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [resolvingType, setResolvingType] = useState<"flash" | "pro" | null>(null);

  const handleCopyLink = useCallback((questionId: string) => {
    const currentUrl = window.location.href;
    const baseUrl = currentUrl.split("#question-")[0];
    const url = `${baseUrl}#question-${questionId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(questionId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  const handleReSolveWrapper = async (modelType: "flash" | "pro") => {
    if (!onReSolve || resolvingType) return;
    setResolvingType(modelType);
    try {
      await onReSolve(question, modelType);
    } finally {
      setResolvingType(null);
    }
  };

  return (
    <div
      id={enableAnchors ? `question-${question.id}` : undefined}
      className="w-full mb-8 border-b border-slate-100 pb-8 last:border-0 scroll-mt-4"
    >
      {/* Question Header with Anchor */}
      <div className="flex items-center gap-3 mb-4">
        {showExamName && question.exam_name && (
          <span className="text-sm font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
            {question.exam_name}
          </span>
        )}
        <span className="text-lg font-black text-slate-800">Q{question.id}</span>
        {enableAnchors && (
          <button
            onClick={() => handleCopyLink(question.id)}
            className={`p-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
              copiedId === question.id
                ? "bg-green-100 text-green-600"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
            }`}
            title="复制题目链接"
          >
            {copiedId === question.id ? (
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
      <div className="mb-4 flex justify-start">
        <div
          onClick={onQuestionClick ? () => onQuestionClick(question) : undefined}
          className={`${onQuestionClick ? "cursor-pointer hover:border-slate-200" : ""} group relative rounded-lg overflow-hidden border border-transparent transition-all inline-block`}
          title={onQuestionClick ? `Click to debug Question ${question.id}` : undefined}
        >
          <img
            src={resolveImageUrl(question.dataUrl)}
            alt={`Question ${question.id}`}
            className="max-w-full h-auto object-contain block select-none"
            loading="lazy"
          />
        </div>
      </div>

      {/* Analysis Block(s) */}
      {(question.analysis || question.pro_analysis) && showExplanations && (
        <div className="mt-4 animate-[fade-in_0.3s_ease-out]">
          {question.pro_analysis ? (
            <AnalysisContent
              analysis={question.pro_analysis}
              title="Gemini Pro"
              isPro
              isResolving={resolvingType === "pro"}
              onReSolve={onReSolve ? () => handleReSolveWrapper("pro") : undefined}
              onDelete={onDeleteAnalysis ? () => onDeleteAnalysis(question, "pro") : undefined}
              onCopy={onCopyAnalysis ? () => onCopyAnalysis(question, "pro") : undefined}
              onEdit={onEditAnalysis ? (field, value) => onEditAnalysis(question, "pro", field, value) : undefined}
            />
          ) : (
            <AnalysisContent
              analysis={question.analysis}
              isResolving={resolvingType === "flash"}
              onReSolve={onReSolve ? () => handleReSolveWrapper("flash") : undefined}
              onDelete={onDeleteAnalysis ? () => onDeleteAnalysis(question, "standard") : undefined}
              onCopy={onCopyAnalysis ? () => onCopyAnalysis(question, "standard") : undefined}
              onEdit={onEditAnalysis ? (field, value) => onEditAnalysis(question, "standard", field, value) : undefined}
            />
          )}
        </div>
      )}
    </div>
  );
};
