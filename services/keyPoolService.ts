/**
 * Key Pool Service
 * Manages multiple API keys with round-robin selection and statistics tracking
 */

export interface KeyStats {
  key: string;
  maskedKey: string; // For display purposes (e.g., "AIza...xyz")
  callCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
}

export interface KeyPool {
  keys: string[];
  currentIndex: number;
  stats: Map<string, KeyStats>;
}

// Global key pool instance
let keyPool: KeyPool = {
  keys: [],
  currentIndex: 0,
  stats: new Map(),
};

// Listeners for stats updates
type StatsListener = (stats: KeyStats[]) => void;
const statsListeners: Set<StatsListener> = new Set();

/**
 * Mask a key for display (show first 4 and last 4 chars)
 */
const maskKey = (key: string): string => {
  if (key.length <= 12) return key.substring(0, 4) + "..." + key.slice(-4);
  return key.substring(0, 4) + "..." + key.slice(-4);
};

/**
 * Initialize the key pool from a multiline string
 */
export const initKeyPool = (keysText: string): void => {
  const keys = keysText
    .split("\n")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  // Preserve existing stats for keys that are still in the pool
  const newStats = new Map<string, KeyStats>();

  for (const key of keys) {
    if (keyPool.stats.has(key)) {
      newStats.set(key, keyPool.stats.get(key)!);
    } else {
      newStats.set(key, {
        key,
        maskedKey: maskKey(key),
        callCount: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
      });
    }
  }

  keyPool = {
    keys,
    currentIndex: 0,
    stats: newStats,
  };

  notifyListeners();
};

/**
 * Get the next key in round-robin fashion
 * Returns null if no keys are available
 */
export const getNextKey = (): string | null => {
  if (keyPool.keys.length === 0) return null;

  const key = keyPool.keys[keyPool.currentIndex];
  keyPool.currentIndex = (keyPool.currentIndex + 1) % keyPool.keys.length;
  return key;
};

/**
 * Get a specific key by index
 */
export const getKeyByIndex = (index: number): string | null => {
  if (index < 0 || index >= keyPool.keys.length) return null;
  return keyPool.keys[index];
};

/**
 * Get the total number of keys in the pool
 */
export const getKeyCount = (): number => {
  return keyPool.keys.length;
};

/**
 * Record a call attempt for a key
 */
export const recordCall = (key: string): void => {
  const stats = keyPool.stats.get(key);
  if (stats) {
    stats.callCount++;
    notifyListeners();
  }
};

/**
 * Record a successful call for a key
 */
export const recordSuccess = (key: string): void => {
  const stats = keyPool.stats.get(key);
  if (stats) {
    stats.successCount++;
    stats.successRate = (stats.successCount / stats.callCount) * 100;
    notifyListeners();
  }
};

/**
 * Record a failed call for a key
 */
export const recordFailure = (key: string): void => {
  const stats = keyPool.stats.get(key);
  if (stats) {
    stats.failureCount++;
    stats.successRate = (stats.successCount / stats.callCount) * 100;
    notifyListeners();
  }
};

/**
 * Get all key statistics
 */
export const getAllStats = (): KeyStats[] => {
  return Array.from(keyPool.stats.values());
};

/**
 * Reset all statistics
 */
export const resetStats = (): void => {
  for (const stats of keyPool.stats.values()) {
    stats.callCount = 0;
    stats.successCount = 0;
    stats.failureCount = 0;
    stats.successRate = 0;
  }
  notifyListeners();
};

/**
 * Subscribe to stats updates
 */
export const subscribeToStats = (listener: StatsListener): (() => void) => {
  statsListeners.add(listener);
  // Immediately call with current stats
  listener(getAllStats());
  // Return unsubscribe function
  return () => statsListeners.delete(listener);
};

/**
 * Notify all listeners of stats changes
 */
const notifyListeners = (): void => {
  const stats = getAllStats();
  for (const listener of statsListeners) {
    listener(stats);
  }
};

/**
 * Check if the key pool is empty
 */
export const isKeyPoolEmpty = (): boolean => {
  return keyPool.keys.length === 0;
};
