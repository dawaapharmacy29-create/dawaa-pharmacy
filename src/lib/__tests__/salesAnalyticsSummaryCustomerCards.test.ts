import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ rpcCalls: 0, countCalls: 0 }));

vi.mock('@/lib/supabase', () => {
  const countQuery = () => {
    const chain: Record<string, unknown> = {};
    const resolve = () => {
      transport.countCalls += 1;
      return Promise.resolve({ count: 7, error: null });
    };
    for (const method of ['in', 'eq', 'or'])
      chain[method] = () => ({ then: (r: (v: unknown) => unknown) => resolve().then(r) });
    return chain;
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      rpc: async () => {
        transport.rpcCalls += 1;
        return {
          data: {
            kpis: { invoicesCount: 3, netSales: 900 },
            staffSales: [
              {
                saleDate: '2026-10-20',
                sellerName: 'د/ ندي',
                branch: 'فرع شكري',
                netTotal: 600,
                invoicesCount: 2,
                avgInvoice: 300,
                uniqueCustomers: 2,
              },
              {
                saleDate: '2026-10-21',
                sellerName: 'د/ مغازي',
                branch: 'فرع شكري',
                netTotal: 300,
                invoicesCount: 1,
                avgInvoice: 300,
                uniqueCustomers: 1,
              },
            ],
          },
          error: null,
        };
      },
      from: () => ({ select: () => countQuery() }),
    },
  };
});

vi.mock('@/lib/staffIdentityService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/staffIdentityService')>();
  return { ...original, fetchStaffIdentityRows: async () => [] };
});

const filters = { startDate: '2026-09-27', endDate: '2026-10-27', branch: 'فرع شكري' };

describe('loadSalesAnalyticsSummary customer cards option', () => {
  beforeEach(async () => {
    transport.rpcCalls = 0;
    transport.countCalls = 0;
    (await import('../salesAnalyticsSummaryService')).clearSalesAnalyticsSummaryCache();
  });

  it('default behaviour is unchanged: four customer-card counts are requested', async () => {
    const { loadSalesAnalyticsSummary } = await import('../salesAnalyticsSummaryService');
    const summary = await loadSalesAnalyticsSummary(filters, true);
    expect(transport.countCalls).toBe(4);
    expect(summary.customerCards).toEqual({
      important: 7,
      stopped: 7,
      threatened: 7,
      invalidPhone: 7,
    });
  });

  it('includeCustomerCards: false skips the counts and returns identical doctor rows', async () => {
    const { loadSalesAnalyticsSummary } = await import('../salesAnalyticsSummaryService');
    const full = await loadSalesAnalyticsSummary(filters, true);
    transport.countCalls = 0;
    const lean = await loadSalesAnalyticsSummary(filters, true, { includeCustomerCards: false });
    expect(transport.countCalls).toBe(0);
    expect(lean.doctorRows).toEqual(full.doctorRows);
    expect(lean.kpis).toEqual(full.kpis);
    expect(lean.customerCards).toEqual({
      important: null,
      stopped: null,
      threatened: null,
      invalidPhone: null,
    });
  });

  it('a lean result is never served from cache to a caller that needs the cards', async () => {
    const { loadSalesAnalyticsSummary } = await import('../salesAnalyticsSummaryService');
    await loadSalesAnalyticsSummary(filters, false, { includeCustomerCards: false });
    const withCards = await loadSalesAnalyticsSummary(filters);
    expect(withCards.customerCards.important).toBe(7);
    expect(transport.rpcCalls).toBe(2);
  });
});
