/**
 * أدوات خفيفة لتحسين الأداء ومنع التهنيج.
 * - debounce للبحث
 * - timeout للطلبات الطويلة
 * - cache قصير للقراءات المتكررة
 */

export function debounce<T extends (...args: any[]) => void>(fn: T, delay = 300) {
  let timer: number | undefined;
  return (...args: Parameters<T>) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

export async function withTimeout<T>(promise: Promise<T>, ms = 20000, message = "انتهى وقت العملية") {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

const memoryCache = new Map<string, { expiresAt: number; value: unknown }>();

export function getShortCache<T>(key: string): T | null {
  const item = memoryCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return item.value as T;
}

export function setShortCache<T>(key: string, value: T, ttlMs = 30_000) {
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function clearShortCache(prefix?: string) {
  if (!prefix) {
    memoryCache.clear();
    return;
  }
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) memoryCache.delete(key);
  }
}
