import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DebugPageData, QuestionImage, DetectedQuestion } from "../types";
import { DebugToolbar } from "./debug/DebugToolbar";
import { DebugPageViewer } from "./debug/DebugPageViewer";
import { DebugInspectorPanel } from "./debug/DebugInspectorPanel";
import { DebugPreviewGrid } from "./debug/DebugPreviewGrid";
import { CropSettings } from "../services/pdfService";
import { getHistoryList, loadExamResult, updateQuestionsForFile, reSaveExamResult } from "../services/storageService";
import { analyzeQuestionViaProxy } from "../services/geminiProxyService";
import { MODEL_IDS } from "../shared/ai-config";
import { NotificationToast } from "./NotificationToast";

interface Notification {
  id: string;
  fileName: string | null;
  type: "success" | "error";
  message: string;
}

const defaultCropSettings: CropSettings = {
  cropPadding: 50,
  canvasPadding: 25,
  mergeOverlap: 50,
};

export const InspectPage: React.FC = () => {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();


  // State for loaded data
  const [pages, setPages] = useState<DebugPageData[]>([]);
  const [questions, setQuestions] = useState<QuestionImage[]>([]);
  const [title, setTitle] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Navigation state
  const [allExamIds, setAllExamIds] = useState<{ id: string; name: string }[]>([]);
  const [currentExamIndex, setCurrentExamIndex] = useState(-1);

  // View state
  const [viewMode, setViewMode] = useState<"preview" | "debug">("preview");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draggingSide, setDraggingSide] = useState<"left" | "right" | "top" | "bottom" | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(70);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Add notification helper
  const addNotification = useCallback((fileName: string | null, type: "success" | "error", message: string) => {
    const id = `notif-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setNotifications(prev => [...prev, { id, fileName, type, message }]);
  }, []);

  // Load exam list for navigation
  useEffect(() => {
    const loadExamList = async () => {
      const list = await getHistoryList();
      const sorted = list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
      setAllExamIds(sorted.map(item => ({ id: item.id, name: item.name })));
    };
    loadExamList();
  }, []);

  // Update current index when exam list or examId changes
  useEffect(() => {
    if (examId && allExamIds.length > 0) {
      const index = allExamIds.findIndex(e => e.id === examId);
      setCurrentExamIndex(index);
    }
  }, [examId, allExamIds]);

  // Load exam data
  useEffect(() => {
    const loadExam = async () => {
      if (!examId) {
        setError("No exam ID provided");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const exam = await loadExamResult(examId);
        if (!exam) {
          setError(`Exam not found: ${examId}`);
          setIsLoading(false);
          return;
        }

        setTitle(exam.name);
        setPages(exam.rawPages || []);
        setQuestions(exam.questions || []);
      } catch (err: any) {
        setError(err.message || "Failed to load exam");
      } finally {
        setIsLoading(false);
      }
    };

    loadExam();
  }, [examId]);

  // Scroll to question anchor on initial load or hash change
  // For HashRouter, window.location.hash contains: #/inspect/examId#question-X
  // We need to extract the question-X part
  useEffect(() => {
    if (!isLoading && questions.length > 0) {
      const fullHash = window.location.hash; // e.g., "#/inspect/uuid#question-5"
      const questionMatch = fullHash.match(/#question-([^#&]+)/);
      if (questionMatch) {
        const questionId = questionMatch[1];
        const element = document.getElementById(`question-${questionId}`);
        if (element) {
          setTimeout(() => {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 100);
        }
      }
    }
  }, [isLoading, questions]);

  // Navigation handlers
  const handleNextFile = useCallback(() => {
    if (currentExamIndex >= 0 && currentExamIndex < allExamIds.length - 1) {
      const nextExam = allExamIds[currentExamIndex + 1];
      navigate(`/inspect/${nextExam.id}`);
    }
  }, [currentExamIndex, allExamIds, navigate]);

  const handlePrevFile = useCallback(() => {
    if (currentExamIndex > 0) {
      const prevExam = allExamIds[currentExamIndex - 1];
      navigate(`/inspect/${prevExam.id}`);
    }
  }, [currentExamIndex, allExamIds, navigate]);

  const handleJumpToIndex = useCallback((oneBasedIndex: number) => {
    const zeroBasedIndex = oneBasedIndex - 1;
    if (zeroBasedIndex >= 0 && zeroBasedIndex < allExamIds.length) {
      const targetExam = allExamIds[zeroBasedIndex];
      navigate(`/inspect/${targetExam.id}`);
    }
  }, [allExamIds, navigate]);

  const handleClose = useCallback(() => {
    navigate("/");
  }, [navigate]);

  // Question click handler - jump to debug view
  const handleQuestionClick = useCallback((q: QuestionImage) => {
    setViewMode("debug");
    const page = pages.find(p => p.fileName === q.fileName && p.pageNumber === q.pageNumber);
    if (page) {
      const detIndex = page.detections.findIndex(d => d.id === q.id);
      if (detIndex !== -1) {
        const key = `${q.fileName}||${q.pageNumber}||${detIndex}`;
        setSelectedKey(key);
      }
    }
  }, [pages]);

  // Re-solve question handler
  const handleReSolveQuestion = useCallback(async (q: QuestionImage) => {
    try {
      const analysis = await analyzeQuestionViaProxy(q.dataUrl, MODEL_IDS.FLASH, 3);

      const updatedQuestion = { ...q, analysis };

      setQuestions(prev => prev.map(item => 
        item.fileName === q.fileName && item.id === q.id ? updatedQuestion : item
      ));

      // Save to storage
      const fileQuestions = questions
        .filter(item => item.fileName === q.fileName)
        .map(item => (item.id === q.id ? updatedQuestion : item));
      await updateQuestionsForFile(q.fileName, fileQuestions);

      addNotification(q.fileName, "success", `Q${q.id} 重新解题完成`);
    } catch (error: any) {
      console.error("Re-solve question failed:", error);
      addNotification(q.fileName, "error", `Q${q.id} 解题失败: ${error.message}`);
      throw error;
    }
  }, [questions, addNotification]);

  // Delete analysis handler
  const handleDeleteAnalysis = useCallback(async (q: QuestionImage, type: "standard" | "pro") => {
    const updatedQuestion = { ...q };
    if (type === "standard") {
      updatedQuestion.analysis = undefined;
    } else {
      updatedQuestion.pro_analysis = undefined;
    }

    setQuestions(prev => prev.map(item =>
      item.fileName === q.fileName && item.id === q.id ? updatedQuestion : item
    ));

    const fileQuestions = questions
      .filter(item => item.fileName === q.fileName)
      .map(item => (item.id === q.id ? updatedQuestion : item));
    await updateQuestionsForFile(q.fileName, fileQuestions);
    addNotification(q.fileName, "success", `Q${q.id} ${type === "standard" ? "标准" : "Pro"}解析已删除`);
  }, [questions, addNotification]);

  // Copy analysis handler
  const handleCopyAnalysis = useCallback(async (q: QuestionImage, fromType: "standard" | "pro") => {
    const updatedQuestion = { ...q };
    if (fromType === "standard") {
      if (!q.analysis) return;
      updatedQuestion.pro_analysis = JSON.parse(JSON.stringify(q.analysis));
    } else {
      if (!q.pro_analysis) return;
      updatedQuestion.analysis = JSON.parse(JSON.stringify(q.pro_analysis));
    }

    setQuestions(prev => prev.map(item =>
      item.fileName === q.fileName && item.id === q.id ? updatedQuestion : item
    ));

    const fileQuestions = questions
      .filter(item => item.fileName === q.fileName)
      .map(item => (item.id === q.id ? updatedQuestion : item));
    await updateQuestionsForFile(q.fileName, fileQuestions);
    addNotification(q.fileName, "success", `Q${q.id} 解析已复制`);
  }, [questions, addNotification]);

  // Update detections handler
  const handleUpdateDetections = useCallback(async (
    fileName: string,
    pageNumber: number,
    newDetections: DetectedQuestion[]
  ) => {
    // Update pages
    const updatedPages = pages.map(p => {
      if (p.fileName === fileName && p.pageNumber === pageNumber) {
        return { ...p, detections: newDetections };
      }
      return p;
    });
    setPages(updatedPages);

    // Save to storage using fileName (title)
    await reSaveExamResult(title, updatedPages, questions);
    addNotification(fileName, "success", "检测区域已更新");
  }, [pages, questions, title, addNotification]);

  // Selection parsing
  const { selectedImage, selectedDetection, pageDetections, selectedIndex } = useMemo(() => {
    if (!selectedKey) return { selectedImage: null, selectedDetection: null, pageDetections: [], selectedIndex: -1 };

    const parts = selectedKey.split("||");
    if (parts.length !== 3) return { selectedImage: null, selectedDetection: null, pageDetections: [], selectedIndex: -1 };

    const fileName = parts[0];
    const pageNum = parseInt(parts[1], 10);
    const detIdx = parseInt(parts[2], 10);

    const page = pages.find(p => p.fileName === fileName && p.pageNumber === pageNum);
    if (!page) return { selectedImage: null, selectedDetection: null, pageDetections: [], selectedIndex: -1 };

    const detectionRaw = page.detections[detIdx];
    const detection = detectionRaw ? { ...detectionRaw, pageNumber: pageNum, fileName } : null;

    let effectiveId: string | null = null;
    const filePages = pages.filter(p => p.fileName === fileName).sort((a, b) => a.pageNumber - b.pageNumber);
    let found = false;
    for (const p of filePages) {
      for (let i = 0; i < p.detections.length; i++) {
        const d = p.detections[i];
        if (d.id !== "continuation") effectiveId = d.id;
        if (p.pageNumber === pageNum && i === detIdx) { found = true; break; }
      }
      if (found) break;
    }

    const image = effectiveId ? questions.find(q => q.fileName === fileName && q.id === effectiveId) || null : null;

    return { selectedImage: image, selectedDetection: detection, pageDetections: page.detections, selectedIndex: detIdx };
  }, [selectedKey, pages, questions]);

  // Column info for column-based editing
  const columnInfo = useMemo(() => {
    if (!selectedDetection || !pageDetections.length) return null;
    const boxes = (Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0] : selectedDetection.boxes_2d) as [number, number, number, number];
    const targetXMin = boxes[1];
    const targetXMax = boxes[3];
    const THRESHOLD = 50;
    const columnIndices: number[] = [];
    pageDetections.forEach((det, idx) => {
      const b = (Array.isArray(det.boxes_2d[0]) ? det.boxes_2d[0] : det.boxes_2d) as [number, number, number, number];
      if (Math.abs(b[1] - targetXMin) < THRESHOLD && Math.abs(b[3] - targetXMax) < THRESHOLD) {
        columnIndices.push(idx);
      }
    });
    return { indices: columnIndices, initialLeft: targetXMin, initialRight: targetXMax };
  }, [selectedDetection, pageDetections]);

  const selectedBoxCoords = useMemo(() => {
    if (!selectedDetection) return null;
    const boxes = (Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0] : selectedDetection.boxes_2d) as [number, number, number, number];
    return { ymin: boxes[0], xmin: boxes[1], ymax: boxes[2], xmax: boxes[3] };
  }, [selectedDetection]);

  const selectedPageData = useMemo(() => {
    if (!selectedDetection) return undefined;
    return pages.find(p => p.fileName === selectedDetection.fileName && p.pageNumber === selectedDetection.pageNumber);
  }, [pages, selectedDetection]);

  // Panel resizing
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingPanel(true);
  }, []);

  const handlePanelResize = useCallback((e: MouseEvent) => {
    if (!isResizingPanel || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftPanelWidth(Math.max(20, Math.min(80, newWidth)));
  }, [isResizingPanel]);

  const stopResizing = useCallback(() => setIsResizingPanel(false), []);

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

  // Global mouse up for drag commit
  const handleGlobalMouseUp = useCallback(async () => {
    if (!draggingSide || dragValue === null || !selectedDetection) {
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
        columnInfo.indices.forEach(idx => {
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
    handleUpdateDetections(fileName, pageNum, newDetections);
  }, [draggingSide, dragValue, columnInfo, selectedDetection, pageDetections, selectedKey, selectedIndex, handleUpdateDetections]);

  useEffect(() => {
    if (draggingSide) {
      window.addEventListener("mouseup", handleGlobalMouseUp);
    } else {
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    }
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, [draggingSide, handleGlobalMouseUp]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (draggingSide) { setDraggingSide(null); setDragValue(null); }
        else if (selectedKey) { setSelectedKey(null); }
        else { handleClose(); }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draggingSide, selectedKey, handleClose]);

  // Reset selection when exam changes
  useEffect(() => {
    setSelectedKey(null);
    setDraggingSide(null);
    setDragValue(null);
  }, [examId]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-950">
        <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-500 border-t-transparent mb-4"></div>
        <p className="text-white text-lg font-bold">Loading exam...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-950">
        <div className="text-red-500 text-6xl mb-4">⚠️</div>
        <p className="text-white text-lg font-bold mb-2">Error</p>
        <p className="text-slate-400 mb-6">{error}</p>
        <button
          onClick={handleClose}
          className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors"
        >
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950 animate-[fade-in_0.2s_ease-out]">
      <DebugToolbar
        title={title}
        pageCount={pages.length}
        currentFileIndex={currentExamIndex + 1}
        totalFiles={allExamIds.length}
        viewMode={viewMode}
        onToggleView={setViewMode}
        onPrevFile={currentExamIndex > 0 ? handlePrevFile : undefined}
        onNextFile={currentExamIndex < allExamIds.length - 1 ? handleNextFile : undefined}
        onJumpToIndex={handleJumpToIndex}
        onClose={handleClose}
        hasNextFile={currentExamIndex < allExamIds.length - 1}
        hasPrevFile={currentExamIndex > 0}
      />

      <div className="flex-1 flex overflow-hidden relative" ref={containerRef}>
        {viewMode === "preview" ? (
          <DebugPreviewGrid
            questions={questions}
            onQuestionClick={handleQuestionClick}
            onReSolveQuestion={handleReSolveQuestion}
            onDeleteAnalysis={handleDeleteAnalysis}
            onCopyAnalysis={handleCopyAnalysis}
            enableAnchors={true}
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
              onDragStateChange={(side, val) => { setDraggingSide(side); setDragValue(val); }}
              isProcessing={false}
              hasNextFile={currentExamIndex < allExamIds.length - 1}
              hasPrevFile={currentExamIndex > 0}
              onTriggerNextFile={handleNextFile}
              onTriggerPrevFile={handlePrevFile}
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
              isProcessing={false}
              draggingSide={draggingSide}
              dragValue={dragValue}
              columnInfo={columnInfo}
              cropSettings={defaultCropSettings}
            />
          </>
        )}
      </div>

      <NotificationToast
        notifications={notifications}
        onDismiss={(id) => setNotifications(prev => prev.filter(n => n.id !== id))}
        onView={(fileName) => {
          // No action needed since we're already in inspect view
        }}
      />
    </div>
  );
};
