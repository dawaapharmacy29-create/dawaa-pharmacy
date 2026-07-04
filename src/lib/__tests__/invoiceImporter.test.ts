import { describe, expect, it } from 'vitest';
import { buildInvoiceDuplicateIdentity, parseInvoiceDate } from '@/lib/invoiceImporter';
import {
  getInvoiceAmount,
  getInvoiceBranch,
  getInvoiceDay,
  getInvoiceId,
  getInvoiceSellerName,
} from '@/lib/invoices/invoiceCore';

describe('buildInvoiceDuplicateIdentity', () => {
  it('uses invoice number, branch and date to create a stable duplicate key', () => {
    expect(buildInvoiceDuplicateIdentity('INV-100', 'فرع شكري', '2026-07-01')).toBe(
      'INV-100|فرع شكري|2026-07-01'
    );
  });

  it('normalizes empty branch and trims values', () => {
    expect(buildInvoiceDuplicateIdentity('  INV-200  ', '  ', '2026-07-02')).toBe(
      'INV-200|غير محدد|2026-07-02'
    );
  });

  it('treats branch aliases as the same normalized branch and normalizes date values', () => {
    const key1 = buildInvoiceDuplicateIdentity('INV-300', 'شكري', '02/07/2026');
    const key2 = buildInvoiceDuplicateIdentity('INV-300', 'فرع شكري', '2026-07-02T08:15:00Z');
    expect(key1).toBe(key2);
  });

  it('returns different keys for same invoice number with different dates or branches', () => {
    const baseKey = buildInvoiceDuplicateIdentity('INV-400', 'فرع شكري', '2026-07-02');
    const differentDateKey = buildInvoiceDuplicateIdentity('INV-400', 'فرع شكري', '2026-07-03');
    const differentBranchKey = buildInvoiceDuplicateIdentity('INV-400', 'فرع الشامي', '2026-07-02');

    expect(differentDateKey).not.toBe(baseKey);
    expect(differentBranchKey).not.toBe(baseKey);
  });

  it('does not treat blank invoice numbers as the same invoice across different dates or normalized branches', () => {
    const keyA = buildInvoiceDuplicateIdentity('', 'فرع شكري', '2026-07-02');
    const keyB = buildInvoiceDuplicateIdentity('', 'فرع الشامي', '2026-07-02');
    const keyC = buildInvoiceDuplicateIdentity('', 'فرع شكري', '2026-07-03');

    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyC);
  });
});

describe('parseInvoiceDate', () => {
  it('parses Egyptian dd/mm/yyyy dates without swapping day and month', () => {
    expect(parseInvoiceDate('02/07/2026')).toBe('2026-07-02');
    expect(parseInvoiceDate('03/07/2026')).toBe('2026-07-03');
  });

  it('supports dd-mm-yyyy, ISO dates, and Excel serial dates', () => {
    expect(parseInvoiceDate('2-7-2026')).toBe('2026-07-02');
    expect(parseInvoiceDate('2026-07-02')).toBe('2026-07-02');
    expect(parseInvoiceDate(46205)).toBe('2026-07-02');
    expect(parseInvoiceDate('46205')).toBe('2026-07-02');
    expect(parseInvoiceDate('2026-07-02T08:15:00Z')).toBe('2026-07-02');
  });
});

describe('invoiceCore helpers', () => {
  it('uses one canonical day parser across invoice fields', () => {
    expect(getInvoiceDay({ sale_date: '02/07/2026' })).toBe('2026-07-02');
    expect(getInvoiceDay({ invoice_datetime: '03/07/2026 14:30' })).toBe('2026-07-03');
  });

  it('prefers net amount fields in the expected order', () => {
    expect(getInvoiceAmount({ net_amount: 120, net_total: 90, amount: 80 })).toBe(120);
    expect(getInvoiceAmount({ net_total: 90, total_amount: 80, amount: 70 })).toBe(90);
    expect(getInvoiceAmount({ total_amount: 80, amount: 70 })).toBe(80);
    expect(getInvoiceAmount({ amount: 70, gross_amount: 100 })).toBe(70);
  });

  it('normalizes invoice id, branch and seller name', () => {
    expect(getInvoiceId({ invoice_number: '  A-1  ', invoice_no: 'B-2' })).toBe('A-1');
    expect(getInvoiceBranch({ branch: 'shokry' })).toBe('فرع شكري');
    expect(getInvoiceBranch({ branch_name: 'الشامي' })).toBe('فرع الشامي');
    expect(getInvoiceSellerName({ staff_name: 'د/ سارة', seller_name: 'د/ بسنت' })).toBe('د/ سارة');
  });
});
