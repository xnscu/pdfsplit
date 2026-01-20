
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { DebugPageData, DetectedQuestion } from '../../types';

interface Props {
  width: number;
  pages: DebugPageData[];
  selectedKey: string | null;
  onSelectKey: (key: string) => void;
  selectedDetection: DetectedQuestion & { pageNumber: number } | null;
  selectedBoxCoords: { ymin: number; xmin: number; ymax: number; xmax: number } | null;
  columnInfo: { indices: number[]; initialLeft: number; initialRight: number } | null;
  draggingSide: 'left' | 'right' | 'top' | 'bottom' | null;
  dragValue: number | null;
  onDragStateChange: (side: 'left' | 'right' | 'top' | 'bottom' | null, value: number | null) => void;
  isProcessing: boolean;
  hasNextFile: boolean;
  hasPrevFile: boolean;
  onTriggerNextFile: () => void;
  onTriggerPrevFile: () => void;
}

const PULL_THRESHOLD = 500;

export const DebugPageViewer: React.FC<Props> = ({
  width,
  pages,
  selectedKey,
  onSelectKey,
  selectedDetection,
  selectedBoxCoords,
  columnInfo,
  draggingSide,
  dragValue,
  onDragStateChange,
  isProcessing,
  hasNextFile,
  hasPrevFile,
  onTriggerNextFile,
  onTriggerPrevFile
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Pull Gesture State
  const [pullDelta, setPullDelta] = useState(0);
  const touchStartY = useRef<number | null>(null);
  const lastTriggerTime = useRef<number>(0);

  // Trigger navigation when threshold reached
  useEffect(() => {
    if (Math.abs(pullDelta) > PULL_THRESHOLD) {
      const now = Date.now();
      if (now - lastTriggerTime.current > 1000) {
        if (pullDelta > 0 && hasNextFile) {
          onTriggerNextFile();
          lastTriggerTime.current = now;
        } else if (pullDelta < 0 && hasPrevFile) {
          onTriggerPrevFile();
          lastTriggerTime.current = now;
        }
      }
      setPullDelta(0);
    }
  }, [pullDelta, hasNextFile, hasPrevFile, onTriggerNextFile, onTriggerPrevFile]);

  // Reset scroll when pages change (new file)
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    setPullDelta(0);
  }, [pages[0]?.fileName]);

  // Scroll Handler
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtTop = scrollTop <= 0;
    const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 1;

    if (!isAtTop && !isAtBottom && pullDelta !== 0) {
        setPullDelta(0);
    }
  };

  // Wheel Handler
  const handleWheel = (e: React.WheelEvent) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    
    const isAtTop = scrollTop <= 1; 
    const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 1;

    if (isAtTop && hasPrevFile && e.deltaY < 0) {
        setPullDelta(prev => Math.max(prev + e.deltaY, -PULL_THRESHOLD * 1.5));
    } else if (isAtBottom && hasNextFile && e.deltaY > 0) {
        setPullDelta(prev => Math.min(prev + e.deltaY, PULL_THRESHOLD * 1.5));
    } else {
        if (pullDelta !== 0 && ((isAtTop && !hasPrevFile) || (isAtBottom && !hasNextFile))) {
             setPullDelta(0);
        }
    }
  };

  // Touch Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const currentY = e.touches[0].clientY;
    const diff = touchStartY.current - currentY; 

    const isAtTop = scrollTop <= 0;
    const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 1;

    if (isAtTop && hasPrevFile && diff < 0) {
        setPullDelta(diff); 
    } else if (isAtBottom && hasNextFile && diff > 0) {
        setPullDelta(diff);
    } else {
        setPullDelta(0);
    }
  };

  const handleTouchEnd = () => {
    setPullDelta(0);
    touchStartY.current = null;
  };

  // Drag Handlers
  const handleSvgMouseDown = useCallback((e: React.MouseEvent, side: 'left' | 'right' | 'top' | 'bottom') => {
      e.stopPropagation();
      e.preventDefault();
      
      let initVal = 0;
      if (side === 'left') initVal = columnInfo?.initialLeft || 0;
      if (side === 'right') initVal = columnInfo?.initialRight || 1000;
      if (side === 'top') initVal = selectedBoxCoords?.ymin || 0;
      if (side === 'bottom') initVal = selectedBoxCoords?.ymax || 1000;

      onDragStateChange(side, initVal);
  }, [columnInfo, selectedBoxCoords, onDragStateChange]);

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
      
      newVal = Math.max(0, Math.min(1000, newVal));
      onDragStateChange(draggingSide, newVal); // Update parent state, which feeds back into dragValue prop
  }, [draggingSide, onDragStateChange]);

  const handleGlobalMouseUp = useCallback(() => {
     // Handled by parent to finalize update, but here we just stop tracking if needed locally
     // Actually parent handles the final commit logic.
  }, []);

  useEffect(() => {
      if (draggingSide) {
          window.addEventListener('mousemove', handleGlobalMouseMove);
      } else {
          window.removeEventListener('mousemove', handleGlobalMouseMove);
      }
      return () => {
          window.removeEventListener('mousemove', handleGlobalMouseMove);
      };
  }, [draggingSide, handleGlobalMouseMove]);


  return (
    <div 
        className="relative flex flex-col bg-slate-950" 
        style={{ width: `${width}%` }}
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
                            onSelectKey(uniqueKey);
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

                    {selectedDetection && selectedDetection.pageNumber === page.pageNumber && selectedBoxCoords && !isProcessing && (
                        <>
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
  );
};
