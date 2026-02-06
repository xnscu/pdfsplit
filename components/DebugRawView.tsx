import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { DebugPageData, QuestionImage, DetectedQuestion } from "../types";
import { DebugToolbar } from "./debug/DebugToolbar";
import { DebugPageViewer } from "./debug/DebugPageViewer";
import { DebugInspectorPanel } from "./debug/DebugInspectorPanel";
import { DebugPreviewGrid } from "./debug/DebugPreviewGrid";
import { CropSettings } from "../services/pdfService";

interface Props {
  pages: DebugPageData[];
  questions: QuestionImage[];
  onClose: () => void;
  title?: string;
  onNextFile?: () => void;
  onPrevFile?: () => void;
  onJumpToIndex?: (index: number) => void;
  hasNextFile?: boolean;
  hasPrevFile?: boolean;
  onUpdateDetections?: (fileName: string, pageNumber: number, newDetections: DetectedQuestion[]) => void;
  onReanalyzeFile?: (fileName: string) => void;
  onDownloadZip?: (fileName: string) => void;
  onRefineFile?: (fileName: string) => void;
  onProcessFile?: (fileName: string) => void;
  onAnalyzeFile?: (fileName: string) => void; // New
  onReSolveQuestion?: (q: QuestionImage, modelType: "flash" | "pro") => Promise<void>; // Re-solve single question
  onDeleteAnalysis?: (q: QuestionImage, type: "standard" | "pro") => void;
  onCopyAnalysis?: (q: QuestionImage, fromType: "standard" | "pro") => void;
  onEditAnalysis?: (q: QuestionImage, type: "standard" | "pro", field: string, value: string) => Promise<void>;
  onStopAnalyze?: () => void; // Stop analysis
  analyzingTotal?: number;
  analyzingDone?: number;
  isZipping?: boolean;
  zippingProgress?: string;
  isGlobalProcessing?: boolean;
  processingFiles: Set<string>;
  currentFileIndex: number;
  totalFiles: number;
  cropSettings: CropSettings;
  isAutoAnalyze?: boolean;
  setIsAutoAnalyze?: (val: boolean) => void;
  onPush?: () => void;
  onPull?: () => void;
  recommendPush?: boolean;
  recommendPull?: boolean;
}

