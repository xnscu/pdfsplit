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
  onDeleteAnalysis?: (q: QuestionImage, type: "standard" | "pro") => void;
  onCopyAnalysis?: (q: QuestionImage, fromType: "standard" | "pro") => void;
}

// Helper to clean Gemini markdown output
// Replace literal "\n" (backslash + n) with double newline for paragraph breaks
// BUT protect LaTeX commands starting with n (e.g., \nu, \neq, \nabla) by using negative lookahead
const cleanMd = (text: string | undefined) => {
  if (!text) return "";
  return text.replace(/\\n(?![a-z])/g, "\n\n");
};

// Helper Component for Analysis Content
const AnalysisContent: React.FC<{
  analysis: any;
  title?: string;
  isPro?: boolean;
  onDelete?: () => void;
  onCopy?: () => void;
}> = ({ analysis, title, isPro, onDelete, onCopy }) => {
  if (!analysis) return <div className="text-slate-400 italic text-sm p-4">暂无解析数据</div>;

  return (
    <div className={`bg-white rounded-xl p-6 border shadow-sm ${isPro ? "border-purple-200 shadow-purple-50" : "border-slate-200"}`}>
      {/* Metadata Tags */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-100">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[10px] font-black uppercase tracking-widest mr-2 flex items-center gap-1 ${isPro ? "text-purple-600" : "text-slate-500"}`}>
            {title || "AI 解析"}
          </span>
          <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded text-xs font-bold border border-slate-200">
            难度: {analysis.difficulty}/5
          </span>
          <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded text-xs font-bold border border-slate-200">
            {analysis.question_type}
          </span>
          <span className={`px-3 py-1 rounded text-xs font-bold border ${analysis.picture_ok ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
            图片: {analysis.picture_ok ? "OK" : "待检查"}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1">
          {onCopy && (
            <button
              onClick={onCopy}
              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-100"
              title={isPro ? "复制到标准解析" : "复制到 Pro 解析"}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
              title="删除此解析"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {/* Tags Breadcrumbs */}
        <div>
          {(analysis.tags || []).map((tag: any, idx: number) => (
            <div key={idx} className="text-sm text-slate-800 font-medium">
              <span className="text-slate-900 font-bold">● {tag.level0}</span>
              {tag.level1 && <span className="text-slate-500"> › {tag.level1}</span>}
              {tag.level2 && <span className="text-slate-500"> › {tag.level2}</span>}
            </div>
          ))}
        </div>

        {/* Standard Solution */}
        <div className="prose prose-sm max-w-none prose-slate prose-headings:font-bold prose-headings:text-slate-900 prose-p:text-slate-800">
          <h4 className="text-sm font-bold text-slate-900 mb-1 border-b border-slate-300 pb-0.5 inline-block">
            标准解答
          </h4>
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {cleanMd(analysis.solution_md)}
          </ReactMarkdown>
        </div>

        {/* Analysis */}
        <div className="prose prose-sm max-w-none prose-slate prose-headings:font-bold prose-headings:text-slate-900 prose-p:text-slate-800">
          <h4 className="text-sm font-bold text-slate-900 mb-1 border-b border-slate-300 pb-0.5 inline-block">
            思路分析
          </h4>
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {cleanMd(analysis.analysis_md)}
          </ReactMarkdown>
        </div>

        {/* Breakthrough */}
        {analysis.breakthrough_md && (
          <div className="prose prose-sm max-w-none prose-slate prose-headings:font-bold prose-headings:text-slate-900 prose-p:text-slate-800">
            <h4 className="text-sm font-bold text-slate-900 mb-1 border-b border-slate-300 pb-0.5 inline-block">
              突破口
            </h4>
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
              {cleanMd(analysis.breakthrough_md)}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
};

export const DebugPreviewGrid: React.FC<Props> = ({
  questions,
  onQuestionClick,
  onReSolveQuestion,
  onDeleteAnalysis,
  onCopyAnalysis,
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
      <div className={`mx-auto min-h-full py-10 px-6 md:px-12 bg-white ${questions.some(q => q.pro_analysis) ? "max-w-[95vw]" : "max-w-5xl"}`}>
        <div className="flex flex-col items-start w-full">
          {sortedQuestions.map((q) => (
            <div
              key={q.id}
              className="w-full mb-8 border-b border-slate-100 pb-8 last:border-0"
            >
              {/* Image and Controls */}
              <div className="flex items-start gap-4 mb-4">
                 {/* Image */}
                 <div
                  onClick={() => onQuestionClick(q)}
                  className="cursor-pointer group relative rounded-lg overflow-hidden border border-transparent hover:border-slate-200 transition-all flex-1"
                  title={`Click to debug Question ${q.id}`}
                >
                  <img
                    src={resolveImageUrl(q.dataUrl)}
                    alt=""
                    className="max-w-full h-auto object-contain block select-none max-h-[400px]"
                    loading="lazy"
                  />
                </div>

                {onReSolveQuestion && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const uniqueId = `${q.fileName}-${q.id}`;
                      if (resolvingId === uniqueId) return;
                      setResolvingId(uniqueId);
                      try {
                        await onReSolveQuestion(q);
                      } finally {
                        setResolvingId(null);
                      }
                    }}
                    disabled={resolvingId === `${q.fileName}-${q.id}`}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                      resolvingId === `${q.fileName}-${q.id}`
                        ? "bg-blue-100 text-blue-400 cursor-wait"
                        : "bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
                    }`}
                    title="重新解题"
                  >
                    {resolvingId === `${q.fileName}-${q.id}` ? (
                      <>
                        <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        解题中...
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        重新解题
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Analysis Block(s) */}
              {(q.analysis || q.pro_analysis) && (
                <div className="mt-4 animate-[fade-in_0.3s_ease-out]">
                  {q.pro_analysis ? (
                     // Grid View for Comparison
                     <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div>
                           <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 pl-1">Standard Analysis</div>
                           <AnalysisContent 
                            analysis={q.analysis} 
                            title="Flash/Standard" 
                            onDelete={onDeleteAnalysis ? () => onDeleteAnalysis(q, "standard") : undefined}
                            onCopy={onCopyAnalysis ? () => onCopyAnalysis(q, "standard") : undefined}
                           />
                        </div>
                        <div>
                           <div className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-2 pl-1">Pro Analysis</div>
                           <AnalysisContent 
                            analysis={q.pro_analysis} 
                            title="Gemini Pro" 
                            isPro 
                            onDelete={onDeleteAnalysis ? () => onDeleteAnalysis(q, "pro") : undefined}
                            onCopy={onCopyAnalysis ? () => onCopyAnalysis(q, "pro") : undefined}
                           />
                        </div>
                     </div>
                  ) : (
                     // Single View
                     <AnalysisContent 
                      analysis={q.analysis} 
                      onDelete={onDeleteAnalysis ? () => onDeleteAnalysis(q, "standard") : undefined}
                      onCopy={onCopyAnalysis ? () => onCopyAnalysis(q, "standard") : undefined}
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
