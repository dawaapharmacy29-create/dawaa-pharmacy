/**
 * supabasePagination.ts — Full-pagination helpers for Supabase queries
 * Ensures we never miss rows due to the default 1000-row limit.
 */

import { supabase } from "@/lib/supabase";

export type SupabaseQueryBuilder = ReturnType<typeof supabase.from>;

const PAGE_SIZE = 1000;

/**
 * Fetches all pages from a Supabase query builder.
 * Handles pagination automatically.
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
  const results: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await (query as any).range(from, from + pageSize - 1);

    if (error) {
      console.error("[fetchAllPages] Supabase error:", error.message);
      break;
    }

    if (!data || data.length === 0) break;

    results.push(...(data as T[]));

    if (data.length < pageSize) break;
    from += pageSize;
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
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[fetchPagedQuery] Supabase error:", error.message);
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
  let q = supabase.from(tableName).select("*", { count: "exact", head: true });

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      q = (q as any).eq(key, value);
    }
  }

  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}
