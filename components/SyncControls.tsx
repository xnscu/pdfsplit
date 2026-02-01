import React from "react";

interface Props {
  onPush?: () => void;
  onPull?: () => void;
  recommendPush?: boolean;
  recommendPull?: boolean;
  variant?: "icon" | "labeled";
  size?: "sm" | "md";
}

export const SyncControls: React.FC<Props> = ({
  onPush,
  onPull,
  recommendPush = false,
  recommendPull = false,
  variant = "labeled",
}) => {
  const baseClasses = "transition-all flex items-center justify-center gap-2 relative";
  
  // Common solid styles
  const pushBase = "bg-indigo-600 text-white shadow-lg shadow-indigo-900/20 hover:bg-indigo-500 rounded-xl font-bold text-xs";
  const pullBase = "bg-cyan-600 text-white shadow-lg shadow-cyan-900/20 hover:bg-cyan-500 rounded-xl font-bold text-xs";

  const pushClasses = variant === "labeled"
    ? `${pushBase} px-3 py-2 ${recommendPush ? "ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-900 animate-pulse" : ""}`
    : `${pushBase} p-2 ${recommendPush ? "ring-2 ring-indigo-400 ring-offset-1 animate-pulse" : ""}`;

  const pullClasses = variant === "labeled"
    ? `${pullBase} px-3 py-2 ${recommendPull ? "ring-2 ring-cyan-400 ring-offset-2 ring-offset-slate-900 animate-pulse" : ""}`
    : `${pullBase} p-2 ${recommendPull ? "ring-2 ring-cyan-400 ring-offset-1 animate-pulse" : ""}`;

  // Badges for recommendations
  const PushBadge = () => (
    <span className="absolute -top-1 -right-1 flex h-3 w-3">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
      <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
    </span>
  );

  const PullBadge = () => (
    <span className="absolute -top-1 -right-1 flex h-3 w-3">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
      <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
    </span>
  );

  return (
    <div className="flex items-center gap-2">
      {onPush && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPush();
          }}
          className={`${baseClasses} ${pushClasses}`}
          title={recommendPush ? "Local changes detected - Push recommended" : "Push to Cloud"}
        >
          {recommendPush && <PushBadge />}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
          {variant === "labeled" && "Push"}
        </button>
      )}

      {onPull && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPull();
          }}
          className={`${baseClasses} ${pullClasses}`}
          title={recommendPull ? "Remote changes detected - Pull recommended" : "Pull from Cloud"}
        >
          {recommendPull && <PullBadge />}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          {variant === "labeled" && "Pull"}
        </button>
      )}
    </div>
  );
};
