import React from "react";
import packageJson from "../package.json";

interface Props {
  onReset: () => void;
  showReset: boolean;
  onReturnToInspector?: () => void;
}

export const Header: React.FC<Props> = ({ onReset, showReset }) => {
  return (
    <header className="max-w-6xl mx-auto py-10 text-center relative z-50 bg-slate-50">
      <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-2 tracking-tight">
        Exam <span className="text-blue-600">Smart</span> Splitter
      </h1>
      <p className="text-slate-400 font-medium mb-8 flex items-center justify-center gap-2">
        AI-powered Batch Question Extraction Tool
        <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md text-[10px] font-bold border border-slate-200">
          v{packageJson.version}
        </span>
      </p>

      {showReset && (
        <div className="flex flex-col md:flex-row justify-center items-center gap-4 mt-4 animate-fade-in flex-wrap">
          <button
            onClick={onReset}
            className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 transition-all flex items-center gap-2 shadow-sm"
          >
            Reset
          </button>
        </div>
      )}
    </header>
  );
};

export default Header;
