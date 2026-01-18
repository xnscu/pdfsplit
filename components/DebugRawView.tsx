
import React, { useState, useMemo } from 'react';
import { DebugPageData, QuestionImage } from '../types';

interface Props {
  pages: DebugPageData[];
  questions: QuestionImage[];
  onClose: () => void;
}

export const DebugRawView: React.FC<Props> = ({ pages, questions, onClose }) => {
  // Key format: "fileName||pageNumber||detIndex"
  // Using index ensures uniqueness even if IDs (like 'continuation') are repeated on a page
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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
    // This handles 'continuation' boxes by mapping them to the preceding Question ID
    let effectiveId: string | null = null;
    
    // Sort pages to ensure correct sequence
    const filePages = pages.filter(p => p.fileName === fileName).sort((a,b) => a.pageNumber - b.pageNumber);
    
    let found = false;
    for (const p of filePages) {
        for (let i = 0; i < p.detections.length; i++) {
            const d = p.detections[i];
            if (d.id !== 'continuation') {
                effectiveId = d.id;
            }
            // Check if this is the selected box
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

  if (pages.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950 animate-[fade-in_0.2s_ease-out]">
      {/* Top Toolbar */}
      <div className="flex-none h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 shadow-xl z-50">
         <div className="flex items-center gap-4">
            <h2 className="text-white font-black text-xl tracking-tight">Debug Inspector</h2>
            <div className="hidden sm:flex px-3 py-1 bg-slate-800 rounded-lg border border-slate-700 items-center gap-2">
               <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
               <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">{pages.length} Source Pages</span>
            </div>
         </div>
         <button 
           onClick={onClose}
           className="bg-white text-slate-900 px-5 py-2 rounded-xl font-bold text-sm hover:bg-slate-200 transition-colors flex items-center gap-2 shadow-lg shadow-white/5"
         >
           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
           Back to Results
         </button>
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
                            className="cursor-pointer transition-all duration-200"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedKey(uniqueKey);
                            }}
                          >
                            {boxes.map((box, bIdx) => (
                              <rect
                                key={bIdx}
                                x={box[1]}
                                y={box[0]}
                                width={box[3] - box[1]}
                                height={box[2] - box[0]}
                                fill={isSelected ? "rgba(59, 130, 246, 0.2)" : "rgba(255, 50, 50, 0.05)"}
                                stroke={isSelected ? "#3b82f6" : "#ef4444"}
                                strokeWidth={isSelected ? "4" : "1.5"}
                                vectorEffect="non-scaling-stroke"
                                className="hover:fill-[rgba(59,130,246,0.1)] hover:stroke-blue-400 hover:stroke-[3px] transition-all"
                              />
                            ))}
                            
                            {/* ID Label Tag */}
                            <rect 
                              x={boxes[0][3] - 40} 
                              y={boxes[0][0]} 
                              width="40" 
                              height="25" 
                              fill={isSelected ? "#3b82f6" : "#ef4444"}
                              className="transition-colors"
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
              <div className="space-y-10 animate-[fade-in_0.3s_ease-out]">
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

                  {/* Preview Image Card */}
                  <div className="bg-slate-950 rounded-3xl border border-slate-800 p-6 shadow-inner relative group">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-purple-600 rounded-t-3xl opacity-50"></div>
                    {selectedImage ? (
                        <div className="flex items-center justify-center min-h-[300px] bg-white/5 rounded-2xl overflow-hidden relative cursor-zoom-in">
                          {/* Checkerboard background for transparency illusion */}
                          <div className="absolute inset-0 opacity-20" 
                              style={{backgroundImage: 'radial-gradient(#475569 1px, transparent 1px)', backgroundSize: '10px 10px'}}></div>
                          
                          <img 
                            src={selectedImage.dataUrl} 
                            alt="Extracted Result" 
                            className="relative max-w-full h-auto object-contain shadow-2xl"
                          />
                        </div>
                    ) : (
                        <div className="h-64 flex flex-col items-center justify-center text-slate-600 border-2 border-dashed border-slate-800 rounded-2xl">
                          <svg className="w-12 h-12 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                          <span className="text-xs font-bold uppercase tracking-widest">Image not generated yet</span>
                          <span className="text-[10px] text-slate-500 mt-2">Check processing status</span>
                        </div>
                    )}
                    <div className="mt-6 flex justify-between items-center">
                        <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">
                          {selectedImage ? `ID: ${selectedImage.id}` : 'Result Preview'}
                        </span>
                        {selectedImage && (
                            <a 
                              href={selectedImage.dataUrl} 
                              download={`${selectedImage.fileName}_Q${selectedImage.id}.jpg`}
                              className="text-blue-400 hover:text-blue-300 text-xs font-bold flex items-center gap-2 transition-colors bg-blue-500/10 px-4 py-2 rounded-lg"
                            >
                              Download <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            </a>
                        )}
                    </div>
                  </div>

                  {/* Technical Data */}
                  <div className="space-y-4">
                    <h4 className="text-slate-400 font-bold text-xs uppercase tracking-widest border-b border-slate-800 pb-2">Coordinates (0-1000)</h4>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-800">
                          <span className="block text-[10px] text-slate-500 uppercase font-black mb-1">Y-Min (Top)</span>
                          <span className="text-white font-mono text-lg">
                              {selectedDetection ? Math.round((Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0][0] : selectedDetection.boxes_2d[0]) as number) : '-'}
                          </span>
                        </div>
                        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-800">
                          <span className="block text-[10px] text-slate-500 uppercase font-black mb-1">X-Min (Left)</span>
                          <span className="text-white font-mono text-lg">
                              {selectedDetection ? Math.round((Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0][1] : selectedDetection.boxes_2d[1]) as number) : '-'}
                          </span>
                        </div>
                        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-800">
                          <span className="block text-[10px] text-slate-500 uppercase font-black mb-1">Y-Max (Bottom)</span>
                          <span className="text-white font-mono text-lg">
                              {selectedDetection ? Math.round((Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0][2] : selectedDetection.boxes_2d[2]) as number) : '-'}
                          </span>
                        </div>
                        <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-800">
                          <span className="block text-[10px] text-slate-500 uppercase font-black mb-1">X-Max (Right)</span>
                          <span className="text-white font-mono text-lg">
                              {selectedDetection ? Math.round((Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0][3] : selectedDetection.boxes_2d[3]) as number) : '-'}
                          </span>
                        </div>
                    </div>
                    
                    {/* Box Count Indicator */}
                    {(selectedDetection?.boxes_2d as any[])?.length > 1 && (
                        <div className="bg-amber-500/10 text-amber-500 px-5 py-4 rounded-xl border border-amber-500/20 text-sm font-bold flex items-center gap-3">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            Multi-box Detected (Automatic Stitching)
                        </div>
                    )}
                  </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                  <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mb-8">
                      <svg className="w-12 h-12 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" /></svg>
                  </div>
                  <h3 className="text-slate-200 font-bold text-xl mb-3">No Selection</h3>
                  <p className="text-slate-500 text-base max-w-[240px]">Click any bounding box on the left to inspect details and view the cropped result.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
