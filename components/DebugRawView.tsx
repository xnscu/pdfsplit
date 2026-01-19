
import React, { useState, useEffect, useMemo } from 'react';
import { DebugPageData, QuestionImage } from '../types';
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
}

// Default settings for debug visualization - STRICT mode
// No padding, no border, exact coordinate match.
const DEBUG_CROP_SETTINGS: CropSettings = {
  cropPadding: 10, // Changed to 0 to be exact
  canvasPaddingLeft: 0,
  canvasPaddingRight: 0,
  canvasPaddingY: 0,
  mergeOverlap: -5,
  debugExportPadding: 0 // New setting to remove the white border
};

export const DebugRawView: React.FC<Props> = ({ 
  pages, 
  questions, 
  onClose, 
  title,
  onNextFile,
  onPrevFile,
  hasNextFile,
  hasPrevFile
}) => {
  // Key format: "fileName||pageNumber||detIndex"
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  
  // State for dynamically generated raw view (for ZIP loaded data)
  const [dynamicRawUrl, setDynamicRawUrl] = useState<string | null>(null);
  const [isGeneratingRaw, setIsGeneratingRaw] = useState(false);

  // Reset selected key when the file changes (pages prop changes)
  useEffect(() => {
    setSelectedKey(null);
  }, [pages[0]?.fileName]);

  const { selectedImage, selectedDetection } = useMemo(() => {
    if (!selectedKey) return { selectedImage: null, selectedDetection: null };
    
    const parts = selectedKey.split('||');
    if (parts.length !== 3) return { selectedImage: null, selectedDetection: null };

    const fileName = parts[0];
    const pageNum = parseInt(parts[1], 10);
    const detIdx = parseInt(parts[2], 10);

    // 1. Find the specific detection for raw data display
    const page = pages.find(p => p.fileName === fileName && p.pageNumber === pageNum);
    if (!page) return { selectedImage: null, selectedDetection: null };

    const detectionRaw = page.detections[detIdx];
    const detection = detectionRaw ? { ...detectionRaw, pageNumber: pageNum, fileName } : null;

    // 2. Resolve the effective Question ID to find the extracted image
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

    return { selectedImage: image, selectedDetection: detection };
  }, [selectedKey, pages, questions]);

  // Effect: Dynamically generate the raw crop
  useEffect(() => {
    // Reset state when selection changes
    setDynamicRawUrl(null);
    setIsGeneratingRaw(false);

    if (!selectedDetection || !selectedKey) return;

    // We ALWAYS regenerate the raw view here using DEBUG_CROP_SETTINGS (0 padding).
    // The selectedImage.originalDataUrl typically contains padding (25px) from the main app settings,
    // so we cannot use it if we want to show the "Exact" raw match.

    const generateRawView = async () => {
      setIsGeneratingRaw(true);
      try {
        const parts = selectedKey.split('||');
        const fileName = parts[0];
        const pageNum = parseInt(parts[1], 10);
        
        const page = pages.find(p => p.fileName === fileName && p.pageNumber === pageNum);
        
        if (page) {
          // Normalize boxes to array format for the service
          let boxes = selectedDetection.boxes_2d;
          // Ensure it's treated as an array of boxes even if it's a single box array (though types say it is)
          if (!Array.isArray(boxes[0])) {
             // @ts-ignore
             boxes = [boxes];
          }

          // Use the construct service to stitch/crop the raw area
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

  }, [selectedDetection, selectedKey, pages]); // Removed selectedImage from deps to avoid unnecessary re-runs

  // Determine which URL to show for the Raw View. 
  // We prefer the dynamic one because it uses 0-padding (strict match).
  const displayRawUrl = dynamicRawUrl;

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
             {/* File Navigation Controls */}
             <div className="flex items-center mr-4 bg-slate-800 rounded-lg p-1 border border-slate-700">
               <button 
                  onClick={onPrevFile} 
                  disabled={!hasPrevFile}
                  className={`p-1.5 rounded-md transition-colors ${hasPrevFile ? 'text-white hover:bg-slate-700' : 'text-slate-600 cursor-not-allowed'}`}
                  title="Previous PDF File"
               >
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
               </button>
               <span className="text-slate-500 text-xs font-bold uppercase px-2 select-none">PDF File</span>
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

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left: 50% Width, Scrollable Paper View */}
        <div className="w-1/2 overflow-y-auto overflow-x-hidden p-4 flex flex-col gap-8 bg-slate-950 custom-scrollbar border-r border-slate-800">
          {pages.map((page) => (
            <div key={`${page.fileName}-${page.pageNumber}`} className="w-full relative group">
              {/* Header above each page */}
              <div className="flex justify-between items-end mb-2 px-1">
                <div>
                    <h3 className="text-slate-400 font-bold text-xs uppercase tracking-widest truncate max-w-[300px]">{page.fileName}</h3>
                    <div className="flex gap-2 mt-1">
                      <span className="bg-blue-900/30 text-blue-300 text-[10px] font-black uppercase px-2 py-0.5 rounded border border-blue-800/50">Page {page.pageNumber}</span>
                    </div>
                </div>
              </div>

              {/* The Page Image Container - Full Width */}
              <div className="relative w-full shadow-2xl shadow-black/50 rounded-sm overflow-hidden bg-white ring-1 ring-slate-800">
                  <img 
                    src={page.dataUrl} 
                    alt={`Page ${page.pageNumber}`} 
                    className="block w-full h-auto opacity-90 transition-opacity hover:opacity-100"
                  />
                  
                  {/* SVG Overlay */}
                  <svg 
                      className="absolute inset-0 w-full h-full"
                      viewBox="0 0 1000 1000"
                      preserveAspectRatio="none"
                  >
                      {page.detections.map((det, detIdx) => {
                        const uniqueKey = `${page.fileName}||${page.pageNumber}||${detIdx}`;
                        const isSelected = selectedKey === uniqueKey;
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
                                {/* 1. Glow/Interaction Layer: Thicker, transparent stroke for visibility and hit-area */}
                                <rect
                                  x={box[1]}
                                  y={box[0]}
                                  width={box[3] - box[1]}
                                  height={box[2] - box[0]}
                                  fill={isSelected ? "rgba(59, 130, 246, 0.1)" : "transparent"} 
                                  stroke={isSelected ? "#3b82f6" : "transparent"}
                                  strokeWidth={isSelected ? "6" : "0"} 
                                  strokeOpacity="0.4"
                                  vectorEffect="non-scaling-stroke"
                                />

                                {/* 2. Precision Layer: 1px hairline stroke for exact coordinate visualization */}
                                <rect
                                  x={box[1]}
                                  y={box[0]}
                                  width={box[3] - box[1]}
                                  height={box[2] - box[0]}
                                  fill="none"
                                  stroke={isSelected ? "#3b82f6" : "#ef4444"}
                                  strokeWidth="1" // Always 1px for maximum precision
                                  vectorEffect="non-scaling-stroke" // Keeps it 1px regardless of zoom
                                  shapeRendering="geometricPrecision"
                                  className="transition-colors duration-200 hover:stroke-blue-400"
                                />
                              </React.Fragment>
                            ))}
                            
                            {/* ID Label Tag */}
                            <rect 
                              x={boxes[0][3] - 40} 
                              y={boxes[0][0]} 
                              width="40" 
                              height="25" 
                              fill={isSelected ? "#3b82f6" : "#ef4444"}
                              className="transition-colors duration-200"
                            />
                            <text
                              x={boxes[0][3] - 20}
                              y={boxes[0][0] + 17}
                              fill="white"
                              fontSize="16"
                              fontWeight="bold"
                              textAnchor="middle"
                              pointerEvents="none"
                            >
                              {det.id === 'continuation' ? '...' : det.id}
                            </text>
                          </g>
                        );
                      })}
                  </svg>
              </div>
            </div>
          ))}
          <div className="h-20"></div> {/* Spacer for bottom scroll */}
        </div>

        {/* Right: 50% Width, Inspector Sidebar */}
        <div className="w-1/2 bg-slate-900 flex flex-col shadow-2xl relative z-20">
          <div className="p-6 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md">
            <h3 className="text-slate-400 font-bold text-xs uppercase tracking-[0.2em]">Inspector</h3>
          </div>

          <div className="flex-1 overflow-y-auto p-8">
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
                        <div className="mt-4 flex justify-end">
                            {selectedImage && (
                                <a 
                                  href={selectedImage.dataUrl} 
                                  download={`${selectedImage.fileName}_Q${selectedImage.id}.jpg`}
                                  className="text-green-400 hover:text-green-300 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-colors bg-green-500/10 px-3 py-1.5 rounded-lg border border-green-500/20"
                                >
                                  Download Final
                                </a>
                            )}
                        </div>
                      </div>
                    </div>

                    {/* 2. Raw Gemini Detection */}
                    <div className="space-y-3">
                       <h4 className="text-blue-400 font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                          <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                          Raw Gemini Detection (No Trim)
                       </h4>

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

                         <div className="mt-4 flex justify-between items-center">
                            <span className="text-[10px] text-slate-500 font-medium">
                               Matches red box on left exactly
                            </span>
                         </div>
                       </div>
                    </div>

                  </div>

                  {/* Technical Data */}
                  <div className="space-y-4 pt-6 border-t border-slate-800">
                    <h4 className="text-slate-500 font-bold text-xs uppercase tracking-widest">Bounding Box Coordinates</h4>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-800/30 p-3 rounded-lg border border-slate-800">
                          <span className="block text-[9px] text-slate-500 uppercase font-black mb-1">Y-Min</span>
                          <span className="text-white font-mono text-sm">
                              {selectedDetection ? Math.round((Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0][0] : selectedDetection.boxes_2d[0]) as number) : '-'}
                          </span>
                        </div>
                        <div className="bg-slate-800/30 p-3 rounded-lg border border-slate-800">
                          <span className="block text-[9px] text-slate-500 uppercase font-black mb-1">X-Min</span>
                          <span className="text-white font-mono text-sm">
                              {selectedDetection ? Math.round((Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0][1] : selectedDetection.boxes_2d[1]) as number) : '-'}
                          </span>
                        </div>
                        <div className="bg-slate-800/30 p-3 rounded-lg border border-slate-800">
                          <span className="block text-[9px] text-slate-500 uppercase font-black mb-1">Y-Max</span>
                          <span className="text-white font-mono text-sm">
                              {selectedDetection ? Math.round((Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0][2] : selectedDetection.boxes_2d[2]) as number) : '-'}
                          </span>
                        </div>
                        <div className="bg-slate-800/30 p-3 rounded-lg border border-slate-800">
                          <span className="block text-[9px] text-slate-500 uppercase font-black mb-1">X-Max</span>
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
                  <p className="text-slate-500 text-base max-w-[240px]">Click any bounding box on the left to inspect details and compare raw vs processed output.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
