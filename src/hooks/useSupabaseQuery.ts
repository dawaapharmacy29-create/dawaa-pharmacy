import { useEffect, useState, useCallback, useRef } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { logActivity as writeActivityLog } from '@/lib/activityLog';
import { logSupabaseError } from '@/lib/supabaseError';
import { TABLES } from '@/lib/supabaseTables';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface QueryOptions {
  table: string;
  select?: string;
  filters?: Array<{ column: string; operator: string; value: unknown }>;
  orderBy?: { column: string; ascending?: boolean };
  limit?: number;
  realtimeEnabled?: boolean; // default: false — enable only where live updates are truly needed
}

type QueryBuilder = ReturnType<ReturnType<typeof supabase.from>['select']>;

function friendlySupabaseError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('row-level security') || lower.includes('permission denied')) {
    return 'صلاحيات قاعدة البيانات لا تسمح بهذه العملية. راجع إعدادات RLS في Supabase.';
  }
  if (lower.includes('does not exist') || lower.includes('schema cache')) {
    return 'جدول أو عمود غير موجود في Supabase. راجع هيكل قاعدة البيانات.';
  }
  if (lower.includes('failed to fetch') || lower.includes('network')) {
    return 'تعذر الاتصال بقاعدة البيانات. راجع الإنترنت وإعدادات Supabase.';
  }
  return message;
}

export function useSupabaseQuery<T>(options: QueryOptions) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const mountedRef = useRef(true);

  // Stable serialised keys used as useCallback deps (avoids complex-expression lint warning)
  const filtersKey = JSON.stringify(options.filters ?? null);
  const selectKey = options.select ?? '';
  const limitKey = options.limit ?? 0;
  const orderColumn = options.orderBy?.column ?? '';
  const orderAsc = options.orderBy?.ascending ?? false;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!isSupabaseConfigured) {
      if (mountedRef.current) {
        setData([]);
        setLoading(false);
        setError('إعدادات Supabase غير موجودة. أضف ملف .env لتفعيل البيانات الحقيقية.');
      }
      return;
    }

    let query: QueryBuilder = supabase.from(options.table).select(options.select || '*');

    if (options.filters) {
      for (const f of options.filters) {
        if (f.operator === 'eq') query = query.eq(f.column, f.value);
        else if (f.operator === 'ilike') query = query.ilike(f.column, String(f.value));
        else if (f.operator === 'gte') query = query.gte(f.column, f.value);
        else if (f.operator === 'lte') query = query.lte(f.column, f.value);
      }
    }

    if (options.orderBy) {
      query = query.order(options.orderBy.column, {
        ascending: options.orderBy.ascending ?? false,
      });
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data: result, error: err } = await query;

    if (!mountedRef.current) return;

    if (err) {
      setError(friendlySupabaseError(err.message));
      if (options.table === TABLES.employeeTransactions) {
        console.error('Employee transactions error:', {
          message: err.message,
          details: err.details,
          hint: err.hint,
          code: err.code,
        });
      }
      logSupabaseError(`${options.table} fetch`, err);
    } else {
      setData((result as T[]) || []);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.table, filtersKey, selectKey, limitKey, orderColumn, orderAsc]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();

    if (isSupabaseConfigured && options.realtimeEnabled === true) {
      channelRef.current = supabase
        .channel(`realtime:${options.table}:${Math.random()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: options.table }, () => {
          fetchData();
        })
        .subscribe();
    }

    return () => {
      mountedRef.current = false;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [fetchData, options.realtimeEnabled, options.table]);

  return { data, loading, error, refetch: fetchData };
}

export async function supabaseInsert<T>(
  table: string,
  record: Partial<T>
): Promise<{ data: T | null; error: string | null }> {
  if (!isSupabaseConfigured) return { data: null, error: 'إعدادات Supabase غير موجودة' };
  const { data, error } = await supabase
    .from(table)
    .insert(record as Record<string, unknown>)
    .select()
    .single();
  if (error) {
    logSupabaseError(`${table} insert`, error);
    return { data: null, error: friendlySupabaseError(error.message) };
  }
  return { data: data as T, error: null };
}

export async function supabaseUpdate<T>(
  table: string,
  id: string,
  updates: Partial<T>
): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'إعدادات Supabase غير موجودة' };
  const { error } = await supabase
    .from(table)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    logSupabaseError(`${table} update`, error);
    return { error: friendlySupabaseError(error.message) };
  }
  return { error: null };
}

export async function supabaseDelete(table: string, id: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured) return { error: 'إعدادات Supabase غير موجودة' };
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) {
    logSupabaseError(`${table} delete`, error);
    return { error: friendlySupabaseError(error.message) };
  }
  return { error: null };
}

export async function logActivity(
  userId: string,
  userName: string,
  action: string,
  module: string,
  details: string,
  branch: string,
  extras?: Record<string, unknown> &
    Partial<{ user_role: string; target_type: string; target_id: string }>
) {
  await writeActivityLog({
    user_id: userId,
    user_name: userName,
    action,
    module,
    details: extras ? { summary: details, ...extras } : details,
    branch_name: branch,
    user_role: typeof extras?.user_role === 'string' ? extras.user_role : undefined,
    target_type: typeof extras?.target_type === 'string' ? extras.target_type : undefined,
    target_id: typeof extras?.target_id === 'string' ? extras.target_id : undefined,
  });
}
