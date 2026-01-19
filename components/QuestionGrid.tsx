
import React, { useState, useEffect, useCallback, useMemo, CSSProperties } from 'react';
import JSZip from 'jszip';
import * as ReactWindow from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { QuestionImage, DebugPageData } from '../types';
import { VariableSizeList } from 'react-window';

interface Props {
  questions: QuestionImage[];
  rawPages: DebugPageData[];
  onDebug: (fileName: string) => void;
  onRefine: (fileName: string) => void;
}

interface RowData {
  type: 'header' | 'grid';
  fileName: string;
  items: QuestionImage[]; // For 'grid' type
  startIndex: number; // Index of the first item in this row within the file's list
  totalInFile: number;
}

interface ItemDataProps {
  rows: RowData[];
  columns: number;
  onDebug: (fileName: string) => void;
  onRefine: (fileName: string) => void;
  generateZip: (fileName?: string) => void;
  zippingFile: string | null;
  zippingProgress: string;
  setSelectedImage: (img: QuestionImage) => void;
}

// Manually define ListChildComponentProps to avoid import errors
interface ListChildComponentProps {
  index: number;
  style: CSSProperties;
  data: ItemDataProps;
  isScrolling?: boolean;
}

const ROW_HEIGHT_HEADER = 100;
const ROW_HEIGHT_GRID = 360;

