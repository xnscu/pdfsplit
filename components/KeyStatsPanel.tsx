import React, { useState, useEffect } from "react";
import {
  KeyStats,
  subscribeToStats,
  resetStats,
} from "../services/keyPoolService";

interface Props {
  isVisible: boolean;
}

export const KeyStatsPanel: React.FC<Props> = ({ isVisible }) => {
  const [stats, setStats] = useState<KeyStats[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToStats(setStats);
    return unsubscribe;
  }, []);

  if (!isVisible || stats.length === 0) return null;

  const totalCalls = stats.reduce((sum, s) => sum + s.callCount, 0);
  const totalSuccess = stats.reduce((sum, s) => sum + s.successCount, 0);
  const totalFailure = stats.reduce((sum, s) => sum + s.failureCount, 0);
  const overallSuccessRate = totalCalls > 0 ? ((totalSuccess / totalCalls) * 100).toFixed(1) : "0.0";

  return (
    <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-slate-200 shadow-lg p-4 space-y-4 animate-[fade-in_0.3s_ease-out]">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
          API Key 调用统计
        </h3>
        <button
          onClick={resetStats}
          className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors px-2 py-1 rounded-lg hover:bg-slate-100"
        >
          重置
        </button>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-4 gap-2 p-3 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl">
        <div className="text-center">
          <div className="text-lg font-black text-slate-800">{totalCalls}</div>
          <div className="text-[10px] font-bold text-slate-500 uppercase">总调用</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-black text-emerald-600">{totalSuccess}</div>
          <div className="text-[10px] font-bold text-slate-500 uppercase">成功</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-black text-red-500">{totalFailure}</div>
          <div className="text-[10px] font-bold text-slate-500 uppercase">失败</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-black text-blue-600">{overallSuccessRate}%</div>
          <div className="text-[10px] font-bold text-slate-500 uppercase">成功率</div>
        </div>
      </div>

      {/* Per-Key Stats */}
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {stats.map((stat, index) => (
          <div
            key={stat.key}
            className="flex items-center justify-between p-2 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-slate-400 w-6">{index + 1}.</span>
              <span className="font-mono text-xs text-slate-600">{stat.maskedKey}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold text-slate-500">{stat.callCount}</span>
                <span className="text-[10px] text-slate-400">调用</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold text-emerald-600">{stat.successCount}</span>
                <span className="text-[10px] text-emerald-400">✓</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold text-red-500">{stat.failureCount}</span>
                <span className="text-[10px] text-red-400">✗</span>
              </div>
              <div
                className={`text-xs font-black px-2 py-0.5 rounded ${
                  stat.successRate >= 80
                    ? "bg-emerald-100 text-emerald-700"
                    : stat.successRate >= 50
                    ? "bg-yellow-100 text-yellow-700"
                    : stat.callCount === 0
                    ? "bg-slate-100 text-slate-500"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {stat.callCount > 0 ? `${stat.successRate.toFixed(0)}%` : "-"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
