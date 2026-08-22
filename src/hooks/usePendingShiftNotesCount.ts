import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type ShiftNotesRuntimeState = {
  refreshPromise: Promise<number | null> | null;
  lastRefreshAt: number;
  subscribers: number;
  count: number | null;
  timer: number | null;
};

const shiftNotesRuntime = ((globalThis as typeof globalThis & {
  __dawaaShiftNotesRuntime?: ShiftNotesRuntimeState;
}).__dawaaShiftNotesRuntime ??= {
  refreshPromise: null,
  lastRefreshAt: 0,
  subscribers: 0,
  count: null,
  timer: null,
});

const CACHE_TTL_MS = 30_000;
const POLL_INTERVAL_MS = 120_000;

export function usePendingShiftNotesCount() {
  const [count, setCount] = useState<number | null>(shiftNotesRuntime.count);

  const refresh = useCallback(async (force = false) => {
    if (!isSupabaseConfigured) {
      shiftNotesRuntime.count = null;
      setCount(null);
      return;
    }

    const cacheIsFresh =
      !force &&
      shiftNotesRuntime.count !== null &&
      shiftNotesRuntime.lastRefreshAt > 0 &&
      Date.now() - shiftNotesRuntime.lastRefreshAt < CACHE_TTL_MS;
    if (cacheIsFresh) {
      setCount(shiftNotesRuntime.count);
      return;
    }

    if (shiftNotesRuntime.refreshPromise) {
      const sharedCount = await shiftNotesRuntime.refreshPromise;
      setCount(sharedCount);
      return;
    }

    shiftNotesRuntime.refreshPromise = (async () => {
      try {
        const { data, error } = await supabase.rpc('count_pending_shift_notes_v1');
        if (error) throw error;
        const parsed = Number(data ?? 0);
        const pending = Number.isFinite(parsed) ? parsed : 0;
        shiftNotesRuntime.count = pending;
        shiftNotesRuntime.lastRefreshAt = Date.now();
        return pending;
      } catch (error) {
        if (import.meta.env.DEV) console.warn('[usePendingShiftNotesCount] failed', error);
        shiftNotesRuntime.count = null;
        return null;
      } finally {
        shiftNotesRuntime.refreshPromise = null;
      }
    })();

    const nextCount = await shiftNotesRuntime.refreshPromise;
    setCount(nextCount);
  }, []);

  useEffect(() => {
    shiftNotesRuntime.subscribers += 1;
    if (shiftNotesRuntime.count !== null) setCount(shiftNotesRuntime.count);

    void refresh();
    const onDataChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ table?: string }>).detail;
      if (!detail?.table || detail.table === 'shift_notes') void refresh(true);
    };
    window.addEventListener('dataChanged', onDataChanged);

    if (shiftNotesRuntime.subscribers === 1) {
      if (shiftNotesRuntime.timer) window.clearInterval(shiftNotesRuntime.timer);
      shiftNotesRuntime.timer = window.setInterval(() => void refresh(true), POLL_INTERVAL_MS);
    }

    return () => {
      shiftNotesRuntime.subscribers = Math.max(0, shiftNotesRuntime.subscribers - 1);
      window.removeEventListener('dataChanged', onDataChanged);
      if (shiftNotesRuntime.subscribers === 0 && shiftNotesRuntime.timer) {
        window.clearInterval(shiftNotesRuntime.timer);
        shiftNotesRuntime.timer = null;
      }
    };
  }, [refresh]);

  return count;
}
