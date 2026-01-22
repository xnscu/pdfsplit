import React from 'react';

interface Props {
  progress: number;
  size?: string; // CSS width/height value, e.g. "5rem"
  colorClass?: string;
  strokeWidth?: number;
  label?: React.ReactNode;
  className?: string;
}

export const CircularProgress: React.FC<Props> = ({ 
  progress, 
  size = "5rem", 
  colorClass = "text-blue-600",
  strokeWidth = 6,
  label,
  className = ""
}) => {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const normalizedProgress = Math.min(100, Math.max(0, progress));
  const offset = circumference * (1 - normalizedProgress / 100);

  return (
    <div className={`relative flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 64 64">
        {/* Track */}
        <circle 
          cx="32" cy="32" r={radius} 
          stroke="currentColor" strokeWidth={strokeWidth} fill="transparent" 
          className="text-slate-100" 
        />
        {/* Indicator */}
        <circle 
          cx="32" cy="32" r={radius} 
          stroke="currentColor" strokeWidth={strokeWidth} fill="transparent" 
          className={`${colorClass} transition-all duration-300 ease-out`} 
          strokeDasharray={circumference}
          strokeDashoffset={offset} 
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
         {label || <span className="text-lg font-black text-slate-800">{Math.round(normalizedProgress)}%</span>}
      </div>
    </div>
  );
};
