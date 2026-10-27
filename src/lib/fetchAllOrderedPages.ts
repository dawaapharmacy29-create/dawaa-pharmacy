const PAGE_SIZE = 1000;

type PageQuery = {
  order: (
    column: string,
    options: { ascending: boolean }
  ) => {
    range: (
      from: number,
      to: number
    ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  };
};

/**
 * Reads every row of a filtered query, page by page, in a stable order.
 *
 * The API caps each response (1000 rows by default), so `.limit(10000)` silently
 * returns an arbitrary subset once a filter matches more rows. This keeps paging
 * until the server returns nothing, advancing by what it actually returned (so a
 * lower server cap cannot truncate either), and reports an error instead of a
 * partial result when the bound is reached or a page fails.
 */
export async function fetchAllOrderedPages<T>(
  buildQuery: () => PageQuery,
  options: { orderColumn: string; maxRows: number; limitError: string }
): Promise<{ data: T[] | null; error: { message?: string } | null }> {
  const rows: T[] = [];
  while (rows.length < options.maxRows) {
    const { data, error } = await buildQuery()
      .order(options.orderColumn, { ascending: true })
      .range(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    const batch = (data || []) as T[];
    if (!batch.length) return { data: rows, error: null };
    rows.push(...batch);
  }
  return { data: null, error: { message: options.limitError } };
}
