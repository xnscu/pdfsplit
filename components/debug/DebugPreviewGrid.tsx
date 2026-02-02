import React, { useMemo, useState, useCallback } from "react";
import { QuestionImage } from "../../types";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { resolveImageUrl } from "../../services/r2Service";

interface Props {
  questions: QuestionImage[];
  onQuestionClick: (q: QuestionImage) => void;
  onReSolveQuestion?: (q: QuestionImage, modelType: "flash" | "pro") => Promise<void>;
  onDeleteAnalysis?: (q: QuestionImage, type: "standard" | "pro") => void;
  onCopyAnalysis?: (q: QuestionImage, fromType: "standard" | "pro") => void;
  onEditAnalysis?: (q: QuestionImage, type: "standard" | "pro", field: string, value: string) => Promise<void>;
  enableAnchors?: boolean; // Enable anchor links for each question
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
  isResolving?: boolean;
  onReSolve?: () => void;
  onDelete?: () => void;
  onCopy?: () => void;
  onEdit?: (field: string, value: string) => Promise<void>;
}> = ({ analysis, title, isPro, isResolving, onReSolve, onDelete, onCopy, onEdit }) => {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleStartEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue || "");
  };

  const handleSaveEdit = async () => {
    if (!editingField || !onEdit) return;
    setIsSaving(true);
    try {
      await onEdit(editingField, editValue);
      setEditingField(null);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingField(null);
    setEditValue("");
  };

  if (!analysis) return <div className="text-slate-400 italic text-sm p-4">暂无解析数据</div>;

  const renderEditableSection = (sectionTitle: string, field: string, content: string | undefined) => {
    const isEditing = editingField === field;
    
    return (
      <div className="prose prose-sm max-w-none prose-slate prose-headings:font-bold prose-headings:text-slate-900 prose-p:text-slate-800">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="text-sm font-bold text-slate-900 border-b border-slate-300 pb-0.5 inline-block m-0">
            {sectionTitle}
          </h4>
          {onEdit && !isEditing && (
            <button
              onClick={() => handleStartEdit(field, content || "")}
              className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
              title="编辑"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
        </div>
        {isEditing ? (
          <div className="mt-2">
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="w-full h-40 p-3 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
              placeholder={`输入${sectionTitle}内容...`}
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={handleCancelEdit}
                disabled={isSaving}
                className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={isSaving}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {isSaving && (
                  <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                保存
              </button>
            </div>
          </div>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {cleanMd(content)}
          </ReactMarkdown>
        )}
      </div>
    );
  };

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
          {onReSolve && (
            <button
              onClick={onReSolve}
              disabled={isResolving}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                isResolving
                  ? "bg-blue-100 text-blue-400 cursor-wait"
                  : isPro 
                    ? "bg-purple-50 text-purple-600 hover:bg-purple-100 border border-purple-200"
                    : "bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
              }`}
              title={`使用 ${isPro ? "Pro" : "Flash"} 重新解题`}
            >
              {isResolving ? (
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

        {/* Standard Solution - Editable */}
        {renderEditableSection("标准解答", "solution_md", analysis.solution_md)}

        {/* Analysis - Editable */}
        {renderEditableSection("思路分析", "analysis_md", analysis.analysis_md)}

        {/* Breakthrough - Editable */}
        {(analysis.breakthrough_md || editingField === "breakthrough_md") && 
          renderEditableSection("突破口", "breakthrough_md", analysis.breakthrough_md)
        }
        
        {/* Add breakthrough button if not present */}
        {!analysis.breakthrough_md && editingField !== "breakthrough_md" && onEdit && (
          <button
            onClick={() => handleStartEdit("breakthrough_md", "")}
            className="text-xs text-slate-400 hover:text-blue-600 flex items-center gap-1 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            添加突破口
          </button>
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
  onEditAnalysis,
  enableAnchors = false,
}) => {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Handle re-solve with specific model type
  const handleReSolve = useCallback(async (q: QuestionImage, modelType: "flash" | "pro") => {
    if (!onReSolveQuestion) return;
    const uniqueId = `${q.fileName}-${q.id}-${modelType}`;
    if (resolvingId === uniqueId) return;
    setResolvingId(uniqueId);
    try {
      await onReSolveQuestion(q, modelType);
    } finally {
      setResolvingId(null);
    }
  }, [onReSolveQuestion, resolvingId]);

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
    const baseUrl = currentUrl.split('#question-')[0];
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
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
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
                            isResolving={resolvingId === `${q.fileName}-${q.id}-flash`}
                            onReSolve={onReSolveQuestion ? () => handleReSolve(q, "flash") : undefined}
                            onDelete={onDeleteAnalysis ? () => onDeleteAnalysis(q, "standard") : undefined}
                            onCopy={onCopyAnalysis ? () => onCopyAnalysis(q, "standard") : undefined}
                            onEdit={onEditAnalysis ? (field, value) => onEditAnalysis(q, "standard", field, value) : undefined}
                           />
                        </div>
                        <div>
                           <div className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-2 pl-1">Pro Analysis</div>
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
                      onEdit={onEditAnalysis ? (field, value) => onEditAnalysis(q, "standard", field, value) : undefined}
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
