/**
 * Sync History Service
 * Manages sync history records stored in IndexedDB
 * Records each sync session with time, action type, and file names
 */

export interface SyncHistoryRecord {
  id: string;
  syncTime: number;
  actionType: "push" | "pull" | "full_sync";
  fileNames: string[];
  fileCount: number;
  success: boolean;
  errorMessage?: string;
}

const DB_NAME = "MathSplitterDB";
const SYNC_HISTORY_STORE = "sync_history";
const MAX_RECORDS = 1000; // Keep last 1000 records

/**
 * Open IndexedDB and ensure sync_history store exists
 */
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SYNC_HISTORY_STORE)) {
        const store = db.createObjectStore(SYNC_HISTORY_STORE, { keyPath: "id" });
        store.createIndex("syncTime", "syncTime", { unique: false });
      }
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Ensure store exists
      if (!db.objectStoreNames.contains(SYNC_HISTORY_STORE)) {
        const currentVersion = db.version;
        db.close();
        const upgradeRequest = indexedDB.open(DB_NAME, currentVersion + 1);

        upgradeRequest.onupgradeneeded = (e) => {
          const upgradedDb = (e.target as IDBOpenDBRequest).result;
          if (!upgradedDb.objectStoreNames.contains(SYNC_HISTORY_STORE)) {
            const store = upgradedDb.createObjectStore(SYNC_HISTORY_STORE, { keyPath: "id" });
            store.createIndex("syncTime", "syncTime", { unique: false });
          }
        };

        upgradeRequest.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
        upgradeRequest.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
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
 * Save a sync history record
 */
export const saveSyncHistory = async (
  actionType: "push" | "pull" | "full_sync",
  fileNames: string[],
  success: boolean,
  errorMessage?: string
): Promise<void> => {
  // Filter out any empty or invalid file names
  const validFileNames = fileNames ? fileNames.filter((f) => f && f.trim().length > 0) : [];

  // Don't create history record if no files are involved AND it was successful
  // We still want to record failures even if no files were transferred
  if (validFileNames.length === 0 && success) {
    return;
  }

  const db = await openDB();

  const record: SyncHistoryRecord = {
    id: crypto.randomUUID(),
    syncTime: Date.now(),
    actionType,
    fileNames: validFileNames,
    fileCount: validFileNames.length,
    success,
    errorMessage,
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SYNC_HISTORY_STORE], "readwrite");
    const store = transaction.objectStore(SYNC_HISTORY_STORE);
    const request = store.add(record);

    request.onsuccess = async () => {
      // Clean up old records if we exceed MAX_RECORDS
      await cleanupOldRecords(db);
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
};

/**
 * Get sync history records, sorted by time (newest first)
 */
export const getSyncHistory = async (limit?: number): Promise<SyncHistoryRecord[]> => {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SYNC_HISTORY_STORE], "readonly");
    const store = transaction.objectStore(SYNC_HISTORY_STORE);
    const index = store.index("syncTime");
    const request = index.openCursor(null, "prev"); // prev = descending order

    const results: SyncHistoryRecord[] = [];
    let count = 0;
    const maxCount = limit || MAX_RECORDS;

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor && count < maxCount) {
        results.push(cursor.value as SyncHistoryRecord);
        count++;
        cursor.continue();
      } else {
        resolve(results);
      }
    };

    request.onerror = () => reject(request.error);
  });
};

/**
 * Clear all sync history records
 */
export const clearSyncHistory = async (): Promise<void> => {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SYNC_HISTORY_STORE], "readwrite");
    const store = transaction.objectStore(SYNC_HISTORY_STORE);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Clean up old records to keep only the most recent MAX_RECORDS
 */
const cleanupOldRecords = async (db: IDBDatabase): Promise<void> => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SYNC_HISTORY_STORE], "readwrite");
    const store = transaction.objectStore(SYNC_HISTORY_STORE);
    const index = store.index("syncTime");
    const request = index.openCursor(null, "prev");

    const allKeys: string[] = [];
    let count = 0;

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        allKeys.push(cursor.value.id);
        count++;
        if (count > MAX_RECORDS) {
          // Delete old records
          const deleteTransaction = db.transaction([SYNC_HISTORY_STORE], "readwrite");
          const deleteStore = deleteTransaction.objectStore(SYNC_HISTORY_STORE);
          for (let i = MAX_RECORDS; i < allKeys.length; i++) {
            deleteStore.delete(allKeys[i]);
          }
          resolve();
        } else {
          cursor.continue();
        }
      } else {
        resolve();
      }
    };

    request.onerror = () => reject(request.error);
  });
};
