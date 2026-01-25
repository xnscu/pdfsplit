import {
  DebugPageData,
  HistoryMetadata,
  DetectedQuestion,
  QuestionImage,
  ExamRecord,
} from "../types";

const DB_NAME = "MathSplitterDB";
const STORE_NAME = "exams";
// Removing explicit DB_VERSION constant to avoid VersionError on rollback

/**
 * Open (and initialize) the IndexedDB
 * Modified to be version-agnostic to handle code rollbacks gracefully.
 */
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    // FIX: Do not pass a version number.
    // If DB exists (e.g. v4), it opens v4. If it doesn't, it creates v1.
    // This prevents "VersionError: requested version (1) is less than existing (4)".
    const request = indexedDB.open(DB_NAME);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Safety Fallback: If DB exists (so onupgradeneeded didn't run) but STORE_NAME is missing,
      // we must force an upgrade to create it. This handles rare edge cases.
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const currentVersion = db.version;
        db.close();
        const upgradeRequest = indexedDB.open(DB_NAME, currentVersion + 1);

        upgradeRequest.onupgradeneeded = (e) => {
          const upgradedDb = (e.target as IDBOpenDBRequest).result;
          if (!upgradedDb.objectStoreNames.contains(STORE_NAME)) {
            upgradedDb.createObjectStore(STORE_NAME, { keyPath: "id" });
          }
        };

        upgradeRequest.onsuccess = (e) =>
          resolve((e.target as IDBOpenDBRequest).result);
        upgradeRequest.onerror = (e) =>
          reject((e.target as IDBOpenDBRequest).error);
        return;
      }

      resolve(db);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
};

/**
 * Save an exam result to history
 * NOW SUPPORTS SAVING PROCESSED QUESTIONS
 * 
 * @param fileName - The name of the exam file
 * @param rawPages - The raw page data
 * @param questions - The question images
 * @param preserveId - Optional: Preserve this specific ID (used for sync from remote to maintain ID consistency)
 */
export const saveExamResult = async (
  fileName: string,
  rawPages: DebugPageData[],
  questions: QuestionImage[] = [],
  preserveId?: string,
): Promise<string> => {
  const db = await openDB();

  // Determine the ID to use:
  // 1. If preserveId is provided (from remote sync), use it to maintain ID consistency across devices
  // 2. Otherwise, try to find existing record by name to update it
  // 3. If not found, generate a new UUID
  let id: string;
  if (preserveId) {
    id = preserveId;
  } else {
    const list = await getHistoryList();
    const existing = list.find((h) => h.name === fileName);
    id = existing ? existing.id : crypto.randomUUID();
  }
  const timestamp = Date.now();

  // Safety: Deduplicate pages by pageNumber before saving to prevent DB corruption
  const uniquePages = Array.from(
    new Map(rawPages.map((item) => [item.pageNumber, item])).values(),
  );
  uniquePages.sort((a, b) => a.pageNumber - b.pageNumber);

  const record: ExamRecord = {
    id,
    name: fileName,
    timestamp,
    pageCount: uniquePages.length,
    rawPages: uniquePages, // This includes the heavy Base64 images
    questions: questions, // Store the cut images
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);

    request.onsuccess = () => resolve(id);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Updates an existing exam result if it exists (by name), otherwise saves a new one.
 * Used for re-analysis. Updates both raw pages and result questions.
 */
export const reSaveExamResult = async (
  fileName: string,
  rawPages: DebugPageData[],
  questions?: QuestionImage[],
): Promise<void> => {
  const list = await getHistoryList();
  const targetItem = list.find((h) => h.name === fileName);

  if (!targetItem) {
    await saveExamResult(fileName, rawPages, questions || []);
    return;
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const getReq = store.get(targetItem.id);

    getReq.onsuccess = () => {
      const record = getReq.result as ExamRecord;
      if (record) {
        // Dedup pages
        const uniquePages = Array.from(
          new Map(rawPages.map((item) => [item.pageNumber, item])).values(),
        );
        uniquePages.sort((a, b) => a.pageNumber - b.pageNumber);

        record.rawPages = uniquePages;
        record.pageCount = uniquePages.length;
        record.timestamp = Date.now();

        // Update questions if provided.
        if (questions !== undefined) {
          record.questions = questions;
        }

        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      } else {
        saveExamResult(fileName, rawPages, questions)
          .then(() => resolve())
          .catch(reject);
      }
    };
    getReq.onerror = () => reject(getReq.error);
  });
};

/**
 * Update detections for a specific page AND update the question images for that file.
 * Used for manual refinement/calibration.
 */
