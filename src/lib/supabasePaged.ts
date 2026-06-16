import { supabase } from "@/lib/supabase";

export type PagedSelectOptions = {
  table: string;
  select?: string;
  chunkSize?: number;
  maxRows?: number;
  orderBy?: string;
  ascending?: boolean;
  filters?: (query: any) => any;
};

export async function selectAllPaged<T = Record<string, unknown>>({
  table,
  select = "*",
  chunkSize = 1000,
  maxRows = 50000,
  orderBy,
  ascending = true,
  filters,
}: PagedSelectOptions): Promise<{ data: T[]; error: any | null; rowsScanned: number; truncated: boolean }> {
  const rows: T[] = [];
  let from = 0;
  let error: any | null = null;

  while (from < maxRows) {
    const to = Math.min(from + chunkSize - 1, maxRows - 1);
    let query = supabase.from(table).select(select);
    if (filters) query = filters(query);
    if (orderBy) query = query.order(orderBy, { ascending });
    const result = await query.range(from, to);

    if (result.error) {
      error = result.error;
      break;
    }

    const page = (result.data || []) as T[];
    rows.push(...page);
    if (page.length < chunkSize) break;
    from += chunkSize;
  }

  return { data: rows, error, rowsScanned: rows.length, truncated: rows.length >= maxRows };
}
