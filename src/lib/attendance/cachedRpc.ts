import { supabase } from '@/lib/supabase';

type CacheEntry = { data: unknown; expiresAt: number; promise?: Promise<unknown> };

const cache = new Map<string, CacheEntry>();

/**
 * ينفذ RPC مع تخزين مؤقت خفيف في الذاكرة (TTL بالثواني، الافتراضي 45 ثانية).
 * الهدف: لو رجعت لنفس التاب خلال فترة قصيرة، نعرض آخر نتيجة فورًا بدل انتظار طلب جديد،
 * مع تحديث النتيجة في الخلفية لو انتهت الصلاحية. يمنع كمان تكرار نفس الطلب لو اتنادى مرتين في نفس اللحظة.
 */
export async function cachedRpc<T>(rpcName: string, params: Record<string, unknown> = {}, ttlSeconds = 45): Promise<{ data: T | null; error: Error | null; fromCache: boolean }> {
  const key = `${rpcName}:${JSON.stringify(params)}`;
  const now = Date.now();
  const existing = cache.get(key);

  if (existing && existing.expiresAt > now) {
    return { data: existing.data as T, error: null, fromCache: true };
  }
  if (existing?.promise) {
    try {
      const data = await existing.promise;
      return { data: data as T, error: null, fromCache: false };
    } catch (e) {
      return { data: null, error: e instanceof Error ? e : new Error('cached rpc failed'), fromCache: false };
    }
  }

  const promise = supabase.rpc(rpcName, params).then(({ data, error }) => {
    if (error) throw error;
    cache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
    return data;
  });
  cache.set(key, { data: existing?.data ?? null, expiresAt: 0, promise });

  try {
    const data = await promise;
    return { data: data as T, error: null, fromCache: false };
  } catch (e) {
    cache.delete(key);
    return { data: (existing?.data as T) ?? null, error: e instanceof Error ? e : new Error('cached rpc failed'), fromCache: false };
  }
}

/** يمسح التخزين المؤقت لدالة معينة (أو الكل) — يُستخدم بعد أي إجراء يغيّر البيانات (اعتماد/رفض/ربط). */
export function invalidateCachedRpc(rpcName?: string) {
  if (!rpcName) { cache.clear(); return; }
  for (const key of cache.keys()) if (key.startsWith(`${rpcName}:`)) cache.delete(key);
}
