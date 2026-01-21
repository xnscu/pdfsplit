
import { CropSettings } from '../services/pdfService';
import { DetectedQuestion, DebugPageData } from '../types';
import { reSaveExamResult, updatePageDetectionsAndQuestions } from '../services/storageService';
import { generateQuestionsFromRawPages } from '../services/generationService';
import { detectQuestionsOnPage } from '../services/geminiService';

interface RefinementProps {
  state: any;
  setters: any;
  actions: any;
  refreshHistoryList: () => Promise<void>;
}

export const useRefinementActions = ({ state, setters, actions, refreshHistoryList }: RefinementProps) => {
  const { rawPages, concurrency, selectedModel, cropSettings } = state;
  const { setQuestions, setRawPages, setProcessingFiles, setCroppingDone } = setters;
  const { addNotification } = actions;

  const handleRecropFile = async (fileName: string, specificSettings: CropSettings) => {
    const targetPages = rawPages.filter((p: any) => p.fileName === fileName);
    if (targetPages.length === 0) return;

    const taskController = new AbortController();
    
    setProcessingFiles((prev: any) => new Set(prev).add(fileName));
    setters.setRefiningFile(null); 

    try {
       const newQuestions = await generateQuestionsFromRawPages(
         targetPages, 
         specificSettings, 
         taskController.signal,
         {
             onProgress: () => setCroppingDone((p: number) => p + 1)
         },
         concurrency
        );
       
       if (!taskController.signal.aborted) {
         setQuestions((prev: any) => {
            const others = prev.filter((q: any) => q.fileName !== fileName);
            const combined = [...others, ...newQuestions];
             return combined.sort((a: any,b: any) => {
                 if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
                 if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
                 return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
              });
         });

         await reSaveExamResult(fileName, targetPages, newQuestions);
         await refreshHistoryList(); // Update timestamp in history
         addNotification(fileName, 'success', `Successfully refined ${fileName}`);
       }
    } catch (e: any) {
       console.error(e);
       addNotification(fileName, 'error', `Failed to refine ${fileName}: ${e.message}`);
    } finally {
       setProcessingFiles((prev: any) => {
           const next = new Set(prev);
           next.delete(fileName);
           return next;
       });
    }
  };

  const executeReanalysis = async (fileName: string) => {
    const filePages = rawPages.filter((p: any) => p.fileName === fileName).sort((a: any,b: any) => a.pageNumber - b.pageNumber);
    if (filePages.length === 0) return;

    const taskController = new AbortController();
    const signal = taskController.signal;

    setProcessingFiles((prev: any) => new Set(prev).add(fileName));
    
    try {
        const updatedRawPages = [...rawPages];
        
        const chunks = [];
        for (let i = 0; i < filePages.length; i += concurrency) {
            chunks.push(filePages.slice(i, i + concurrency));
        }

        const newResults: DebugPageData[] = [];

        for (const chunk of chunks) {
            if (signal.aborted) break;
            
            await Promise.all(chunk.map(async (page: DebugPageData) => {
                const detections = await detectQuestionsOnPage(page.dataUrl, selectedModel);
                const newPage = { ...page, detections };
                newResults.push(newPage);
            }));
        }

        if (signal.aborted) return;

        const mergedRawPages = updatedRawPages.map(p => {
             const match = newResults.find(n => n.fileName === p.fileName && n.pageNumber === p.pageNumber);
             return match ? match : p;
        });
        
        setRawPages(mergedRawPages);
        
        const finalFilePages = mergedRawPages.filter(p => p.fileName === fileName);
        
        const newQuestions = await generateQuestionsFromRawPages(
            finalFilePages, 
            cropSettings, 
            signal,
            {
                onProgress: () => setCroppingDone((p: number) => p + 1)
            },
            concurrency
        );
        
        if (!signal.aborted) {
             setQuestions((prev: any) => {
                const others = prev.filter((q: any) => q.fileName !== fileName);
                const combined = [...others, ...newQuestions];
                 return combined.sort((a: any,b: any) => {
                     if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
                     if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
                     return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
                  });
             });
             
             await reSaveExamResult(fileName, finalFilePages, newQuestions);
             await refreshHistoryList(); // Update timestamp in history
             addNotification(fileName, 'success', `AI Analysis completed for ${fileName}`);
        }

    } catch (error: any) {
        console.error(error);
        addNotification(fileName, 'error', `Re-analysis failed for ${fileName}: ${error.message}`);
    } finally {
        setProcessingFiles((prev: any) => {
           const next = new Set(prev);
           next.delete(fileName);
           return next;
       });
    }
  };

  const handleUpdateDetections = async (fileName: string, pageNumber: number, newDetections: DetectedQuestion[]) => {
      const updatedPages = rawPages.map((p: any) => {
          if (p.fileName === fileName && p.pageNumber === pageNumber) {
              return { ...p, detections: newDetections };
          }
          return p;
      });

      setRawPages(updatedPages);
      setProcessingFiles((prev: any) => new Set(prev).add(fileName));

      try {
          const targetPages = updatedPages.filter((p: any) => p.fileName === fileName);
          if (targetPages.length === 0) {
              setProcessingFiles((prev: any) => { const n = new Set(prev); n.delete(fileName); return n; });
              return;
          }

          const taskController = new AbortController();
          
          const newQuestions = await generateQuestionsFromRawPages(
              targetPages, 
              cropSettings, 
              taskController.signal,
              {
                  onProgress: () => setCroppingDone((p: number) => p + 1)
              },
              concurrency
          );
          
          if (!taskController.signal.aborted) {
              await updatePageDetectionsAndQuestions(fileName, pageNumber, newDetections, newQuestions);
              // Note: manual detection updates don't usually change the exam timestamp in the DB service unless configured to do so.
              // But if we wanted to be safe we could refresh here too.
              
              setQuestions((prev: any) => {
                  const others = prev.filter((q: any) => q.fileName !== fileName);
                  const combined = [...others, ...newQuestions];
                  return combined.sort((a: any,b: any) => {
                     if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
                     if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
                     return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
                  });
              });
          }

      } catch (err: any) {
          console.error("Failed to save or recrop", err);
          addNotification(fileName, 'error', `Failed to save changes: ${err.message}`);
      } finally {
          setProcessingFiles((prev: any) => {
             const next = new Set(prev);
             next.delete(fileName);
             return next;
         });
      }
  };

  return { handleRecropFile, executeReanalysis, handleUpdateDetections };
};
