import { describe, it, expect, vi } from 'vitest';
import { fetchQaCaseList, fetchQaCaseDetail } from '../queries';

/** Minimal fake Supabase query builder — chainable, resolves to a fixed payload per table. */
function fakeSupabase(tableData: Record<string, any>) {
  const from = vi.fn((table: string) => {
    const payload = tableData[table] ?? { data: [], error: null };
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => Promise.resolve(payload)),
      maybeSingle: vi.fn(() => Promise.resolve(payload)),
    };
    return builder;
  });
  return { from };
}

describe('fetchQaCaseList (I/O wrapper)', () => {
  it('reads only from the current-row views, never a write-capable table', async () => {
    const client = fakeSupabase({
      sales_intelligence_current_case_analyses: { data: [], error: null },
      sales_intelligence_current_attributions: { data: [], error: null },
      sales_intelligence_basket_invoice_matches: { data: [], error: null },
    });
    await fetchQaCaseList(client);
    expect(client.from).toHaveBeenCalledWith('sales_intelligence_current_case_analyses');
    expect(client.from).toHaveBeenCalledWith('sales_intelligence_current_attributions');
    // No "current" view exists for this table (see queries.ts's own comment) — it is filtered
    // directly by is_current_evaluation=true instead, never read unfiltered.
    expect(client.from).toHaveBeenCalledWith('sales_intelligence_basket_invoice_matches');
  });

  it('propagates a Supabase error instead of silently returning an empty list', async () => {
    const client = fakeSupabase({
      sales_intelligence_current_case_analyses: { data: null, error: new Error('boom') },
      sales_intelligence_current_attributions: { data: [], error: null },
    });
    await expect(fetchQaCaseList(client)).rejects.toThrow('boom');
  });
});

describe('fetchQaCaseDetail (I/O wrapper)', () => {
  it('returns null when no current analysis exists for the case id (never throws)', async () => {
    const client = fakeSupabase({
      sales_intelligence_cases: { data: null, error: null },
      sales_intelligence_current_case_analyses: { data: null, error: null },
    });
    const result = await fetchQaCaseDetail(client, 'missing-case');
    expect(result).toBeNull();
  });
});
