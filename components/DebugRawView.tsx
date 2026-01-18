
import React, { useState } from 'react';
import { DebugPageData } from '../types';

interface Props {
  pages: DebugPageData[];
}

export const DebugRawView: React.FC<Props> = ({ pages }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
                      // Unique key for selection within this page context
                      const uniqueKey = `${pageIdx}-${det.id}`;
                      const isSelected = selectedId === uniqueKey;
                      const boxes = (Array.isArray(det.boxes_2d[0]) ? det.boxes_2d : [det.boxes_2d]) as [number, number, number, number][];
                      
                      return (
                        <g 
                          key={det.id} 
                          className="cursor-pointer group"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(uniqueKey);
                          }}
                        >
                          {boxes.map((box, bIdx) => (
                            <rect
                              key={bIdx}
                              x={box[1]}
                              y={box[0]}
                              width={box[3] - box[1]}
                              height={box[2] - box[0]}
                              fill={isSelected ? "rgba(59, 130, 246, 0.3)" : "rgba(255, 50, 50, 0.1)"}
                              stroke={isSelected ? "#3b82f6" : "red"}
                              strokeWidth={isSelected ? "3" : "2"}
                              vectorEffect="non-scaling-stroke"
                              className="group-hover:fill-[rgba(255,50,50,0.3)] group-hover:stroke-[4px] transition-all duration-75"
                            />
                          ))}
                          
                          {/* ID Label */}
                          <text
                            x={boxes[0][3] - 10}
                            y={boxes[0][0] + 35}
                            fill={isSelected ? "#60a5fa" : "#991b1b"}
                            fontSize="40"
                            fontWeight="900"
                            textAnchor="end"
                            style={{ textShadow: '0 0 4px #000' }}
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
                const uniqueKey = `${pageIdx}-${det.id}`;
                const isSelected = selectedId === uniqueKey;
                const boxes = (Array.isArray(det.boxes_2d[0]) ? det.boxes_2d : [det.boxes_2d]) as [number, number, number, number][];
                const isMulti = boxes.length > 1;

                return (
                  <button
                    key={det.id}
                    onClick={() => setSelectedId(uniqueKey)}
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
                         {isMulti ? `${boxes.length} boxes` : 'Single box'}
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
    </div>
  );
};
