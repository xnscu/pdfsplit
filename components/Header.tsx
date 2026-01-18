import React from 'react';

interface Props {
  onShowHistory: () => void;
  onReset: () => void;
  showReset: boolean;
}

export const Header: React.FC<Props> = ({ onShowHistory, onReset, showReset }) => {
  return (
    <header className="max-w-6xl mx-auto py-10 text-center relative z-50 bg-slate-50">
      <div className="absolute right-0 top-10 hidden md:block">
         <button 
           onClick={onShowHistory}
           className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl hover:bg-slate-50 hover:text-blue-600 transition-colors flex items-center gap-2 font-bold text-xs shadow-sm uppercase tracking-wider"
         >
           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
           History
         </button>
      </div>

      <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-2 tracking-tight">
        Exam <span className="text-blue-600">Smart</span> Splitter
      </h1>
      <p className="text-slate-400 font-medium mb-8">AI-powered Batch Question Extraction Tool</p>

      {showReset && (
        <div className="flex flex-col md:flex-row justify-center items-center gap-4 mt-4 animate-fade-in flex-wrap">
          <button onClick={onReset} className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 transition-all flex items-center gap-2 shadow-sm">Reset</button>
        </div>
      )}
      <div className="md:hidden mt-4 flex justify-center">
          <button 
           onClick={onShowHistory}
           className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl hover:bg-slate-50 hover:text-blue-600 transition-colors flex items-center gap-2 font-bold text-xs shadow-sm uppercase tracking-wider"
         >
           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
           History
         </button>
      </div>
    </header>
  );
};
