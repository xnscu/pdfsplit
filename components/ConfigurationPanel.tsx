
import React from 'react';
import { CropSettings } from '../services/pdfService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedModel: string;
  setSelectedModel: (m: string) => void;
  concurrency: number;
  setConcurrency: (c: number) => void;
  cropSettings: CropSettings;
  setCropSettings: React.Dispatch<React.SetStateAction<CropSettings>>;
  useHistoryCache: boolean;
  setUseHistoryCache: (b: boolean) => void;
  batchSize?: number;
  setBatchSize?: (b: number) => void;
}

export const ConfigurationPanel: React.FC<Props> = ({
  isOpen, onClose,
  selectedModel, setSelectedModel,
  concurrency, setConcurrency,
  cropSettings, setCropSettings,
  useHistoryCache, setUseHistoryCache,
  batchSize, setBatchSize
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm animate-[fade-in_0.2s_ease-out]" onClick={onClose}>
       <div 
         className="bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-[2.5rem] p-8 md:p-12 border border-slate-200 shadow-2xl relative animate-[scale-in_0.2s_cubic-bezier(0.175,0.885,0.32,1.275)]"
         onClick={e => e.stopPropagation()}
       >
          <button 
            onClick={onClose}
            className="absolute right-8 top-8 p-3 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-colors text-slate-500 hover:text-slate-800"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>

          <div className="flex items-center gap-4 mb-10 pb-6 border-b border-slate-100">
              <div className="w-14 h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c-.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              </div>
              <div>
                <h2 className="text-3xl font-black text-slate-900 tracking-tight">Settings</h2>
                <p className="text-slate-400 font-medium">Configure AI Model & Processing</p>
              </div>
          </div>
       
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">AI Model</label>
                <div className="flex p-1.5 bg-slate-50 rounded-2xl border border-slate-200">
                  <button onClick={() => setSelectedModel('gemini-3-flash-preview')} className={`flex-1 py-3 text-[10px] font-black uppercase rounded-xl transition-all ${selectedModel === 'gemini-3-flash-preview' ? 'bg-white text-blue-600 shadow-md ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-600'}`}>Flash</button>
                  <button onClick={() => setSelectedModel('gemini-3-pro-preview')} className={`flex-1 py-3 text-[10px] font-black uppercase rounded-xl transition-all ${selectedModel === 'gemini-3-pro-preview' ? 'bg-white text-blue-600 shadow-md ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-600'}`}>Pro</button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]" title="Controls simultaneous Gemini API requests">AI Concurrency</label>
                  <span className="text-xs font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">{concurrency} Threads</span>
                </div>
                <div className="pt-2 px-1">
                  <input type="range" min="1" max="10" value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} className="w-full accent-blue-600 h-2 bg-slate-100 rounded-lg cursor-pointer appearance-none" />
                </div>
              </div>

              {batchSize !== undefined && setBatchSize && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]" title="Controls how many files are processed in parallel locally">Batch Process Size</label>
                    <span className="text-xs font-black text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">{batchSize} Items</span>
                  </div>
                  <div className="pt-2 px-1">
                    <input type="range" min="5" max="100" step="5" value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} className="w-full accent-emerald-500 h-2 bg-slate-100 rounded-lg cursor-pointer appearance-none" />
                  </div>
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wide">Higher = Faster, but uses more RAM.</p>
                </div>
              )}

              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Crop Padding</label>
                <div className="relative group">
                  <input type="number" value={cropSettings.cropPadding} onChange={(e) => setCropSettings(s => ({...s, cropPadding: Number(e.target.value)}))} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300 uppercase select-none group-focus-within:text-blue-400 transition-colors">px</div>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Merge Overlap</label>
                <div className="relative group">
                  <input type="number" value={cropSettings.mergeOverlap} onChange={(e) => setCropSettings(s => ({...s, mergeOverlap: Number(e.target.value)}))} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300 uppercase select-none group-focus-within:text-blue-400 transition-colors">px</div>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Inner Padding</label>
                <div className="relative group">
                  <input type="number" value={cropSettings.canvasPadding} onChange={(e) => {
                      const v = Number(e.target.value);
                      setCropSettings(s => ({...s, canvasPadding: v}));
                  }} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300 uppercase select-none group-focus-within:text-blue-400 transition-colors">px</div>
                </div>
              </div>

              <div className="space-y-4 md:col-span-2">
                <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Smart History</label>
                </div>
                <label className="flex items-center gap-4 cursor-pointer group p-4 bg-slate-50 rounded-2xl border border-slate-200 hover:border-blue-300 transition-all">
                    <div className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" checked={useHistoryCache} onChange={(e) => setUseHistoryCache(e.target.checked)} />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </div>
                    <div>
                        <span className="text-sm font-bold text-slate-700 group-hover:text-blue-600 transition-colors block">
                            Use Cached Data
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">Skip re-processing existing files if available in history.</span>
                    </div>
                </label>
              </div>
          </div>
          
          <div className="mt-12 pt-8 border-t border-slate-100 flex justify-end">
              <button onClick={onClose} className="px-8 py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-slate-800 transition-all shadow-xl active:scale-95 text-sm uppercase tracking-wider">
                  Done
              </button>
          </div>
       </div>
    </div>
  );
};
