import React from "react";
import { CropSettings } from "../services/pdfService";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedModel: string;
  setSelectedModel: (m: string) => void;
  concurrency: number;
  setConcurrency: (c: number) => void;
  analysisConcurrency?: number;
  setAnalysisConcurrency?: (c: number) => void;
  cropSettings: CropSettings;
  setCropSettings: React.Dispatch<React.SetStateAction<CropSettings>>;
  useHistoryCache: boolean;
  setUseHistoryCache: (b: boolean) => void;
  batchSize?: number;
  setBatchSize?: (b: number) => void;
  apiKey?: string;
  setApiKey?: (key: string) => void;
  syncConcurrency?: number;
  setSyncConcurrency?: (c: number) => void;
  batchCheckChunkSize?: number;
  setBatchCheckChunkSize?: (c: number) => void;
  batchCheckConcurrency?: number;
  setBatchCheckConcurrency?: (c: number) => void;
}

export const ConfigurationPanel: React.FC<Props> = ({
  isOpen,
  onClose,
  selectedModel,
  setSelectedModel,
  concurrency,
  setConcurrency,
  analysisConcurrency = 5,
  setAnalysisConcurrency,
  cropSettings,
  setCropSettings,
  useHistoryCache,
  setUseHistoryCache,
  batchSize,
  setBatchSize,
  apiKey,
  setApiKey,
  syncConcurrency = 10,
  setSyncConcurrency,
  batchCheckChunkSize = 50,
  setBatchCheckChunkSize,
  batchCheckConcurrency = 100,
  setBatchCheckConcurrency,
}) => {
  if (!isOpen) return null;

  const detectedCores =
    typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm animate-[fade-in_0.2s_ease-out]"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-[2.5rem] p-8 md:p-12 border border-slate-200 shadow-2xl relative animate-[scale-in_0.2s_cubic-bezier(0.175,0.885,0.32,1.275)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-8 top-8 p-3 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-colors text-slate-500 hover:text-slate-800"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white">
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c-.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">
            Configuration
          </h2>
        </div>

        <div className="space-y-8">
          {/* API Key Section */}
          {setApiKey && (
            <div className="space-y-4 pt-2">
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">
                Custom API Key
              </h3>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500">
                  Gemini API Key (Optional)
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Leave empty to use default system key"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-slate-300 placeholder:font-normal"
                />
                <p className="text-[10px] text-slate-400 font-medium">
                  Entering a key here will override the built-in default key for
                  all AI operations.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-4 pt-6 border-t border-slate-100">
            <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">
              AI Model
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                {
                  id: "gemini-3-flash-preview",
                  name: "Gemini 3.0 Flash",
                  desc: "Fastest & Cost-effective",
                },
                {
                  id: "gemini-3-pro-preview",
                  name: "Gemini 3.0 Pro",
                  desc: "High Reasoning Power",
                },
              ].map((model) => (
                <button
                  key={model.id}
                  onClick={() => setSelectedModel(model.id)}
                  className={`p-4 rounded-2xl border-2 text-left transition-all ${selectedModel === model.id ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-blue-300"}`}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span
                      className={`font-black ${selectedModel === model.id ? "text-blue-700" : "text-slate-700"}`}
                    >
                      {model.name}
                    </span>
                    {selectedModel === model.id && (
                      <div className="w-3 h-3 bg-blue-600 rounded-full"></div>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 font-bold">
                    {model.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6 pt-6 border-t border-slate-100">
            <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">
              Performance
            </h3>

            <div className="space-y-3">
              <div className="flex justify-between">
                <label className="font-bold text-slate-700">
                  Page Detection Concurrency
                </label>
                <span className="font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-lg text-xs">
                  {concurrency} Pages
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={concurrency}
                onChange={(e) => setConcurrency(parseInt(e.target.value))}
                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
            </div>

            {setAnalysisConcurrency && (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <label className="font-bold text-slate-700">
                    Question Analysis Concurrency
                  </label>
                  <span className="font-black text-purple-600 bg-purple-50 px-3 py-1 rounded-lg text-xs">
                    {analysisConcurrency} Questions
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={analysisConcurrency}
                  onChange={(e) =>
                    setAnalysisConcurrency(parseInt(e.target.value))
                  }
                  className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-purple-600"
                />
                <p className="text-xs text-slate-400 font-medium">
                  Parallel AI requests for solving math problems.
                </p>
              </div>
            )}

            {setBatchSize && batchSize !== undefined && (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <label className="font-bold text-slate-700">
                    Image Processing Batch Size
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-lg text-xs">
                      {batchSize} Threads
                    </span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Max: {detectedCores}
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min="1"
                  max={detectedCores}
                  step="1"
                  value={batchSize}
                  onChange={(e) => setBatchSize(parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>
            )}

            {setSyncConcurrency && (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <label className="font-bold text-slate-700">
                    Cloud Sync Concurrency
                  </label>
                  <span className="font-black text-emerald-600 bg-emerald-50 px-3 py-1 rounded-lg text-xs">
                    {syncConcurrency} Uploads
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="50"
                  value={syncConcurrency}
                  onChange={(e) =>
                    setSyncConcurrency(parseInt(e.target.value))
                  }
                  className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                />
                <p className="text-xs text-slate-400 font-medium">
                  Parallel image uploads during cloud sync. Higher values = faster sync but more network load.
                </p>
              </div>
            )}

            {setBatchCheckChunkSize && (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <label className="font-bold text-slate-700">
                    Batch Check Chunk Size
                  </label>
                  <span className="font-black text-cyan-600 bg-cyan-50 px-3 py-1 rounded-lg text-xs">
                    {batchCheckChunkSize} Hashes/Request
                  </span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="200"
                  step="10"
                  value={batchCheckChunkSize}
                  onChange={(e) =>
                    setBatchCheckChunkSize(parseInt(e.target.value))
                  }
                  className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-cyan-600"
                />
                <p className="text-xs text-slate-400 font-medium">
                  Number of image hashes to check per API request. Higher values = fewer requests but larger payloads.
                </p>
              </div>
            )}

            {setBatchCheckConcurrency && (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <label className="font-bold text-slate-700">
                    Batch Check Concurrency
                  </label>
                  <span className="font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg text-xs">
                    {batchCheckConcurrency} Requests
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="200"
                  step="10"
                  value={batchCheckConcurrency}
                  onChange={(e) =>
                    setBatchCheckConcurrency(parseInt(e.target.value))
                  }
                  className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
                <p className="text-xs text-slate-400 font-medium">
                  Parallel batch check requests. Higher values = faster checking but more network load.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between mt-4">
              <label className="font-bold text-slate-700">
                Use History Cache
              </label>
              <div
                className={`w-14 h-8 flex items-center bg-slate-200 rounded-full p-1 cursor-pointer transition-colors ${useHistoryCache ? "bg-blue-600" : ""}`}
                onClick={() => setUseHistoryCache(!useHistoryCache)}
              >
                <div
                  className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform ${useHistoryCache ? "translate-x-6" : ""}`}
                ></div>
              </div>
            </div>
          </div>

          <div className="space-y-6 pt-6 border-t border-slate-100">
            <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">
              Global Crop Defaults
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500">
                  Crop Padding (px)
                </label>
                <input
                  type="number"
                  value={cropSettings.cropPadding}
                  onChange={(e) =>
                    setCropSettings({
                      ...cropSettings,
                      cropPadding: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500">
                  Inner Padding (px)
                </label>
                <input
                  type="number"
                  value={cropSettings.canvasPadding}
                  onChange={(e) =>
                    setCropSettings({
                      ...cropSettings,
                      canvasPadding: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500">
                  Merge Overlap (px)
                </label>
                <input
                  type="number"
                  value={cropSettings.mergeOverlap}
                  onChange={(e) =>
                    setCropSettings({
                      ...cropSettings,
                      mergeOverlap: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
