import React, { useState, useEffect } from "react";
import { DetectedQuestion, QuestionImage, DebugPageData } from "../../types";
import { generateDebugPreviews } from "../../services/generationService";
import { CropSettings } from "../../services/pdfService";
import { resolveImageUrl } from "../../services/r2Service";

interface Props {
  width: number;
  selectedDetection:
    | (DetectedQuestion & { pageNumber: number; fileName: string })
    | null;
  selectedImage: QuestionImage | null;
  pageData?: DebugPageData;
  isProcessing: boolean;
  draggingSide: "left" | "right" | "top" | "bottom" | null;
  dragValue: number | null;
  columnInfo: {
    indices: number[];
    initialLeft: number;
    initialRight: number;
  } | null;
  cropSettings: CropSettings;
}

export const DebugInspectorPanel: React.FC<Props> = ({
  width,
  selectedDetection,
  selectedImage,
  pageData,
  isProcessing,
  draggingSide,
  dragValue,
  columnInfo,
  cropSettings,
}) => {
  const [stages, setStages] = useState<{
    stage1: string;
    stage2: string;
    stage3: string;
    stage4: string;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Effect: Generate previews when selection changes
  useEffect(() => {
    setStages(null);
    setIsGenerating(false);
    setPreviewError(null);

    if (!selectedDetection || !pageData) return;

    const generatePreviews = async () => {
      setIsGenerating(true);
      try {
        let boxes = selectedDetection.boxes_2d;
        if (!Array.isArray(boxes[0])) {
          // @ts-ignore
          boxes = [boxes];
        }

        // Calculate Target Width for this page (Max of all detection boxes)
        let maxBoxWidthPx = 0;
        if (pageData && pageData.detections) {
          pageData.detections.forEach((det) => {
            const dBoxes = Array.isArray(det.boxes_2d[0])
              ? det.boxes_2d
              : [det.boxes_2d];
            dBoxes.forEach((b) => {
              // @ts-ignore
              const w = ((b[3] - b[1]) / 1000) * pageData.width;
              if (w > maxBoxWidthPx) maxBoxWidthPx = w;
            });
          });
        }

        const result = await generateDebugPreviews(
          pageData.dataUrl,
          boxes as [number, number, number, number][],
          pageData.width,
          pageData.height,
          cropSettings,
          Math.ceil(maxBoxWidthPx), // Pass target width for alignment
        );

        setStages(result);
      } catch (e) {
        console.error("Error generating debug view:", e);
        setPreviewError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsGenerating(false);
      }
    };

    generatePreviews();
  }, [selectedDetection, pageData, cropSettings]);

  const PreviewCard = ({
    title,
    url,
    color,
    desc,
  }: {
    title: string;
    url?: string;
    color: string;
    desc: string;
  }) => (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <h4
          className={`font-bold text-xs uppercase tracking-widest flex items-center gap-2 text-${color}-400`}
        >
          <span className={`w-2 h-2 bg-${color}-500 rounded-full`}></span>
          {title}
        </h4>
        <span className="text-[9px] text-slate-500 font-bold uppercase">
          {desc}
        </span>
      </div>

      <div
        className={`bg-slate-950 rounded-2xl border border-${color}-900/30 p-4 shadow-xl relative group overflow-hidden min-h-[120px]`}
      >
        {url ? (
          <div className="flex items-center justify-center bg-white rounded-lg overflow-hidden relative cursor-zoom-in">
            <div
              className="absolute inset-0 opacity-10"
              style={{
                backgroundImage: "radial-gradient(#000 1px, transparent 1px)",
                backgroundSize: "10px 10px",
              }}
            ></div>
            <img
              src={url}
              alt={title}
              className="relative max-w-full h-auto object-contain"
            />
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-700 min-h-[100px]">
            {isGenerating ? (
              <div
                className={`w-5 h-5 border-2 border-${color}-500 border-t-transparent rounded-full animate-spin`}
              ></div>
            ) : (
              <span className="text-[10px] uppercase font-bold">
                Preview Unavailable
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      className="bg-slate-900 flex flex-col shadow-2xl relative z-20"
      style={{ width: `${width}%` }}
    >
      <div className="p-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md">
        <h3 className="text-slate-400 font-bold text-xs uppercase tracking-[0.2em]">
          Processing Stages
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto p-6 relative custom-scrollbar">
        {isProcessing && (
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-[2px] z-50 flex items-center justify-center">
            <span className="text-blue-400 font-black uppercase tracking-widest text-xs animate-pulse">
              Syncing...
            </span>
          </div>
        )}

        {selectedDetection ? (
          <div className="space-y-8 animate-[fade-in_0.3s_ease-out] pb-12">
            {/* Header Info */}
            <div>
              <div className="flex justify-between items-start mb-1">
                <h2 className="text-3xl font-black text-white tracking-tight">
                  {selectedDetection.id === "continuation"
                    ? "Cont."
                    : `Q${selectedDetection.id}`}
                </h2>
                <span className="bg-slate-800 text-slate-400 px-3 py-1 rounded-full text-[10px] font-bold border border-slate-700">
                  P{selectedDetection.pageNumber}
                </span>
              </div>
              {columnInfo && (
                <p className="mt-1 text-blue-400 text-[10px] font-bold uppercase tracking-wide">
                  Column Mode Active
                </p>
              )}
            </div>

            {/* 4 Stages */}
            <div className="space-y-6">
              {previewError && (
                <div className="bg-red-950/40 border border-red-900/40 text-red-200 rounded-2xl px-4 py-3 text-xs font-bold">
                  预览生成失败：{previewError}
                </div>
              )}
              <PreviewCard
                title="4. Final Output"
                url={resolveImageUrl(selectedImage?.dataUrl) || stages?.stage4}
                color="green"
                desc={selectedImage ? "Full Merged Result" : "Aligned Fragment"}
              />
              <PreviewCard
                title="1. Raw AI Detection"
                url={stages?.stage1}
                color="blue"
                desc="Exact box coordinates"
              />
              <PreviewCard
                title="2. Crop Padding"
                url={stages?.stage2}
                color="indigo"
                desc="Applied Crop Buffer"
              />
              <PreviewCard
                title="3. Whitespace Trim"
                url={stages?.stage3}
                color="violet"
                desc="Analyzed Content"
              />
            </div>

            {/* Coords */}
            <div className="pt-4 border-t border-slate-800">
              <h4 className="text-slate-500 font-bold text-[10px] uppercase tracking-widest mb-3">
                Coordinates
              </h4>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div
                  className={`bg-slate-800/50 p-2 rounded text-center border ${draggingSide === "top" ? "border-green-500 text-green-400" : "border-slate-800 text-slate-300"}`}
                >
                  Y-MIN:{" "}
                  {selectedDetection
                    ? Math.round(
                        (Array.isArray(selectedDetection.boxes_2d[0])
                          ? selectedDetection.boxes_2d[0][0]
                          : selectedDetection.boxes_2d[0]) as number,
                      )
                    : "-"}
                </div>
                <div
                  className={`bg-slate-800/50 p-2 rounded text-center border ${draggingSide === "left" ? "border-blue-500 text-blue-400" : "border-slate-800 text-slate-300"}`}
                >
                  X-MIN:{" "}
                  {selectedDetection
                    ? Math.round(
                        (Array.isArray(selectedDetection.boxes_2d[0])
                          ? selectedDetection.boxes_2d[0][1]
                          : selectedDetection.boxes_2d[1]) as number,
                      )
                    : "-"}
                </div>
                <div
                  className={`bg-slate-800/50 p-2 rounded text-center border ${draggingSide === "bottom" ? "border-green-500 text-green-400" : "border-slate-800 text-slate-300"}`}
                >
                  Y-MAX:{" "}
                  {selectedDetection
                    ? Math.round(
                        (Array.isArray(selectedDetection.boxes_2d[0])
                          ? selectedDetection.boxes_2d[0][2]
                          : selectedDetection.boxes_2d[2]) as number,
                      )
                    : "-"}
                </div>
                <div
                  className={`bg-slate-800/50 p-2 rounded text-center border ${draggingSide === "right" ? "border-blue-500 text-blue-400" : "border-slate-800 text-slate-300"}`}
                >
                  X-MAX:{" "}
                  {selectedDetection
                    ? Math.round(
                        (Array.isArray(selectedDetection.boxes_2d[0])
                          ? selectedDetection.boxes_2d[0][3]
                          : selectedDetection.boxes_2d[3]) as number,
                      )
                    : "-"}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
            <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-6">
              <svg
                className="w-10 h-10 text-slate-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
                />
              </svg>
            </div>
            <p className="text-slate-500 text-sm font-bold max-w-[200px]">
              Select a box to analyze the 4 processing stages.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
