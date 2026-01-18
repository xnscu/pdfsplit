import React from 'react';

interface Props {
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const UploadSection: React.FC<Props> = ({ onFileChange }) => {
  return (
    <div className="relative group overflow-hidden bg-white border-2 border-dashed border-slate-300 rounded-[3rem] p-20 text-center hover:border-blue-500 hover:bg-blue-50/20 transition-all duration-500 shadow-2xl shadow-slate-200/20">
      <input type="file" accept="application/pdf,application/zip" onChange={onFileChange} multiple className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20" />
      <div className="relative z-10">
        <div className="w-24 h-24 bg-blue-600 text-white rounded-[2rem] flex items-center justify-center mx-auto mb-8 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-500 shadow-2xl shadow-blue-200">
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v12m0 0l-4-4m4 4l4-4M4 17a3 3 0 003 3h10a3 3 0 003-3v-1" /></svg>
        </div>
        <h2 className="text-3xl font-black text-slate-900 mb-3 tracking-tight">Process Documents</h2>
        <p className="text-slate-400 text-lg font-medium">Click or drag PDF files here (Batch supported)</p>
        <div className="mt-10 flex justify-center gap-4">
            <span className="px-5 py-2 bg-slate-50 text-slate-400 text-[10px] font-black rounded-xl border border-slate-200 uppercase tracking-widest shadow-sm">PDF Files</span>
            <span className="px-5 py-2 bg-slate-50 text-slate-400 text-[10px] font-black rounded-xl border border-slate-200 uppercase tracking-widest shadow-sm">Data ZIPs</span>
        </div>
      </div>
    </div>
  );
};
