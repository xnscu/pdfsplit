
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import { QuestionImage, DebugPageData } from '../types';

interface Props {
  questions: QuestionImage[];
  rawPages: DebugPageData[];
  onDebug: (fileName: string) => void;
  onRefine: (fileName: string) => void;
}

export const QuestionGrid: React.FC<Props> = ({ questions, rawPages, onDebug, onRefine }) => {
  const [zippingFile, setZippingFile] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<QuestionImage | null>(null);
  const [showOriginal, setShowOriginal] = useState(false); 

  const groupedQuestions = useMemo(() => {
    const groups: Record<string, QuestionImage[]> = {};
    questions.forEach(q => {
      if (!groups[q.fileName]) {
        groups[q.fileName] = [];
      }
      groups[q.fileName].push(q);
    });
    return groups;
  }, [questions]);

  const handleNext = useCallback(() => {
    if (!selectedImage) return;
    const currentIndex = questions.indexOf(selectedImage);
    if (currentIndex < questions.length - 1) {
      setSelectedImage(questions[currentIndex + 1]);
      setShowOriginal(false);
    }
  }, [questions, selectedImage]);

  const handlePrev = useCallback(() => {
    if (!selectedImage) return;
    const currentIndex = questions.indexOf(selectedImage);
    if (currentIndex > 0) {
      setSelectedImage(questions[currentIndex - 1]);
      setShowOriginal(false);
    }
  }, [questions, selectedImage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedImage) return;
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'Escape') setSelectedImage(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImage, handleNext, handlePrev]);

  const generateZip = async (targetFileName?: string) => {
    if (questions.length === 0) return;
    
    const fileNames = targetFileName ? [targetFileName] : Object.keys(groupedQuestions);
    if (fileNames.length === 0) return;

    if (targetFileName) setZippingFile(targetFileName);
    else setZippingFile('ALL');
    
    try {
      const zip = new JSZip();
      const isBatch = fileNames.length > 1;

      fileNames.forEach((fileName) => {
        const fileQs = groupedQuestions[fileName];
        if (!fileQs) return;

        const fileRawPages = rawPages.filter(p => p.fileName === fileName);
        
        // If batch download, put in folder. If single file download, put in root.
        const folder = isBatch ? zip.folder(fileName) : zip;
        if (!folder) return;

        // Add metadata/debug info
        folder.file("analysis_data.json", JSON.stringify(fileRawPages, null, 2));
        
        const fullPagesFolder = folder.folder("full_pages");
        fileRawPages.forEach((page) => {
          const base64Data = page.dataUrl.split(',')[1];
          fullPagesFolder?.file(`Page_${page.pageNumber}.jpg`, base64Data, { base64: true });
        });

        const usedNames = new Set<string>();
        fileQs.forEach((q) => {
          const base64Data = q.dataUrl.split(',')[1];
          let finalName = `${q.fileName}_Q${q.id}.jpg`;
          if (usedNames.has(finalName)) {
             let counter = 1;
             const baseName = `${q.fileName}_Q${q.id}`;
             while(usedNames.has(`${baseName}_${counter}.jpg`)) counter++;
             finalName = `${baseName}_${counter}.jpg`;
          }
          usedNames.add(finalName);
          folder.file(finalName, base64Data, { base64: true });
        });
      });

      const content = await zip.generateAsync({ 
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      });
      
      const url = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      
      let downloadName = "exam_processed.zip";
      if (targetFileName) {
        downloadName = `${targetFileName}_processed.zip`;
      } else if (isBatch) {
        downloadName = "exam_batch_processed.zip";
      }

      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("ZIP Error:", err);
      alert("Error creating ZIP.");
    } finally {
      setZippingFile(null);
    }
  };

  if (questions.length === 0) return null;

  const currentIndex = selectedImage ? questions.indexOf(selectedImage) : -1;
  const hasNext = currentIndex < questions.length - 1;
  const hasPrev = currentIndex > 0;

  return (
    <>
      <div className="mt-12 w-full animate-[fade-in_0.6s_ease-out]">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-8 border-b border-slate-200 pb-10">
          <div>
            <h2 className="text-4xl font-black text-slate-900 mb-3 tracking-tight">Results</h2>
            <p className="text-slate-500 font-semibold flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.4)]"></span>
              Extracted {questions.length} questions from {Object.keys(groupedQuestions).length} source files
            </p>
          </div>
          {Object.keys(groupedQuestions).length > 1 && (
            <button 
                onClick={() => generateZip()}
                disabled={zippingFile !== null}
                className={`group px-8 py-3 rounded-2xl font-black transition-all flex items-center justify-center gap-3 shadow-lg min-w-[200px] tracking-tight uppercase text-xs ${
                zippingFile 
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none' 
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 active:scale-95'
                }`}
            >
                {zippingFile === 'ALL' ? 'Zipping All...' : 'Download All as ZIP'}
            </button>
          )}
        </div>

        {Object.entries(groupedQuestions).map(([fileName, fileQuestions]: [string, QuestionImage[]]) => (
            <div key={fileName} className="mb-16 bg-white rounded-[2.5rem] p-8 border border-slate-100 shadow-xl shadow-slate-200/40">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 pb-6 border-b border-slate-50">
                    <div className="flex items-center gap-4">
                        <div className="bg-blue-50 text-blue-600 p-3 rounded-2xl border border-blue-100">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </div>
                        <div>
                          <h3 className="text-2xl font-black text-slate-800 tracking-tight break-all">{fileName}</h3>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{fileQuestions.length} Items Found</p>
                        </div>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-3">
                        <button 
                           onClick={() => onDebug(fileName)}
                           className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors flex items-center gap-2 border border-slate-200 bg-white"
                           title="View Debug Analysis"
                        >
                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                           Debug
                        </button>
                        <button 
                           onClick={() => onRefine(fileName)}
                           className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors flex items-center gap-2 border border-slate-200 bg-white"
                           title="Refine Crop Settings"
                        >
                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                           Refine
                        </button>
                        <button 
                           onClick={() => generateZip(fileName)}
                           disabled={zippingFile !== null}
                           className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-green-600 hover:bg-green-50 transition-colors flex items-center gap-2 border border-slate-200 bg-white disabled:opacity-50"
                           title="Download ZIP"
                        >
                           {zippingFile === fileName ? (
                             <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                           ) : (
                             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                           )}
                           ZIP
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {fileQuestions.map((q, idx) => (
                    <div 
                    key={`${q.fileName}-${q.pageNumber}-${q.id}-${idx}`} 
                    className="group bg-slate-50 border border-slate-200 rounded-[1.5rem] overflow-hidden hover:shadow-xl transition-all duration-300 hover:-translate-y-1 flex flex-col"
                    >
                    <div className="px-5 py-3 border-b border-slate-200/50 flex justify-between items-center bg-white/50">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">P{q.pageNumber} • Q{q.id}</span>
                        {q.originalDataUrl && (
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" title="Refined"></span>
                        )}
                    </div>
                    <div 
                        className="p-6 flex items-center justify-center flex-grow bg-white min-h-[200px] cursor-zoom-in relative"
                        onClick={() => setSelectedImage(q)}
                    >
                        <img 
                        src={q.dataUrl} 
                        alt={`Question ${q.id}`} 
                        className="max-w-full h-auto rounded-md select-none transition-transform duration-500 group-hover:scale-[1.02]"
                        />
                    </div>
                    </div>
                ))}
                </div>
            </div>
        ))}
      </div>

      {selectedImage && (
        <div 
          className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/95 backdrop-blur-md transition-opacity animate-[fade-in_0.2s_ease-out]"
          onClick={() => setSelectedImage(null)}
        >
          {hasPrev && (
            <button
              className="absolute left-6 top-1/2 -translate-y-1/2 p-5 text-white/40 hover:text-white hover:bg-white/10 rounded-full transition-all z-50"
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
            >
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {hasNext && (
            <button
              className="absolute right-6 top-1/2 -translate-y-1/2 p-5 text-white/40 hover:text-white hover:bg-white/10 rounded-full transition-all z-50"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
            >
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          <div className="relative max-w-7xl w-full h-[95vh] flex flex-col items-center justify-center p-6 md:px-16 md:py-10" onClick={(e) => e.stopPropagation()}>
            <div className="w-full flex justify-between items-center text-white mb-6">
               <div className="flex flex-col">
                 <h2 className="text-3xl font-black tracking-tight">Question {selectedImage.id}</h2>
                 <p className="text-xs font-bold text-white/40 uppercase tracking-[0.2em]">{selectedImage.fileName}</p>
               </div>
               <div className="flex gap-6">
                  <button 
                    className="text-white/40 hover:text-white p-3 transition-colors bg-white/5 rounded-2xl hover:bg-white/10"
                    onClick={() => setSelectedImage(null)}
                  >
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
               </div>
            </div>
            
            <div className="flex-1 w-full bg-white rounded-3xl overflow-hidden shadow-2xl relative flex flex-col">
              <div className="relative w-full h-full bg-slate-50 flex items-center justify-center p-12 overflow-auto">
                {selectedImage.originalDataUrl && (
                  <div className="absolute top-6 left-6 z-20">
                    <button 
                      onMouseDown={() => setShowOriginal(true)}
                      onMouseUp={() => setShowOriginal(false)}
                      onMouseLeave={() => setShowOriginal(false)}
                      onTouchStart={() => setShowOriginal(true)}
                      onTouchEnd={() => setShowOriginal(false)}
                      className={`
                        px-6 py-3 rounded-2xl font-black shadow-2xl transition-all border-2 uppercase text-[10px] tracking-widest
                        ${showOriginal 
                          ? 'bg-blue-600 text-white border-blue-700 scale-105' 
                          : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
                        }
                      `}
                    >
                      {showOriginal ? 'Showing Original' : 'Hold to Compare'}
                    </button>
                  </div>
                )}

                <img 
                  src={showOriginal && selectedImage.originalDataUrl ? selectedImage.originalDataUrl : selectedImage.dataUrl} 
                  alt={`Full size Question ${selectedImage.id}`} 
                  className={`max-h-full max-w-full object-contain shadow-2xl transition-all duration-300 ${showOriginal ? 'ring-8 ring-blue-500/20' : ''}`}
                />
              </div>
            </div>
            
            <div className="mt-8 flex items-center justify-between w-full max-w-5xl">
              <span className="text-white/30 text-[10px] font-black uppercase tracking-[0.3em]">Arrows to navigate • Esc to close</span>
              <a 
                 href={selectedImage.dataUrl} 
                 download={`${selectedImage.fileName}_Q${selectedImage.id}.jpg`}
                 className="bg-white text-slate-950 px-8 py-3.5 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-slate-200 transition-all flex items-center gap-3 active:scale-95 shadow-2xl shadow-white/5"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Image
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
