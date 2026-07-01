import { describe, expect, it } from 'vitest';
import { buildInvoiceDuplicateIdentity } from '@/lib/invoiceImporter';

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
