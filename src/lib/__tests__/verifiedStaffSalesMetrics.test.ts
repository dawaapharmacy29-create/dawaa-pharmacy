import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/invoiceCache', () => ({ clearInvoiceCache: vi.fn() }));

import { computeVerifiedStaffSalesMetrics } from '@/lib/salesInvoiceSource';

describe('unified core verified staff sales', () => {
  const invoices = [
    { id: '1', staff_id: 'staff-one', seller_name: 'د دنيا', net_amount: 100, customer_code: 'C1' },
    { id: '2', staff_id: null, seller_name: 'د دنيا', net_amount: 900, customer_code: 'C2' },
    { id: '3', staff_id: 'staff-two', seller_name: 'د دنيا', net_amount: 400, customer_code: 'C3' },
    { id: '4', staff_id: 'staff-one', seller_name: 'اسم قديم', net_amount: 200, customer_code: 'C1' },
  ];

  it('credits only invoices with the exact canonical staff ID', () => {
    const result = computeVerifiedStaffSalesMetrics('staff-one', invoices);
    expect(result.invoiceCount).toBe(2);
    expect(result.totalSales).toBe(300);
    expect(result.averageInvoice).toBe(150);
    expect(result.customersHandled).toBe(1);
    expect(result.linkedInvoices).toBe(2);
  });

  it('does not credit same-name invoices belonging to another ID or no ID', () => {
    const result = computeVerifiedStaffSalesMetrics('staff-two', invoices);
    expect(result.invoiceCount).toBe(1);
    expect(result.totalSales).toBe(400);
  });

  it('never credits invoices when the requested staff ID is empty', () => {
    expect(computeVerifiedStaffSalesMetrics('', invoices).invoiceCount).toBe(0);
    expect(computeVerifiedStaffSalesMetrics('', invoices).totalSales).toBe(0);
  });
});
