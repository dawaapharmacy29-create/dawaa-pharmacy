/* eslint-disable no-empty */
/**
 * invoiceCache.ts
 * Cache for sales invoice data with TTL.
 *
 * IMPROVEMENT v3:
 *  - TTL raised from 5 min → 30 min (invoice data rarely changes mid-session)
 *  - Uses localStorage (persistent across tabs) with sessionStorage fallback
 *  - localStorage gives near-instant loads even after page refresh
 */

const CACHE_VERSION = 'v3';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes (was 5 minutes)

interface CacheEntry<T> {
  data: T;
  ts: number;
  version: string;
}

function getStorage(): Storage | null {
  try {
    // Prefer localStorage (persists across tabs + refreshes)
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {}
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch {}
  return null;
}

export function cacheGet<T>(key: string): T | null {
  try {
    const storage = getStorage();
    if (!storage) return null;
    const raw = storage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (entry.version !== CACHE_VERSION) {
      storage.removeItem(key);
      return null;
    }
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      storage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, data: T): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    const entry: CacheEntry<T> = { data, ts: Date.now(), version: CACHE_VERSION };
    storage.setItem(key, JSON.stringify(entry));
  } catch {
    // Storage full or unavailable — silently skip
    // Try clearing old dawaa invoice keys first, then retry
    try {
      clearInvoiceCache();
      const storage = getStorage();
      if (!storage) return;
      const entry: CacheEntry<T> = { data, ts: Date.now(), version: CACHE_VERSION };
      storage.setItem(key, JSON.stringify(entry));
    } catch {
      // Give up silently
    }
  }
}

export function invoiceCacheKey(startDate: string, endDate: string, branch: string): string {
  const b = String(branch || 'all')
    .replace(/\s+/g, '_')
    .slice(0, 30);
  return `dawaa_inv_${startDate}_${endDate}_${b}_${CACHE_VERSION}`;
}

/** Call this before a forced refresh so stale cache is not served. */
export function clearInvoiceCache(): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    const keys = Object.keys(storage).filter((k) => k.startsWith('dawaa_inv_'));
    keys.forEach((k) => storage.removeItem(k));
  } catch {
    // ignore
  }
}
