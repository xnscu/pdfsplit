
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DebugPageData, DetectedQuestion } from '../types';

interface Props {
  pages: DebugPageData[];
}

// Flattened structure for easy navigation across all pages
interface FlattenedItem {
  page: DebugPageData;
  detection: DetectedQuestion;
  pageIndex: number;
  detectionIndex: number;
}

export const DebugRawView: React.FC<Props> = ({ pages }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Flatten all detections into a single list for easy sequential navigation
  const allItems = useMemo(() => {
    const items: FlattenedItem[] = [];
    pages.forEach((page, pIdx) => {
      page.detections.forEach((det, dIdx) => {
        items.push({
          page,
          detection: det,
          pageIndex: pIdx,
          detectionIndex: dIdx
        });
      });
    });
    return items;
  }, [pages]);

  // Generate the raw crop when the selection changes
  useEffect(() => {
    if (selectedIndex === null) {
      setPreviewUrl(null);
      return;
    }

    const item = allItems[selectedIndex];
    if (!item) return;

    const generateCrop = async () => {
      const { page, detection } = item;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = page.dataUrl;
      await new Promise((resolve) => { img.onload = resolve; });

      // Handle both single and multiple boxes
      const rawBoxes = (Array.isArray(detection.boxes_2d[0]) 
        ? detection.boxes_2d 
        : [detection.boxes_2d]) as [number, number, number, number][];

      const fragments = rawBoxes.map(box => {
        const x = Math.floor((box[1] / 1000) * page.width);
        const y = Math.floor((box[0] / 1000) * page.height);
        const w = Math.floor(((box[3] - box[1]) / 1000) * page.width);
        const h = Math.floor(((box[2] - box[0]) / 1000) * page.height);
        return { x, y, w, h };
      });

      const totalHeight = fragments.reduce((acc, f) => acc + f.h, 0);
      const maxWidth = Math.max(...fragments.map(f => f.w));

      if (maxWidth === 0 || totalHeight === 0) return;

      const canvas = document.createElement('canvas');
      canvas.width = maxWidth;
      canvas.height = totalHeight + (fragments.length > 1 ? (fragments.length - 1) * 10 : 0); // Add slight gap for multi-box
      const ctx = canvas.getContext('2d');

      if (ctx) {
        ctx.fillStyle = '#eee';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        let currentY = 0;
        fragments.forEach(f => {
          ctx.drawImage(img, f.x, f.y, f.w, f.h, 0, currentY, f.w, f.h);
          currentY += f.h + 10;
        });
        setPreviewUrl(canvas.toDataURL('image/jpeg', 1.0));
      }
    };

    generateCrop();
  }, [selectedIndex, allItems]);

  const handleNext = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIndex(prev => (prev !== null && prev < allItems.length - 1 ? prev + 1 : prev));
  }, [allItems.length]);

  const handlePrev = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIndex(prev => (prev !== null && prev > 0 ? prev - 1 : prev));
  }, []);
  
  // Keyboard navigation for the modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedIndex === null) return;
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'Escape') setSelectedIndex(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, handleNext, handlePrev]);

  if (pages.length === 0) return null;

  return (
    <div className="animate-fade-in space-y-12 pb-20 w-full">
      {pages.map((page, pageIdx) => (
        <div key={`${page.fileName}-${page.pageNumber}`} className="bg-slate-900 rounded-xl overflow-hidden shadow-2xl border border-slate-800 flex flex-col lg:flex-row h-[85vh]">
          
          {/* Main Image Area - Takes remaining width & Uses natural aspect ratio */}
          <div className="flex-grow relative bg-slate-950/50 h-full flex flex-col">
             {/* Header Overlay */}
            <div className="flex-none bg-slate-900/90 backdrop-blur-sm px-6 py-3 border-b border-slate-800 flex justify-between items-center z-10">
               <h2 className="text-white font-bold text-lg flex items-center gap-2">
                 <span className="text-slate-300 font-normal">{page.fileName}</span>
                 <span className="bg-blue-600 text-xs px-2 py-1 rounded ml-2">Page {page.pageNumber}</span>
               </h2>
               <span className="text-slate-500 text-xs font-mono">{page.width} x {page.height}px</span>
            </div>

            {/* Responsive Image Container */}
            <div className="flex-grow p-4 overflow-auto flex justify-center items-start">
               {/* Wrapper matches image size naturally */}
               <div className="relative shadow-2xl inline-block">
                 <img 
                   src={page.dataUrl} 
                   alt={`Page ${page.pageNumber}`} 
                   className="block max-w-full h-auto"
                   style={{ maxHeight: 'calc(85vh - 60px)' }} 
                 />
                 
                 {/* SVG Overlay using viewBox 0-1000 for perfect normalized coordinate mapping */}
                 <svg 
                    className="absolute inset-0 w-full h-full"
                    viewBox="0 0 1000 1000"
                    preserveAspectRatio="none"
                 >
                    {page.detections.map((det) => {
                      // Find index in flattened list for click handler
                      const globalIndex = allItems.findIndex(item => item.pageIndex === pageIdx && item.detection.id === det.id);
                      
                      // Normalize boxes for rendering
                      const boxes = (Array.isArray(det.boxes_2d[0]) 
                        ? det.boxes_2d 
                        : [det.boxes_2d]) as [number, number, number, number][];
                      
                      return (
                        <g 
                          key={det.id} 
                          className="cursor-pointer group"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedIndex(globalIndex);
                          }}
                        >
                          {boxes.map((box, bIdx) => (
                            <rect
                              key={bIdx}
                              x={box[1]} // xmin
                              y={box[0]} // ymin
                              width={box[3] - box[1]} // xmax - xmin
                              height={box[2] - box[0]} // ymax - ymin
                              fill="rgba(255, 50, 50, 0.1)"
                              stroke="red"
                              strokeWidth="2"
                              vectorEffect="non-scaling-stroke"
                              className="group-hover:fill-[rgba(255,50,50,0.3)] group-hover:stroke-[4px] transition-all duration-75"
                            />
                          ))}
                          
                          {/* ID Label - Top Right inside the first box */}
                          <text
                            x={boxes[0][3] - 10}
                            y={boxes[0][0] + 35}
                            fill="#991b1b" // Deep Red (red-800)
                            fontSize="40"
                            fontWeight="900"
                            textAnchor="end"
                            style={{ 
                              textShadow: '0 0 4px #fff, 0 0 2px #fff' // White halo for contrast
                            }}
                          >
                            {det.id}
                          </text>
                        </g>
                      );
                    })}
                 </svg>
               </div>
            </div>
          </div>

          {/* Sidebar List - Fixed Width */}
          <div className="w-full lg:w-80 bg-slate-900 border-l border-slate-800 flex flex-col flex-none h-[300px] lg:h-full">
            <div className="p-4 border-b border-slate-800 bg-slate-900 flex-none">
              <h3 className="text-slate-300 font-semibold text-sm uppercase tracking-wider">Coordinates List</h3>
              <p className="text-xs text-slate-500 mt-1">{page.detections.length} questions detected</p>
            </div>
            <div className="overflow-y-auto flex-1 p-2 space-y-1">
              {page.detections.map((det) => {
                const globalIndex = allItems.findIndex(item => item.pageIndex === pageIdx && item.detection.id === det.id);
                const isSelected = selectedIndex === globalIndex;
                const boxes = (Array.isArray(det.boxes_2d[0]) ? det.boxes_2d : [det.boxes_2d]) as [number, number, number, number][];
                const isMulti = boxes.length > 1;

                return (
                  <button
                    key={det.id}
                    onClick={() => setSelectedIndex(globalIndex)}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-all group flex justify-between items-center ${
                      isSelected 
                        ? 'bg-blue-900/40 border-blue-500/50' 
                        : 'bg-transparent border-transparent hover:bg-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className={`font-bold ${isSelected ? 'text-blue-400' : 'text-slate-200 group-hover:text-blue-400'}`}>
                        Q{det.id}
                      </div>
                      <div className="text-[10px] font-mono text-slate-600">
                         {isMulti ? `${boxes.length} boxes (stitched)` : 'Single box'}
                      </div>
                    </div>
                    <div className="text-right">
                       {isMulti ? (
                         <span className="text-[10px] font-mono text-slate-500 block">Mixed</span>
                       ) : (
                         <>
                           <span className="text-[10px] font-mono text-slate-500 block">y:{Math.round(boxes[0][0])}</span>
                           <span className="text-[10px] font-mono text-slate-500 block">x:{Math.round(boxes[0][1])}</span>
                         </>
                       )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ))}

      {/* Raw Crop Modal */}
      {selectedIndex !== null && allItems[selectedIndex] && (
        <div 
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setSelectedIndex(null)}
        >
          {/* Previous Button */}
          <button 
             onClick={handlePrev}
             disabled={selectedIndex === 0}
             className="absolute left-4 top-1/2 -translate-y-1/2 p-4 text-white/40 hover:text-white disabled:opacity-0 hover:bg-white/10 rounded-full transition-all z-50"
          >
             <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          
          {/* Next Button */}
          <button 
             onClick={handleNext}
             disabled={selectedIndex === allItems.length - 1}
             className="absolute right-4 top-1/2 -translate-y-1/2 p-4 text-white/40 hover:text-white disabled:opacity-0 hover:bg-white/10 rounded-full transition-all z-50"
          >
             <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>

          <div 
             className="bg-white rounded-xl overflow-hidden max-w-5xl w-full max-h-[90vh] flex flex-col shadow-2xl m-4 z-40" 
             onClick={e => e.stopPropagation()}
          >
             <div className="bg-slate-50 px-6 py-4 border-b flex justify-between items-center">
                <div>
                   <h3 className="font-bold text-xl text-slate-900">
                     Raw Crop: Question {allItems[selectedIndex].detection.id}
                   </h3>
                   <p className="text-xs text-slate-500">
                     {allItems[selectedIndex].page.fileName} • Page {allItems[selectedIndex].page.pageNumber}
                   </p>
                </div>
                <button onClick={() => setSelectedIndex(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                  <svg className="w-6 h-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
             </div>
             
             <div className="flex-1 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAAOwgAADsIBFShKgAAAABhJREFUOBFjTE1N/Z8YCwgodQwY1YAMgAAAVg4EIZ77X6YAAAAASUVORK5CYII=')] overflow-auto flex items-center justify-center p-8 min-h-[400px]">
                {previewUrl ? (
                   <img src={previewUrl} className="border-2 border-red-500 shadow-xl max-w-full object-contain" alt="Raw Crop" />
                ) : (
                   <div className="animate-pulse flex space-x-4">
                      <div className="h-12 w-12 bg-slate-200 rounded-full"></div>
                   </div>
                )}
             </div>
             
             <div className="bg-yellow-50 px-6 py-3 text-xs text-yellow-800 border-t border-yellow-100 flex justify-between items-center">
               <span>⚠️ Displaying exact coordinates (0px padding, No cleaning).</span>
               <span className="font-mono text-yellow-900/50 hidden sm:inline">
                   {(Array.isArray(allItems[selectedIndex].detection.boxes_2d[0])) ? "Nested Box Structure" : `[${Math.round(allItems[selectedIndex].detection.boxes_2d[0] as number)},${Math.round(allItems[selectedIndex].detection.boxes_2d[1] as number)}]`}
               </span>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};
