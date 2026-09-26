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
      sales_intelligence_cases: { data: [], error: null },
      whatsapp_review_sources: { data: [], error: null },
    });
    await fetchQaCaseList(client);
    expect(client.from).toHaveBeenCalledWith('sales_intelligence_current_case_analyses');
    expect(client.from).toHaveBeenCalledWith('sales_intelligence_current_attributions');
    // No "current" view exists for this table (see queries.ts's own comment) — it is filtered
    // directly by is_current_evaluation=true instead, never read unfiltered.
    expect(client.from).toHaveBeenCalledWith('sales_intelligence_basket_invoice_matches');
    expect(client.from).toHaveBeenCalledWith('sales_intelligence_cases');
    expect(client.from).toHaveBeenCalledWith('whatsapp_review_sources');
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
  it('can enrich a source identity from the customers table when the exported name carries the code', async () => {
    const client = fakeSupabase({
      sales_intelligence_cases: { data: { case_id: 'case-1', conversation_id: 'conv-1', customer_id: null, customer_phone: null }, error: null },
      sales_intelligence_current_case_analyses: { data: { analysis_id: 'a1', case_id: 'case-1', attribution_level: 'unknown', integrity_evaluation_scope: 'insufficient', needs_human_review: false }, error: null },
      sales_intelligence_current_attributions: { data: null, error: null },
      sales_intelligence_basket_invoice_matches: { data: null, error: null },
      sales_intelligence_current_policy_evaluations: { data: null, error: null },
      whatsapp_review_sources: { data: { id: 'conv-1', raw_text: '[9:00 AM] محمد الكموني17777: مساء الخير', branch: 'فرع شكري', conversation_started_at: '2026-09-24T06:00:00.000Z', conversation_ended_at: '2026-09-24T06:05:00.000Z', customer_id: null, customer_name: 'محمد الكموني17777', customer_code: null, customer_phone: null }, error: null },
      customers: { data: [{ name: 'م محمد الكموني vip %', customer_code: '17777', phone: '01000365139' }], error: null },
    });
    const result = await fetchQaCaseDetail(client, 'case-1');
    expect(result?.conversation?.customerName).toBe('محمد الكموني');
    expect(result?.conversation?.customerCode).toBe('17777');
    expect(result?.conversation?.customerPhone).toBe('01000365139');
    expect(client.from).toHaveBeenCalledWith('customers');
  });

  it('returns null when no current analysis exists for the case id (never throws)', async () => {
    const client = fakeSupabase({
      sales_intelligence_cases: { data: null, error: null },
      sales_intelligence_current_case_analyses: { data: null, error: null },
    });
    const result = await fetchQaCaseDetail(client, 'missing-case');
    expect(result).toBeNull();
  });
});
