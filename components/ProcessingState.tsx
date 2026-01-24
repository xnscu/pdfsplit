
import React from 'react';
import { ProcessingStatus } from '../types';
import { CircularProgress } from './CircularProgress';

interface Props {
  status: ProcessingStatus;
  progress: number;
  total: number;
  completedCount: number;
  error?: string;
  detailedStatus?: string;
  croppingTotal?: number;
  croppingDone?: number;
  elapsedTime?: string;
  currentRound?: number;
  failedCount?: number;
  onAbort?: () => void;
  onClose?: () => void;
}

export const ProcessingState: React.FC<Props> = ({ 
  status, 
  progress, 
  total, 
  completedCount,
  error, 
  detailedStatus,
  croppingTotal = 0,
  croppingDone = 0,
  elapsedTime = "00:00",
  currentRound = 1,
  failedCount = 0,
  onAbort,
  onClose
}) => {
  if (status === ProcessingStatus.IDLE || status === ProcessingStatus.COMPLETED) return null;

  const isError = status === ProcessingStatus.ERROR;
  const isStopped = status === ProcessingStatus.STOPPED;

  let displayPercent = 0;
  if (status === ProcessingStatus.CROPPING && croppingTotal > 0) {
    displayPercent = (croppingDone / croppingTotal) * 100;
  } else if (total > 0) {
    displayPercent = (completedCount / total) * 100;
  }

  return (
    <div className="fixed bottom-6 right-6 z-[190] w-80 md:w-96 shadow-2xl border-2 border-slate-100 bg-white rounded-2xl p-5 animate-[fade-in_0.3s_ease-out] flex flex-col gap-4">
      
      {isError ? (
        <div className="flex flex-col gap-2">
           <div className="flex items-start gap-3">
             <div className="w-10 h-10 rounded-full bg-red-100 text-red-500 flex items-center justify-center shrink-0">
               <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
             </div>
             <div>
               <h4 className="font-black text-slate-800 text-sm uppercase">Processing Error</h4>
               <p className="text-xs text-slate-500 font-bold mt-1 leading-relaxed">{error || "Unknown error"}</p>
             </div>
           </div>
           <button onClick={onClose} className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold py-2 rounded-lg mt-2 transition-colors">Dismiss</button>
        </div>
      ) : isStopped ? (
        <div className="flex flex-col gap-2">
           <div className="flex items-start gap-3">
             <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-500 flex items-center justify-center shrink-0">
               <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
             </div>
             <div>
               <h4 className="font-black text-slate-800 text-sm uppercase">Stopped</h4>
               <p className="text-xs text-slate-500 font-bold mt-1">Process aborted by user.</p>
             </div>
           </div>
           <button onClick={onClose} className="bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold py-2 rounded-lg mt-2 transition-colors">Close</button>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <div className="shrink-0">
             <CircularProgress 
                progress={displayPercent} 
                size="3.5rem"
                strokeWidth={4}
                colorClass={currentRound > 1 ? 'text-orange-500' : 'text-blue-600'}
                label={<span className="text-[10px] font-black text-slate-700">{Math.round(displayPercent)}%</span>}
             />
          </div>
          
          <div className="flex-1 min-w-0">
             <h3 className="text-sm font-black text-slate-900 truncate tracking-tight mb-0.5">
                {status === ProcessingStatus.LOADING_PDF && "Loading..."}
                {status === ProcessingStatus.DETECTING_QUESTIONS && currentRound === 1 && "Analyzing..."}
                {status === ProcessingStatus.DETECTING_QUESTIONS && currentRound > 1 && "Retrying..."}
                {status === ProcessingStatus.CROPPING && "Cropping..."}
             </h3>
             <p className="text-[10px] font-bold text-slate-400 truncate mb-1">{detailedStatus}</p>
             
             <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 bg-slate-50 px-2 py-1 rounded-lg border border-slate-100 self-start inline-flex">
                 <span className="tabular-nums">{elapsedTime}</span>
                 {status === ProcessingStatus.DETECTING_QUESTIONS && (
                     <>
                       <span className="w-px h-3 bg-slate-300"></span>
                       <span>{completedCount}/{total}</span>
                     </>
                 )}
                 {status === ProcessingStatus.CROPPING && (
                     <>
                        <span className="w-px h-3 bg-slate-300"></span>
                        <span>{croppingDone}/{croppingTotal}</span>
                     </>
                 )}
                 {onAbort && (
                    <>
                      <span className="w-px h-3 bg-slate-300"></span>
                      <button onClick={onAbort} className="text-red-500 hover:text-red-600 uppercase">Stop</button>
                    </>
                 )}
             </div>
          </div>
        </div>
      )}
    </div>
  );
};
