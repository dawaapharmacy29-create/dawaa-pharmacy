import { describe, expect, it } from 'vitest';
import { buildInvoiceDuplicateIdentity, parseInvoiceDate } from '@/lib/invoiceImporter';

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
});

describe('parseInvoiceDate', () => {
  it('parses Egyptian dd/mm/yyyy dates without swapping day and month', () => {
    expect(parseInvoiceDate('02/07/2026')).toBe('2026-07-02');
    expect(parseInvoiceDate('03/07/2026')).toBe('2026-07-03');
  });

  it('supports dd-mm-yyyy and Excel serial dates', () => {
    expect(parseInvoiceDate('2-7-2026')).toBe('2026-07-02');
    expect(parseInvoiceDate(46205)).toBe('2026-07-02');
  });
});
