
import { DebugPageData, HistoryMetadata } from "../types";

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

  const record = {
    id,
    name: fileName,
    timestamp,
    pageCount: rawPages.length,
    rawPages // This includes the heavy Base64 images
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
