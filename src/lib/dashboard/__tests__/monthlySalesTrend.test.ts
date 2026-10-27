import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; params: Record<string, unknown> }>,
  data: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: async (name: string, params: Record<string, unknown>) => {
      transport.calls.push({ name, params });
      return { data: transport.data, error: null };
    },
  },
}));

describe('dashboard monthly sales trend', () => {
  beforeEach(() => {
    transport.calls = [];
    transport.data = [];
  });

  it('loads every month with one RPC and keeps the former row shape and order', async () => {
    const { fetchMonthlySalesFromTruth } = await import('../dashboardTruthService');
    transport.data = ['2026-10-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].map(
      (month, i) => ({
        month_start: month,
        invoices_count: 10 * (i + 1),
        sales_total: 1000 * (i + 1),
      })
    );
    const rows = await fetchMonthlySalesFromTruth('2026-10-27', 'كل الفروع', 5);
    expect(transport.calls).toEqual([
      {
        name: 'get_dashboard_monthly_sales_v172',
        params: { p_end: '2026-10-27', p_branch: 'كل الفروع', p_months: 5 },
      },
    ]);
    expect(rows.map((row) => row.month_label)).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(rows[4]).toEqual({
      month_start: '2026-10-01',
      month_label: '2026-10',
      branch: 'كل الفروع',
      sales_total: 1000,
      invoices_count: 10,
      avg_invoice: 100,
    });
  });

  it('fails visibly instead of showing a month as zero when the server omitted it', async () => {
    const { fetchMonthlySalesFromTruth } = await import('../dashboardTruthService');
    transport.data = [{ month_start: '2026-10-01', invoices_count: 1, sales_total: 5 }];
    await expect(fetchMonthlySalesFromTruth('2026-10-27', 'كل الفروع', 2)).rejects.toThrow(
      'monthly_sales_months_incomplete'
    );
  });

  it('returns nothing for an invalid end date without calling the server', async () => {
    const { fetchMonthlySalesFromTruth } = await import('../dashboardTruthService');
    expect(await fetchMonthlySalesFromTruth('not-a-date', 'كل الفروع', 5)).toEqual([]);
    expect(transport.calls).toHaveLength(0);
  });
});
