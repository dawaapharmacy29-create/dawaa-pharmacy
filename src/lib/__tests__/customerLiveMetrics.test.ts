import { describe, it, expect } from 'vitest';
import { buildCustomerLiveMetrics } from '@/lib/customers/buildCustomerLiveMetrics';

function invoice(amount: number, id: string, date = '2026-06-01') {
  return { net_amount: amount, invoice_number: id, invoice_date: date } as Record<string, unknown>;
}

describe('buildCustomerLiveMetrics', () => {
  it('aggregates invoices and computes totals correctly', () => {
    const amounts = [83, 85, 80, 180, 370, 1500];
    // remaining 10 invoices summing to 2546.5
    const rest = [200, 220, 300, 150, 120, 55.5, 90, 300, 200, 910.5];
    const all = [...amounts, ...rest];
    // ensure length 16
    expect(all.length).toBe(16);
    const rows = all.map((a, idx) => invoice(a, `inv-${idx}`, `2026-0${(idx % 6) + 1}-01`));
    const metrics = buildCustomerLiveMetrics(rows as any);

    const total = Math.round(metrics.totalPurchases * 10) / 10;
    const expected = Math.round(all.reduce((s, v) => s + v, 0) * 10) / 10;
    expect(total).toBeCloseTo(expected, 1);
    expect(metrics.invoicesCount).toBe(16);
    expect(Math.round(metrics.avgInvoice)).toBe(Math.round(4844.5 / 16));
  });

  it('merges invoices with same customer_code regardless of phone', () => {
    const rows = [
      { invoice_number: 'A', net_amount: 100, customer_code: '3660', phone: '' },
      { invoice_number: 'B', net_amount: 200, customer_code: '3660', phone: 'code:3660' },
    ];
    const metrics = buildCustomerLiveMetrics(rows as any);
    expect(metrics.invoicesCount).toBe(2);
    expect(metrics.totalPurchases).toBe(300);
  });
});
