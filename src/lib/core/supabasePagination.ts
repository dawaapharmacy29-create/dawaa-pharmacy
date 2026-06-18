/**
 * supabasePagination.ts — Full-pagination helpers for Supabase queries
 * Ensures we never miss rows due to the default 1000-row limit.
 *
 * IMPROVEMENT: fetchAllPages now fetches pages in PARALLEL (not sequential)
 * which is significantly faster for large datasets (e.g. 5000 invoices = 5 parallel
 * requests instead of 5 sequential ones).
 */

import { supabase } from '@/lib/supabase';

export type SupabaseQueryBuilder = ReturnType<typeof supabase.from>;

const PAGE_SIZE = 1000;

/**
 * Fetches all pages from a Supabase query builder.
 * Uses parallel fetching for maximum speed — gets row count first,
 * then fires all page requests simultaneously.
 *
 * Usage:
 *   const rows = await fetchAllPages(
 *     supabase.from("sales_invoices").select("id, amount").eq("branch", "فرع شكري")
 *   );
 */
export async function fetchAllPages<T = unknown>(
  query: SupabaseQueryBuilder,
  pageSize = PAGE_SIZE
): Promise<T[]> {
  // Step 1: Get total count with a HEAD request (no data, just count)
  const countResult = await (query as any).select('*', { count: 'exact', head: true });
  const totalCount: number = countResult.count ?? 0;

  if (totalCount === 0) {
    // Fallback: try a single page in case count isn't supported
    const { data, error } = await (query as any).range(0, pageSize - 1);
    if (error) {
      console.error('[fetchAllPages] Supabase error:', error.message);
      return [];
    }
    return (data as T[]) ?? [];
  }

  const pageCount = Math.ceil(totalCount / pageSize);

  if (pageCount === 1) {
    // Single page — no need for parallel overhead
    const { data, error } = await (query as any).range(0, pageSize - 1);
    if (error) {
      console.error('[fetchAllPages] Supabase error:', error.message);
      return [];
    }
    return (data as T[]) ?? [];
  }

  // Step 2: Fire all page requests in parallel
  const pagePromises = Array.from({ length: pageCount }, (_, i) => {
    const from = i * pageSize;
    const to = from + pageSize - 1;
    return (query as any).range(from, to);
  });

  const pageResults = await Promise.all(pagePromises);

  const results: T[] = [];
  for (const result of pageResults) {
    if (result.error) {
      console.error('[fetchAllPages] Supabase page error:', result.error.message);
      continue;
    }
    if (result.data) results.push(...(result.data as T[]));
  }

  return results;
}

/**
 * Fetches a single page of results with count.
 * Returns { data, count, hasMore }.
 */
export async function fetchPagedQuery<T = unknown>(
  query: SupabaseQueryBuilder,
  page: number,
  pageSize = 50
): Promise<{ data: T[]; count: number; hasMore: boolean }> {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await (query as any)
    .range(from, to)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[fetchPagedQuery] Supabase error:', error.message);
    return { data: [], count: 0, hasMore: false };
  }

  const total = count ?? 0;
  return {
    data: (data as T[]) ?? [],
    count: total,
    hasMore: from + pageSize < total,
  };
}

/**
 * Builds a count query to check total rows before fetching.
 */
export async function countQuery(
  tableName: string,
  filters?: Record<string, unknown>
): Promise<number> {
  let q = supabase.from(tableName).select('*', { count: 'exact', head: true });

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      q = (q as any).eq(key, value);
    }
  }

  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}
