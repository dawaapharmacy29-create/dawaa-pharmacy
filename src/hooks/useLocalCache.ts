import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Persistent local cache using IndexedDB for large datasets.
 * Falls back to memory cache if IndexedDB unavailable.
 * TTL-aware: auto-clears expired entries.
 */

const DB_NAME = 'dawaa-cache';
const DB_VERSION = 1;
const STORE_NAME = 'cache-entries';

interface CacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
  ttlMs?: number; // 0 = no expiry
}

const inMemoryCache = new Map<string, { value: unknown; timestamp: number; ttlMs?: number }>();

function getDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function setCacheEntry<T>(key: string, value: T, ttlMs = 0): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const entry: CacheEntry<T> = {
      key,
      value,
      timestamp: Date.now(),
      ttlMs,
    };
    await new Promise<void>((resolve, reject) => {
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.warn('[useLocalCache] Failed to set cache entry:', error);
    inMemoryCache.set(key, { value, timestamp: Date.now(), ttlMs });
  }
}

async function getCacheEntry<T>(key: string): Promise<T | null> {
  try {
    const db = await getDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const entry = req.result as CacheEntry<T> | undefined;
        if (!entry) {
          resolve(null);
          return;
        }
        // Check TTL
        if (entry.ttlMs && Date.now() - entry.timestamp > entry.ttlMs) {
          // Expired - remove it
          const delTx = db.transaction(STORE_NAME, 'readwrite');
          delTx.objectStore(STORE_NAME).delete(key);
          resolve(null);
        } else {
          resolve(entry.value);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (error) {
    console.warn('[useLocalCache] Failed to get cache entry:', error);
    const entry = inMemoryCache.get(key);
    if (!entry) return null;
    const expired = entry.ttlMs && Date.now() - entry.timestamp > entry.ttlMs;
    if (expired) {
      inMemoryCache.delete(key);
      return null;
    }
    return entry.value as T;
  }
}

async function clearCacheEntry(key: string): Promise<void> {
  inMemoryCache.delete(key);
  try {
    const db = await getDb();
    return new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (error) {
    console.warn('[useLocalCache] Failed to clear cache entry:', error);
  }
}

export function useLocalCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: {
    ttlMs?: number; // Time-to-live in milliseconds (0 = no expiry)
    skipStore?: boolean; // Skip storage (memory only)
  }
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const ttlMs = options?.ttlMs ?? 0;
  const skipStore = options?.skipStore ?? false;

  const load = useCallback(
    async (forceRefresh = false) => {
      const cached = !forceRefresh && (await getCacheEntry<T>(key));
      if (cached !== null) {
        setData(cached);
        setError(null);
        return;
      }

      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setLoading(true);
      setError(null);

      try {
        const result = await fetcher();
        if (abortRef.current?.signal.aborted) return;

        setData(result);
        if (!skipStore) {
          await setCacheEntry(key, result, ttlMs);
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          const error = err instanceof Error ? err : new Error(String(err));
          setError(error);
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    },
    [key, fetcher, skipStore, ttlMs]
  );

  useEffect(() => {
    void load(false);
    return () => abortRef.current?.abort();
  }, [load]);

  return {
    data,
    loading,
    error,
    refetch: () => load(true),
    clear: () => {
      setData(null);
      setError(null);
      return clearCacheEntry(key);
    },
  };
}
