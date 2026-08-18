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

const DONE_PATTERN = /completed|done|closed|cancelled|deleted|تم|مغلق|ملغي|محذوف/i;

function isPendingShiftNote(row: Record<string, unknown>) {
  if (row.deleted_at) return false;
  if (row.completed_at) return false;
  const status = String(row.status || '').trim();
  if (!status) return true;
  if (DONE_PATTERN.test(status)) return false;
  return true;
}

export function usePendingShiftNotesCount() {
  const [count, setCount] = useState<number | null>(shiftNotesRuntime.count);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      shiftNotesRuntime.count = null;
      setCount(null);
      return;
    }

    if (shiftNotesRuntime.refreshPromise && Date.now() - shiftNotesRuntime.lastRefreshAt < 15_000) {
      const sharedCount = await shiftNotesRuntime.refreshPromise;
      setCount(sharedCount);
      return;
    }

    shiftNotesRuntime.refreshPromise = (async () => {
      try {
        const { data, error } = await supabase
          .from('shift_notes')
          .select('id,status,deleted_at,completed_at')
          .is('deleted_at', null)
          .limit(500);
        if (error) throw error;
        const pending = (data || []).filter((row) => isPendingShiftNote(row as Record<string, unknown>)).length;
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
      if (!detail?.table || detail.table === 'shift_notes') void refresh();
    };
    window.addEventListener('dataChanged', onDataChanged);

    if (shiftNotesRuntime.subscribers === 1) {
      if (shiftNotesRuntime.timer) window.clearInterval(shiftNotesRuntime.timer);
      shiftNotesRuntime.timer = window.setInterval(() => void refresh(), 120_000);
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
