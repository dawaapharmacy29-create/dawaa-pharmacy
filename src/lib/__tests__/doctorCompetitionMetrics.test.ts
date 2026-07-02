import { describe, expect, it, vi, beforeEach } from 'vitest';

const fetchSalesInvoicesPagedSafeMock = vi.fn();

vi.mock('@/lib/salesInvoiceQueries', () => ({
  fetchSalesInvoicesPagedSafe: (...args: unknown[]) => fetchSalesInvoicesPagedSafeMock(...args),
  INVOICE_SELECT_FULL: '',
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const run = async () => ({ data: [], error: null });
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

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    invoice_no: String(overrides.invoice_no || '1'),
    invoice_date: String(overrides.invoice_date || '2026-01-01'),
    branch: overrides.branch || 'فرع شكري',
    seller_name: overrides.seller_name || undefined,
    normalized_seller_name: overrides.normalized_seller_name || undefined,
    staff_name: overrides.staff_name || undefined,
    staff_id: overrides.staff_id || undefined,
    net_amount: overrides.net_amount ?? 12000,
    total_amount: overrides.total_amount || overrides.net_amount || 0,
    amount: overrides.amount || overrides.net_amount || 0,
    ...overrides,
  };
}

describe('doctorCompetitionMetrics eligibility', () => {
  beforeEach(() => {
    fetchSalesInvoicesPagedSafeMock.mockReset();
  });

  it('aggregates sales_invoices doctor rows directly and uses invoice fields', async () => {
    fetchSalesInvoicesPagedSafeMock
      .mockResolvedValueOnce([
        invoiceRow({ invoice_no: '1', normalized_seller_name: 'د/ أميره', net_amount: 15000 }),
        invoiceRow({ invoice_no: '2', seller_name: 'د/ فاطمة', net_amount: 5000 }),
        invoiceRow({ invoice_no: '3', normalized_seller_name: 'د/ أميره', net_amount: 5000 }),
      ])
      .mockResolvedValueOnce([]);

    const metrics = await getDoctorCompetitionMetrics({ period: 'custom', customStart: '2026-01-01', customEnd: '2026-01-01' });

    const amira = metrics.rows.find((row) => row.name === 'د/ اميره');
    expect(amira).toBeDefined();
    expect(amira?.totalSales).toBe(20000);
    expect(metrics.winners.sales?.name).toBe('د/ اميره');
  });

  it('uses only sales_invoices fields and never selects doctor_name', async () => {
    fetchSalesInvoicesPagedSafeMock
      .mockResolvedValueOnce([invoiceRow({ seller_name: 'د/ سارة', net_amount: 12000 })])
      .mockResolvedValueOnce([]);

    await getDoctorCompetitionMetrics({ period: 'custom', customStart: '2026-01-01', customEnd: '2026-01-01' });

    const firstCall = fetchSalesInvoicesPagedSafeMock.mock.calls[0][0] as Record<string, unknown>;
    expect(firstCall.selectOptions).toEqual([
      'id,invoice_number,invoice_no,invoice_date,sale_date,branch,branch_name,seller_name,normalized_seller_name,staff_name,staff_id,net_amount,net_total,total_amount,amount,customer_code',
    ]);
    expect(String(firstCall.selectOptions[0]).includes('doctor_name')).toBe(false);
  });

  it('aggregates invoices by staff_id when provided and keeps display name from seller fields', async () => {
    fetchSalesInvoicesPagedSafeMock
      .mockResolvedValueOnce([
        invoiceRow({ invoice_no: '1', staff_id: 'uuid-1', normalized_seller_name: 'د/ اسلام فاروق', net_amount: 20000 }),
        invoiceRow({ invoice_no: '2', staff_id: 'uuid-1', normalized_seller_name: 'د/ اسلام فاروق', net_amount: 32917.88 }),
      ])
      .mockResolvedValueOnce([]);

    const metrics = await getDoctorCompetitionMetrics({ period: 'custom', customStart: '2026-01-01', customEnd: '2026-01-01' });
    const doctor = metrics.rows.find((row) => row.staffId === 'uuid-1');

    expect(doctor).toBeDefined();
    expect(doctor?.totalSales).toBeCloseTo(52917.88, 2);
    expect(doctor?.name).toBe('د/ اسلام فاروق');
    expect(doctor?.staffId).toBe('uuid-1');
  });

  it('counts seller_name-only invoices when staff_id is missing', async () => {
    fetchSalesInvoicesPagedSafeMock
      .mockResolvedValueOnce([
        invoiceRow({ invoice_no: '1', seller_name: 'د/ حسن', net_amount: 41702.36 }),
      ])
      .mockResolvedValueOnce([]);

    const metrics = await getDoctorCompetitionMetrics({ period: 'custom', customStart: '2026-01-01', customEnd: '2026-01-01' });
    const doctor = metrics.rows.find((row) => row.name === 'د/ حسن');

    expect(doctor).toBeDefined();
    expect(doctor?.totalSales).toBeCloseTo(41702.36, 2);
    expect(doctor?.staffId).toBeNull();
  });

  it('groups multiple invoices under the same staff_id doctor', async () => {
    fetchSalesInvoicesPagedSafeMock
      .mockResolvedValueOnce([
        invoiceRow({ invoice_no: '1', staff_id: 'uuid-2', normalized_seller_name: 'د/ ساره', net_amount: 20000 }),
        invoiceRow({ invoice_no: '2', staff_id: 'uuid-2', normalized_seller_name: 'د/ ساره', net_amount: 19638.15 }),
      ])
      .mockResolvedValueOnce([]);

    const metrics = await getDoctorCompetitionMetrics({ period: 'custom', customStart: '2026-01-01', customEnd: '2026-01-01' });
    const doctor = metrics.rows.find((row) => row.staffId === 'uuid-2');

    expect(doctor).toBeDefined();
    expect(doctor?.totalSales).toBeCloseTo(39638.15, 2);
    expect(doctor?.invoices).toBe(2);
  });

  it('does not award average invoice winner when invoices count is below threshold', async () => {
    fetchSalesInvoicesPagedSafeMock
      .mockResolvedValueOnce([
        invoiceRow({ invoice_no: '1', seller_name: 'د/ وائل', net_amount: 31800 }),
      ])
      .mockResolvedValueOnce([]);

    const metrics = await getDoctorCompetitionMetrics({ period: 'custom', customStart: '2026-01-01', customEnd: '2026-01-01' });

    expect(metrics.winners.averageInvoice).toBeNull();
    expect(metrics.reviewRows.some((row) => row.name === 'د/ وائل' && !row.avgInvoiceEligible)).toBe(true);
  });

  it('does not pick a zero-sales doctor as sales winner', async () => {
    fetchSalesInvoicesPagedSafeMock
      .mockResolvedValueOnce([invoiceRow({ seller_name: 'د/ أميرة', net_amount: 0 })])
      .mockResolvedValueOnce([]);

    const metrics = await getDoctorCompetitionMetrics({ period: 'custom', customStart: '2026-01-01', customEnd: '2026-01-01' });

    expect(metrics.rows.length).toBe(0);
    expect(metrics.winners.sales).toBeNull();
    expect(metrics.eligibleRows.length).toBe(0);
    expect(metrics.reviewRows.length).toBe(0);
  });

  it('does not pick one-invoice outlier as average invoice winner', async () => {
    fetchSalesInvoicesPagedSafeMock
      .mockResolvedValueOnce([
        invoiceRow({ invoice_no: '1', seller_name: 'د/ وائل', net_amount: 31800 }),
        invoiceRow({ invoice_no: '2', seller_name: 'د/ سارة', net_amount: 12000 }),
      ])
      .mockResolvedValueOnce([invoiceRow({ invoice_no: '3', seller_name: 'د/ سارة', net_amount: 10000 })]);

    const metrics = await getDoctorCompetitionMetrics({ period: 'custom', customStart: '2026-01-01', customEnd: '2026-01-01' });

    expect(metrics.winners.averageInvoice).toBeNull();
    expect(metrics.reviewRows.some((row) => row.name === 'د/ وائل' && !row.avgInvoiceEligible)).toBe(true);
  });

  it('does not pick stagnant winner when stagnant data is disabled', async () => {
    fetchSalesInvoicesPagedSafeMock
      .mockResolvedValueOnce([invoiceRow({ seller_name: 'د/ سارة', net_amount: 12000 })])
      .mockResolvedValueOnce([invoiceRow({ seller_name: 'د/ سارة', net_amount: 10000 })]);

    const metrics = await getDoctorCompetitionMetrics({ period: 'custom', customStart: '2026-01-01', customEnd: '2026-01-01' });

    expect(metrics.metadata.stagnantEnabled).toBe(false);
    expect(metrics.winners.stagnant).toBeNull();
    expect(metrics.eligibleRows[0].stagnantStatus).toBe('disabled');
  });

  it('marks growth unavailable when previous period has no sales', async () => {
    fetchSalesInvoicesPagedSafeMock
      .mockResolvedValueOnce([invoiceRow({ seller_name: 'د/ سارة', net_amount: 12000 })])
      .mockResolvedValueOnce([]);

    const metrics = await getDoctorCompetitionMetrics({ period: 'custom', customStart: '2026-01-01', customEnd: '2026-01-01' });

    expect(metrics.eligibleRows[0].growthRate).toBeNull();
    expect(metrics.eligibleRows[0].growthRateStatus).toBe('unavailable');
  });

  it('keeps unknown doctor out of eligible rows', async () => {
    fetchSalesInvoicesPagedSafeMock
      .mockResolvedValueOnce([invoiceRow({ seller_name: 'غير محدد', net_amount: 12000 })])
      .mockResolvedValueOnce([]);

    const metrics = await getDoctorCompetitionMetrics({ period: 'custom', customStart: '2026-01-01', customEnd: '2026-01-01' });

    expect(metrics.eligibleRows.some((row) => row.name === 'غير محدد')).toBe(false);
    expect(metrics.reviewRows.some((row) => row.reviewIssues.includes('دكتور غير محدد'))).toBe(true);
  });
});
