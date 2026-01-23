
import { useRef } from 'react';
import { ProcessingStatus, QuestionImage } from '../types';
import { analyzeQuestion } from '../services/geminiService';
import { updateQuestionsForFile } from '../services/storageService';
import { MODEL_IDS } from '../shared/ai-config';

interface AnalysisProps {
  state: any;
  setters: any;
  refs: any;
  actions: any;
}

export const useAnalysisProcessor = ({ state, setters, refs, actions }: AnalysisProps) => {
  const { analysisConcurrency, questions, selectedModel, apiKey } = state;
  const {
    setAnalyzingTotal, setAnalyzingDone,
    setQuestions
  } = setters;
  const { stopRequestedRef } = refs;
  const { addNotification } = actions;

  const handleStartAnalysisRobust = async (fileName: string) => {
      const targetQuestions = questions.filter((q: QuestionImage) => q.fileName === fileName);
      if (targetQuestions.length === 0) {
          addNotification(fileName, 'error', "没有找到需要解析的题目。");
          return;
      }

      // Reset progress
      setAnalyzingTotal(targetQuestions.length);
      setAnalyzingDone(0);
      
      const localMap = new Map<string, QuestionImage>();
      targetQuestions.forEach(q => localMap.set(q.id, q));

      // Queue for processing (contains QuestionImage)
      const queue = [...targetQuestions];
      
      // Helper to process a single item
      const processItem = async (q: QuestionImage) => {
        if (stopRequestedRef.current) return;
        
        try {
            // Check if already analyzed to avoid double work if re-added
            // (Though in this logic we only re-add on failure)
            
            const analysis = await analyzeQuestion(q.dataUrl, selectedModel || MODEL_IDS.FLASH, undefined, apiKey);
            
            // Success! Update Local Map
            const updatedQ = { ...q, analysis };
            localMap.set(q.id, updatedQ);

            // 1. Update React State (Real-time UI)
            setQuestions((prev: QuestionImage[]) => {
                return prev.map(item => {
                    if (item.fileName === q.fileName && item.id === q.id) {
                        return updatedQ;
                    }
                    return item;
                });
            });

            // 2. Real-time DB Save (Persistence)
            const currentFileQuestions = Array.from(localMap.values());
            currentFileQuestions.sort((a, b) => (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0));
            
            // We don't await this to avoid blocking the worker thread too long
            updateQuestionsForFile(fileName, currentFileQuestions).catch(e => console.warn("Auto-save failed", e));
            
            // Increment Success Counter
            setAnalyzingDone((prev: number) => prev + 1);

        } catch (e: any) {
            console.warn(`Analysis failed for Q${q.id}, retrying...`, e.message);
            // On failure: Push back to queue with a small delay to avoid hammering
            if (!stopRequestedRef.current) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2s backoff
                queue.push(q);
            }
        }
    };

    // Worker Loop
    const workers = Array(analysisConcurrency).fill(null).map(async () => {
        while (queue.length > 0) {
            if (stopRequestedRef.current) break;
            const item = queue.shift();
            if (item) await processItem(item);
        }
    });

    await Promise.all(workers);
    
    if (!stopRequestedRef.current) {
        addNotification(fileName, 'success', "AI 解析全部完成！");
    } else {
        addNotification(fileName, 'error', "解析已停止。");
    }
    
    // Reset counters after done (or stopped)
    setAnalyzingTotal(0);
    setAnalyzingDone(0);
  };

  return { handleStartAnalysis: handleStartAnalysisRobust };
};