const VirtualRow = ({ index, style, data }: ListChildComponentProps) => {
  const { rows, columns, onDebug, onRefine, generateZip, zippingFile, zippingProgress, setSelectedImage } = data;
  const row = rows[index];

  if (row.type === 'header') {
    return (
      <div style={style} className="px-4 md:px-8 py-4 z-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/80 backdrop-blur-md p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4 overflow-hidden">
             <div className="bg-blue-50 text-blue-600 p-2 rounded-xl shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
             </div>
             <div className="min-w-0">
               <h3 className="text-lg font-black text-slate-800 tracking-tight truncate">{row.fileName}</h3>
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{row.totalInFile} Items</p>
             </div>
          </div>
          
          <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => onDebug(row.fileName)} className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 bg-white transition-colors">Debug</button>
              <button onClick={() => onRefine(row.fileName)} className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 bg-white transition-colors">Refine</button>
              <button 
                onClick={() => generateZip(row.fileName)}
                disabled={zippingFile !== null}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-green-600 hover:bg-green-50 border border-slate-200 bg-white transition-colors disabled:opacity-50 w-[80px] flex justify-center"
              >
                 {zippingFile === row.fileName ? (
                   <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                 ) : "ZIP"}
              </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={style} className="px-4 md:px-8">
      <div 
        className="grid gap-6 h-full" 
        style={{ 
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          paddingBottom: '20px' // Gutter
        }}
      >
        {row.items.map((q, i) => (
           <div 
              key={`${q.fileName}-${q.id}-${i}`}
              className="group bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-xl transition-all duration-300 flex flex-col h-full"
           >
              <div className="px-4 py-2 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Q{q.id}</span>
                  {q.originalDataUrl && <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>}
              </div>
              <div 
                  className="p-4 flex items-center justify-center flex-grow cursor-zoom-in relative bg-white"
                  onClick={() => setSelectedImage(q)}
              >
                  <img 
                    src={q.dataUrl} 
                    alt={`Q${q.id}`} 
                    className="max-w-full max-h-[260px] w-auto h-auto object-contain transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
              </div>
           </div>
        ))}
        {/* Fill empty cells to maintain grid structure visually if needed */}
        {Array.from({ length: columns - row.items.length }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
      </div>
    </div>
  );
};

export const QuestionGrid: React.FC<Props> = ({ questions, rawPages, onDebug, onRefine }) => {
  const [zippingFile, setZippingFile] = useState<string | null>(null);
  const [zippingProgress, setZippingProgress] = useState<string>('');
  const [selectedImage, setSelectedImage] = useState<QuestionImage | null>(null);
  const [showOriginal, setShowOriginal] = useState(false); 

  // Cast imports to any to bypass type errors in some environments
  const List = ReactWindow.VariableSizeList || (ReactWindow as any).default?.VariableSizeList || VariableSizeList;
  const AutoSizerAny = AutoSizer as any;

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

  // Handle Modal Navigation
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

  // ZIP Generation Logic
  const generateZip = async (targetFileName?: string) => {
    if (questions.length === 0) return;
    const fileNames = targetFileName ? [targetFileName] : Object.keys(groupedQuestions);
    if (fileNames.length === 0) return;

    if (targetFileName) setZippingFile(targetFileName);
    else setZippingFile('ALL');
    setZippingProgress('Initializing...');
    
    try {
      const zip = new JSZip();
      const isBatch = fileNames.length > 1;
      let processedCount = 0;
      const totalCount = fileNames.length;

      for (const fileName of fileNames) {
        const fileQs = groupedQuestions[fileName];
        if (!fileQs) continue;
        const fileRawPages = rawPages.filter(p => p.fileName === fileName);
        const folder = isBatch ? zip.folder(fileName) : zip;
        if (!folder) continue;

        // OPTIMIZATION: Create a lightweight copy of rawPages for JSON without the Base64 images
        // The images are stored in "full_pages/" folder anyway.
        const lightweightRawPages = fileRawPages.map(({ dataUrl, ...rest }) => rest);
        folder.file("analysis_data.json", JSON.stringify(lightweightRawPages, null, 2));
        
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

        processedCount++;
        if (!targetFileName) {
            setZippingProgress(`Preparing ${processedCount}/${totalCount}`);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      setZippingProgress(targetFileName ? 'Compressing...' : 'Compressing 0%');

      const content = await zip.generateAsync({ 
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      }, (metadata) => {
          setZippingProgress(`Compressing ${metadata.percent.toFixed(0)}%`);
      });
      
      const url = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      let downloadName = targetFileName ? `${targetFileName}_processed.zip` : isBatch ? "exam_batch_processed.zip" : `${fileNames[0]}_processed.zip`;

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
      setZippingProgress('');
    }
  };

  const hasNext = selectedImage && questions.indexOf(selectedImage) < questions.length - 1;
  const hasPrev = selectedImage && questions.indexOf(selectedImage) > 0;

  if (questions.length === 0) return null;

  return (
    <>
      <div className="w-full flex flex-col h-[calc(100vh-140px)] animate-[fade-in_0.6s_ease-out]">
        {/* Fixed Header Area */}
        <div className="flex-none px-4 md:px-8 pb-6 border-b border-slate-200 mb-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h2 className="text-3xl font-black text-slate-900 mb-2 tracking-tight">Results</h2>
              <p className="text-slate-500 font-semibold flex items-center gap-2 text-sm">
                <span className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.4)]"></span>
                Extracted {questions.length} questions from {Object.keys(groupedQuestions).length} files
              </p>
            </div>
            <button 
                onClick={() => generateZip()}
                disabled={zippingFile !== null}
                className={`group px-6 py-3 rounded-xl font-black transition-all flex items-center justify-center gap-3 shadow-lg min-w-[200px] tracking-tight uppercase text-xs ${
                zippingFile 
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed shadow-none' 
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 active:scale-95'
                }`}
            >
                {zippingFile === 'ALL' ? (
                    <>
                      <svg className="animate-spin w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      <span>{zippingProgress}</span>
                    </>
                ) : 'Download All (ZIP)'}
            </button>
          </div>
        </div>

        {/* Virtualized Grid */}
        <div className="flex-1 min-h-0 bg-slate-50/50">
          <AutoSizerAny>
            {({ height, width }: { height: number; width: number }) => {
              // Determine columns based on width
              let columns = 1;
              if (width >= 640) columns = 2;
              if (width >= 1024) columns = 3;
              if (width >= 1280) columns = 4;
              if (width >= 1536) columns = 5;

              // Compute virtual rows flattened from groups
              const rows: RowData[] = [];
              Object.entries(groupedQuestions).forEach(([fileName, fileQs]) => {
                // Header Row
                rows.push({
                  type: 'header',
                  fileName,
                  items: [],
                  startIndex: 0,
                  totalInFile: fileQs.length
                });

                // Grid Rows
                for (let i = 0; i < fileQs.length; i += columns) {
                  rows.push({
                    type: 'grid',
                    fileName,
                    items: fileQs.slice(i, i + columns),
                    startIndex: i,
                    totalInFile: fileQs.length
                  });
                }
              });

              return (
                <List
                  height={height}
                  width={width}
                  itemCount={rows.length}
                  itemSize={(index: number) => rows[index].type === 'header' ? ROW_HEIGHT_HEADER : ROW_HEIGHT_GRID}
                  itemData={{
                    rows,
                    columns,
                    onDebug,
                    onRefine,
                    generateZip,
                    zippingFile,
                    zippingProgress,
                    setSelectedImage
                  }}
                >
                  {VirtualRow}
                </List>
              );
            }}
          </AutoSizerAny>
        </div>
      </div>

      {/* Full Screen Modal */}
      {selectedImage && (
        <div 
          className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/95 backdrop-blur-md transition-opacity animate-[fade-in_0.2s_ease-out]"
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
               <button 
                  className="text-white/40 hover:text-white p-3 transition-colors bg-white/5 rounded-2xl hover:bg-white/10"
                  onClick={() => setSelectedImage(null)}
                >
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
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
