import { useRef } from "react";
import { ProcessingStatus, QuestionImage } from "../types";
import { analyzeQuestion } from "../services/geminiService";
import { updateQuestionsForFile } from "../services/storageService";
import { MODEL_IDS } from "../shared/ai-config";

interface AnalysisProps {
  state: any;
  setters: any;
  refs: any;
  actions: any;
}

export const useAnalysisProcessor = ({
  state,
  setters,
  refs,
  actions,
}: AnalysisProps) => {
  const { analysisConcurrency, questions, selectedModel, apiKey, skipSolvedQuestions } = state;
  const { setAnalyzingTotal, setAnalyzingDone, setQuestions } = setters;
  const { stopRequestedRef } = refs;
  const { addNotification } = actions;

  const handleStartAnalysisRobust = async (fileName: string) => {
    const startTimeLocal = Date.now();
    let targetQuestions = questions.filter(
      (q: QuestionImage) => q.fileName === fileName,
    );
    
    // 如果启用了跳过已解析题目选项，过滤掉已有解析的题目
    if (skipSolvedQuestions) {
      const unsolvedQuestions = targetQuestions.filter(
        (q: QuestionImage) => !q.analysis,
      );
      const skippedCount = targetQuestions.length - unsolvedQuestions.length;
      if (skippedCount > 0) {
        addNotification(
          fileName,
          "success",
          `已跳过 ${skippedCount} 个已有解析的题目`,
        );
      }
      targetQuestions = unsolvedQuestions;
    }
    
    if (targetQuestions.length === 0) {
      addNotification(fileName, "error", "没有找到需要解析的题目。");
      return;
    }

    setAnalyzingTotal(targetQuestions.length);
    setAnalyzingDone(0);

    const localMap = new Map<string, QuestionImage>();
    targetQuestions.forEach((q) => localMap.set(q.id, q));

    const queue = [...targetQuestions];

    const processItem = async (q: QuestionImage) => {
      if (stopRequestedRef.current) return;

      try {
        const analysis = await analyzeQuestion(
          q.dataUrl,
          selectedModel || MODEL_IDS.FLASH,
          undefined,
          apiKey,
        );

        const updatedQ = { ...q, analysis };
        localMap.set(q.id, updatedQ);

        setQuestions((prev: QuestionImage[]) => {
          return prev.map((item) => {
            if (item.fileName === q.fileName && item.id === q.id) {
              return updatedQ;
            }
            return item;
          });
        });

        const currentFileQuestions = Array.from(localMap.values());
        currentFileQuestions.sort(
          (a, b) => (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0),
        );

        updateQuestionsForFile(fileName, currentFileQuestions).catch((e) =>
          console.warn("Auto-save failed", e),
        );

        setAnalyzingDone((prev: number) => prev + 1);
      } catch (e: any) {
        console.warn(`Analysis failed for Q${q.id}, retrying...`, e.message);
        if (!stopRequestedRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          queue.push(q);
        }
      }
    };

    const workers = Array(analysisConcurrency)
      .fill(null)
      .map(async () => {
        while (queue.length > 0) {
          if (stopRequestedRef.current) break;
          const item = queue.shift();
          if (item) await processItem(item);
        }
      });

    await Promise.all(workers);

    if (!stopRequestedRef.current) {
      const duration = ((Date.now() - startTimeLocal) / 1000).toFixed(1);
      addNotification(fileName, "success", `AI 解析全部完成 (${duration}s)`);
    } else {
      addNotification(fileName, "error", "解析已停止。");
    }

    setAnalyzingTotal(0);
    setAnalyzingDone(0);
  };

  return { handleStartAnalysis: handleStartAnalysisRobust };
};
