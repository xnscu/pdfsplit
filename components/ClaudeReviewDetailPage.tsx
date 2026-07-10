import React, { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { resolveImageUrl } from "../services/r2Service";
import { AnalysisContent, cleanMd } from "./debug/AnalysisContent";
import { ClaudeReview, QuestionAnalysis } from "../types";

interface DetailData {
  question_id: string;
  exam_id: string;
  data_url: string;
  page_number: number;
  exam_name: string;
  analysis: QuestionAnalysis | null;
  pro_analysis: QuestionAnalysis | null;
  claude_analysis: (QuestionAnalysis & { final_answers?: string[] }) | null;
  claude_review: ClaudeReview | null;
}

const VERDICT_STYLE: Record<string, { label: string; cls: string; note: string }> = {
  correct: {
    label: "Gemini 正确",
    cls: "bg-emerald-50 text-emerald-800 border-emerald-200",
    note: "两边最终答案一致，或仅是等价形式的不同写法。",
  },
  minor_issue: {
    label: "过程有瑕疵",
    cls: "bg-amber-50 text-amber-800 border-amber-200",
    note: "最终答案正确，但推理过程存在问题。",
  },
  incorrect: {
    label: "Gemini 错误",
    cls: "bg-rose-50 text-rose-800 border-rose-200",
    note: "经独立验算，Gemini 的最终答案错误。",
  },
  unverifiable: {
    label: "无法判定",
    cls: "bg-slate-100 text-slate-700 border-slate-300",
    note: "图片不可读或题目本身有问题，留待人工复核。",
  },
  pending_arbitration: {
    label: "待仲裁",
    cls: "bg-indigo-50 text-indigo-800 border-indigo-200",
    note: "字符串分诊判定两边答案不一致，等待 Opus 逐步验算。",
  },
};

const SEVERITY_LABEL: Record<string, string> = {
  typo: "笔误",
  calculation: "计算错误",
  logic: "逻辑错误",
  answer: "答案错误",
};

const ReviewPanel: React.FC<{ review: ClaudeReview }> = ({ review }) => {
  const style = VERDICT_STYLE[review.verdict] || VERDICT_STYLE.unverifiable;

  return (
    <div className={`rounded-2xl border p-5 ${style.cls}`}>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <span className="text-lg font-bold">{style.label}</span>
        {review.confidence != null && (
          <span className="text-sm opacity-70 tabular-nums">
            置信度 {(review.confidence * 100).toFixed(0)}%
          </span>
        )}
        <span className="text-xs opacity-60 ml-auto font-mono">
          {review.model_id}
          {review.effort ? ` · ${review.effort}` : ""}
        </span>
      </div>

      <p className="text-sm opacity-80 mb-4">{style.note}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div className="bg-white/60 rounded-xl p-3">
          <div className="text-xs opacity-60 mb-1">Claude 的答案</div>
          <div className="font-mono text-xs break-words">{review.claude_answer || "—"}</div>
        </div>
        <div className="bg-white/60 rounded-xl p-3">
          <div className="text-xs opacity-60 mb-1">Gemini 的答案</div>
          <div className="font-mono text-xs break-words">{review.gemini_answer || "—"}</div>
        </div>
      </div>

      {review.issues?.length > 0 && (
        <div className="mt-4">
          <div className="text-xs opacity-60 mb-2">发现的问题</div>
          <ul className="space-y-2">
            {review.issues.map((issue, i) => (
              <li key={i} className="bg-white/60 rounded-xl p-3 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-black/5">
                    {SEVERITY_LABEL[issue.severity] || issue.severity}
                  </span>
                  <span className="text-xs opacity-60">{issue.location}</span>
                </div>
                <div className="opacity-90">{issue.description}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.reviewed_at && (
        <div className="text-xs opacity-50 mt-4">
          核查于 {new Date(review.reviewed_at).toLocaleString("zh-CN")}
        </div>
      )}
    </div>
  );
};

export const ClaudeReviewDetailPage: React.FC = () => {
  const { examId, questionId } = useParams<{ examId: string; questionId: string }>();
  const [data, setData] = useState<DetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!examId || !questionId) return;

    setIsLoading(true);
    setError(null);

    fetch(
      `/api/claude-review/questions/${encodeURIComponent(examId)}/${encodeURIComponent(questionId)}`,
    )
      .then((r) => {
        if (r.status === 404) throw new Error("题目不存在");
        if (!r.ok) throw new Error(`请求失败 (${r.status})`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setIsLoading(false));
  }, [examId, questionId]);

  if (isLoading) {
    return <div className="py-20 text-center text-slate-400">加载中…</div>;
  }

  if (error || !data) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center">
        <p className="text-rose-600 mb-4">{error || "加载失败"}</p>
        <Link to="/claude-review" className="text-indigo-600 hover:underline">
          返回列表
        </Link>
      </div>
    );
  }

  const claudeFinal = data.claude_analysis?.final_answers || [];

  return (
    <div className="max-w-6xl mx-auto py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            to="/claude-review"
            className="text-sm text-slate-500 hover:text-indigo-600 transition-colors"
          >
            ← 返回列表
          </Link>
          <h1 className="text-2xl font-bold text-slate-800 mt-2">第 {data.question_id} 题</h1>
          <p className="text-sm text-slate-500 mt-1">
            {data.exam_name} · 第 {data.page_number} 页
          </p>
        </div>
        <Link
          to={`/inspect/${encodeURIComponent(data.exam_id)}`}
          className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 transition-colors"
        >
          查看整份试卷
        </Link>
      </div>

      {data.claude_review && (
        <div className="mb-6">
          <ReviewPanel review={data.claude_review} />
        </div>
      )}

      {!data.claude_review && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
          这道题 Claude 已经解答，但尚未经过分诊比对。
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700">
              题目原图
            </div>
            <img
              src={resolveImageUrl(data.data_url)}
              alt={`第 ${data.question_id} 题`}
              className="w-full"
            />
          </div>

          {claudeFinal.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-700 mb-3">Claude 的最终答案</div>
              <ol className="space-y-2">
                {claudeFinal.map((ans, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="text-slate-400 shrink-0">({i + 1})</span>
                    <span className="font-mono text-xs text-slate-700 break-words pt-0.5">{ans}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {data.claude_analysis && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-indigo-700 mb-3">Claude 独立解答</div>
              <AnalysisContent analysis={data.claude_analysis} />
            </div>
          )}

          {data.pro_analysis && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-700 mb-3">Gemini Pro 解答</div>
              <AnalysisContent analysis={data.pro_analysis} isPro />
            </div>
          )}
        </div>
      </div>

      {data.claude_review?.corrected_solution_md && (
        <div className="mt-6 bg-white rounded-2xl border border-rose-200 p-5">
          <div className="text-sm font-semibold text-rose-700 mb-3">Claude 给出的修正解答</div>
          {/* Rendered directly rather than through AnalysisContent, which expects a
              full QuestionAnalysis and would show an empty difficulty and a red
              "图片: 待检查" badge for a bare solution string. */}
          <div className="prose prose-slate prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
              {cleanMd(data.claude_review.corrected_solution_md)}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
};
