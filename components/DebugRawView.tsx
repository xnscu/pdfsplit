
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DebugPageData, DetectedQuestion } from '../types';
import { constructQuestionCanvas, analyzeCanvasContent, generateAlignedImage, CropSettings } from '../services/pdfService';

interface Props {
  pages: DebugPageData[];
  settings: CropSettings;
}

// Flattened structure for easy navigation across all pages
interface FlattenedItem {
  page: DebugPageData;
  detection: DetectedQuestion;
  pageIndex: number;
  detectionIndex: number;
}

export const DebugRawView: React.FC<Props> = ({ pages, settings }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [previewData, setPreviewData] = useState<{ final: string, original: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

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

  // Generate both the Processed (Aligned) and Raw (Original/Stitched) crops
  useEffect(() => {
    if (selectedIndex === null) {
      setPreviewData(null);
      return;
    }

    const item = allItems[selectedIndex];
    if (!item) return;

    const generatePreview = async () => {
      setIsGenerating(true);
      try {
        const { page, detection } = item;
        
        // Handle both single and multiple boxes
        const boxes = (Array.isArray(detection.boxes_2d[0]) 
          ? detection.boxes_2d 
          : [detection.boxes_2d]) as [number, number, number, number][];

        // 1. Construct the Raw Stitched Canvas
        const constructed = await constructQuestionCanvas(
          page.dataUrl,
          boxes,
          page.width,
          page.height,
          settings
        );

        if (constructed.canvas) {
           // 2. Analyze content to find trim bounds
           const trim = analyzeCanvasContent(constructed.canvas);
           
           // 3. Generate Final Aligned Image (Processed)
           const finalDataUrl = await generateAlignedImage(
               constructed.canvas,
               trim,
               trim.w, // For debug, just align to itself
               settings
           );

           // 4. Determine "Original" view
           // If constructQuestionCanvas created a raw visualization (e.g. from stitching), use it.
           // Otherwise use the raw stitched canvas itself.
           let rawDataUrl = constructed.originalDataUrl;
           if (!rawDataUrl && 'toDataURL' in constructed.canvas) {
              rawDataUrl = (constructed.canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.8);
           } else if (!rawDataUrl && constructed.canvas instanceof OffscreenCanvas) {
              const blob = await constructed.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
              rawDataUrl = await new Promise(r => {
                  const reader = new FileReader();
                  reader.onloadend = () => r(reader.result as string);
                  reader.readAsDataURL(blob);
              });
           }

           setPreviewData({
               final: finalDataUrl,
               original: rawDataUrl || finalDataUrl
           });
        }
      } catch (e) {
        console.error("Preview generation failed", e);
      } finally {
        setIsGenerating(false);
      }
    };

    generatePreview();
  }, [selectedIndex, allItems, settings]);

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
          
          {/* Main Image Area */}
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
                      const globalIndex = allItems.findIndex(item => item.pageIndex === pageIdx && item.detection.id === det.id);
                      const boxes = (Array.isArray(det.boxes_2d[0]) ? det.boxes_2d : [det.boxes_2d]) as [number, number, number, number][];
                      
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
                              x={box[1]}
                              y={box[0]}
                              width={box[3] - box[1]}
                              height={box[2] - box[0]}
                              fill="rgba(255, 50, 50, 0.1)"
                              stroke="red"
                              strokeWidth="2"
                              vectorEffect="non-scaling-stroke"
                              className="group-hover:fill-[rgba(255,50,50,0.3)] group-hover:stroke-[4px] transition-all duration-75"
                            />
                          ))}
                          
                          {/* ID Label */}
                          <text
                            x={boxes[0][3] - 10}
                            y={boxes[0][0] + 35}
                            fill="#991b1b"
                            fontSize="40"
                            fontWeight="900"
                            textAnchor="end"
                            style={{ textShadow: '0 0 4px #fff, 0 0 2px #fff' }}
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

          {/* Sidebar List */}
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

      {/* Enhanced Preview Modal */}
      {selectedIndex !== null && allItems[selectedIndex] && (
        <div 
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 backdrop-blur-sm"
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
             className="relative max-w-7xl w-full h-[95vh] flex flex-col items-center justify-center p-4 md:px-12 md:py-8"
             onClick={e => e.stopPropagation()}
          >
             <div className="w-full flex justify-between items-center text-white mb-4">
               <div className="flex flex-col">
                 <h2 className="text-2xl font-bold">Debug Crop: Q{allItems[selectedIndex].detection.id}</h2>
                 <p className="text-sm text-white/50">{allItems[selectedIndex].page.fileName} • Page {allItems[selectedIndex].page.pageNumber}</p>
               </div>
               <button onClick={() => setSelectedIndex(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/50 hover:text-white">
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
               </button>
             </div>

             <div className="flex-1 w-full bg-white rounded-xl overflow-hidden shadow-2xl relative flex flex-col">
                <div className="relative w-full h-full bg-slate-100 flex items-center justify-center p-8">
                   
                   {/* Compare Button Overlay */}
                   {previewData?.original && !isGenerating && (
                      <div className="absolute top-4 left-4 z-20">
                        <button 
                          onMouseDown={() => setShowOriginal(true)}
                          onMouseUp={() => setShowOriginal(false)}
                          onMouseLeave={() => setShowOriginal(false)}
                          onTouchStart={() => setShowOriginal(true)}
                          onTouchEnd={() => setShowOriginal(false)}
                          className={`
                            px-4 py-2 rounded-full font-bold shadow-lg transition-all border-2
                            ${showOriginal 
                              ? 'bg-orange-500 text-white border-orange-600 scale-105' 
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                            }
                          `}
                        >
                          {showOriginal ? '显示原始裁剪 (Raw)' : '长按对比原图 (Original)'}
                        </button>
                      </div>
                   )}

                   {isGenerating ? (
                      <div className="flex flex-col items-center gap-4 text-slate-400">
                         <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
                         <span className="font-bold text-sm">Generating optimized crop...</span>
                      </div>
                   ) : previewData ? (
                      <img 
                        src={showOriginal ? previewData.original : previewData.final} 
                        alt="Question Crop" 
                        className={`max-h-full max-w-full object-contain shadow-lg transition-all duration-150 ${showOriginal ? 'ring-4 ring-orange-500' : ''}`}
                      />
                   ) : (
                      <span className="text-red-400 font-bold">Failed to load preview</span>
                   )}
                </div>
             </div>

             <div className="mt-6 flex items-center justify-between w-full max-w-4xl text-white/60 text-sm">
                <span>
                    Use arrow keys to navigate. 
                    {showOriginal ? <strong className="text-orange-400 ml-2">Viewing Raw Stitch</strong> : <strong className="text-blue-400 ml-2">Viewing Final Processed</strong>}
                </span>
                <div className="font-mono text-xs opacity-50">
                    Box: {JSON.stringify(allItems[selectedIndex].detection.boxes_2d)}
                </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};
