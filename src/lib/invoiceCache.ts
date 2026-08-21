/* eslint-disable no-empty */
/**
 * invoiceCache.ts
 * Shared cache for sales invoice data with explicit freshness policies.
 *
 * Stability phase 1:
 *  - Live/current-period invoice data must stay fresh (60 seconds).
 *  - Historical invoice data may use a longer cache (30 minutes).
 *  - The default cache lifetime is conservative (5 minutes).
 *  - Cache version bumped to invalidate older 30-minute snapshots.
 */

const CACHE_VERSION = 'v4';
export const LIVE_INVOICE_CACHE_TTL_MS = 60 * 1000;
export const DEFAULT_INVOICE_CACHE_TTL_MS = 5 * 60 * 1000;
export const HISTORICAL_INVOICE_CACHE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  ts: number;
  version: string;
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {}
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch {}
  return null;
}

export function cacheGet<T>(
  key: string,
  maxAgeMs = DEFAULT_INVOICE_CACHE_TTL_MS,
): T | null {
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
    if (!Number.isFinite(entry.ts) || Date.now() - entry.ts > maxAgeMs) {
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
    try {
      clearInvoiceCache();
      const storage = getStorage();
      if (!storage) return;
      const entry: CacheEntry<T> = { data, ts: Date.now(), version: CACHE_VERSION };
      storage.setItem(key, JSON.stringify(entry));
    } catch {
      // Storage is optional. Network/database remains the source of truth.
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
    const keys = Object.keys(storage).filter(
      (key) => key.startsWith('dawaa_inv_') || key.startsWith('dawaa:last-good-sales:'),
    );
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // ignore
  }
}
