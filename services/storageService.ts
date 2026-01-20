
import { DebugPageData, HistoryMetadata, DetectedQuestion } from "../types";

const DB_NAME = "MathSplitterDB";
const STORE_NAME = "exams";
const DB_VERSION = 1;

/**
 * Open (and initialize) the IndexedDB
 */
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
};

/**
 * Save an exam result to history
 */
export const saveExamResult = async (fileName: string, rawPages: DebugPageData[]): Promise<string> => {
  const db = await openDB();
  const id = crypto.randomUUID();
  const timestamp = Date.now();

  // Safety: Deduplicate pages by pageNumber before saving to prevent DB corruption
  const uniquePages = Array.from(new Map(rawPages.map(item => [item.pageNumber, item])).values());
  uniquePages.sort((a, b) => a.pageNumber - b.pageNumber);

  const record = {
    id,
    name: fileName,
    timestamp,
    pageCount: uniquePages.length,
    rawPages: uniquePages // This includes the heavy Base64 images
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
 * Used for re-analysis.
 */
export const reSaveExamResult = async (fileName: string, rawPages: DebugPageData[]): Promise<void> => {
  const list = await getHistoryList();
  const targetItem = list.find(h => h.name === fileName);

  if (!targetItem) {
    await saveExamResult(fileName, rawPages);
    return;
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const getReq = store.get(targetItem.id);

    getReq.onsuccess = () => {
      const record = getReq.result;
      if (record) {
        // Dedup pages
        const uniquePages = Array.from(new Map(rawPages.map(item => [item.pageNumber, item])).values());
        uniquePages.sort((a, b) => a.pageNumber - b.pageNumber);

        record.rawPages = uniquePages;
        record.pageCount = uniquePages.length;
        record.timestamp = Date.now();

        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      } else {
        saveExamResult(fileName, rawPages).then(() => resolve()).catch(reject);
      }
    };
    getReq.onerror = () => reject(getReq.error);
  });
};

/**
 * Update detections for a specific page in an existing exam record.
 * Used for manual refinement/calibration.
 */
export const updatePageDetections = async (fileName: string, pageNumber: number, newDetections: DetectedQuestion[]): Promise<void> => {
  const db = await openDB();
  
  // 1. Find the record by name (we have to search, as we might not have the UUID handy in all contexts, 
  // or we scan the most recent one matching fileName. Ideally we pass UUID, but fileName is the app's primary key logic currently)
  
  // Get all metadata to find the ID
  const list = await getHistoryList();
  const targetItem = list.find(h => h.name === fileName); // Assuming unique filenames for active session
  
  if (!targetItem) {
     console.warn("Could not find history record to update for", fileName);
     return;
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    
    // Get full record
    const getReq = store.get(targetItem.id);
    
    getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record || !record.rawPages) {
            resolve();
            return;
        }

        // Update the specific page
        const pageIndex = record.rawPages.findIndex((p: DebugPageData) => p.pageNumber === pageNumber);
        if (pageIndex !== -1) {
            record.rawPages[pageIndex].detections = newDetections;
            
            // Save back
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

/**
 * Get a list of all history items (Metadata only, no images) to display in the list
 */
export const getHistoryList = async (): Promise<HistoryMetadata[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    // getting all is fine for metadata because we will strip heavy data before returning,
    // but cleaner is to use a cursor. For simplicity in this app, getAll is usually okay unless 100s of items.
    // However, store contains heavy images. Using cursor is safer to avoid loading all images into memory.
    
    const request = store.openCursor();
    const results: HistoryMetadata[] = [];

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
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
export const loadExamResult = async (id: string): Promise<{ rawPages: DebugPageData[], name: string } | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      if (request.result) {
        resolve({
          rawPages: request.result.rawPages,
          name: request.result.name
        });
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

    ids.forEach(id => {
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
  const record: any = await new Promise((resolve, reject) => {
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
