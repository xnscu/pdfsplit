import React, { useMemo, useState } from "react";
import { QuestionImage } from "../../types";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { resolveImageUrl } from "../../services/r2Service";

interface Props {
  questions: QuestionImage[];
  onQuestionClick: (q: QuestionImage) => void;
  onReSolveQuestion?: (q: QuestionImage) => Promise<void>;
}

// Helper to clean Gemini markdown output
// Replace literal "\n" (backslash + n) with double newline for paragraph breaks
// BUT protect LaTeX commands starting with n (e.g., \nu, \neq, \nabla) by using negative lookahead
const cleanMd = (text: string | undefined) => {
  if (!text) return "";
  return text.replace(/\\n(?![a-z])/g, "\n\n");
};

export const DebugPreviewGrid: React.FC<Props> = ({
  questions,
  onQuestionClick,
  onReSolveQuestion,
}) => {
  const [resolvingId, setResolvingId] = useState<string | null>(null);

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
        <svg
          className="w-16 h-16 mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <p className="font-bold text-lg">No processed images yet</p>
        <p className="text-xs">
          Click "Process" in the toolbar to generate crops.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-y-auto bg-white custom-scrollbar">
      {/*
         Simulate final paper width (e.g. A4 constrained or responsive max-width).
         Centered content with white background.
      */}
      <div className="max-w-5xl mx-auto min-h-full py-10 px-6 md:px-12 bg-white">
        <div className="flex flex-col items-start w-full">
          {sortedQuestions.map((q) => (
            <div
              key={q.id}
              className="w-full mb-8 border-b border-slate-100 pb-8 last:border-0"
            >
              {/* Image only, no metadata overlay on image to keep it clean */}
              <div
                onClick={() => onQuestionClick(q)}
                className="cursor-pointer group relative rounded-lg overflow-hidden border border-transparent hover:border-slate-200 transition-all"
                title={`Click to debug Question ${q.id}`}
              >
                <img
                  src={resolveImageUrl(q.dataUrl)}
                  alt=""
                  className="max-w-full h-auto object-contain block select-none"
                  loading="lazy"
                />
              </div>

              {/* Analysis Block */}
              {q.analysis && (
                <div className="mt-4 px-2 md:px-4 animate-[fade-in_0.3s_ease-out]">
                  <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
                    {/* Metadata Tags */}
                    <div className="flex flex-wrap items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 mr-2 flex items-center gap-1">
                        AI 解析
                      </span>
                      <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded text-xs font-bold border border-slate-200">
                        难度: {q.analysis.difficulty}/5
                      </span>
                      <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded text-xs font-bold border border-slate-200">
                        {q.analysis.question_type}
                      </span>
                      {/* Spacer */}
                      <div className="flex-1" />
                      {/* Re-solve Button */}
                      {onReSolveQuestion && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (resolvingId === q.id) return;
                            setResolvingId(q.id);
                            try {
                              await onReSolveQuestion(q);
                            } finally {
                              setResolvingId(null);
                            }
                          }}
                          disabled={resolvingId === q.id}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                            resolvingId === q.id
                              ? "bg-blue-100 text-blue-400 cursor-wait"
                              : "bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
                          }`}
                          title="重新解题"
                        >
                          {resolvingId === q.id ? (
                            <>
                              <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                />
                              </svg>
                              解题中...
                            </>
                          ) : (
                            <>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                />
                              </svg>
                              重新解题
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    <div className="space-y-6">
                      {/* Tags Breadcrumbs */}
                      <div>
                        {(q.analysis.tags || []).map((tag, idx) => (
                          <div
                            key={idx}
                            className="text-sm text-slate-800 font-medium"
                          >
                            <span className="text-slate-900 font-bold">
                              ● {tag.level0}
                            </span>
                            {tag.level1 && (
                              <span className="text-slate-500">
                                {" "}
                                › {tag.level1}
                              </span>
                            )}
                            {tag.level2 && (
                              <span className="text-slate-500">
                                {" "}
                                › {tag.level2}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Standard Solution */}
                      <div className="prose prose-sm max-w-none prose-slate prose-headings:font-bold prose-headings:text-slate-900 prose-p:text-slate-800">
                        <h4 className="text-sm font-bold text-slate-900 mb-1 border-b border-slate-300 pb-0.5 inline-block">
                          标准解答
                        </h4>
                        <ReactMarkdown
                          remarkPlugins={[remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                        >
                          {cleanMd(q.analysis.solution_md)}
                        </ReactMarkdown>
                      </div>

                      {/* Analysis */}
                      <div className="prose prose-sm max-w-none prose-slate prose-headings:font-bold prose-headings:text-slate-900 prose-p:text-slate-800">
                        <h4 className="text-sm font-bold text-slate-900 mb-1 border-b border-slate-300 pb-0.5 inline-block">
                          思路分析
                        </h4>
                        <ReactMarkdown
                          remarkPlugins={[remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                        >
                          {cleanMd(q.analysis.analysis_md)}
                        </ReactMarkdown>
                      </div>

                      {/* Breakthrough */}
                      {q.analysis.breakthrough_md && (
                        <div className="prose prose-sm max-w-none prose-slate prose-headings:font-bold prose-headings:text-slate-900 prose-p:text-slate-800">
                          <h4 className="text-sm font-bold text-slate-900 mb-1 border-b border-slate-300 pb-0.5 inline-block">
                            突破口
                          </h4>
                          <ReactMarkdown
                            remarkPlugins={[remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                          >
                            {cleanMd(q.analysis.breakthrough_md)}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
