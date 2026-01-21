
import React, { useEffect } from 'react';

export interface AppNotification {
  id: string;
  fileName?: string | null;
  type: 'success' | 'error';
  message: string;
}

interface Props {
  notifications: AppNotification[];
  onDismiss: (id: string) => void;
  onView: (fileName: string) => void;
}

export const NotificationToast: React.FC<Props> = ({ notifications, onDismiss, onView }) => {
  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-3 pointer-events-none">
      {notifications.map(n => (
        <div 
          key={n.id} 
          className="bg-white rounded-xl shadow-2xl shadow-slate-400/20 border border-slate-200 p-4 w-80 pointer-events-auto animate-[fade-in_0.3s_ease-out] flex items-start gap-3 relative overflow-hidden"
        >
           <div className={`absolute top-0 left-0 w-1 h-full ${n.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}></div>
           <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${n.type === 'success' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
              {n.type === 'success' ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
              ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              )}
           </div>
           <div className="flex-1 min-w-0">
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-wide mb-0.5">{n.type === 'success' ? 'Process Completed' : 'Process Failed'}</h4>
              <p className="text-xs text-slate-500 font-bold mb-3 break-words leading-relaxed">{n.message}</p>
              {n.type === 'success' && n.fileName && (
                  <button 
                    onClick={() => {
                        if (n.fileName) onView(n.fileName);
                        onDismiss(n.id);
                    }}
                    className="text-[10px] font-bold text-white bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg transition-colors shadow-lg shadow-slate-200"
                  >
                    View Result
                  </button>
              )}
           </div>
           <button onClick={() => onDismiss(n.id)} className="text-slate-300 hover:text-slate-500 p-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
           </button>
        </div>
      ))}
    </div>
  );
};
