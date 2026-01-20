
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { DebugPageData, QuestionImage, DetectedQuestion } from '../types';
import { constructQuestionCanvas, CropSettings } from '../services/pdfService';

interface Props {
  pages: DebugPageData[];
  questions: QuestionImage[];
  onClose: () => void;
  title?: string;
  onNextFile?: () => void;
  onPrevFile?: () => void;
  hasNextFile?: boolean;
  hasPrevFile?: boolean;
  onUpdateDetections?: (fileName: string, pageNumber: number, newDetections: DetectedQuestion[]) => void;
  isProcessing?: boolean;
  currentFileIndex: number;
  totalFiles: number;
}

// Default settings for debug visualization - STRICT mode
// No padding, no border, exact coordinate match.
const DEBUG_CROP_SETTINGS: CropSettings = {
  cropPadding: 10,
  canvasPadding: 0,
  mergeOverlap: -5,
  debugExportPadding: 0
};

export const DebugRawView: React.FC<Props> = ({ 
  pages, 
  questions, 
  onClose, 
  title,
  onNextFile,
  onPrevFile,
  hasNextFile,
  hasPrevFile,
  onUpdateDetections,
  isProcessing = false,
  currentFileIndex,
  totalFiles
}) => {
  // Key format: "fileName||pageNumber||detIndex"
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  
  // State for dynamically generated raw view
  const [dynamicRawUrl, setDynamicRawUrl] = useState<string | null>(null);
  const [isGeneratingRaw, setIsGeneratingRaw] = useState(false);

  // Dragging State for Crop Lines
  const [draggingSide, setDraggingSide] = useState<'left' | 'right' | 'top' | 'bottom' | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Navigation Gesture State
  const [pullDelta, setPullDelta] = useState(0);
  const touchStartY = useRef<number | null>(null);
  const lastTriggerTime = useRef<number>(0);
  const PULL_THRESHOLD = 150;

  // Panel Resizing State
  const [leftPanelWidth, setLeftPanelWidth] = useState(70); // Initial 70%
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset selected key and scroll when the file changes
  useEffect(() => {
    setSelectedKey(null);
    setDraggingSide(null);
    setDragValue(null);
    setPullDelta(0);
    
    // Reset scroll to top when file changes
    if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
    }
  }, [pages[0]?.fileName]);

  // Trigger navigation when threshold reached
  useEffect(() => {
    if (Math.abs(pullDelta) > PULL_THRESHOLD) {
        const now = Date.now();
        if (now - lastTriggerTime.current > 1000) {
            if (pullDelta > 0 && hasNextFile && onNextFile) {
                onNextFile();
                lastTriggerTime.current = now;
            } else if (pullDelta < 0 && hasPrevFile && onPrevFile) {
                onPrevFile();
                lastTriggerTime.current = now;
            }
        }
        // Reset immediately after trigger attempt
        setPullDelta(0);
    }
  }, [pullDelta, hasNextFile, hasPrevFile, onNextFile, onPrevFile]);

  const { selectedImage, selectedDetection, pageDetections, selectedIndex } = useMemo(() => {
    if (!selectedKey) return { selectedImage: null, selectedDetection: null, pageDetections: [], selectedIndex: -1 };
    
    const parts = selectedKey.split('||');
    if (parts.length !== 3) return { selectedImage: null, selectedDetection: null, pageDetections: [], selectedIndex: -1 };

    const fileName = parts[0];
    const pageNum = parseInt(parts[1], 10);
    const detIdx = parseInt(parts[2], 10);

    const page = pages.find(p => p.fileName === fileName && p.pageNumber === pageNum);
    if (!page) return { selectedImage: null, selectedDetection: null, pageDetections: [], selectedIndex: -1 };

    const detectionRaw = page.detections[detIdx];
    const detection = detectionRaw ? { ...detectionRaw, pageNumber: pageNum, fileName } : null;

    let effectiveId: string | null = null;
    const filePages = pages.filter(p => p.fileName === fileName).sort((a,b) => a.pageNumber - b.pageNumber);
    let found = false;
    for (const p of filePages) {
        for (let i = 0; i < p.detections.length; i++) {
            const d = p.detections[i];
            if (d.id !== 'continuation') {
                effectiveId = d.id;
            }
            if (p.pageNumber === pageNum && i === detIdx) {
                found = true;
                break;
            }
        }
        if (found) break;
    }

    const image = effectiveId ? questions.find(q => q.fileName === fileName && q.id === effectiveId) || null : null;

    return { selectedImage: image, selectedDetection: detection, pageDetections: page.detections, selectedIndex: detIdx };
  }, [selectedKey, pages, questions]);

  // Column Group Logic: Find all detections in the same "column" as the selected one
  const columnInfo = useMemo(() => {
    if (!selectedDetection || !pageDetections.length) return null;

    const boxes = (Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0] : selectedDetection.boxes_2d) as [number, number, number, number];
    const targetXMin = boxes[1];
    const targetXMax = boxes[3];
    
    // Threshold to consider "same column" - e.g. 50px tolerance
    const THRESHOLD = 50; 

    // Find all items that roughly align horizontally
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

  // Get current Box coords for vertical lines
  const selectedBoxCoords = useMemo(() => {
    if (!selectedDetection) return null;
    const boxes = (Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0] : selectedDetection.boxes_2d) as [number, number, number, number];
    return {
        ymin: boxes[0],
        xmin: boxes[1],
        ymax: boxes[2],
        xmax: boxes[3]
    };
  }, [selectedDetection]);

  // Effect: Generate raw view
  useEffect(() => {
    setDynamicRawUrl(null);
    setIsGeneratingRaw(false);

    if (!selectedDetection || !selectedKey) return;

    const generateRawView = async () => {
      setIsGeneratingRaw(true);
      try {
        const parts = selectedKey.split('||');
        const fileName = parts[0];
        const pageNum = parseInt(parts[1], 10);
        
        const page = pages.find(p => p.fileName === fileName && p.pageNumber === pageNum);
        
        if (page) {
          let boxes = selectedDetection.boxes_2d;
          if (!Array.isArray(boxes[0])) {
             // @ts-ignore
             boxes = [boxes];
          }

          const result = await constructQuestionCanvas(
            page.dataUrl,
            boxes as [number, number, number, number][],
            page.width,
            page.height,
            DEBUG_CROP_SETTINGS
          );

          if (result.originalDataUrl) {
            setDynamicRawUrl(result.originalDataUrl);
          }
        }
      } catch (e) {
        console.error("Error generating debug view:", e);
      } finally {
        setIsGeneratingRaw(false);
      }
    };

    generateRawView();

  }, [selectedDetection, selectedKey, pages]); 

  const displayRawUrl = dynamicRawUrl;

  // Handle Scroll/Wheel/Touch Logic
  const handleScroll = () => {
      const container = scrollContainerRef.current;
      if (!container) return;
      
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtTop = scrollTop <= 0;
      const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 1;

      // Reset pull delta if we scroll away from boundaries
      if (!isAtTop && !isAtBottom && pullDelta !== 0) {
          setPullDelta(0);
      }
  };

  const handleWheel = (e: React.WheelEvent) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    
    const isAtTop = scrollTop <= 1; // Tolerance
    const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 1;

    if (isAtTop && hasPrevFile && e.deltaY < 0) {
        // e.deltaY is negative (scrolling up), we accumulate negative value
        setPullDelta(prev => Math.max(prev + e.deltaY, -PULL_THRESHOLD * 1.5));
    } else if (isAtBottom && hasNextFile && e.deltaY > 0) {
        // e.deltaY is positive (scrolling down), we accumulate positive value
        setPullDelta(prev => Math.min(prev + e.deltaY, PULL_THRESHOLD * 1.5));
    } else {
        // If wheeling but not effectively pulling (e.g. hitting wall but no file there), reset
        if (pullDelta !== 0 && ((isAtTop && !hasPrevFile) || (isAtBottom && !hasNextFile))) {
             setPullDelta(0);
        }
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
      touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
      if (touchStartY.current === null) return;
      const container = scrollContainerRef.current;
      if (!container) return;

      const { scrollTop, scrollHeight, clientHeight } = container;
      const currentY = e.touches[0].clientY;
      const diff = touchStartY.current - currentY; // positive = moving up (scrolling down)

      const isAtTop = scrollTop <= 0;
      const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 1;

      if (isAtTop && hasPrevFile && diff < 0) {
          // Pulling down at top
          setPullDelta(diff); 
      } else if (isAtBottom && hasNextFile && diff > 0) {
          // Pulling up at bottom
          setPullDelta(diff);
      } else {
          setPullDelta(0);
      }
  };

  const handleTouchEnd = () => {
      setPullDelta(0);
      touchStartY.current = null;
  };

  // --- Resizing Logic ---
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); // Prevent text selection
    setIsResizingPanel(true);
  }, []);

  const handlePanelResize = useCallback((e: MouseEvent) => {
    if (!isResizingPanel || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
    
    // Clamp between 20% and 80% to prevent layout breaking
    setLeftPanelWidth(Math.max(20, Math.min(80, newWidth)));
  }, [isResizingPanel]);

  const stopResizing = useCallback(() => {
    setIsResizingPanel(false);
  }, []);

  useEffect(() => {
    if (isResizingPanel) {
      window.addEventListener('mousemove', handlePanelResize);
      window.addEventListener('mouseup', stopResizing);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      window.removeEventListener('mousemove', handlePanelResize);
      window.removeEventListener('mouseup', stopResizing);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    return () => {
      window.removeEventListener('mousemove', handlePanelResize);
      window.removeEventListener('mouseup', stopResizing);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingPanel, handlePanelResize, stopResizing]);


  // Drag Handlers for Boxes (Crop Adjustment)
  const handleSvgMouseDown = useCallback((e: React.MouseEvent, side: 'left' | 'right' | 'top' | 'bottom') => {
      e.stopPropagation();
      e.preventDefault();
      
      setDraggingSide(side);

      // Initialize drag value based on type
      if (side === 'left') setDragValue(columnInfo?.initialLeft || 0);
      if (side === 'right') setDragValue(columnInfo?.initialRight || 1000);
      if (side === 'top') setDragValue(selectedBoxCoords?.ymin || 0);
      if (side === 'bottom') setDragValue(selectedBoxCoords?.ymax || 1000);

  }, [columnInfo, selectedBoxCoords]);

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
      if (!draggingSide || !svgRef.current) return;
      
      const rect = svgRef.current.getBoundingClientRect();
      const scaleX = 1000 / rect.width;
      const scaleY = 1000 / rect.height;

      let newVal = 0;

      if (draggingSide === 'left' || draggingSide === 'right') {
          newVal = (e.clientX - rect.left) * scaleX;
      } else {
          newVal = (e.clientY - rect.top) * scaleY;
      }
      
      // Clamp values (0-1000)
      newVal = Math.max(0, Math.min(1000, newVal));
      
      setDragValue(newVal);
  }, [draggingSide]);

  const handleGlobalMouseUp = useCallback(async () => {
      if (!draggingSide || dragValue === null || !selectedDetection || !onUpdateDetections) {
          setDraggingSide(null);
          setDragValue(null);
          return;
      }

      const parts = selectedKey!.split('||');
      const fileName = parts[0];
      const pageNum = parseInt(parts[1], 10);
      
      // Clone existing detections
      const newDetections = JSON.parse(JSON.stringify(pageDetections)) as DetectedQuestion[];
      
      if (draggingSide === 'left' || draggingSide === 'right') {
          // BATCH UPDATE: Columns
          if (columnInfo) {
            columnInfo.indices.forEach(idx => {
                const det = newDetections[idx];
                if (Array.isArray(det.boxes_2d[0])) {
                    if (draggingSide === 'left') (det.boxes_2d[0] as any)[1] = Math.round(dragValue);
                    else (det.boxes_2d[0] as any)[3] = Math.round(dragValue);
                } else {
                    if (draggingSide === 'left') (det.boxes_2d as any)[1] = Math.round(dragValue);
                    else (det.boxes_2d as any)[3] = Math.round(dragValue);
                }
            });
          }
      } else {
          // SINGLE UPDATE: Top/Bottom
          const det = newDetections[selectedIndex];
          if (det) {
              if (Array.isArray(det.boxes_2d[0])) {
                  if (draggingSide === 'top') (det.boxes_2d[0] as any)[0] = Math.round(dragValue);
                  else (det.boxes_2d[0] as any)[2] = Math.round(dragValue);
              } else {
                  if (draggingSide === 'top') (det.boxes_2d as any)[0] = Math.round(dragValue);
                  else (det.boxes_2d as any)[2] = Math.round(dragValue);
              }
          }
      }

      setDraggingSide(null);
      setDragValue(null);
      
      // Call parent update
      onUpdateDetections(fileName, pageNum, newDetections);
      
  }, [draggingSide, dragValue, columnInfo, selectedDetection, pageDetections, selectedKey, onUpdateDetections, selectedIndex]);

  // Attach global listeners for dragging crop lines
  useEffect(() => {
      if (draggingSide) {
          window.addEventListener('mousemove', handleGlobalMouseMove);
          window.addEventListener('mouseup', handleGlobalMouseUp);
      } else {
          window.removeEventListener('mousemove', handleGlobalMouseMove);
          window.removeEventListener('mouseup', handleGlobalMouseUp);
      }
      return () => {
          window.removeEventListener('mousemove', handleGlobalMouseMove);
          window.removeEventListener('mouseup', handleGlobalMouseUp);
      };
  }, [draggingSide, handleGlobalMouseMove, handleGlobalMouseUp]);

  // Handle Escape key to deselect or close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [draggingSide, selectedKey, onClose]);


  if (pages.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950 animate-[fade-in_0.2s_ease-out]">
      {/* Top Toolbar */}
      <div className="flex-none h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 shadow-xl z-50">
         <div className="flex items-center gap-4 min-w-0">
            <h2 className="text-white font-black text-xl tracking-tight hidden sm:block">Debug Inspector</h2>
            {title && (
                 <span className="text-slate-500 font-bold text-sm bg-slate-800 px-3 py-1 rounded-lg border border-slate-700 truncate max-w-[200px] sm:max-w-[300px]">{title}</span>
            )}
            <div className="hidden lg:flex px-3 py-1 bg-slate-800 rounded-lg border border-slate-700 items-center gap-2">
               <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
               <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">{pages.length} Pages</span>
            </div>
         </div>
         
         <div className="flex items-center gap-3">
             <div className="flex items-center mr-4 bg-slate-800 rounded-lg p-1 border border-slate-700">
               <button 
                  onClick={onPrevFile} 
                  disabled={!hasPrevFile}
                  className={`p-1.5 rounded-md transition-colors ${hasPrevFile ? 'text-white hover:bg-slate-700' : 'text-slate-600 cursor-not-allowed'}`}
                  title="Previous PDF File"
               >
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
               </button>
               <span className="text-white font-bold text-sm px-4 select-none tabular-nums tracking-wider">{currentFileIndex} <span className="text-slate-500 text-xs">/</span> {totalFiles}</span>
               <button 
                  onClick={onNextFile} 
                  disabled={!hasNextFile}
                  className={`p-1.5 rounded-md transition-colors ${hasNextFile ? 'text-white hover:bg-slate-700' : 'text-slate-600 cursor-not-allowed'}`}
                  title="Next PDF File"
               >
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
               </button>
             </div>

             <button 
               onClick={onClose}
               className="bg-white text-slate-900 px-4 py-2 rounded-xl font-bold text-sm hover:bg-slate-200 transition-colors flex items-center gap-2 shadow-lg shadow-white/5"
             >
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
               Back to Grid
             </button>
         </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative" ref={containerRef}>
        {/* Left: Dynamic Width, Scrollable Paper View */}
        <div 
          className="relative flex flex-col bg-slate-950" 
          style={{ width: `${leftPanelWidth}%` }}
        >
            {/* Visual Indicators for Pull-to-Switch */}
            <div 
                className={`absolute top-0 left-0 w-full flex items-center justify-center pointer-events-none transition-all duration-200 z-50 bg-slate-800/80 backdrop-blur border-b border-blue-500/50 ${pullDelta < 0 ? 'opacity-100 h-16' : 'opacity-0 h-0'}`}
                style={{ opacity: Math.min(Math.abs(pullDelta) / PULL_THRESHOLD, 1) }}
            >
                <div className="flex flex-col items-center">
                    <svg className={`w-6 h-6 text-blue-400 transition-transform duration-300 ${Math.abs(pullDelta) > PULL_THRESHOLD ? 'rotate-180 scale-110' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                    <span className="text-white text-xs font-bold uppercase tracking-widest mt-1">
                        {Math.abs(pullDelta) > PULL_THRESHOLD ? 'Release to Previous' : 'Pull for Previous'}
                    </span>
                </div>
            </div>

            <div 
                ref={scrollContainerRef}
                onScroll={handleScroll}
                onWheel={handleWheel}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className="w-full h-full overflow-y-auto overflow-x-hidden p-4 flex flex-col gap-8 custom-scrollbar overscroll-contain"
                style={{ overscrollBehavior: 'contain' }}
            >
            {pages.map((page) => (
                <div key={`${page.fileName}-${page.pageNumber}`} className="w-full relative group">
                <div className="flex justify-between items-end mb-2 px-1">
                    <div>
                        <h3 className="text-slate-400 font-bold text-xs uppercase tracking-widest truncate max-w-[300px]">{page.fileName}</h3>
                        <div className="flex gap-2 mt-1">
                        <span className="bg-blue-900/30 text-blue-300 text-[10px] font-black uppercase px-2 py-0.5 rounded border border-blue-800/50">Page {page.pageNumber}</span>
                        </div>
                    </div>
                </div>

                {/* The Page Image Container */}
                <div className="relative w-full shadow-2xl shadow-black/50 rounded-sm overflow-hidden bg-white ring-1 ring-slate-800 select-none">
                    <img 
                        src={page.dataUrl} 
                        alt={`Page ${page.pageNumber}`} 
                        className="block w-full h-auto opacity-90 transition-opacity hover:opacity-100 pointer-events-none"
                    />
                    
                    <svg 
                        ref={selectedDetection?.pageNumber === page.pageNumber ? svgRef : undefined}
                        className="absolute inset-0 w-full h-full"
                        viewBox="0 0 1000 1000"
                        preserveAspectRatio="none"
                    >
                        {/* Detections */}
                        {page.detections.map((det, detIdx) => {
                            const uniqueKey = `${page.fileName}||${page.pageNumber}||${detIdx}`;
                            const isSelected = selectedKey === uniqueKey;
                            const isGrouped = columnInfo && selectedDetection?.pageNumber === page.pageNumber && columnInfo.indices.includes(detIdx);
                            const boxes = (Array.isArray(det.boxes_2d[0]) ? det.boxes_2d : [det.boxes_2d]) as [number, number, number, number][];
                            
                            return (
                            <g 
                                key={uniqueKey} 
                                className="cursor-pointer"
                                onClick={(e) => {
                                e.stopPropagation();
                                setSelectedKey(uniqueKey);
                                }}
                            >
                                {boxes.map((box, bIdx) => (
                                <React.Fragment key={bIdx}>
                                    <rect
                                    x={box[1]}
                                    y={box[0]}
                                    width={box[3] - box[1]}
                                    height={box[2] - box[0]}
                                    fill={isSelected ? "rgba(59, 130, 246, 0.1)" : isGrouped ? "rgba(59, 130, 246, 0.03)" : "transparent"} 
                                    stroke={isSelected ? "#3b82f6" : "transparent"}
                                    strokeWidth={isSelected ? "6" : "0"} 
                                    strokeOpacity="0.4"
                                    vectorEffect="non-scaling-stroke"
                                    />

                                    <rect
                                    x={box[1]}
                                    y={box[0]}
                                    width={box[3] - box[1]}
                                    height={box[2] - box[0]}
                                    fill="none"
                                    stroke={isSelected ? "#3b82f6" : isGrouped ? "#60a5fa" : "#ef4444"}
                                    strokeWidth="1"
                                    strokeOpacity={isGrouped && !isSelected ? 0.3 : 1}
                                    vectorEffect="non-scaling-stroke" 
                                    shapeRendering="geometricPrecision"
                                    className="transition-colors duration-200 hover:stroke-blue-400"
                                    />
                                </React.Fragment>
                                ))}
                                
                                <rect 
                                x={boxes[0][3] - 40} 
                                y={boxes[0][0]} 
                                width="40" 
                                height="25" 
                                fill={isSelected ? "#3b82f6" : "#ef4444"}
                                opacity={isGrouped && !isSelected ? 0.3 : 1}
                                className="transition-colors duration-200"
                                />
                                <text
                                x={boxes[0][3] - 20}
                                y={boxes[0][0] + 17}
                                fill="white"
                                fontSize="16"
                                fontWeight="bold"
                                textAnchor="middle"
                                opacity={isGrouped && !isSelected ? 0.5 : 1}
                                pointerEvents="none"
                                >
                                {det.id === 'continuation' ? '...' : det.id}
                                </text>
                            </g>
                            );
                        })}

                        {/* Interactive Drag Handles - Only for selected page */}
                        {selectedDetection && selectedDetection.pageNumber === page.pageNumber && selectedBoxCoords && !isProcessing && (
                            <>
                            {/* Lines and Handles logic ... (Same as before) */}
                            {columnInfo && (
                                <>
                                    <line 
                                        x1={draggingSide === 'left' && dragValue !== null ? dragValue : columnInfo.initialLeft} y1="0" 
                                        x2={draggingSide === 'left' && dragValue !== null ? dragValue : columnInfo.initialLeft} y2="1000" 
                                        stroke="#3b82f6" strokeWidth="2" strokeDasharray="5,5" vectorEffect="non-scaling-stroke"
                                    />
                                    <line 
                                        className="cursor-col-resize hover:stroke-blue-400/50"
                                        x1={draggingSide === 'left' && dragValue !== null ? dragValue : columnInfo.initialLeft} y1="0" 
                                        x2={draggingSide === 'left' && dragValue !== null ? dragValue : columnInfo.initialLeft} y2="1000" 
                                        stroke="transparent" strokeWidth="12" vectorEffect="non-scaling-stroke"
                                        onMouseDown={(e) => handleSvgMouseDown(e, 'left')}
                                    />
                                </>
                            )}
                            
                            {columnInfo && (
                                <>
                                    <line 
                                        x1={draggingSide === 'right' && dragValue !== null ? dragValue : columnInfo.initialRight} y1="0" 
                                        x2={draggingSide === 'right' && dragValue !== null ? dragValue : columnInfo.initialRight} y2="1000" 
                                        stroke="#3b82f6" strokeWidth="2" strokeDasharray="5,5" vectorEffect="non-scaling-stroke"
                                    />
                                    <line 
                                        className="cursor-col-resize hover:stroke-blue-400/50"
                                        x1={draggingSide === 'right' && dragValue !== null ? dragValue : columnInfo.initialRight} y1="0" 
                                        x2={draggingSide === 'right' && dragValue !== null ? dragValue : columnInfo.initialRight} y2="1000" 
                                        stroke="transparent" strokeWidth="12" vectorEffect="non-scaling-stroke"
                                        onMouseDown={(e) => handleSvgMouseDown(e, 'right')}
                                    />
                                </>
                            )}

                            {/* Top Line (Individual) */}
                            <>
                                <line 
                                    x1={selectedBoxCoords.xmin - 20} y1={draggingSide === 'top' && dragValue !== null ? dragValue : selectedBoxCoords.ymin} 
                                    x2={selectedBoxCoords.xmax + 20} y2={draggingSide === 'top' && dragValue !== null ? dragValue : selectedBoxCoords.ymin} 
                                    stroke="#10b981" strokeWidth="2" strokeDasharray="5,5" vectorEffect="non-scaling-stroke"
                                />
                                <line 
                                    className="cursor-row-resize hover:stroke-emerald-400/50"
                                    x1={selectedBoxCoords.xmin - 20} y1={draggingSide === 'top' && dragValue !== null ? dragValue : selectedBoxCoords.ymin} 
                                    x2={selectedBoxCoords.xmax + 20} y2={draggingSide === 'top' && dragValue !== null ? dragValue : selectedBoxCoords.ymin} 
                                    stroke="transparent" strokeWidth="12" vectorEffect="non-scaling-stroke"
                                    onMouseDown={(e) => handleSvgMouseDown(e, 'top')}
                                />
                            </>

                            {/* Bottom Line (Individual) */}
                            <>
                                <line 
                                    x1={selectedBoxCoords.xmin - 20} y1={draggingSide === 'bottom' && dragValue !== null ? dragValue : selectedBoxCoords.ymax} 
                                    x2={selectedBoxCoords.xmax + 20} y2={draggingSide === 'bottom' && dragValue !== null ? dragValue : selectedBoxCoords.ymax} 
                                    stroke="#10b981" strokeWidth="2" strokeDasharray="5,5" vectorEffect="non-scaling-stroke"
                                />
                                <line 
                                    className="cursor-row-resize hover:stroke-emerald-400/50"
                                    x1={selectedBoxCoords.xmin - 20} y1={draggingSide === 'bottom' && dragValue !== null ? dragValue : selectedBoxCoords.ymax} 
                                    x2={selectedBoxCoords.xmax + 20} y2={draggingSide === 'bottom' && dragValue !== null ? dragValue : selectedBoxCoords.ymax} 
                                    stroke="transparent" strokeWidth="12" vectorEffect="non-scaling-stroke"
                                    onMouseDown={(e) => handleSvgMouseDown(e, 'bottom')}
                                />
                            </>

                            {draggingSide && dragValue !== null && (
                                <g>
                                    <rect 
                                        x={draggingSide === 'left' || draggingSide === 'right' ? dragValue + 10 : 500} 
                                        y={draggingSide === 'top' || draggingSide === 'bottom' ? dragValue + 10 : 50} 
                                        width="120" height="30" rx="6" fill="rgba(0,0,0,0.8)" 
                                    />
                                    <text 
                                        x={draggingSide === 'left' || draggingSide === 'right' ? dragValue + 70 : 560} 
                                        y={draggingSide === 'top' || draggingSide === 'bottom' ? dragValue + 30 : 70} 
                                        fill="white" fontSize="14" fontWeight="bold" textAnchor="middle"
                                    >
                                        {draggingSide === 'left' || draggingSide === 'right' ? 'X: ' : 'Y: '}{Math.round(dragValue)}
                                    </text>
                                </g>
                            )}
                            </>
                        )}
                    </svg>
                </div>
                </div>
            ))}
            <div className="h-20 flex items-center justify-center pointer-events-none">
                {/* Spacer at bottom */}
            </div>

            {/* Processing Overlay for Left Panel */}
            {isProcessing && (
                <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-white p-6 rounded-2xl shadow-2xl flex flex-col items-center animate-bounce-in">
                        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"></div>
                        <h4 className="text-slate-800 font-bold text-sm">Regenerating Images...</h4>
                    </div>
                </div>
            )}
            </div>
            
            {/* Bottom Pull Indicator */}
            <div 
                className={`absolute bottom-0 left-0 w-full flex items-center justify-center pointer-events-none transition-all duration-200 z-50 bg-slate-800/80 backdrop-blur border-t border-blue-500/50 ${pullDelta > 0 ? 'opacity-100 h-16' : 'opacity-0 h-0'}`}
                style={{ opacity: Math.min(Math.abs(pullDelta) / PULL_THRESHOLD, 1) }}
            >
                <div className="flex flex-col items-center">
                    <svg className={`w-6 h-6 text-blue-400 transition-transform duration-300 ${Math.abs(pullDelta) > PULL_THRESHOLD ? 'rotate-180 scale-110' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                    <span className="text-white text-xs font-bold uppercase tracking-widest mt-1">
                        {Math.abs(pullDelta) > PULL_THRESHOLD ? 'Release to Next' : 'Pull for Next'}
                    </span>
                </div>
            </div>
        </div>

        {/* Resizer Handle */}
        <div
            className={`w-2 bg-slate-950 hover:bg-blue-600 cursor-col-resize relative z-[60] flex items-center justify-center transition-colors border-l border-r border-slate-800 flex-none select-none ${isResizingPanel ? 'bg-blue-600' : ''}`}
            onMouseDown={startResizing}
        >
            <div className="w-0.5 h-8 bg-slate-600 rounded-full pointer-events-none"></div>
        </div>

        {/* Right: Dynamic Width, Inspector Sidebar */}
        <div 
            className="bg-slate-900 flex flex-col shadow-2xl relative z-20"
            style={{ width: `${100 - leftPanelWidth}%` }}
        >
          <div className="p-6 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md">
            <h3 className="text-slate-400 font-bold text-xs uppercase tracking-[0.2em]">Inspector</h3>
          </div>

          <div className="flex-1 overflow-y-auto p-8 relative">
            {isProcessing && (
               <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-[2px] z-50 flex items-center justify-center">
                    <span className="text-blue-400 font-black uppercase tracking-widest text-xs animate-pulse">Syncing...</span>
               </div>
            )}
            
            {selectedKey ? (
              <div className="space-y-12 animate-[fade-in_0.3s_ease-out]">
                  {/* Header Info */}
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <h2 className="text-4xl font-black text-white tracking-tight">
                        {selectedDetection?.id === 'continuation' ? 'Continuation' : `Q${selectedDetection?.id}`}
                      </h2>
                      <span className="bg-slate-800 text-slate-400 px-4 py-1.5 rounded-full text-xs font-bold border border-slate-700">
                          Page {selectedDetection?.pageNumber}
                      </span>
                    </div>
                    <p className="text-slate-500 text-sm font-medium break-all">{selectedDetection?.fileName}</p>
                    {columnInfo && (
                        <p className="mt-2 text-blue-400 text-xs font-bold uppercase tracking-wide bg-blue-900/20 inline-block px-2 py-1 rounded border border-blue-900/40">
                            Editing Column: {columnInfo.indices.length} Questions Linked
                        </p>
                    )}
                  </div>

                  {/* Comparison Section */}
                  <div className="grid grid-cols-1 gap-10">
                    
                    {/* 1. Final Processed Result */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                         <h4 className="text-green-400 font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                           <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                           Final Processed Output
                         </h4>
                         {selectedImage && (
                            <span className="text-slate-600 text-[10px] font-mono">
                               {(selectedImage as any).width || '?'} x {(selectedImage as any).height || '?'} px
                            </span>
                         )}
                      </div>

                      <div className="bg-slate-950 rounded-3xl border border-green-900/30 p-6 shadow-2xl relative group overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-green-500 to-emerald-600 rounded-t-3xl opacity-50"></div>
                        {selectedImage ? (
                            <div className="flex items-center justify-center min-h-[160px] bg-white rounded-xl overflow-hidden relative cursor-zoom-in">
                              <div className="absolute inset-0 opacity-10" 
                                  style={{backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '10px 10px'}}></div>
                              
                              <img 
                                src={selectedImage.dataUrl} 
                                alt="Final Result" 
                                className="relative max-w-full h-auto object-contain"
                              />
                            </div>
                        ) : (
                           <div className="h-40 flex flex-col items-center justify-center text-slate-600">
                             <span className="text-xs font-bold uppercase tracking-widest">Processing...</span>
                           </div>
                        )}
                      </div>
                    </div>

                    {/* 2. Raw Gemini Detection */}
                    <div className="space-y-3">
                       <div className="flex justify-between items-center">
                            <h4 className="text-blue-400 font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                                <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                                Raw Gemini Detection (No Trim)
                            </h4>
                            <span className="text-[10px] text-slate-500 font-black uppercase">
                                Drag Lines to Adjust Crop
                            </span>
                       </div>

                       <div className="bg-slate-950 rounded-3xl border border-blue-900/30 p-6 shadow-2xl relative group overflow-hidden">
                         <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-t-3xl opacity-50"></div>
                         
                         {displayRawUrl ? (
                             <div className="flex items-center justify-center min-h-[160px] bg-white rounded-xl overflow-hidden relative cursor-zoom-in">
                               <div className="absolute inset-0 opacity-10" 
                                   style={{backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '10px 10px'}}></div>
                               
                               <img 
                                 src={displayRawUrl} 
                                 alt="Raw Gemini Crop" 
                                 className="relative max-w-full h-auto object-contain"
                               />
                             </div>
                         ) : (
                            <div className="h-40 flex flex-col items-center justify-center text-slate-600 border-2 border-dashed border-slate-800 rounded-xl bg-slate-900/50">
                               {isGeneratingRaw ? (
                                   <div className="flex flex-col items-center gap-2">
                                       <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                       <span className="text-xs font-bold uppercase tracking-widest text-blue-400">Generating Preview...</span>
                                   </div>
                               ) : (
                                   <span className="text-xs font-bold uppercase tracking-widest opacity-50">Raw view unavailable</span>
                               )}
                            </div>
                         )}
                       </div>
                    </div>

                  </div>

                  {/* Technical Data */}
                  <div className="space-y-4 pt-6 border-t border-slate-800">
                    <div className="flex justify-between items-center">
                        <h4 className="text-slate-500 font-bold text-xs uppercase tracking-widest">Bounding Box Coordinates</h4>
                        <span className="text-blue-500 text-[10px] uppercase font-bold">Y-Axis (Green) • X-Axis (Blue)</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className={`bg-slate-800/30 p-3 rounded-lg border transition-colors ${draggingSide === 'top' ? 'bg-emerald-900/30 border-emerald-500' : 'bg-slate-800/30 border-slate-800'}`}>
                          <span className="block text-[9px] text-slate-500 uppercase font-black mb-1">Y-Min (Top)</span>
                          <span className="text-white font-mono text-sm">
                              {selectedDetection ? Math.round((Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0][0] : selectedDetection.boxes_2d[0]) as number) : '-'}
                          </span>
                        </div>
                        <div className={`p-3 rounded-lg border transition-colors ${draggingSide === 'left' ? 'bg-blue-900/30 border-blue-500' : 'bg-slate-800/30 border-slate-800'}`}>
                          <span className="block text-[9px] text-slate-500 uppercase font-black mb-1">X-Min (Left)</span>
                          <span className="text-white font-mono text-sm">
                              {selectedDetection ? Math.round((Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0][1] : selectedDetection.boxes_2d[1]) as number) : '-'}
                          </span>
                        </div>
                        <div className={`bg-slate-800/30 p-3 rounded-lg border transition-colors ${draggingSide === 'bottom' ? 'bg-emerald-900/30 border-emerald-500' : 'bg-slate-800/30 border-slate-800'}`}>
                          <span className="block text-[9px] text-slate-500 uppercase font-black mb-1">Y-Max (Bottom)</span>
                          <span className="text-white font-mono text-sm">
                              {selectedDetection ? Math.round((Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0][2] : selectedDetection.boxes_2d[2]) as number) : '-'}
                          </span>
                        </div>
                        <div className={`p-3 rounded-lg border transition-colors ${draggingSide === 'right' ? 'bg-blue-900/30 border-blue-500' : 'bg-slate-800/30 border-slate-800'}`}>
                          <span className="block text-[9px] text-slate-500 uppercase font-black mb-1">X-Max (Right)</span>
                          <span className="text-white font-mono text-sm">
                              {selectedDetection ? Math.round((Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0][3] : selectedDetection.boxes_2d[3]) as number) : '-'}
                          </span>
                        </div>
                    </div>
                  </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                  <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mb-8">
                      <svg className="w-12 h-12 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" /></svg>
                  </div>
                  <h3 className="text-slate-200 font-bold text-xl mb-3">No Selection</h3>
                  <p className="text-slate-500 text-base max-w-[240px]">Click any bounding box on the left to inspect details and drag adjustment lines.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
