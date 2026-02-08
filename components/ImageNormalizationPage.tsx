import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface TaskStatus {
  id: string;
  task_type: string;
  total: number;
  processed: number;
  status: "running" | "completed" | "failed" | "paused";
  updated_at: string;
  metadata: string | null;
}

export const ImageNormalizationPage: React.FC = () => {
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/tasks/image-normalization");
      if (res.ok) {
        const data = await res.json();
        if (data && (data.status || data.id)) {
          setStatus(data);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const getMetadata = () => {
    if (!status?.metadata) return {};
    try {
      return JSON.parse(status.metadata);
    } catch {
      return {};
    }
  };

  const meta = getMetadata();
  const progress = status ? (status.total > 0 ? (status.processed / status.total) * 100 : 0) : 0;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4 mb-8">
        <Link to="/" className="p-2 rounded-full hover:bg-gray-100 transition-colors">
          <svg className="w-6 h-6 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-slate-800">Exam Image Normalization</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold text-slate-700">Task Status</h2>
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              status?.status === "running"
                ? "bg-blue-100 text-blue-800"
                : status?.status === "completed"
                  ? "bg-green-100 text-green-800"
                  : status?.status === "failed"
                    ? "bg-red-100 text-red-800"
                    : "bg-gray-100 text-gray-800"
            }`}
          >
            {status?.status?.toUpperCase() || "IDLE"}
          </span>
        </div>

        {status && status.status ? (
          <div className="space-y-6">
            <div className="relative pt-1">
              <div className="flex mb-2 items-center justify-between">
                <div>
                  <span className="text-xs font-semibold inline-block py-1 px-2 uppercase rounded-full text-blue-600 bg-blue-200">
                    Progress
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-semibold inline-block text-blue-600">
                    {Math.round(progress)}% ({status.processed} / {status.total})
                  </span>
                </div>
              </div>
              <div className="overflow-hidden h-2 mb-4 text-xs flex rounded bg-blue-200">
                <div
                  style={{ width: `${progress}%` }}
                  className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-blue-500 transition-all duration-500"
                ></div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                <p className="text-slate-500 mb-1">Last Updated</p>
                <p className="font-mono text-slate-700">
                  {status.updated_at ? new Date(status.updated_at).toLocaleString() : "-"}
                </p>
              </div>
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                <p className="text-slate-500 mb-1">Current Action</p>
                <p className="font-medium text-slate-700">{meta.message || meta.currentExam || "-"}</p>
              </div>
            </div>

            {meta.currentExam && (
              <div className="bg-slate-50 p-4 rounded-lg text-sm border border-slate-100">
                <p className="text-slate-500 mb-1">Processing Exam:</p>
                <p className="font-medium truncate text-slate-800">{meta.currentExam}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12 text-slate-500">
            {loading ? "Loading status..." : "No active normalization task found."}
            <p className="text-xs mt-2 text-slate-400">Run "npm run normalize" on the server to start processing.</p>
          </div>
        )}
      </div>
    </div>
  );
};
