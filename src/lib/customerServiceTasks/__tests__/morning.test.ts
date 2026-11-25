import { describe, expect, it } from 'vitest';
import {
  pairTransfers,
  summarizeByDoctor,
  transferProgress,
  type DoctorError,
  type TransferPurchase,
  type TransferSale,
} from '../morning';

const purchase = (
  serial: string,
  net: number,
  at: string,
  extra: Partial<TransferPurchase> = {}
): TransferPurchase => ({
  store: 'الادارة فرع شكري',
  serial,
  invoice_at: at,
  supplier_name: 'دواء الشامي',
  supplier_invoice_no: null,
  items: 1,
  net,
  entered_by: 'نور',
  note: null,
  lines: [],
  check: null,
  ...extra,
});

const sale = (
  invoice: string,
  net: number,
  at: string,
  extra: Partial<TransferSale> = {}
): TransferSale => ({
  invoice,
  at,
  net,
  seller: 'د اميرة',
  lines: 1,
  note: null,
  items: [],
  check: null,
  ...extra,
});

describe('pairTransfers', () => {
  it('pairs by the sale number written on the purchase before anything else', () => {
    const r = pairTransfers(
      [purchase('13034', 51, '2026-11-22 10:00', { supplier_invoice_no: '83881' })],
      [sale('83880', 51, '2026-11-22 10:01'), sale('83881', 60, '2026-11-22 09:00')]
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].sale.invoice).toBe('83881');
    expect(r.pairs[0].how).toBe('number');
    expect(r.salesOnly.map((s) => s.invoice)).toEqual(['83880']);
  });

  it('pairs the same value to the nearest sale and uses each sale once', () => {
    const r = pairTransfers(
      [purchase('1', 70, '2026-11-22 19:25'), purchase('2', 70, '2026-11-22 22:00')],
      [sale('a', 70, '2026-11-22 21:59'), sale('b', 70, '2026-11-22 19:27')]
    );
    const bySerial = Object.fromEntries(r.pairs.map((p) => [p.purchase.serial, p.sale.invoice]));
    expect(bySerial).toEqual({ '1': 'b', '2': 'a' });
    expect(r.purchasesOnly).toHaveLength(0);
  });

  it('prefers the same value with the same number of lines', () => {
    const r = pairTransfers(
      [purchase('1', 100, '2026-11-22 12:00', { items: 3 })],
      [
        sale('near', 100, '2026-11-22 12:01', { lines: 1 }),
        sale('far', 100, '2026-11-22 08:00', { lines: 3 }),
      ]
    );
    expect(r.pairs[0].sale.invoice).toBe('far');
    expect(r.pairs[0].how).toBe('value_items');
  });

  it('pairs by the item codes when the purchase report came with its items', () => {
    const line = (code: string) => ({ code, name: code, qty: 1, price: 10, total: 10 });
    const r = pairTransfers(
      [purchase('1', 95, '2026-11-22 12:00', { items: 3, lines: ['a', 'b', 'c'].map(line) })],
      [
        sale('near', 95, '2026-11-22 12:01', { lines: 3, items: ['x', 'y', 'z'].map(line) }),
        sale('far', 100, '2026-11-22 08:00', { lines: 3, items: ['a', 'b', 'd'].map(line) }),
      ]
    );
    expect(r.pairs[0].sale.invoice).toBe('far');
    expect(r.pairs[0].how).toBe('codes');
  });

  it('keeps a saved link and leaves a purchase marked «no sale» unpaired', () => {
    const r = pairTransfers(
      [
        purchase('1', 30, '2026-11-22 04:29', {
          check: { status: 'ok', problems: [], note: null, by: 'نور', at: '', sale_invoice: 's1' },
        }),
        purchase('2', 50, '2026-11-22 05:00', {
          check: {
            status: 'problem',
            problems: ['no_sale'],
            note: null,
            by: 'نور',
            at: '',
            sale_invoice: null,
          },
        }),
      ],
      [sale('s1', 40, '2026-11-22 04:31'), sale('s2', 50, '2026-11-22 05:01')]
    );
    expect(r.pairs.map((p) => [p.purchase.serial, p.sale.invoice, p.how])).toEqual([
      ['1', 's1', 'saved'],
    ]);
    expect(r.purchasesOnly.map((p) => p.serial)).toEqual(['2']);
    expect(r.salesOnly.map((s) => s.invoice)).toEqual(['s2']);
    // الاتنين اتراجعوا، والبيع اللي فاضل لسه.
    expect(transferProgress(r)).toEqual({ done: 2, total: 3 });
  });
});

describe('summarizeByDoctor', () => {
  const row = (
    responsible: string,
    decision: DoctorError['decision'],
    problems: string[],
    points: number | null = null
  ): DoctorError => ({
    id: Math.random().toString(),
    kind: 'purchase',
    branch: 'فرع شكري',
    day: '2026-11-23',
    label: null,
    net: 10,
    responsible,
    responsible_staff_id: null,
    problems,
    note: null,
    reported_by: 'نور',
    reported_at: '',
    decision,
    outcome: null,
    points,
    decided_by: null,
    decided_at: null,
    decision_note: null,
  });

  it('counts invoices and problems per person and skips dismissed ones', () => {
    const s = summarizeByDoctor([
      row('د اميرة', 'pending', ['price']),
      row('د اميرة', 'deducted', ['price', 'qty'], -2),
      row('د اميرة', 'dismissed', ['qty']),
      row('د عمر', 'pending', ['wrong_supplier']),
    ]);
    expect(s[0]).toEqual({
      name: 'د اميرة',
      invoices: 2,
      pending: 1,
      points: -2,
      problems: { price: 2, qty: 1 },
    });
    expect(s[1].name).toBe('د عمر');
  });
});
