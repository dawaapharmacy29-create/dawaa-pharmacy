import { describe, expect, it } from 'vitest';
import { mustPreserveInvoiceStaffId, resolveInvoiceSellerIdentity, retainExistingInvoiceStaffId } from '../invoiceSellerIdentity';
import type { StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';

function staff(id: string, name: string, branch: string, active = true): StaffDirectoryIdentity {
  return { id, name, branch, active, status: active ? 'active' : 'archived', source: 'staff', role: null, username: null };
}

describe('invoice seller canonical identity', () => {
  it('never strips staff_id from sales invoice saves when the schema cache is stale', () => {
    expect(mustPreserveInvoiceStaffId('sales_invoices', 'staff_id')).toBe(true);
    expect(mustPreserveInvoiceStaffId('sales_invoices', 'other_optional_field')).toBe(false);
    expect(mustPreserveInvoiceStaffId('other_table', 'staff_id')).toBe(false);
  });

  it('re-import never loses a human-confirmed identity or silently overwrites it', () => {
    expect(retainExistingInvoiceStaffId('owner-confirmed-alia', null)).toBe('owner-confirmed-alia');
    expect(retainExistingInvoiceStaffId('owner-confirmed-mohamed', 'another-mohamed')).toBe('owner-confirmed-mohamed');
    expect(retainExistingInvoiceStaffId(null, 'unique-active-id')).toBe('unique-active-id');
    expect(retainExistingInvoiceStaffId(null, null)).toBeNull();
  });
  it('links B-Connect names to the active employee, never the archived twin', () => {
    const directory = [staff('active-donia', 'د دنيا', 'فرع شكري'), staff('archived-donia', 'د/ دنيا', 'المخزن', false)];
    for (const input of ['د/ دنيا', 'د دنيا', 'دنيا']) {
      expect(resolveInvoiceSellerIdentity(input, 'شكري', directory)).toBe('active-donia');
    }
  });

  it('does not silently pick the first active employee with the same name', () => {
    const directory = [staff('a', 'د أميرة', 'فرع شكري'), staff('b', 'د/ أميرة', 'فرع شكري')];
    expect(resolveInvoiceSellerIdentity('أميرة', 'شكري', directory)).toBeNull();
  });

  it('uses the invoice branch solely to distinguish two active names', () => {
    const directory = [staff('a', 'د أميرة', 'فرع شكري'), staff('b', 'د أميرة', 'فرع الشامي')];
    expect(resolveInvoiceSellerIdentity('د/ أميرة', 'شكري', directory)).toBe('a');
    expect(resolveInvoiceSellerIdentity('د/ أميرة', 'فرع الشامي', directory)).toBe('b');
  });

  it('rejects unverified names and keeps matching aliases on the same staff id', () => {
    const directory = [staff('a', 'د دنيا', 'شكري'), { ...staff('a', 'د/ دنيا', 'شكري'), source: 'alias' as const }];
    expect(resolveInvoiceSellerIdentity('دنيا', 'شكري', directory)).toBe('a');
    expect(resolveInvoiceSellerIdentity('د شبل', 'شكري', directory)).toBeNull();
  });
});
