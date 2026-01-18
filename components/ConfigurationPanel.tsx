import React from 'react';
import { CropSettings } from '../services/pdfService';

interface Props {
  selectedModel: string;
  setSelectedModel: (m: string) => void;
  concurrency: number;
  setConcurrency: (c: number) => void;
  cropSettings: CropSettings;
  setCropSettings: React.Dispatch<React.SetStateAction<CropSettings>>;
  useHistoryCache: boolean;
  setUseHistoryCache: (b: boolean) => void;
}

export const ConfigurationPanel: React.FC<Props> = ({
  selectedModel, setSelectedModel,
  concurrency, setConcurrency,
  cropSettings, setCropSettings,
  useHistoryCache, setUseHistoryCache
}) => {
  return (
    <section className="bg-white rounded-[2rem] p-8 md:p-10 border border-slate-200 shadow-xl shadow-slate-200/50">
       <div className="flex items-center gap-3 mb-10 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c-.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          </div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Configuration</h2>
       </div>
       
       <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-x-12 gap-y-10">
          <div className="space-y-4">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">AI Model</label>
            <div className="flex p-1.5 bg-slate-50 rounded-2xl border border-slate-200">
              <button onClick={() => setSelectedModel('gemini-3-flash-preview')} className={`flex-1 py-2.5 text-[10px] font-black uppercase rounded-xl transition-all ${selectedModel === 'gemini-3-flash-preview' ? 'bg-white text-blue-600 shadow-md ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-600'}`}>Flash</button>
              <button onClick={() => setSelectedModel('gemini-3-pro-preview')} className={`flex-1 py-2.5 text-[10px] font-black uppercase rounded-xl transition-all ${selectedModel === 'gemini-3-pro-preview' ? 'bg-white text-blue-600 shadow-md ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-600'}`}>Pro</button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Concurrency</label>
              <span className="text-xs font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">{concurrency} Threads</span>
            </div>
            <div className="pt-2 px-1">
              <input type="range" min="1" max="10" value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} className="w-full accent-blue-600 h-2 bg-slate-100 rounded-lg cursor-pointer appearance-none" />
            </div>
          </div>

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
              <input type="number" value={cropSettings.canvasPaddingLeft} onChange={(e) => {
                  const v = Number(e.target.value);
                  setCropSettings(s => ({...s, canvasPaddingLeft: v, canvasPaddingRight: v, canvasPaddingY: v}));
              }} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300 uppercase select-none group-focus-within:text-blue-400 transition-colors">px</div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Smart History</label>
            </div>
            <label className="flex items-center gap-3 cursor-pointer group p-3 bg-slate-50 rounded-2xl border border-slate-200 hover:border-blue-300 transition-all">
                <div className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={useHistoryCache} onChange={(e) => setUseHistoryCache(e.target.checked)} />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </div>
                <span className="text-xs font-bold text-slate-600 group-hover:text-blue-600 transition-colors">
                    Use Cached Data
                </span>
            </label>
          </div>
       </div>
    </section>
  );
};
