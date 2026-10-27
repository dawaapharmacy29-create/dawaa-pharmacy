import { describe, expect, it } from 'vitest';
import { fetchAllOrderedPages } from '../fetchAllOrderedPages';

// Simulates a PostgREST endpoint that caps every response at `cap` rows.
function cappedSource(total: number, cap: number, failAt?: number) {
  const ranges: Array<[number, number]> = [];
  const rows = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
  const build = () => ({
    order: (column: string, options: { ascending: boolean }) => {
      expect(column).toBe('id');
      expect(options.ascending).toBe(true);
      return {
        range: async (from: number, to: number) => {
          ranges.push([from, to]);
          if (failAt !== undefined && from >= failAt)
            return { data: null, error: { message: 'page_failed' } };
          return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
        },
      };
    },
  });
  return { build, ranges };
}

const opts = { orderColumn: 'id', maxRows: 20000, limitError: 'limit_reached' };

describe('fetchAllOrderedPages', () => {
  it('returns every row past the 1000-row response cap (1,566 like the last 3 months)', async () => {
    const source = cappedSource(1566, 1000);
    const result = await fetchAllOrderedPages<{ id: number }>(source.build, opts);
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1566);
    expect(new Set(result.data!.map((row) => row.id)).size).toBe(1566);
  });

  it('is not truncated by a server cap lower than the page size', async () => {
    const source = cappedSource(1566, 500);
    const result = await fetchAllOrderedPages<{ id: number }>(source.build, opts);
    expect(result.data).toHaveLength(1566);
    expect(source.ranges[1][0]).toBe(500);
  });

  it('reports a failed page instead of a partial result', async () => {
    const source = cappedSource(1566, 1000, 1000);
    const result = await fetchAllOrderedPages<{ id: number }>(source.build, opts);
    expect(result).toEqual({ data: null, error: { message: 'page_failed' } });
  });

  it('reports the bound instead of silently stopping', async () => {
    const source = cappedSource(2500, 1000);
    const result = await fetchAllOrderedPages<{ id: number }>(source.build, {
      ...opts,
      maxRows: 2000,
    });
    expect(result).toEqual({ data: null, error: { message: 'limit_reached' } });
  });

  it('returns an empty list for an empty period', async () => {
    const result = await fetchAllOrderedPages<{ id: number }>(cappedSource(0, 1000).build, opts);
    expect(result).toEqual({ data: [], error: null });
  });
});
