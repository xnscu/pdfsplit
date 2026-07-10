import React, { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { resolveImageUrl } from "../services/r2Service";
import { ReviewVerdict } from "../types";

const PAGE_SIZE = 24;

// 'pending_arbitration' is written by the server-side triage as a marker, not a
// real verdict, so it is listed here alongside the four terminal verdicts.
type FilterValue = ReviewVerdict | "pending_arbitration" | "unreviewed" | "";

interface ReviewQuestion {
  question_id: string;
  exam_id: string;
  data_url: string;
  page_number: number;
  exam_name: string;
  difficulty: number | null;
  question_type: string | null;
  verdict: FilterValue | null;
  confidence: number | null;
  effort: string | null;
  claude_answer: string | null;
  gemini_answer: string | null;
  claude_final_answers: string[];
}

interface Stats {
  by_verdict: { verdict: string; count: number }[];
  claude_solved: number;
  target: { total: number; solved: number; reviewed: number };
}

const VERDICT_STYLE: Record<string, { label: string; cls: string }> = {
  correct: { label: "Gemini 正确", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  minor_issue: { label: "过程有瑕疵", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  incorrect: { label: "Gemini 错误", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  unverifiable: { label: "无法判定", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  pending_arbitration: { label: "待仲裁", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
};

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "", label: "全部" },
  { value: "correct", label: "Gemini 正确" },
  { value: "incorrect", label: "Gemini 错误" },
  { value: "minor_issue", label: "过程有瑕疵" },
  { value: "pending_arbitration", label: "待仲裁" },
  { value: "unverifiable", label: "无法判定" },
  { value: "unreviewed", label: "未分诊" },
];

const VerdictBadge: React.FC<{ verdict: string | null }> = ({ verdict }) => {
  const style = verdict ? VERDICT_STYLE[verdict] : null;
  if (!style) {
    return (
      <span className="px-2 py-0.5 text-xs rounded-full border bg-white text-slate-400 border-slate-200">
        未分诊
      </span>
    );
  }
  return <span className={`px-2 py-0.5 text-xs rounded-full border ${style.cls}`}>{style.label}</span>;
};

const ProgressBar: React.FC<{ stats: Stats }> = ({ stats }) => {
  const { total, solved, reviewed } = stats.target;
  if (!total) return null;

  const solvedPct = (solved / total) * 100;
  const reviewedPct = (reviewed / total) * 100;

  // At 15 questions per daily run, the remaining work is this many days out.
  const remaining = total - solved;
  const daysLeft = Math.ceil(remaining / 15);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700">
          核查进度
          <span className="ml-2 font-normal text-slate-400">难度 ≥4 的解答题</span>
        </h2>
        <span className="text-sm text-slate-500">
          {solved} / {total}
        </span>
      </div>

      <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-indigo-200 transition-all"
          style={{ width: `${solvedPct}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 bg-indigo-600 transition-all"
          style={{ width: `${reviewedPct}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-xs text-slate-500">
        <span>
          <span className="inline-block w-2 h-2 rounded-full bg-indigo-200 mr-1.5 align-middle" />
          已解答 {solved}
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-full bg-indigo-600 mr-1.5 align-middle" />
          已核查 {reviewed}
        </span>
        <span>剩余 {remaining}，按每天 15 道约需 {daysLeft} 天</span>
      </div>

      <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-100">
        {stats.by_verdict
          .filter((v) => v.verdict !== "not_reviewed")
          .map((v) => (
            <div key={v.verdict} className="flex items-center gap-1.5">
              <VerdictBadge verdict={v.verdict} />
              <span className="text-sm font-medium text-slate-700 tabular-nums">{v.count}</span>
            </div>
          ))}
      </div>
    </div>
  );
};

export const ClaudeReviewPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [stats, setStats] = useState<Stats | null>(null);
  const [questions, setQuestions] = useState<ReviewQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const verdict = (searchParams.get("verdict") || "") as FilterValue;
  const page = Math.max(parseInt(searchParams.get("page") || "1", 10) || 1, 1);
  const offset = (page - 1) * PAGE_SIZE;

  const setFilter = useCallback(
    (next: FilterValue) => {
      const params: Record<string, string> = {};
      if (next) params.verdict = next;
      setSearchParams(params);
    },
    [setSearchParams],
  );

  const setPage = useCallback(
    (next: number) => {
      const params: Record<string, string> = {};
      if (verdict) params.verdict = verdict;
      if (next > 1) params.page = String(next);
      setSearchParams(params);
    },
    [setSearchParams, verdict],
  );

  useEffect(() => {
    fetch("/api/claude-review/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {
        /* progress bar is optional; the list below still renders */
      });
  }, []);

  useEffect(() => {
    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (verdict) params.set("verdict", verdict);

    fetch(`/api/claude-review/questions?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`请求失败 (${r.status})`);
        return r.json();
      })
      .then((data) => {
        setQuestions(data.questions);
        setTotal(data.total);
      })
      .catch((e) => setError(e.message))
      .finally(() => setIsLoading(false));
  }, [verdict, offset]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="max-w-7xl mx-auto py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Claude 核查</h1>
          <p className="text-sm text-slate-500 mt-1">
            Claude 独立解答后与 Gemini Pro 的答案对账，分歧题交由 Opus 仲裁
          </p>
        </div>
        <Link to="/" className="text-sm text-slate-500 hover:text-indigo-600 transition-colors">
          返回首页
        </Link>
      </div>

      {stats && (
        <div className="mb-6">
          <ProgressBar stats={stats} />
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              verdict === f.value
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="py-20 text-center text-slate-400">加载中…</div>
      ) : questions.length === 0 ? (
        <div className="py-20 text-center text-slate-400">
          没有符合条件的题目。Claude 尚未处理，或该分类为空。
        </div>
      ) : (
        <>
          <div className="text-sm text-slate-400 mb-3">共 {total} 道</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {questions.map((q) => (
              <Link
                key={`${q.exam_id}:${q.question_id}`}
                to={`/claude-review/${encodeURIComponent(q.exam_id)}/${encodeURIComponent(q.question_id)}`}
                className="group bg-white rounded-2xl border border-slate-200 overflow-hidden hover:border-indigo-300 hover:shadow-lg transition-all"
              >
                <div className="h-44 bg-slate-50 overflow-hidden border-b border-slate-100">
                  <img
                    src={resolveImageUrl(q.data_url)}
                    alt={`第 ${q.question_id} 题`}
                    loading="lazy"
                    className="w-full h-full object-cover object-top group-hover:scale-[1.02] transition-transform"
                  />
                </div>

                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-700">
                      第 {q.question_id} 题
                      {q.difficulty != null && (
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          难度 {q.difficulty}
                        </span>
                      )}
                    </span>
                    <VerdictBadge verdict={q.verdict} />
                  </div>

                  <div className="text-xs text-slate-400 truncate mb-2" title={q.exam_name}>
                    {q.exam_name}
                  </div>

                  {q.claude_answer && q.gemini_answer && (
                    <div className="space-y-1 text-xs pt-2 border-t border-slate-100">
                      <div className="flex gap-2">
                        <span className="text-slate-400 shrink-0 w-12">Claude</span>
                        <span className="text-slate-600 truncate" title={q.claude_answer}>
                          {q.claude_answer}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-slate-400 shrink-0 w-12">Gemini</span>
                        <span className="text-slate-600 truncate" title={q.gemini_answer}>
                          {q.gemini_answer}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-8">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:border-indigo-300 transition-colors"
              >
                上一页
              </button>
              <span className="text-sm text-slate-500 tabular-nums">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:border-indigo-300 transition-colors"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
