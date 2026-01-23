
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
  const { analysisConcurrency, questions, selectedModel } = state;
  const {
    setAnalyzingTotal, setAnalyzingDone,
    setQuestions
  } = setters;
  const { stopRequestedRef } = refs;
  const { addNotification } = actions;

  // Revised Handler with local tracking for DB save
  const handleStartAnalysisRobust = async (fileName: string) => {
      const targetQuestions = questions.filter((q: QuestionImage) => q.fileName === fileName);
      if (targetQuestions.length === 0) {
          addNotification(fileName, 'error', "No questions found to analyze.");
          return;
      }

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
            // Sort questions to maintain order
            currentFileQuestions.sort((a, b) => (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0));
            
            await updateQuestionsForFile(fileName, currentFileQuestions);

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
    
    addNotification(fileName, 'success', "Analysis complete and saved.");
    setAnalyzingTotal(0);
    setAnalyzingDone(0);
  };

  return { handleStartAnalysis: handleStartAnalysisRobust };
};
