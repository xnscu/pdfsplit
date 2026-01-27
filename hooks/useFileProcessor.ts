import { useRef, useEffect } from "react";
import * as pdfjsLib from "pdfjs-dist";
import JSZip from "jszip";
import { ProcessingStatus, DebugPageData, QuestionImage, SourcePage } from "../types";
import { renderPageToImage } from "../services/pdfService";
import { detectQuestionsViaProxy } from "../services/geminiProxyService";
import { loadExamResult, saveExamResult, getHistoryList } from "../services/storageService";
import {
  generateQuestionsFromRawPages,
  CropQueue,
  createLogicalQuestions,
  processLogicalQuestion,
} from "../services/generationService";

interface ProcessorProps {
  state: any;
  setters: any;
  refs: any;
  actions: any;
  refreshHistoryList: () => Promise<void>;
}

export const useFileProcessor = ({ state, setters, refs, actions, refreshHistoryList }: ProcessorProps) => {
  const { cropSettings, concurrency, selectedModel, useHistoryCache, batchSize, apiKey } = state;

  const {
    setStatus,
    setDetailedStatus,
    setError,
    setQuestions,
    setRawPages,
    setSourcePages,
    setTotal,
    setCompletedCount,
    setProgress,
    setCroppingTotal,
    setCroppingDone,
    setCurrentRound,
    setFailedCount,
    setStartTime,
  } = setters;

  const { abortControllerRef, stopRequestedRef } = refs;
  const { addNotification } = actions;

  // Global Queue for cropping tasks to ensure flattened concurrency
  const cropQueueRef = useRef(new CropQueue());

  // Track per-file progress to save results when file is done
  const fileResultsRef = useRef<Record<string, QuestionImage[]>>({});
  const fileCropMetaRef = useRef<Record<string, { totalQs: number; processedQs: number; saved: boolean }>>({});

  useEffect(() => {
    cropQueueRef.current.concurrency = batchSize || 10;
  }, [batchSize]);

  const processZipFiles = async (files: { blob: Blob; name: string }[]) => {
    const startTimeLocal = Date.now();
    try {
      setStartTime(startTimeLocal);
      setStatus(ProcessingStatus.LOADING_PDF);
      setDetailedStatus("Scanning ZIP contents...");

      const allRawPages: DebugPageData[] = [];
      const allQuestions: QuestionImage[] = [];

      // Map to store math_analysis.json data by folder: { folderName -> { questionId -> analysis } }
      const mathAnalysisMap = new Map<string, Map<string, QuestionImage["analysis"]>>();

      let totalWorkItems = 0;

      // Structure: each folder in the ZIP represents one PDF file
      // folder/
      //   analysis_data.json - page detection data
      //   math_analysis.json - question analysis data (optional)
      //   [fileName]_Q1.jpg, [fileName]_Q2.jpg,... - cropped question images
      //   full_pages/Page_1.jpg,... - full page images

      interface FolderWork {
        folderName: string; // e.g., "2000上海文"
        dirPrefix: string; // e.g., "2000上海文/" or ""
        analysisDataKey: string | null;
        mathAnalysisKey: string | null;
        pages: DebugPageData[];
        imageKeys: string[]; // Question image keys for this folder
        zip: JSZip;
      }

      const folderWorks: FolderWork[] = [];

      for (const file of files) {
        try {
          const zip = new JSZip();
          const loadedZip = await zip.loadAsync(file.blob, {
            decodeFileName: (bytes) => {
              try {
                // Try decoding as GBK (common for Chinese Windows zips)
                // Implicit cast safe for browser JSZip execution
                return new TextDecoder("gbk").decode(bytes as Uint8Array);
              } catch (e) {
                // Fallback to UTF-8
                return new TextDecoder("utf-8").decode(bytes as Uint8Array);
              }
            },
          });
          const zipBaseName = file.name.replace(/\.[^/.]+$/, "");

          // Find all analysis_data.json files to identify folders
          const analysisFileKeys = Object.keys(loadedZip.files).filter((key) =>
            key.match(/(^|\/)analysis_data\.json$/i)
          );

          // Track folders we've already processed
          const processedFolders = new Set<string>();

          for (const analysisKey of analysisFileKeys) {
            // Extract folder prefix: "2000上海文/analysis_data.json" -> "2000上海文/"
            const dirPrefix = analysisKey.substring(0, analysisKey.lastIndexOf("analysis_data.json"));
            // Folder name: "2000上海文/" -> "2000上海文", or empty -> use zip base name
            const folderName = dirPrefix ? dirPrefix.replace(/\/$/, "") : zipBaseName;

            if (processedFolders.has(folderName)) continue;
            processedFolders.add(folderName);

            // Parse analysis_data.json
            const jsonText = await loadedZip.file(analysisKey)!.async("text");
            const pages = JSON.parse(jsonText) as DebugPageData[];

            // Update fileName for each page
            pages.forEach((p) => {
              if (!p.fileName || p.fileName === "unknown_file") {
                p.fileName = folderName;
              }
            });

            totalWorkItems += pages.length;

            // Check for math_analysis.json in the same folder
            const mathAnalysisKey = `${dirPrefix}math_analysis.json`;
            const hasMathAnalysis = !!loadedZip.files[mathAnalysisKey];

            // Find question images in this folder (not in full_pages)
            const folderImageKeys = Object.keys(loadedZip.files).filter(
              (k) =>
                k.startsWith(dirPrefix) &&
                !loadedZip.files[k].dir &&
                /\.(jpg|jpeg|png)$/i.test(k) &&
                !k.includes("full_pages/")
            );

            folderWorks.push({
              folderName,
              dirPrefix,
              analysisDataKey: analysisKey,
              mathAnalysisKey: hasMathAnalysis ? mathAnalysisKey : null,
              pages,
              imageKeys: folderImageKeys,
              zip: loadedZip,
            });
          }

          // Handle case where there are no analysis_data.json but there are images at root level
          if (analysisFileKeys.length === 0) {
            const rootImageKeys = Object.keys(loadedZip.files).filter(
              (k) =>
                !loadedZip.files[k].dir &&
                /\.(jpg|jpeg|png)$/i.test(k) &&
                !k.includes("full_pages/") &&
                !k.includes("/") // Only root level
            );
            if (rootImageKeys.length > 0) {
              folderWorks.push({
                folderName: zipBaseName,
                dirPrefix: "",
                analysisDataKey: null,
                mathAnalysisKey: null,
                pages: [],
                imageKeys: rootImageKeys,
                zip: loadedZip,
              });
            }
          }
        } catch (e) {
          console.error(`Failed to scan ${file.name}`, e);
        }
      }

      setTotal(totalWorkItems > 0 ? totalWorkItems : 1);
      setCompletedCount(0);
      setProgress(0);

      let processedCount = 0;

      // Process each folder
      for (const work of folderWorks) {
        setDetailedStatus(`Processing: ${work.folderName}`);

        // Step 1: Parse math_analysis.json if exists
        if (work.mathAnalysisKey) {
          try {
            const mathJsonText = await work.zip.file(work.mathAnalysisKey)!.async("text");
            const mathAnalysisData = JSON.parse(mathJsonText) as Array<{
              id: string;
              analysis: QuestionImage["analysis"];
            }>;

            const analysisById = new Map<string, QuestionImage["analysis"]>();
            for (const item of mathAnalysisData) {
              analysisById.set(item.id, item.analysis);
            }
            mathAnalysisMap.set(work.folderName, analysisById);
          } catch (e) {
            console.warn(`Failed to parse math_analysis.json for ${work.folderName}`, e);
          }
        }

        // Step 2: Process pages - load full page images
        for (const page of work.pages) {
          // Ensure fileName is set correctly
          page.fileName = work.folderName;

          // Find and load full page image
          let foundKey: string | undefined = undefined;
          const candidates = [
            `${work.dirPrefix}full_pages/Page_${page.pageNumber}.jpg`,
            `${work.dirPrefix}full_pages/Page_${page.pageNumber}.jpeg`,
            `${work.dirPrefix}full_pages/Page_${page.pageNumber}.png`,
          ];

          for (const c of candidates) {
            if (work.zip.files[c]) {
              foundKey = c;
              break;
            }
          }

          if (!foundKey) {
            foundKey = Object.keys(work.zip.files).find(
              (k) =>
                k.startsWith(work.dirPrefix) &&
                !work.zip.files[k].dir &&
                k.match(new RegExp(`full_pages/.*Page_${page.pageNumber}\\.(jpg|jpeg|png)$`, "i"))
            );
          }

          if (foundKey) {
            const base64 = await work.zip.file(foundKey)!.async("base64");
            const ext = foundKey.split(".").pop()?.toLowerCase();
            const mime = ext === "png" ? "image/png" : "image/jpeg";
            page.dataUrl = `data:${mime};base64,${base64}`;
          }

          processedCount++;
          setCompletedCount(processedCount);
          setProgress(processedCount);

          if (processedCount % 5 === 0) await new Promise((r) => setTimeout(r, 0));
        }

        allRawPages.push(...work.pages);

        // Step 3: Load question images for this folder
        if (work.imageKeys.length > 0) {
          setDetailedStatus(`Loading question images: ${work.folderName}`);
          const folderQuestions: QuestionImage[] = [];
          const folderAnalysis = mathAnalysisMap.get(work.folderName);

          const chunkSize = 20;
          for (let i = 0; i < work.imageKeys.length; i += chunkSize) {
            const chunk = work.imageKeys.slice(i, i + chunkSize);
            await Promise.all(
              chunk.map(async (key) => {
                const base64 = await work.zip.file(key)!.async("base64");
                const ext = key.split(".").pop()?.toLowerCase();
                const mime = ext === "png" ? "image/png" : "image/jpeg";
                const pathParts = key.split("/");
                const fileNameWithExt = pathParts[pathParts.length - 1];

                let qId = "0";

                // Try to match pattern: folderName_Q1.jpg or folderName_Q1_2.jpg
                const flatMatch = fileNameWithExt.match(/^(.+)_Q(\d+(?:_\d+)?)\.(jpg|jpeg|png)$/i);
                if (flatMatch) {
                  qId = flatMatch[2];
                } else {
                  // Try to match pattern: Q1.jpg or Q1_2.jpg
                  const nestedMatch = fileNameWithExt.match(/^Q(\d+(?:_\d+)?)\.(jpg|jpeg|png)$/i);
                  if (nestedMatch) {
                    qId = nestedMatch[1];
                  }
                }

                // Build question with analysis if available
                const question: QuestionImage = {
                  id: qId,
                  pageNumber: 1, // Default, could be improved by matching detection data
                  fileName: work.folderName, // Always use the folder name
                  dataUrl: `data:${mime};base64,${base64}`,
                };

                // Attach analysis from math_analysis.json if available
                if (folderAnalysis && folderAnalysis.has(qId)) {
                  question.analysis = folderAnalysis.get(qId);
                }

                folderQuestions.push(question);
              })
            );
            await new Promise((r) => setTimeout(r, 0));
          }

          // Sort questions by numeric ID
          folderQuestions.sort((a, b) => {
            const aNum = parseFloat(a.id) || 0;
            const bNum = parseFloat(b.id) || 0;
            return aNum - bNum;
          });

          allQuestions.push(...folderQuestions);
        }
      }

      setRawPages(allRawPages);
      setSourcePages(allRawPages.map(({ detections, ...rest }) => rest));
      setCompletedCount(totalWorkItems > 0 ? totalWorkItems : 1);

      const uniqueFiles = new Set(allRawPages.map((p) => p.fileName));

      if (allQuestions.length > 0) {
        setDetailedStatus("Syncing results...");
        // Sort all questions by fileName then by ID
        allQuestions.sort((a, b) => {
          if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
          return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
        });
        setQuestions(allQuestions);

        const savePromises = Array.from(uniqueFiles).map((fileName) => {
          const filePages = allRawPages.filter((p) => p.fileName === fileName);
          const fileQuestions = allQuestions.filter((q) => q.fileName === fileName);
          return saveExamResult(fileName, filePages, fileQuestions);
        });
        await Promise.all(savePromises);
      } else {
        if (allRawPages.length > 0) {
          setStatus(ProcessingStatus.CROPPING);
          const totalQs = allRawPages.reduce((acc, p) => acc + p.detections.length, 0);
          setCroppingTotal(totalQs);
          setCroppingDone(0);
          setDetailedStatus("Regenerating images...");

          const qs = await generateQuestionsFromRawPages(
            allRawPages,
            cropSettings,
            new AbortController().signal,
            {
              onProgress: () => setCroppingDone((prev: number) => prev + 1),
            },
            batchSize || 10
          );

          setQuestions(qs);

          const savePromises = Array.from(uniqueFiles).map((fileName) => {
            const filePages = allRawPages.filter((p) => p.fileName === fileName);
            const fileQuestions = qs.filter((q) => q.fileName === fileName);
            return saveExamResult(fileName, filePages, fileQuestions);
          });
          await Promise.all(savePromises);
        } else {
          throw new Error("No valid data found in ZIP.");
        }
      }
      await refreshHistoryList();
      const duration = ((Date.now() - startTimeLocal) / 1000).toFixed(1);
      addNotification(null, "success", `ZIP Processed in ${duration}s`);

      // Auto-navigate to first file
      const allFiles = Array.from(new Set(allRawPages.map((p) => p.fileName)));
      if (allFiles.length > 0) {
        allFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
        setters.setDebugFile(allFiles[0]);
        setters.setLastViewedFile(allFiles[0]);
      }

      setStatus(ProcessingStatus.IDLE);
    } catch (err: any) {
      setError("Batch ZIP load failed: " + err.message);
      setStatus(ProcessingStatus.ERROR);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []) as File[];
    if (fileList.length === 0) return;

    const zipFiles = fileList.filter((f) => f.name.toLowerCase().endsWith(".zip"));
    if (zipFiles.length > 0) {
      await processZipFiles(zipFiles.map((f) => ({ blob: f, name: f.name })));
      return;
    }

    const pdfFiles = fileList.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfFiles.length === 0) return;

    abortControllerRef.current = new AbortController();
    stopRequestedRef.current = false;
    const signal = abortControllerRef.current.signal;

    const startTimeLocal = Date.now();
    setStartTime(startTimeLocal);
    setStatus(ProcessingStatus.LOADING_PDF);
    setError(undefined);
    setSourcePages([]);
    setRawPages([]);
    setQuestions([]);
    setCompletedCount(0);
    setCroppingTotal(0);
    setCroppingDone(0);
    setCurrentRound(1);
    setFailedCount(0);
    setters.setProcessingFiles(new Set());

    cropQueueRef.current.clear();
    fileResultsRef.current = {};
    fileCropMetaRef.current = {};

    const filesToProcess: File[] = [];
    const cachedRawPages: DebugPageData[] = [];
    const cachedQuestions: QuestionImage[] = [];

    if (useHistoryCache) {
      setDetailedStatus("Checking history...");
      const historyList = await getHistoryList();
      for (const file of pdfFiles) {
        const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        const historyItem = historyList.find((h) => h.name === fileNameWithoutExt);
        let loadedFromCache = false;
        if (historyItem) {
          try {
            const result = await loadExamResult(historyItem.id);
            if (result && result.rawPages.length > 0) {
              cachedRawPages.push(...result.rawPages);
              if (result.questions && result.questions.length > 0) {
                cachedQuestions.push(...result.questions);
              }
              loadedFromCache = true;
            }
          } catch (err) {
            console.warn(`Failed to load history for ${fileNameWithoutExt}`, err);
          }
        }
        if (!loadedFromCache) filesToProcess.push(file);
      }
    } else {
      filesToProcess.push(...pdfFiles);
    }

    try {
      if (cachedRawPages.length > 0) {
        setDetailedStatus("Restoring cache...");
        const uniqueCached = Array.from(
          new Map(cachedRawPages.map((p) => [`${p.fileName}-${p.pageNumber}`, p])).values()
        );
        setRawPages((prev: any) => [...prev, ...uniqueCached]);

        const recoveredSourcePages = uniqueCached.map((rp) => ({
          dataUrl: rp.dataUrl,
          width: rp.width,
          height: rp.height,
          pageNumber: rp.pageNumber,
          fileName: rp.fileName,
        }));
        setSourcePages((prev: any) => [...prev, ...recoveredSourcePages]);

        let questionsFromCache = cachedQuestions;
        const cachedFiles = new Set(uniqueCached.map((p) => p.fileName));
        const filesWithQs = new Set(cachedQuestions.map((q) => q.fileName));
        const filesNeedingGen = Array.from(cachedFiles).filter((f) => !filesWithQs.has(f));

        if (filesNeedingGen.length > 0) {
          const pagesToGen = uniqueCached.filter((p) => filesNeedingGen.includes(p.fileName));
          const generated = await generateQuestionsFromRawPages(
            pagesToGen,
            cropSettings,
            signal,
            undefined,
            batchSize || 10
          );
          questionsFromCache = [...questionsFromCache, ...generated];
        }

        if (!signal.aborted) {
          setQuestions((prev: any) => {
            const combined = [...prev, ...questionsFromCache];
            return combined.sort((a: any, b: any) => a.fileName.localeCompare(b.fileName));
          });
          setCompletedCount((prev: number) => prev + uniqueCached.length);
        }
      }

      if (filesToProcess.length === 0) {
        setStatus(ProcessingStatus.IDLE);
        const duration = ((Date.now() - startTimeLocal) / 1000).toFixed(1);
        addNotification(null, "success", `Loaded from history in ${duration}s`);
        setDetailedStatus(`Loaded ${cachedRawPages.length} pages from history.`);

        // Auto-navigate to first file in cache
        const cachedFiles = Array.from(new Set(cachedRawPages.map((p) => p.fileName)));
        if (cachedFiles.length > 0) {
          cachedFiles.sort((a, b) =>
            a.localeCompare(b, undefined, {
              numeric: true,
              sensitivity: "base",
            })
          );
          setters.setDebugFile(cachedFiles[0]);
          setters.setLastViewedFile(cachedFiles[0]);
        }

        return;
      }

      const allNewPages: SourcePage[] = [];
      let cumulativeRendered = 0;
      setTotal(cachedRawPages.length + filesToProcess.length * 3);

      for (let fIdx = 0; fIdx < filesToProcess.length; fIdx++) {
        if (signal.aborted || stopRequestedRef.current) break;
        const file = filesToProcess[fIdx];
        const fileName = file.name.replace(/\.[^/.]+$/, "");

        setDetailedStatus(`Rendering: ${file.name}`);

        const loadingTask = pdfjsLib.getDocument({
          data: await file.arrayBuffer(),
        });
        const pdf = await loadingTask.promise;
        cumulativeRendered += pdf.numPages;
        setTotal(cachedRawPages.length + cumulativeRendered + (filesToProcess.length - fIdx - 1) * 3);
        for (let i = 1; i <= pdf.numPages; i++) {
          if (signal.aborted || stopRequestedRef.current) break;
          const page = await pdf.getPage(i);
          const rendered = await renderPageToImage(page, 3);
          const sourcePage = { ...rendered, pageNumber: i, fileName };
          allNewPages.push(sourcePage);
          setSourcePages((prev: any) => [...prev, sourcePage]);
        }
      }

      setTotal(cachedRawPages.length + allNewPages.length);
      setProgress(cachedRawPages.length);

      if (allNewPages.length > 0 && !stopRequestedRef.current && !signal.aborted) {
        setStatus(ProcessingStatus.DETECTING_QUESTIONS);
        const detectionMeta: Record<string, { totalPages: number; processedPages: number }> = {};
        allNewPages.forEach((p) => {
          if (!detectionMeta[p.fileName]) {
            detectionMeta[p.fileName] = {
              totalPages: allNewPages.filter((x) => x.fileName === p.fileName).length,
              processedPages: 0,
            };
          }
        });

        let queue = [...allNewPages];
        let round = 1;
        while (queue.length > 0) {
          if (stopRequestedRef.current || signal.aborted) break;
          setCurrentRound(round);
          setDetailedStatus(round === 1 ? `Analyzing pages...` : `Round ${round}: Retrying...`);
          const nextRoundQueue: SourcePage[] = [];
          const executing = new Set<Promise<void>>();
          for (const pageData of queue) {
            if (stopRequestedRef.current || signal.aborted) break;
            const task = (async () => {
              try {
                // 发起检测请求（传递 signal 以便可以中断）
                const detections = await detectQuestionsViaProxy(
                  pageData.dataUrl,
                  selectedModel,
                  undefined,
                  apiKey,
                  signal
                );

                // 请求完成后，检查停止标志，如果已停止则不更新状态
                if (stopRequestedRef.current || signal.aborted) return;

                const resultPage: DebugPageData = {
                  pageNumber: pageData.pageNumber,
                  fileName: pageData.fileName,
                  dataUrl: pageData.dataUrl,
                  width: pageData.width,
                  height: pageData.height,
                  detections,
                };
                setRawPages((prev: any) => [...prev, resultPage]);
                setCompletedCount((prev: number) => prev + 1);
                setCroppingTotal((prev: number) => prev + detections.length);
                if (detectionMeta[pageData.fileName]) {
                  detectionMeta[pageData.fileName].processedPages++;
                  const dMeta = detectionMeta[pageData.fileName];
                  if (dMeta.processedPages === dMeta.totalPages) {
                    setRawPages((currentRaw: any) => {
                      const filePages = currentRaw.filter((p: any) => p.fileName === pageData.fileName);
                      filePages.sort((a: any, b: any) => a.pageNumber - b.pageNumber);
                      const logicalQs = createLogicalQuestions(filePages);
                      fileCropMetaRef.current[pageData.fileName] = {
                        totalQs: logicalQs.length,
                        processedQs: 0,
                        saved: false,
                      };
                      fileResultsRef.current[pageData.fileName] = [];
                      logicalQs.forEach((lq) => {
                        // 在入队前检查停止标志
                        if (stopRequestedRef.current) return;

                        cropQueueRef.current.enqueue(async () => {
                          // 在开始处理前再次检查停止标志
                          if (stopRequestedRef.current || signal.aborted) return;

                          // 发起处理请求（即使之后停止标志被设置，这个请求也会继续完成）
                          const result = await processLogicalQuestion(lq, cropSettings);

                          // 请求完成后，再次检查停止标志
                          if (stopRequestedRef.current || signal.aborted) return;

                          if (result) {
                            setQuestions((prevQ: any) => {
                              const next = [...prevQ, result];
                              return next.sort((a: any, b: any) => {
                                if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
                                return (parseFloat(a.id) || 0) - (parseFloat(b.id) || 0);
                              });
                            });
                            setCroppingDone((p: number) => p + 1);
                            const fMeta = fileCropMetaRef.current[pageData.fileName];
                            const fRes = fileResultsRef.current[pageData.fileName];
                            if (fMeta && fRes) {
                              fRes.push(result);
                              fMeta.processedQs++;
                              if (fMeta.processedQs >= fMeta.totalQs && !fMeta.saved) {
                                fMeta.saved = true;
                                saveExamResult(pageData.fileName, filePages, fRes).then(() => refreshHistoryList());
                              }
                            }
                          }
                        });
                      });
                      return currentRaw;
                    });
                  }
                }
              } catch (err: any) {
                // 如果已停止，不再重试
                if (stopRequestedRef.current || signal.aborted) return;
                nextRoundQueue.push(pageData);
                setFailedCount((prev: number) => prev + 1);
              }
            })();
            executing.add(task);
            task.then(() => executing.delete(task));
            if (executing.size >= concurrency) await Promise.race(executing);
          }
          await Promise.all(executing);
          if (nextRoundQueue.length > 0 && !stopRequestedRef.current && !signal.aborted) {
            queue = nextRoundQueue;
            round++;
            await new Promise((r) => setTimeout(r, 1000));
          } else queue = [];
        }
      }

      if (stopRequestedRef.current) {
        setStatus(ProcessingStatus.STOPPED);
      } else {
        if (cropQueueRef.current.size > 0) {
          setStatus(ProcessingStatus.CROPPING);
          setDetailedStatus("Finalizing crops...");
          await cropQueueRef.current.onIdle();
        }
        const duration = ((Date.now() - startTimeLocal) / 1000).toFixed(1);
        addNotification(null, "success", `Processed ${allNewPages.length} pages in ${duration}s`);

        // Auto-navigate to first file (merged cache + new)
        const allProcessedFiles = new Set<string>();
        cachedRawPages.forEach((p: any) => allProcessedFiles.add(p.fileName));
        allNewPages.forEach((p) => allProcessedFiles.add(p.fileName));

        const sortedFiles = Array.from(allProcessedFiles).sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
        );

        if (sortedFiles.length > 0) {
          setters.setDebugFile(sortedFiles[0]);
          setters.setLastViewedFile(sortedFiles[0]);
        }

        setStatus(ProcessingStatus.IDLE);
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        setStatus(ProcessingStatus.STOPPED);
        return;
      }
      setError(err.message || "Processing failed.");
      setStatus(ProcessingStatus.ERROR);
    }
  };

  return { processZipFiles, handleFileChange };
};
