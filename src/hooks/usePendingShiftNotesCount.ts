import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const DONE_PATTERN = /completed|done|closed|cancelled|deleted|تم|مغلق|ملغي|محذوف/i;

function isPendingShiftNote(row: Record<string, unknown>) {
  if (row.deleted_at || row.is_deleted === true) return false;
  if (row.completed_at) return false;
  const status = String(row.status || '').trim();
  if (!status) return true;
  if (DONE_PATTERN.test(status)) return false;
  return true;
}

export function usePendingShiftNotesCount() {
  const [count, setCount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setCount(null);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('shift_notes')
        .select('id,status,deleted_at,is_deleted,completed_at')
        .is('deleted_at', null)
        .limit(500);
      if (error) throw error;
      const pending = (data || []).filter((row) => isPendingShiftNote(row as Record<string, unknown>)).length;
      setCount(pending);
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[usePendingShiftNotesCount] failed', error);
      setCount(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onDataChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ table?: string }>).detail;
      if (!detail?.table || detail.table === 'shift_notes') void refresh();
    };
    window.addEventListener('dataChanged', onDataChanged);
    const timer = window.setInterval(() => void refresh(), 120_000);
    return () => {
      window.removeEventListener('dataChanged', onDataChanged);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return count;
}