export const DebugRawView: React.FC<Props> = ({
  pages,
  questions,
  onClose,
  title,
  onNextFile,
  onPrevFile,
  onJumpToIndex,
  hasNextFile,
  hasPrevFile,
  onUpdateDetections,
  onReanalyzeFile,
  onDownloadZip,
  onRefineFile,
  onProcessFile,
  onAnalyzeFile,
  onReSolveQuestion,
  onDeleteAnalysis,
  onCopyAnalysis,
  onEditAnalysis,
  onStopAnalyze,
  analyzingTotal,
  analyzingDone,
  isZipping,
  zippingProgress,
  isGlobalProcessing = false,
  processingFiles,
  currentFileIndex,
  totalFiles,
  cropSettings,
  isAutoAnalyze,
  setIsAutoAnalyze,
  onPush,
  onPull,
  recommendPush,
  recommendPull,
}) => {
  // Key format: "fileName||pageNumber||detIndex"
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showExplanations, setShowExplanations] = useState(true);

  // VIEW MODE: Default to 'preview' (Final Output Grid)
  const [viewMode, setViewMode] = useState<"preview" | "debug">("preview");

  // Dragging State for Crop Lines (Shared with sub-components)
  const [draggingSide, setDraggingSide] = useState<"left" | "right" | "top" | "bottom" | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);

  // Panel Resizing State
  const [leftPanelWidth, setLeftPanelWidth] = useState(70); // Initial 70%
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Check if current file is processing
  const isCurrentFileProcessing = useMemo(() => {
    if (isGlobalProcessing) return true;
    return title ? processingFiles.has(title) : false;
  }, [isGlobalProcessing, processingFiles, title]);

  // Filter questions for the current file ONLY (for the Preview Grid)
  const currentFileQuestions = useMemo(() => {
    if (!title) return [];
    return questions.filter((q) => q.fileName === title);
  }, [questions, title]);

  // Reset selected key and view mode when the file changes
  useEffect(() => {
    setSelectedKey(null);
    setDraggingSide(null);
    setDragValue(null);
    // Note: We intentionally keep the viewMode (Preview/Debug) persistent when switching files
    // as users usually want to stay in one mode while browsing.
  }, [pages[0]?.fileName]);

  const { selectedImage, selectedDetection, pageDetections, selectedIndex } = useMemo(() => {
    if (!selectedKey)
      return {
        selectedImage: null,
        selectedDetection: null,
        pageDetections: [],
        selectedIndex: -1,
      };

    const parts = selectedKey.split("||");
    if (parts.length !== 3)
      return {
        selectedImage: null,
        selectedDetection: null,
        pageDetections: [],
        selectedIndex: -1,
      };

    const fileName = parts[0];
    const pageNum = parseInt(parts[1], 10);
    const detIdx = parseInt(parts[2], 10);

    const page = pages.find((p) => p.fileName === fileName && p.pageNumber === pageNum);
    if (!page)
      return {
        selectedImage: null,
        selectedDetection: null,
        pageDetections: [],
        selectedIndex: -1,
      };

    const detectionRaw = page.detections[detIdx];
    const detection = detectionRaw ? { ...detectionRaw, pageNumber: pageNum, fileName } : null;

    let effectiveId: string | null = null;
    const filePages = pages.filter((p) => p.fileName === fileName).sort((a, b) => a.pageNumber - b.pageNumber);
    let found = false;
    for (const p of filePages) {
      for (let i = 0; i < p.detections.length; i++) {
        const d = p.detections[i];
        if (d.id !== "continuation") {
          effectiveId = d.id;
        }
        if (p.pageNumber === pageNum && i === detIdx) {
          found = true;
          break;
        }
      }
      if (found) break;
    }

    const image = effectiveId ? questions.find((q) => q.fileName === fileName && q.id === effectiveId) || null : null;

    return {
      selectedImage: image,
      selectedDetection: detection,
      pageDetections: page.detections,
      selectedIndex: detIdx,
    };
  }, [selectedKey, pages, questions]);

  // Jump to specific question in Debug Mode
  const handleQuestionClick = useCallback(
    (q: QuestionImage) => {
      // 1. Switch to debug view
      setViewMode("debug");

      // 2. Find the corresponding detection to highlight
      const page = pages.find((p) => p.fileName === q.fileName && p.pageNumber === q.pageNumber);
      if (page) {
        // Try to match ID.
        // Note: q.id might be complex, but detections have an 'id' field.
        const detIndex = page.detections.findIndex((d) => d.id === q.id);
        if (detIndex !== -1) {
          const key = `${q.fileName}||${q.pageNumber}||${detIndex}`;
          setSelectedKey(key);
        }
      }
    },
    [pages],
  );

  // Column Group Logic
  const columnInfo = useMemo(() => {
    if (!selectedDetection || !pageDetections.length) return null;

    const boxes = (
      Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0] : selectedDetection.boxes_2d
    ) as [number, number, number, number];
    const targetXMin = boxes[1];
    const targetXMax = boxes[3];
    const THRESHOLD = 50;

    const columnIndices: number[] = [];
    let minX = targetXMin;
    let maxX = targetXMax;

    pageDetections.forEach((det, idx) => {
      const b = (Array.isArray(det.boxes_2d[0]) ? det.boxes_2d[0] : det.boxes_2d) as [number, number, number, number];
      const detXMin = b[1];
      const detXMax = b[3];

      if (Math.abs(detXMin - targetXMin) < THRESHOLD && Math.abs(detXMax - targetXMax) < THRESHOLD) {
        columnIndices.push(idx);
      }
    });

    return { indices: columnIndices, initialLeft: minX, initialRight: maxX };
  }, [selectedDetection, pageDetections]);

  // Current Box coords for overlays
  const selectedBoxCoords = useMemo(() => {
    if (!selectedDetection) return null;
    const boxes = (
      Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0] : selectedDetection.boxes_2d
    ) as [number, number, number, number];
    return {
      ymin: boxes[0],
      xmin: boxes[1],
      ymax: boxes[2],
      xmax: boxes[3],
    };
  }, [selectedDetection]);

  // Selected Page Data Helper
  const selectedPageData = useMemo(() => {
    if (!selectedDetection) return undefined;
    return pages.find(
      (p) => p.fileName === selectedDetection.fileName && p.pageNumber === selectedDetection.pageNumber,
    );
  }, [pages, selectedDetection]);

  // --- Resizing Logic ---
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingPanel(true);
  }, []);

  const handlePanelResize = useCallback(
    (e: MouseEvent) => {
      if (!isResizingPanel || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftPanelWidth(Math.max(20, Math.min(80, newWidth)));
    },
    [isResizingPanel],
  );

  const stopResizing = useCallback(() => {
    setIsResizingPanel(false);
  }, []);

  useEffect(() => {
    if (isResizingPanel) {
      window.addEventListener("mousemove", handlePanelResize);
      window.addEventListener("mouseup", stopResizing);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    } else {
      window.removeEventListener("mousemove", handlePanelResize);
      window.removeEventListener("mouseup", stopResizing);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    return () => {
      window.removeEventListener("mousemove", handlePanelResize);
      window.removeEventListener("mouseup", stopResizing);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizingPanel, handlePanelResize, stopResizing]);

  // Global Mouse Up to Commit Drag
  const handleGlobalMouseUp = useCallback(async () => {
    if (!draggingSide || dragValue === null || !selectedDetection || !onUpdateDetections) {
      setDraggingSide(null);
      setDragValue(null);
      return;
    }

    const parts = selectedKey!.split("||");
    const fileName = parts[0];
    const pageNum = parseInt(parts[1], 10);

    const newDetections = JSON.parse(JSON.stringify(pageDetections)) as DetectedQuestion[];

    if (draggingSide === "left" || draggingSide === "right") {
      if (columnInfo) {
        columnInfo.indices.forEach((idx) => {
          const det = newDetections[idx];
          if (Array.isArray(det.boxes_2d[0])) {
            if (draggingSide === "left") (det.boxes_2d[0] as any)[1] = Math.round(dragValue);
            else (det.boxes_2d[0] as any)[3] = Math.round(dragValue);
          } else {
            if (draggingSide === "left") (det.boxes_2d as any)[1] = Math.round(dragValue);
            else (det.boxes_2d as any)[3] = Math.round(dragValue);
          }
        });
      }
    } else {
      const det = newDetections[selectedIndex];
      if (det) {
        if (Array.isArray(det.boxes_2d[0])) {
          if (draggingSide === "top") (det.boxes_2d[0] as any)[0] = Math.round(dragValue);
          else (det.boxes_2d[0] as any)[2] = Math.round(dragValue);
        } else {
          if (draggingSide === "top") (det.boxes_2d as any)[0] = Math.round(dragValue);
          else (det.boxes_2d as any)[2] = Math.round(dragValue);
        }
      }
    }

    setDraggingSide(null);
    setDragValue(null);

    onUpdateDetections(fileName, pageNum, newDetections);
  }, [
    draggingSide,
    dragValue,
    columnInfo,
    selectedDetection,
    pageDetections,
    selectedKey,
    onUpdateDetections,
    selectedIndex,
  ]);

  useEffect(() => {
    if (draggingSide) {
      window.addEventListener("mouseup", handleGlobalMouseUp);
    } else {
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    }
    return () => {
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [draggingSide, handleGlobalMouseUp]);

  // Escape Key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (draggingSide) {
          setDraggingSide(null);
          setDragValue(null);
        } else if (selectedKey) {
          setSelectedKey(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draggingSide, selectedKey, onClose]);

  if (pages.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950 animate-[fade-in_0.2s_ease-out]">
      <DebugToolbar
        title={title}
        pageCount={pages.length}
        currentFileIndex={currentFileIndex}
        totalFiles={totalFiles}
        viewMode={viewMode}
        onToggleView={setViewMode}
        onPrevFile={onPrevFile}
        onNextFile={onNextFile}
        onJumpToIndex={onJumpToIndex}
        onClose={onClose}
        onReanalyze={!isCurrentFileProcessing && onReanalyzeFile && title ? () => onReanalyzeFile(title) : undefined}
        onDownloadZip={!isCurrentFileProcessing && onDownloadZip && title ? () => onDownloadZip(title) : undefined}
        onRefine={!isCurrentFileProcessing && onRefineFile && title ? () => onRefineFile(title) : undefined}
        onProcess={!isCurrentFileProcessing && onProcessFile && title ? () => onProcessFile(title) : undefined}
        onAnalyze={!isCurrentFileProcessing && onAnalyzeFile && title ? () => onAnalyzeFile(title) : undefined}
        onStopAnalyze={onStopAnalyze}
        analyzingTotal={analyzingTotal}
        analyzingDone={analyzingDone}
        isZipping={isZipping}
        zippingProgress={zippingProgress}
        hasNextFile={hasNextFile}
        hasPrevFile={hasPrevFile}
        isAutoAnalyze={isAutoAnalyze}
        setIsAutoAnalyze={setIsAutoAnalyze}
        showExplanations={showExplanations}
        onToggleExplanations={() => setShowExplanations(!showExplanations)}
        onPush={onPush}
        onPull={onPull}
        recommendPush={recommendPush}
        recommendPull={recommendPull}
      />

      <div className="flex-1 flex overflow-hidden relative" ref={containerRef}>
        {viewMode === "preview" ? (
          <DebugPreviewGrid
            questions={currentFileQuestions}
            onQuestionClick={handleQuestionClick}
            onReSolveQuestion={onReSolveQuestion}
            onDeleteAnalysis={onDeleteAnalysis}
            onCopyAnalysis={onCopyAnalysis}
            onEditAnalysis={onEditAnalysis}
            showExplanations={showExplanations}
          />
        ) : (
          <>
            <DebugPageViewer
              width={leftPanelWidth}
              pages={pages}
              selectedKey={selectedKey}
              onSelectKey={setSelectedKey}
              selectedDetection={selectedDetection}
              selectedBoxCoords={selectedBoxCoords}
              columnInfo={columnInfo}
              draggingSide={draggingSide}
              dragValue={dragValue}
              onDragStateChange={(side, val) => {
                setDraggingSide(side);
                setDragValue(val);
              }}
              isProcessing={isCurrentFileProcessing}
              hasNextFile={!!hasNextFile}
              hasPrevFile={!!hasPrevFile}
              onTriggerNextFile={() => onNextFile && onNextFile()}
              onTriggerPrevFile={() => onPrevFile && onPrevFile()}
            />

            {/* Resizer Handle */}
            <div
              className={`w-2 bg-slate-950 hover:bg-blue-600 cursor-col-resize relative z-[60] flex items-center justify-center transition-colors border-l border-r border-slate-800 flex-none select-none ${isResizingPanel ? "bg-blue-600" : ""}`}
              onMouseDown={startResizing}
            >
              <div className="w-0.5 h-8 bg-slate-600 rounded-full pointer-events-none"></div>
            </div>

            <DebugInspectorPanel
              width={100 - leftPanelWidth}
              selectedDetection={selectedDetection}
              selectedImage={selectedImage}
              pageData={selectedPageData}
              isProcessing={isCurrentFileProcessing}
              draggingSide={draggingSide}
              dragValue={dragValue}
              columnInfo={columnInfo}
              cropSettings={cropSettings}
              showExplanations={showExplanations}
              onToggleExplanations={() => setShowExplanations(!showExplanations)}
            />
          </>
        )}
      </div>
    </div>
  );
};
