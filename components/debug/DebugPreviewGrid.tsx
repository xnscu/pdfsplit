
import React, { useMemo } from 'react';
import { QuestionImage } from '../../types';

interface Props {
  questions: QuestionImage[];
  onQuestionClick: (q: QuestionImage) => void;
}

export const DebugPreviewGrid: React.FC<Props> = ({ questions, onQuestionClick }) => {
  const sortedQuestions = useMemo(() => {
    return [...questions].sort((a, b) => {
      // Natural sort for IDs like "1", "2", "10", "1.1"
      return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [questions]);

  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-60 bg-white">
        <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="font-bold text-lg">No processed images yet</p>
        <p className="text-xs">Click "Process" in the toolbar to generate crops.</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-y-auto bg-white custom-scrollbar">
      {/* 
         Simulate final paper width (e.g. A4 constrained or responsive max-width).
         Centered content with white background.
      */}
      <div className="max-w-4xl mx-auto min-h-full py-10 px-6 md:px-12 bg-white">
          <div className="flex flex-col items-start w-full">
            {sortedQuestions.map((q) => (
              <div 
                key={q.id} 
                onClick={() => onQuestionClick(q)}
                className="w-full cursor-pointer group relative"
                style={{ marginTop: '10px', marginBottom: '10px' }} // 10px margin as requested
                title={`Click to debug Question ${q.id}`}
              >
                  {/* Image only, no metadata */}
                  <img 
                      src={q.dataUrl} 
                      alt="" 
                      className="max-w-full h-auto object-contain block select-none" 
                      loading="lazy"
                  />
                  
                  {/* Subtle invisible overlay to indicate interactability without changing visual style */}
                  <div className="absolute inset-0 bg-blue-600/0 group-hover:bg-blue-600/5 transition-colors pointer-events-none rounded" />
              </div>
            ))}
          </div>
          
          {/* Subtle end marker */}
          <div className="mt-20 border-t border-slate-100 pt-8 text-center opacity-30">
             <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto"></div>
          </div>
      </div>
    </div>
  );
};
