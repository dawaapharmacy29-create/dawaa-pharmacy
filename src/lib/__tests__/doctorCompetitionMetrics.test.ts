import { describe, expect, it, vi, beforeEach } from 'vitest';

const salesTruthMock = vi.fn();
const tableData = new Map<string, Array<Record<string, unknown>>>();

vi.mock('@/lib/dashboard/dashboardTruthService', () => ({
  DASHBOARD_ALL_BRANCHES: 'كل الفروع',
  dashboardInvoiceAmount: (row: Record<string, unknown>) => Number(row.net_amount || row.amount || 0),
  fetchDashboardSalesTruth: (...args: unknown[]) => salesTruthMock(...args),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const run = async () => ({ data: tableData.get(table) || [], error: null });
      const chain = {
        select: () => chain,
        gte: () => chain,
        lte: () => chain,
        limit: run,
      };
      return chain;
    },
  },
}));

import { getDoctorCompetitionMetrics } from '@/lib/doctorCompetitionMetrics';

function truth(doctorSales: Array<Record<string, unknown>>) {
  return {
    doctorSales,
    cycleRows: [],
    reconciliation: { rowsRead: doctorSales.length },
    summary: { sales_total: doctorSales.reduce((sum, row) => sum + Number(row.sales_total || 0), 0) },
  };
}

describe('doctorCompetitionMetrics eligibility', () => {
  beforeEach(() => {
    salesTruthMock.mockReset();
    tableData.clear();
  });

  it('does not pick a zero-sales doctor as sales winner', async () => {
    salesTruthMock
      .mockResolvedValueOnce(truth([{ doctor_name: 'د/ أميره', branch: 'فرع شكري', sales_total: 0, invoices_count: 20 }]))
      .mockResolvedValueOnce(truth([]));

    const metrics = await getDoctorCompetitionMetrics({ period: 'cycle' });

    expect(metrics.winners.sales).toBeNull();
    expect(metrics.eligibleRows.length).toBe(0);
    expect(metrics.reviewRows[0].ineligibleReasons).toContain('لا توجد مبيعات في الفترة');
  });

  it('does not pick one-invoice outlier as average invoice winner', async () => {
    salesTruthMock
      .mockResolvedValueOnce(
        truth([
          { doctor_name: 'د/ وائل', branch: 'فرع شكري', sales_total: 31800, invoices_count: 1 },
          { doctor_name: 'د/ سارة', branch: 'فرع شكري', sales_total: 12000, invoices_count: 12 },
        ])
      )
      .mockResolvedValueOnce(truth([{ doctor_name: 'د/ سارة', branch: 'فرع شكري', sales_total: 10000, invoices_count: 12 }]));

    const metrics = await getDoctorCompetitionMetrics({ period: 'cycle' });

    expect(metrics.winners.averageInvoice?.name).toBeUndefined();
    expect(metrics.reviewRows.some((row) => row.name === 'د/ وائل' && !row.avgInvoiceEligible)).toBe(true);
  });

  it('does not pick stagnant winner when stagnant data is disabled', async () => {
    salesTruthMock
      .mockResolvedValueOnce(truth([{ doctor_name: 'د/ سارة', branch: 'فرع شكري', sales_total: 12000, invoices_count: 12 }]))
      .mockResolvedValueOnce(truth([{ doctor_name: 'د/ سارة', branch: 'فرع شكري', sales_total: 10000, invoices_count: 12 }]));

    const metrics = await getDoctorCompetitionMetrics({ period: 'cycle' });

    expect(metrics.metadata.stagnantEnabled).toBe(false);
    expect(metrics.winners.stagnant).toBeNull();
    expect(metrics.eligibleRows[0].stagnantStatus).toBe('disabled');
  });

  it('marks growth unavailable when previous period has no sales', async () => {
    salesTruthMock
      .mockResolvedValueOnce(truth([{ doctor_name: 'د/ سارة', branch: 'فرع شكري', sales_total: 12000, invoices_count: 12 }]))
      .mockResolvedValueOnce(truth([]));

    const metrics = await getDoctorCompetitionMetrics({ period: 'cycle' });

    expect(metrics.eligibleRows[0].growthRate).toBeNull();
    expect(metrics.eligibleRows[0].growthRateStatus).toBe('unavailable');
  });

  it('keeps unknown doctor out of eligible rows', async () => {
    salesTruthMock
      .mockResolvedValueOnce(truth([{ doctor_name: 'غير محدد', branch: 'فرع شكري', sales_total: 12000, invoices_count: 12 }]))
      .mockResolvedValueOnce(truth([]));

    const metrics = await getDoctorCompetitionMetrics({ period: 'cycle' });

    expect(metrics.eligibleRows.some((row) => row.name === 'غير محدد')).toBe(false);
    expect(metrics.reviewRows.some((row) => row.reviewIssues.includes('دكتور غير محدد'))).toBe(true);
  });
});
