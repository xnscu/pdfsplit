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
  const { stopRequestedRef, abortControllerRef } = refs;
  const { addNotification } = actions;

  const handleStartAnalysisRobust = async (fileName: string) => {
    // 创建新的 AbortController 用于分析任务
    const analysisController = new AbortController();
    const analysisSignal = analysisController.signal;
    
    // 将 controller 保存到 ref，以便停止时可以中断
    const originalController = abortControllerRef.current;
    abortControllerRef.current = analysisController;
    
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
      // 在开始处理前检查停止标志，如果已停止则不处理新任务
      if (stopRequestedRef.current || analysisSignal.aborted) return;

      try {
        // 发起请求（传递 signal 以便可以中断）
        const analysis = await analyzeQuestion(
          q.dataUrl,
          selectedModel || MODEL_IDS.FLASH,
          undefined,
          apiKey,
          analysisSignal,
        );

        // 请求完成后，再次检查停止标志，如果已停止则不更新状态
        if (stopRequestedRef.current || analysisSignal.aborted) return;

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
        // 如果是中断错误，不再重试
        if (e.name === "AbortError" || stopRequestedRef.current || analysisSignal.aborted) {
          return;
        }
        
        console.warn(`Analysis failed for Q${q.id}, retrying...`, e.message);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        // 只有在未中断时才重试
        if (!stopRequestedRef.current && !analysisSignal.aborted) {
          queue.push(q);
        }
      }
    };

    const workers = Array(analysisConcurrency)
      .fill(null)
      .map(async () => {
        while (queue.length > 0) {
          // 检查停止标志，如果已停止则不再从队列中取新任务
          if (stopRequestedRef.current || analysisSignal.aborted) break;
          const item = queue.shift();
          if (item) {
            // 处理任务（如果被中断会抛出 AbortError）
            await processItem(item);
          }
        }
      });

    try {
      await Promise.all(workers);
    } catch (e: any) {
      // 忽略中断错误
      if (e.name !== "AbortError") {
        console.error("Analysis worker error:", e);
      }
    } finally {
      // 恢复原始的 controller
      abortControllerRef.current = originalController;
    }

    if (!stopRequestedRef.current && !analysisSignal.aborted) {
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
