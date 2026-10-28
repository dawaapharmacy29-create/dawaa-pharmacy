import { describe, expect, it } from 'vitest';
import { mustPreserveInvoiceStaffId } from '../invoiceSellerIdentity';

describe('invoice seller canonical identity', () => {
  it('never strips staff_id from sales invoice saves when the schema cache is stale', () => {
    expect(mustPreserveInvoiceStaffId('sales_invoices', 'staff_id')).toBe(true);
    expect(mustPreserveInvoiceStaffId('sales_invoices', 'other_optional_field')).toBe(false);
    expect(mustPreserveInvoiceStaffId('other_table', 'staff_id')).toBe(false);
  });

});
