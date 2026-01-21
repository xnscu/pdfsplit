
import { useState, useRef, useEffect } from 'react';
import { ProcessingStatus, QuestionImage, DebugPageData, HistoryMetadata, SourcePage } from '../types';
import { CropSettings } from '../services/pdfService';
import { AppNotification } from '../components/NotificationToast';

export const DEFAULT_SETTINGS: CropSettings = {
  cropPadding: 25,
  canvasPadding: 10,
  mergeOverlap: -5
};

export const STORAGE_KEYS = {
  CROP_SETTINGS: 'exam_splitter_crop_settings_v3',
  CONCURRENCY: 'exam_splitter_concurrency_v3',
  MODEL: 'exam_splitter_selected_model_v3',
  USE_HISTORY_CACHE: 'exam_splitter_use_history_cache_v1',
  BATCH_SIZE: 'exam_splitter_batch_size_v1'
};

// Helper for auto-detect batch size based on RAM
export const getAutoBatchSize = (): number => {
  if (typeof navigator !== 'undefined' && 'deviceMemory' in navigator) {
    // @ts-ignore
    const ram = navigator.deviceMemory as number; 
    if (ram <= 4) return 10;
    if (ram <= 8) return 25;
    return 50;
  }
  return 20; 
};

export const useExamState = () => {
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [questions, setQuestions] = useState<QuestionImage[]>([]);
  const [rawPages, setRawPages] = useState<DebugPageData[]>([]);
  const [sourcePages, setSourcePages] = useState<SourcePage[]>([]);
  
  // Specific file interactions
  const [debugFile, setDebugFile] = useState<string | null>(null);
  const [lastViewedFile, setLastViewedFile] = useState<string | null>(null);
  const [refiningFile, setRefiningFile] = useState<string | null>(null);

  // Legacy sync
  const [legacySyncFiles, setLegacySyncFiles] = useState<Set<string>>(new Set());
  const [isSyncingLegacy, setIsSyncingLegacy] = useState(false);

  // Background Processing
  const [processingFiles, setProcessingFiles] = useState<Set<string>>(new Set());
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // History
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryMetadata[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Persistence
  const [cropSettings, setCropSettings] = useState<CropSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CROP_SETTINGS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.canvasPadding === undefined && parsed.canvasPaddingLeft !== undefined) {
             parsed.canvasPadding = parsed.canvasPaddingLeft;
        }
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
      return DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  
  const [concurrency, setConcurrency] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CONCURRENCY);
      return saved ? Math.min(10, Math.max(1, parseInt(saved, 10))) : 5;
    } catch {
      return 5;
    }
  });

  const [batchSize, setBatchSize] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.BATCH_SIZE);
      return saved ? Math.max(1, parseInt(saved, 10)) : getAutoBatchSize();
    } catch {
      return 20;
    }
  });

  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.MODEL) || 'gemini-3-flash-preview';
  });

  const [useHistoryCache, setUseHistoryCache] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.USE_HISTORY_CACHE) === 'true';
  });

  // Progress
  const [progress, setProgress] = useState(0); 
  const [total, setTotal] = useState(0);
  const [completedCount, setCompletedCount] = useState(0); 
  const [error, setError] = useState<string | undefined>();
  const [detailedStatus, setDetailedStatus] = useState<string>('');
  const [croppingTotal, setCroppingTotal] = useState(0);
  const [croppingDone, setCroppingDone] = useState(0);
  
  // Retry / Round
  const [currentRound, setCurrentRound] = useState(1);
  const [failedCount, setFailedCount] = useState(0);
  
  // Timers
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState("00:00");

  const abortControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);

  // Persistence Effects
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CROP_SETTINGS, JSON.stringify(cropSettings));
  }, [cropSettings]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CONCURRENCY, concurrency.toString());
  }, [concurrency]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.BATCH_SIZE, batchSize.toString());
  }, [batchSize]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.MODEL, selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.USE_HISTORY_CACHE, String(useHistoryCache));
  }, [useHistoryCache]);

  const addNotification = (fileName: string, type: 'success' | 'error', message: string) => {
      const id = Date.now().toString() + Math.random().toString();
      setNotifications(prev => [...prev, { id, fileName, type, message }]);
      if (type === 'success') {
          setTimeout(() => {
              setNotifications(current => current.filter(n => n.id !== id));
          }, 8000);
      }
  };

  const resetState = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    stopRequestedRef.current = false;
    setStatus(ProcessingStatus.IDLE);
    setQuestions([]);
    setRawPages([]);
    setSourcePages([]);
    setProgress(0);
    setTotal(0);
    setCompletedCount(0);
    setCroppingTotal(0);
    setCroppingDone(0);
    setError(undefined);
    setDetailedStatus('');
    setDebugFile(null);
    setLastViewedFile(null);
    setRefiningFile(null);
    setStartTime(null);
    setElapsedTime("00:00");
    setCurrentRound(1);
    setFailedCount(0);
    setProcessingFiles(new Set());
    setNotifications([]);
    setLegacySyncFiles(new Set());
    setIsSyncingLegacy(false);
    if (window.location.search) window.history.pushState({}, '', window.location.pathname);
  };

  const handleStop = () => {
    stopRequestedRef.current = true;
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
    }
    setDetailedStatus("Stopping... Current requests will finish.");
  };

  return {
    state: {
      status, questions, rawPages, sourcePages, debugFile, lastViewedFile, refiningFile,
      legacySyncFiles, isSyncingLegacy, processingFiles, notifications, showHistory,
      historyList, isLoadingHistory, cropSettings, concurrency, batchSize, selectedModel,
      useHistoryCache, progress, total, completedCount, error, detailedStatus,
      croppingTotal, croppingDone, currentRound, failedCount, startTime, elapsedTime
    },
    setters: {
      setStatus, setQuestions, setRawPages, setSourcePages, setDebugFile, setLastViewedFile, setRefiningFile,
      setLegacySyncFiles, setIsSyncingLegacy, setProcessingFiles, setNotifications, setShowHistory,
      setHistoryList, setIsLoadingHistory, setCropSettings, setConcurrency, setBatchSize, setSelectedModel,
      setUseHistoryCache, setProgress, setTotal, setCompletedCount, setError, setDetailedStatus,
      setCroppingTotal, setCroppingDone, setCurrentRound, setFailedCount, setStartTime, setElapsedTime
    },
    refs: {
      abortControllerRef,
      stopRequestedRef
    },
    actions: {
      addNotification,
      resetState,
      handleStop
    }
  };
};
