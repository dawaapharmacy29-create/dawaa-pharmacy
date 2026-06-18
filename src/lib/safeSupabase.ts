import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type SafeRowsResult<T> = { rows: T[]; error: string | null; available: boolean };

export async function safeRows<T extends Record<string, unknown>>(
  table: string,
  configure?: (query: any) => any,
  limit = 500
): Promise<SafeRowsResult<T>> {
  if (!isSupabaseConfigured)
    return { rows: [], error: 'إعدادات قاعدة البيانات غير متاحة', available: false };
  try {
    let query = supabase.from(table).select('*').limit(limit);
    if (configure) query = configure(query);
    const { data, error } = await query;
    if (error) return { rows: [], error: error.message, available: false };
    return { rows: (data || []) as T[], error: null, available: true };
  } catch (error) {
    return {
      rows: [],
      error: error instanceof Error ? error.message : 'تعذر قراءة البيانات',
      available: false,
    };
  }
}

export function safeText(value: unknown, fallback = '') {
  return String(value ?? fallback).trim();
}

export function safeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function rowDate(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = safeText(row[key]);
    if (value) return value.slice(0, 10);
  }
  return '';
}

export function isOpenStatus(value: unknown) {
  return !/completed|done|closed|resolved|cancelled|تم|مغلق|ملغي/i.test(safeText(value));
}