export const updatePageDetectionsAndQuestions = async (
  fileName: string,
  pageNumber: number,
  newDetections: DetectedQuestion[],
  newFileQuestions: QuestionImage[],
): Promise<void> => {
  const list = await getHistoryList();
  const targetItem = list.find((h) => h.name === fileName);

  if (!targetItem) {
    console.warn("Could not find history record to update for", fileName);
    return;
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    // Get full record
    const getReq = store.get(targetItem.id);

    getReq.onsuccess = () => {
      const record = getReq.result as ExamRecord;
      if (!record || !record.rawPages) {
        resolve();
        return;
      }

      // 1. Update the specific page detections
      const pageIndex = record.rawPages.findIndex(
        (p: DebugPageData) => p.pageNumber === pageNumber,
      );
      if (pageIndex !== -1) {
        record.rawPages[pageIndex].detections = newDetections;
      }

      // 2. Update the stored questions for this file (Replacing old ones for this file)
      record.questions = newFileQuestions;

      // Save back
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
};

/**
 * Efficiently update ONLY the questions list for a specific file name.
 * Used for real-time analysis saving.
 */
export const updateQuestionsForFile = async (
  fileName: string,
  questions: QuestionImage[],
): Promise<void> => {
  const list = await getHistoryList();
  const targetItem = list.find((h) => h.name === fileName);

  if (!targetItem) {
    return;
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    const getReq = store.get(targetItem.id);

    getReq.onsuccess = () => {
      const record = getReq.result as ExamRecord;
      if (record) {
        record.questions = questions;
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      } else {
        resolve();
      }
    };
    getReq.onerror = () => reject(getReq.error);
  });
};

// Legacy support alias
export const updatePageDetections = async (
  fileName: string,
  pageNumber: number,
  newDetections: DetectedQuestion[],
) => {
  return updatePageDetectionsAndQuestions(
    fileName,
    pageNumber,
    newDetections,
    [],
  );
};

/**
 * Update ONLY questions for a specific exam ID.
 * Used for the "Sync Legacy" feature.
 */
export const updateExamQuestionsOnly = async (
  id: string,
  questions: QuestionImage[],
): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const record = getReq.result as ExamRecord;
      if (record) {
        record.questions = questions;
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      } else {
        resolve(); // Or reject if strict
      }
    };
    getReq.onerror = () => reject(getReq.error);
  });
};

/**
 * Get a list of all history items (Metadata only, no images) to display in the list
 */
export const getHistoryList = async (): Promise<HistoryMetadata[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);

    const request = store.openCursor();
    const results: HistoryMetadata[] = [];

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        // Destructure ONLY metadata to avoid loading heavy image arrays into memory
        const { id, name, timestamp, pageCount } = cursor.value;
        results.push({ id, name, timestamp, pageCount });
        cursor.continue();
      } else {
        // Sort by newest first
        resolve(results.sort((a, b) => b.timestamp - a.timestamp));
      }
    };
    request.onerror = () => reject(request.error);
  });
};

/**
 * Load full data for a specific history item
 */
export const loadExamResult = async (
  id: string,
): Promise<ExamRecord | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result as ExamRecord);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
};

/**
 * Delete a history item
 */
export const deleteExamResult = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Delete multiple history items
 */
export const deleteExamResults = async (ids: string[]): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    ids.forEach((id) => {
      store.delete(id);
    });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

/**
 * Clean up a history item by removing duplicate pages.
 * Returns the number of duplicates removed.
 */
export const cleanupHistoryItem = async (id: string): Promise<number> => {
  const db = await openDB();

  // 1. Get the record
  const record: ExamRecord = await new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  if (!record || !record.rawPages) return 0;

  // 2. De-duplicate based on pageNumber
  const originalCount = record.rawPages.length;
  const uniqueMap = new Map();

  record.rawPages.forEach((p: DebugPageData) => {
    if (!uniqueMap.has(p.pageNumber)) {
      uniqueMap.set(p.pageNumber, p);
    } else {
      // If we have a duplicate, we can optionally keep the one with more detections
      // But usually, they are identical. Keep first for stability.
      const existing = uniqueMap.get(p.pageNumber);
      if (p.detections.length > existing.detections.length) {
        uniqueMap.set(p.pageNumber, p);
      }
    }
  });

  const uniquePages = Array.from(uniqueMap.values());
  uniquePages.sort((a: any, b: any) => a.pageNumber - b.pageNumber);

  // If no change, exit
  if (uniquePages.length === originalCount) return 0;

  // 3. Update the record
  record.rawPages = uniquePages;
  record.pageCount = uniquePages.length;

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  return originalCount - uniquePages.length;
};

/**
 * Iterates through ALL history items and removes duplicates.
 * Returns total pages removed across all exams.
 */
export const cleanupAllHistory = async (): Promise<number> => {
  const list = await getHistoryList();
  let totalRemoved = 0;

  // We process sequentially to avoid jamming the DB transaction if the files are huge
  for (const item of list) {
    try {
      const removed = await cleanupHistoryItem(item.id);
      if (removed > 0) {
        console.log(`Cleaned ${removed} duplicates from ${item.name}`);
      }
      totalRemoved += removed;
    } catch (e) {
      console.error(`Failed to cleanup ${item.name}`, e);
    }
  }
  return totalRemoved;
};
