import React, { useState } from 'react';
import { CropSettings } from '../services/pdfService';
import { ProcessingStatus } from '../types';

interface Props {
  fileName: string;
  initialSettings: CropSettings;
  status: ProcessingStatus;
  onClose: () => void;
  onApply: (fileName: string, settings: CropSettings) => void;
}

export const RefinementModal: React.FC<Props> = ({ 
  fileName, 
  initialSettings, 
  status,
  onClose, 
  onApply 
}) => {
  const [localSettings, setLocalSettings] = useState<CropSettings>(initialSettings);
  const isProcessing = status === ProcessingStatus.CROPPING;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm animate-[fade-in_0.2s_ease-out]">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden scale-100 animate-[scale-in_0.2s_cubic-bezier(0.175,0.885,0.32,1.275)]">
        <div className="p-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h3 className="font-black text-slate-800 text-lg tracking-tight">Refine Settings</h3>
            <p className="text-slate-400 text-xs font-bold truncate max-w-[250px]">{fileName}</p>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-xl hover:bg-slate-200/50"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        
        <div className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Crop Padding</label>
            <div className="flex items-center gap-3 relative group">
              <input type="number" value={localSettings.cropPadding} onChange={(e) => setLocalSettings(prev => ({ ...prev, cropPadding: Number(e.target.value) }))} className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-base" />
              <span className="absolute right-5 text-xs text-slate-400 font-black uppercase select-none">px</span>
            </div>
            <p className="text-[10px] text-slate-400">Buffer around the AI detection box.</p>
          </div>
          
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Inner Padding</label>
            <div className="flex items-center gap-3 relative group">
              <input type="number" value={localSettings.canvasPaddingLeft} onChange={(e) => { const v = Number(e.target.value); setLocalSettings(p => ({ ...p, canvasPaddingLeft: v, canvasPaddingRight: v, canvasPaddingY: v })); }} className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-base" />
              <span className="absolute right-5 text-xs text-slate-400 font-black uppercase select-none">px</span>
            </div>
             <p className="text-[10px] text-slate-400">Aesthetic whitespace added to the final image.</p>
          </div>
          
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Merge Overlap</label>
            <div className="flex items-center gap-3 relative group">
              <input type="number" value={localSettings.mergeOverlap} onChange={(e) => setLocalSettings(p => ({ ...p, mergeOverlap: Number(e.target.value) }))} className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all text-base" />
              <span className="absolute right-5 text-xs text-slate-400 font-black uppercase select-none">px</span>
            </div>
            <p className="text-[10px] text-slate-400">Vertical overlap when stitching split questions.</p>
          </div>

          <div className="pt-4">
            <button 
              onClick={() => onApply(fileName, localSettings)} 
              disabled={isProcessing} 
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-2xl shadow-xl shadow-blue-200 transition-all active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50 text-base"
            >
              {isProcessing ? (
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> 
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              )}
              Apply & Recrop File
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
