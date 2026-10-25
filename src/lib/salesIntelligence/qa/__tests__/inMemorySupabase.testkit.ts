// Filter-aware in-memory stand-in for the Supabase query builder, for read-only loader tests.
// Unlike a fixed-payload mock it applies eq/neq/in/ilike/range filters, so a test can prove that a
// loader only receives rows that belong to the requested case. Unknown tables are empty; rpc()
// returns an empty result; `or()`/`not()` are ignored (they only widen lookups in the readers used
// here). Hidden tables simulate rows the viewer's RLS does not return.

type Row = Record<string, any>;

export interface InMemorySupabaseOptions {
  /** Tables whose rows this viewer cannot see (RLS returns nothing). */
  hiddenTables?: string[];
}

export interface InMemorySupabase {
  from(table: string): any;
  rpc(name: string, args?: unknown): Promise<{ data: unknown[]; error: null }>;
  /** Every table the loader read, in order. */
  readonly reads: string[];
}

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

export function createInMemorySupabase(tables: Record<string, Row[]>, options: InMemorySupabaseOptions = {}): InMemorySupabase {
  const hidden = new Set(options.hiddenTables ?? []);
  const reads: string[] = [];

  function from(table: string) {
    reads.push(table);
    const filters: Array<(row: Row) => boolean> = [];
    let limitCount: number | null = null;
    let rangeWindow: [number, number] | null = null;

    const rows = (): Row[] => {
      if (hidden.has(table)) return [];
      let result = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      if (rangeWindow) result = result.slice(rangeWindow[0], rangeWindow[1] + 1);
      if (limitCount != null) result = result.slice(0, limitCount);
      return result.map((row) => ({ ...row }));
    };

    const builder: any = {
      select: () => builder,
      order: () => builder,
      or: () => builder,
      not: () => builder,
      abortSignal: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push((row) => String(row[column]) === String(value));
        return builder;
      },
      neq: (column: string, value: unknown) => {
        filters.push((row) => String(row[column]) !== String(value));
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => (value === null ? row[column] == null : row[column] === value));
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        const allowed = new Set(values.map((value) => String(value)));
        filters.push((row) => allowed.has(String(row[column])));
        return builder;
      },
      ilike: (column: string, pattern: string) => {
        const expression = likeToRegExp(pattern);
        filters.push((row) => expression.test(String(row[column] ?? '')));
        return builder;
      },
      gte: (column: string, value: unknown) => {
        filters.push((row) => row[column] != null && String(row[column]) >= String(value));
        return builder;
      },
      gt: (column: string, value: unknown) => {
        filters.push((row) => row[column] != null && String(row[column]) > String(value));
        return builder;
      },
      lte: (column: string, value: unknown) => {
        filters.push((row) => row[column] != null && String(row[column]) <= String(value));
        return builder;
      },
      lt: (column: string, value: unknown) => {
        filters.push((row) => row[column] != null && String(row[column]) < String(value));
        return builder;
      },
      limit: (count: number) => {
        limitCount = count;
        return builder;
      },
      range: (start: number, end: number) => {
        rangeWindow = [start, end];
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null, count: rows().length }).then(resolve, reject),
    };
    return builder;
  }

  return {
    from,
    rpc: () => Promise.resolve({ data: [], error: null }),
    get reads() {
      return reads;
    },
  };
}
