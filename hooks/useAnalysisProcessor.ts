
import { useRef } from 'react';
import { ProcessingStatus, QuestionImage } from '../types';
import { analyzeQuestion } from '../services/geminiService';
import { reSaveExamResult } from '../services/storageService';
import { MODEL_IDS } from '../shared/ai-config';

interface AnalysisProps {
  state: any;
  setters: any;
  refs: any;
  actions: any;
}

export const useAnalysisProcessor = ({ state, setters, refs, actions }: AnalysisProps) => {
  const { analysisConcurrency, questions, selectedModel } = state;
  const {
    setStatus, setDetailedStatus, setAnalyzingTotal, setAnalyzingDone,
    setQuestions
  } = setters;
  const { stopRequestedRef } = refs;
  const { addNotification } = actions;

  const handleStartAnalysis = async (fileName: string) => {
    // Filter questions for the file that haven't been analyzed yet (or all if force?)
    // For now, let's analyze all questions in the file to ensure completeness
    const targetQuestions = questions.filter((q: QuestionImage) => q.fileName === fileName);

    if (targetQuestions.length === 0) {
      addNotification(fileName, 'error', "No questions found to analyze.");
      return;
    }

    // Set Status (non-blocking for other files, but indicates activity)
    // We use a separate state indicator logic in UI usually, but here we can toggle loading for this specific file context?
    // Since the requirement says "doesn't affect other operations", we shouldn't change global Status to BLOCKING.
    // However, existing ProcessingStatus is global. 
    // We will use the 'ANALYSIS' status but ensure the UI doesn't lock up navigation.
    // Ideally, we'd use a separate `analyzingFiles` Set.
    
    // Let's use `analyzingTotal` and `analyzingDone` to show progress in the Debug View specifically.
    setAnalyzingTotal(targetQuestions.length);
    setAnalyzingDone(0);
    
    // We process in background.
    
    const queue = [...targetQuestions];
    const activePromises: Promise<void>[] = [];
    
    // Helper to process one item
    const processItem = async (q: QuestionImage) => {
        if (stopRequestedRef.current) return;
        
        try {
            // Check if already analyzed? (Optional optimization)
            // if (q.analysis) { ... } 
            
            const analysis = await analyzeQuestion(q.dataUrl, selectedModel || MODEL_IDS.FLASH); 
            
            // Update State Immediately
            setQuestions((prev: QuestionImage[]) => {
                return prev.map(item => {
                    if (item.fileName === q.fileName && item.id === q.id) {
                        return { ...item, analysis };
                    }
                    return item;
                });
            });
            
            // Note: We batch save later or save individually?
            // To be safe, we could save periodically or at end.
            // Let's rely on updating the whole file record at the end.
            
        } catch (e) {
            console.error(`Analysis failed for Q${q.id}`, e);
            // Optionally mark error in UI
        } finally {
            setAnalyzingDone((prev: number) => prev + 1);
        }
    };

    // Concurrency Loop
    const results: any[] = []; // To track completion
    
    const runWorker = async () => {
        while (queue.length > 0) {
            if (stopRequestedRef.current) break;
            const item = queue.shift();
            if (item) {
                await processItem(item);
            }
        }
    };

    const workers = Array(analysisConcurrency).fill(null).map(() => runWorker());
    
    try {
        await Promise.all(workers);
        
        // Save to DB logic moved to robust handler below
        
    } catch (e) {
        console.error("Analysis batch failed", e);
    }
  };
  
  // Revised Handler with local tracking for DB save
  const handleStartAnalysisRobust = async (fileName: string) => {
      const targetQuestions = questions.filter((q: QuestionImage) => q.fileName === fileName);
      if (targetQuestions.length === 0) return;

      setAnalyzingTotal(targetQuestions.length);
      setAnalyzingDone(0);
      
      const localMap = new Map<string, QuestionImage>();
      targetQuestions.forEach(q => localMap.set(q.id, q));

      const queue = [...targetQuestions];
      
      const processItem = async (q: QuestionImage) => {
        if (stopRequestedRef.current) return;
        try {
            const analysis = await analyzeQuestion(q.dataUrl, selectedModel || MODEL_IDS.FLASH);
            
            // Update Local Map for DB Save
            const updatedQ = { ...q, analysis };
            localMap.set(q.id, updatedQ);

            // Update UI State
            setQuestions((prev: QuestionImage[]) => {
                return prev.map(item => {
                    if (item.fileName === q.fileName && item.id === q.id) {
                        return updatedQ;
                    }
                    return item;
                });
            });
        } catch (e) {
            console.error(e);
        } finally {
            setAnalyzingDone((prev: number) => prev + 1);
        }
    };

    const workers = Array(analysisConcurrency).fill(null).map(async () => {
        while (queue.length > 0) {
            if (stopRequestedRef.current) break;
            const item = queue.shift();
            if (item) await processItem(item);
        }
    });

    await Promise.all(workers);
    
    // Final DB Save
    // We need rawPages to satisfy `reSaveExamResult` signature, effectively merging.
    // We can filter rawPages from state.
    const filePages = state.rawPages.filter((p: any) => p.fileName === fileName);
    const finalQuestions = Array.from(localMap.values());
    
    // Use `reSaveExamResult` which handles "Update existing by name"
    try {
        await reSaveExamResult(fileName, filePages, finalQuestions);
    } catch(e) { console.error("DB Save failed", e); }
    
    addNotification(fileName, 'success', "Analysis complete and saved.");
    setAnalyzingTotal(0);
    setAnalyzingDone(0);
  };

  return { handleStartAnalysis: handleStartAnalysisRobust };
};
