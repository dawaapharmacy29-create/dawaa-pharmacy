/**
 * invoiceCache.ts
 * SessionStorage cache for sales invoice data with TTL.
 * Gives near-instant dashboard loads on repeat visits within the same tab.
 */

const CACHE_VERSION = "v2";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  data: T;
  ts: number;
  version: string;
}

export function cacheGet<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (entry.version !== CACHE_VERSION) {
      sessionStorage.removeItem(key);
      return null;
    }
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, ts: Date.now(), version: CACHE_VERSION };
    sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // sessionStorage full or unavailable — silently skip
  }
}

export function invoiceCacheKey(startDate: string, endDate: string, branch: string): string {
  const b = String(branch || "all").replace(/\s+/g, "_").slice(0, 30);
  return `dawaa_inv_${startDate}_${endDate}_${b}_${CACHE_VERSION}`;
}

/** Call this before a forced refresh so stale cache is not served. */
export function clearInvoiceCache(): void {
  try {
    const keys = Object.keys(sessionStorage).filter((k) => k.startsWith("dawaa_inv_"));
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore
  }
}
