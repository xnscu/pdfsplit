
import React from 'react';
import { ProcessingStatus } from '../types';

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
  onAbort
}) => {
  if (status === ProcessingStatus.IDLE) return null;

  const isCompleted = status === ProcessingStatus.COMPLETED;
  const isError = status === ProcessingStatus.ERROR;
  const isStopped = status === ProcessingStatus.STOPPED;

  let displayPercent = 0;
  if (status === ProcessingStatus.CROPPING && croppingTotal > 0) {
    displayPercent = (croppingDone / croppingTotal) * 100;
  } else if (total > 0) {
    displayPercent = (completedCount / total) * 100;
  }

  return (
    <div className="flex flex-col items-center justify-center p-12 bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 mt-12 w-full max-w-2xl mx-auto transition-all duration-500 relative overflow-hidden">
      {!isError && !isCompleted && !isStopped && (
        <div className="absolute top-0 left-0 w-full h-1.5 bg-slate-50">
          <div 
            className={`h-full transition-all duration-700 ease-out shadow-[0_0_10px_rgba(37,99,235,0.4)] ${currentRound > 1 ? 'bg-orange-500' : 'bg-blue-600'}`}
            style={{ width: `${displayPercent}%` }}
          />
        </div>
      )}

      {isError ? (
        <div className="text-center w-full">
          <div className="bg-red-50 text-red-600 p-8 rounded-3xl mb-4 border border-red-100">
            <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h4 className="font-black text-xl mb-2 uppercase tracking-tight">Processing Error</h4>
            <p className="font-medium opacity-80">{error || "An unknown error occurred. Please try again."}</p>
          </div>
        </div>
      ) : isStopped ? (
        <div className="text-center w-full">
          <div className="bg-orange-50 text-orange-600 p-8 rounded-3xl mb-4 border border-orange-100">
            <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h4 className="font-black text-xl mb-2 uppercase tracking-tight">Processing Stopped</h4>
            <p className="font-medium opacity-80">You manually aborted the process. Partial results may be available below.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="relative w-36 h-36 mb-10 flex items-center justify-center">
            {isCompleted ? (
              <div className="w-28 h-28 bg-green-100 text-green-600 rounded-full flex items-center justify-center animate-[scale-in_0.4s_cubic-bezier(0.175,0.885,0.32,1.275)] shadow-xl shadow-green-100 border-4 border-white">
                <svg className="w-14 h-14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            ) : (
              <>
                <div className="absolute inset-0 border-[6px] border-slate-50 rounded-full"></div>
                <div 
                  className={`absolute inset-0 border-[6px] rounded-full border-t-transparent animate-spin ${currentRound > 1 ? 'border-orange-500' : 'border-blue-600'}`}
                  style={{ animationDuration: '1.2s' }}
                ></div>
                <div className={`absolute inset-0 flex flex-col items-center justify-center font-black tabular-nums ${currentRound > 1 ? 'text-orange-500' : 'text-blue-600'}`}>
                  <span className="text-3xl">{Math.round(displayPercent)}%</span>
                  {currentRound > 1 ? (
                     <span className="text-[9px] bg-orange-100 px-2 py-0.5 rounded-full uppercase tracking-widest mt-1">Round {currentRound}</span>
                  ) : (
                     <span className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Active</span>
                  )}
                </div>
              </>
            )}
          </div>
          
          <h3 className={`text-2xl font-black mb-4 transition-colors duration-500 tracking-tight ${isCompleted ? 'text-green-800' : 'text-slate-900'}`}>
            {status === ProcessingStatus.LOADING_PDF && "Loading Exam..."}
            {status === ProcessingStatus.DETECTING_QUESTIONS && currentRound === 1 && "AI Analyzing Layout..."}
            {status === ProcessingStatus.DETECTING_QUESTIONS && currentRound > 1 && `Retrying Failed Items...`}
            {status === ProcessingStatus.CROPPING && "Precisely Cropping..."}
            {isCompleted && "Processing Completed!"}
          </h3>
          
          <div className="text-slate-500 font-medium text-center max-w-md min-h-[4em] flex flex-col items-center">
            {isCompleted ? (
              <span className="text-green-600 font-bold bg-green-50 px-6 py-2 rounded-full border border-green-100">Successfully extracted from {total} pages.</span>
            ) : (
              <>
                <span className="mb-4 opacity-80 text-sm font-semibold">{detailedStatus}</span>
                
                <div className="flex flex-wrap items-center justify-center gap-3 text-[10px] font-black uppercase tracking-widest bg-slate-50 px-6 py-3 rounded-2xl border border-slate-100 shadow-sm">
                  {status === ProcessingStatus.DETECTING_QUESTIONS ? (
                    <>
                      <span className="flex items-center gap-2 text-slate-400">Total: {total}</span>
                      {failedCount > 0 && (
                        <span className="flex items-center gap-2 text-red-500 bg-red-50 px-2 py-0.5 rounded">Failed: {failedCount}</span>
                      )}
                      <span className="flex items-center gap-2 text-green-600">Done: {completedCount}</span>
                    </>
                  ) : status === ProcessingStatus.CROPPING ? (
                    <>
                      <span className="flex items-center gap-2 text-slate-400">Total Qs: {croppingTotal}</span>
                      <span className="flex items-center gap-2 text-green-600">Cropped: {croppingDone}</span>
                      <span className="flex items-center gap-2 text-blue-500">Page {progress}</span>
                    </>
                  ) : (
                    <span className="text-blue-600">Page {progress} / {total}</span>
                  )}
                  {/* Elapsed Time Display */}
                   <div className="flex items-center gap-2 pl-3 ml-1 border-l border-slate-200 text-slate-500 tabular-nums">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {elapsedTime}
                   </div>
                </div>

                {onAbort && (
                  <button 
                    onClick={onAbort}
                    className="mt-6 px-5 py-2 rounded-xl border border-red-200 bg-white text-red-500 hover:bg-red-50 hover:border-red-300 font-bold text-xs uppercase tracking-wider transition-all shadow-sm hover:shadow-md active:scale-95 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                    Stop Processing
                  </button>
                )}
              </>
            )}
          </div>

          {!isCompleted && (
            <div className="w-full bg-slate-50 h-2.5 rounded-full mt-10 overflow-hidden shadow-inner border border-slate-200/50">
              <div 
                className={`h-full transition-all duration-500 ease-out ${currentRound > 1 ? 'bg-orange-500' : 'bg-blue-600'}`}
                style={{ width: `${displayPercent}%` }}
              ></div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
