import React, { useState, useEffect, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import { QuestionImage, DebugPageData } from '../types';

interface Props {
  questions: QuestionImage[];
  rawPages: DebugPageData[]; // Data required for exporting full pages and JSON
}

export const QuestionGrid: React.FC<Props> = ({ questions, rawPages }) => {
  const [isZipping, setIsZipping] = useState(false);
  const [selectedImage, setSelectedImage] = useState<QuestionImage | null>(null);
  const [showOriginal, setShowOriginal] = useState(false); 

  // Group questions by fileName for display
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

  // Handle keyboard navigation
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

  const downloadAllAsZip = async () => {
    if (questions.length === 0) return;
    setIsZipping(true);
    
    try {
      const zip = new JSZip();
      
      // 1. Add Analysis JSON
      // This contains the raw detections and page metadata
      zip.file("analysis_data.json", JSON.stringify(rawPages, null, 2));

      // 2. Add Full Page Images organized by folder
      const fullPagesFolder = zip.folder("full_pages");
      rawPages.forEach((page) => {
        const base64Data = page.dataUrl.split(',')[1];
        // Create subfolder for each file
        const fileFolder = fullPagesFolder?.folder(page.fileName);
        fileFolder?.file(`Page_${page.pageNumber}.jpg`, base64Data, { base64: true });
      });

      // 3. Add Extracted Questions with folder structure: PDF_Name/Question_ID.jpg
      const questionsFolder = zip.folder("questions");
      const usedNames = new Set<string>();

      questions.forEach((q) => {
        const base64Data = q.dataUrl.split(',')[1];
        
        // Ensure folder exists for this specific PDF file
        const fileQFolder = questionsFolder?.folder(q.fileName);
        
        // Base name for the question
        const baseName = `${q.fileName}_Q${q.id}`;
        
        let finalName = `Q${q.id}`; // Inside the folder, just use Q ID
        // Simple collision check although ID should be unique per file per logic
        // But in case user re-uploaded same file or weird AI behavior:
        let fullPath = `${q.fileName}/${finalName}`;
        
        if (usedNames.has(fullPath)) {
            let counter = 1;
            while(usedNames.has(`${fullPath}_${counter}`)) {
                counter++;
            }
            finalName = `${finalName}_${counter}`;
            fullPath = `${fullPath}_${counter}`;
        }
        usedNames.add(fullPath);

        fileQFolder?.file(`${finalName}.jpg`, base64Data, { base64: true });
      });

      const content = await zip.generateAsync({ 
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      });
      
      const url = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      // Use a generic name or the first file's name + "etc"
      const downloadName = Object.keys(groupedQuestions).length > 1 
        ? "exam_papers_split_batch.zip" 
        : `${Object.keys(groupedQuestions)[0]}_split.zip`;
        
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error creating ZIP:", err);
      alert("An error occurred while creating the ZIP file. Please try downloading images individually.");
    } finally {
      setIsZipping(false);
    }
  };

  if (questions.length === 0) return null;

  const currentIndex = selectedImage ? questions.indexOf(selectedImage) : -1;
  const hasNext = currentIndex < questions.length - 1;
  const hasPrev = currentIndex > 0;

  return (
    <>
      <div className="mt-8 w-full animate-[fade-in_0.6s_ease-out]">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-6 border-b border-slate-200 pb-8">
          <div>
            <h2 className="text-3xl font-extrabold text-slate-900 mb-2">处理结果</h2>
            <p className="text-slate-500 font-medium flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              共提取 {questions.length} 道题目，来自 {Object.keys(groupedQuestions).length} 个文件
            </p>
          </div>
          <button 
            onClick={downloadAllAsZip}
            disabled={isZipping}
            className={`group px-8 py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-3 shadow-xl shadow-blue-100 min-w-[220px] ${
              isZipping 
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-700 text-white active:scale-95'
            }`}
          >
            {isZipping ? (
              <>
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                打包下载中...
              </>
            ) : (
              <>
                <svg className="w-6 h-6 group-hover:bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                下载全部 (ZIP)
              </>
            )}
          </button>
        </div>

        {/* Iterate over file groups to display them with sections */}
        {Object.entries(groupedQuestions).map(([fileName, fileQuestions]: [string, QuestionImage[]]) => (
            <div key={fileName} className="mb-12">
                <div className="flex items-center gap-3 mb-6 px-2">
                    <div className="bg-blue-100 text-blue-700 p-2 rounded-lg">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    </div>
                    <h3 className="text-xl font-bold text-slate-800">{fileName}</h3>
                    <span className="text-sm font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{fileQuestions.length} 题</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-8">
                {fileQuestions.map((q, idx) => (
                    <div 
                    key={`${q.fileName}-${q.pageNumber}-${q.id}-${idx}`} 
                    className="group bg-white border border-slate-200 rounded-3xl overflow-hidden hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 flex flex-col"
                    >
                    <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                        <span className="text-xs font-black uppercase tracking-widest text-slate-400">P{q.pageNumber} • Q{q.id}</span>
                        <div className="flex gap-2">
                        {q.originalDataUrl && (
                            <span className="text-[10px] px-2 py-0.5 bg-orange-100 text-orange-600 rounded-full font-bold border border-orange-200" title="Pixels were removed by edge peeling">
                            已微调
                            </span>
                        )}
                        </div>
                    </div>
                    <div 
                        className="p-8 flex items-center justify-center flex-grow bg-white min-h-[240px] cursor-zoom-in relative"
                        onClick={() => setSelectedImage(q)}
                    >
                        <img 
                        src={q.dataUrl} 
                        alt={`Question ${q.id}`} 
                        className="max-w-full h-auto rounded-lg select-none shadow-sm transition-transform group-hover:scale-[1.02]"
                        />
                    </div>
                    </div>
                ))}
                </div>
            </div>
        ))}
      </div>

      {/* Lightbox / Modal */}
      {selectedImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm transition-opacity animate-[fade-in_0.2s_ease-out]"
          onClick={() => setSelectedImage(null)}
        >
          {/* Navigation Buttons */}
          {hasPrev && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 p-4 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all z-50"
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
            >
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {hasNext && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 p-4 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-all z-50"
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
            >
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          <div className="relative max-w-7xl w-full h-[95vh] flex flex-col items-center justify-center p-4 md:px-12 md:py-8" onClick={(e) => e.stopPropagation()}>
            <div className="w-full flex justify-between items-center text-white mb-4">
               <div className="flex flex-col">
                 <h2 className="text-2xl font-bold">Question {selectedImage.id}</h2>
                 <p className="text-sm text-white/50">{selectedImage.fileName}</p>
               </div>
               <div className="flex gap-4">
                  <button 
                    className="text-white/50 hover:text-white p-2 transition-colors"
                    onClick={() => setSelectedImage(null)}
                  >
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
               </div>
            </div>
            
            <div className="flex-1 w-full bg-white rounded-xl overflow-hidden shadow-2xl relative flex flex-col">
              <div className="relative w-full h-full bg-slate-100 flex items-center justify-center p-8">
                {/* Compare Button Overlay */}
                {selectedImage.originalDataUrl && (
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
                      {showOriginal ? '显示原始裁剪' : '长按对比原图'}
                    </button>
                  </div>
                )}

                <img 
                  src={showOriginal && selectedImage.originalDataUrl ? selectedImage.originalDataUrl : selectedImage.dataUrl} 
                  alt={`Full size Question ${selectedImage.id}`} 
                  className={`max-h-full max-w-full object-contain shadow-lg transition-all duration-150 ${showOriginal ? 'ring-4 ring-orange-500' : ''}`}
                />
              </div>
            </div>
            
            <div className="mt-6 flex items-center justify-between w-full max-w-4xl">
              <span className="text-white/60 text-sm">Use arrow keys to navigate</span>
              <a 
                 href={selectedImage.dataUrl} 
                 download={`${selectedImage.fileName}_Q${selectedImage.id}.jpg`}
                 className="bg-white text-black px-6 py-2 rounded-full font-bold hover:bg-slate-200 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
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