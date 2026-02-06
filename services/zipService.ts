import JSZip from "jszip";
import { imageRefToBlob } from "./imageRef";
import { QuestionImage, DebugPageData } from "../types";

interface ZipOptions {
  fileName: string;
  questions: QuestionImage[];
  rawPages: DebugPageData[];
  onProgress?: (msg: string) => void;
}

export const generateExamZip = async ({
  fileName,
  questions,
  rawPages,
  onProgress,
}: ZipOptions): Promise<Blob | null> => {
  const fileQs = questions.filter((q) => q.fileName === fileName);
  if (fileQs.length === 0) return null;
  const fileRawPages = rawPages.filter((p) => p.fileName === fileName);

  if (onProgress) onProgress("Initializing...");

  const zip = new JSZip();
  const folder = zip.folder(fileName);
  if (!folder) return null;

  const lightweightRawPages = fileRawPages.map(({ dataUrl, ...rest }) => rest);
  folder.file("analysis_data.json", JSON.stringify(lightweightRawPages, null, 2));

  // Add Analysis JSON if present
  const analysisData = fileQs
    .map((q) => ({
      id: q.id,
      analysis: q.analysis,
    }))
    .filter((q) => q.analysis);
  if (analysisData.length > 0) {
    folder.file("math_analysis.json", JSON.stringify(analysisData, null, 2));
  }

  const fullPagesFolder = folder.folder("full_pages");
  if (fullPagesFolder) {
    for (const page of fileRawPages) {
      const blob = await imageRefToBlob(page.dataUrl);
      fullPagesFolder.file(`Page_${page.pageNumber}.jpg`, blob, {
        compression: "STORE",
      });
    }
  }

  const usedNames = new Set<string>();
  let processedCount = 0;
  const totalFiles = fileQs.length + (fileRawPages.length || 0); // Approximation

  for (const q of fileQs) {
    let finalName = `${q.fileName}_Q${q.id}.jpg`;
    if (usedNames.has(finalName)) {
      let counter = 1;
      const baseName = `${q.fileName}_Q${q.id}`;
      while (usedNames.has(`${baseName}_${counter}.jpg`)) counter++;
      finalName = `${baseName}_${counter}.jpg`;
    }
    usedNames.add(finalName);
    const blob = await imageRefToBlob(q.dataUrl);
    folder.file(finalName, blob, {
      compression: "STORE",
    });

    processedCount++;
    if (onProgress) onProgress(`Packing ${processedCount}/${fileQs.length}`);
    // Yield to UI thread
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (onProgress) onProgress("Compressing 0%");

  const content = await zip.generateAsync(
    {
      type: "blob",
      compression: "STORE",
    },
    (metadata) => {
      if (onProgress) onProgress(`Compressing ${metadata.percent.toFixed(0)}%`);
    },
  );

  return content;
};
