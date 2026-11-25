import { describe, expect, it } from 'vitest';
import { matchesPurchase, paperSerialRate, type PurchaseInvoice } from '../morning';

const invoice = (extra: Partial<PurchaseInvoice> = {}): PurchaseInvoice => ({
  store: 'الادارة فرع شكري',
  serial: '21949',
  invoice_at: '2026-11-24T01:23:00',
  supplier_code: '479',
  supplier_name: 'دواء زكريا',
  supplier_invoice_no: '88123',
  items: 1,
  net: 178.5,
  payment: 'credit',
  entered_by: 'د اسلام فاروق',
  note: null,
  check: null,
  ...extra,
});

describe('searching purchase invoices', () => {
  it('finds by serial or supplier invoice number, in Arabic digits too', () => {
    expect(matchesPurchase(invoice(), '21949')).toBe(true);
    expect(matchesPurchase(invoice(), '٢١٩٤٩')).toBe(true);
    expect(matchesPurchase(invoice(), '88123')).toBe(true);
    expect(matchesPurchase(invoice(), '5555')).toBe(false);
  });

  it('finds by who entered it or the supplier, ignoring alef and taa marbuta forms', () => {
    expect(matchesPurchase(invoice(), 'إسلام')).toBe(true);
    expect(matchesPurchase(invoice(), 'زكريا')).toBe(true);
    expect(matchesPurchase(invoice({ entered_by: 'د اميرة' }), 'اميره')).toBe(true);
    expect(matchesPurchase(invoice(), 'وائل')).toBe(false);
    expect(matchesPurchase(invoice(), '  ')).toBe(true);
  });

  it('finds a serial she corrected', () => {
    expect(
      matchesPurchase(
        invoice({
          check: {
            status: 'fixed',
            problems: [],
            fix: { serial: '30001' },
            note: null,
            by: null,
            at: '',
          },
        }),
        '30001'
      )
    ).toBe(true);
  });
});

describe('paper serial rate', () => {
  it('is the share of answered invoices where the serial was written', () => {
    expect(paperSerialRate({ checked: 8, wrote: 6 })).toBe(75);
    expect(paperSerialRate({ checked: 0, wrote: 0 })).toBeNull();
  });
});
