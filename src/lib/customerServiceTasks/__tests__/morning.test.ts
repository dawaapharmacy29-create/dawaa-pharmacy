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
  it('pairs one sale with the two purchases it was received as, before a lone same-value sale far away', () => {
    // بيع 84254 بـ 5,088 اتسجل شراء على 13128 (4,000) و 13130 (1,088)، وفيه بيع تاني بـ 1,088 من ٢٢ ساعة.
    const r = pairTransfers(
      [
        purchase('13128', 4000, '2026-11-24 22:43'),
        purchase('13130', 1088, '2026-11-24 22:57'),
        purchase('13112', 450, '2026-11-24 19:26'),
      ],
      [
        sale('84133', 1088, '2026-11-24 00:18', { lines: 2 }),
        sale('84254', 5088, '2026-11-24 22:55', { lines: 2 }),
      ]
    );
    expect(
      r.pairs.map((p) => [p.sale.invoice, p.how, p.purchase.serial, ...p.rest.map((x) => x.serial)])
    ).toEqual([['84254', 'split', '13128', '13130']]);
    expect(r.purchasesOnly.map((p) => p.serial)).toEqual(['13112']);
    expect(r.salesOnly.map((s) => s.invoice)).toEqual(['84133']);
  });

  it('does not split across purchases more than three hours from the sale', () => {
    const r = pairTransfers(
      [purchase('a', 4000, '2026-11-24 10:00'), purchase('b', 1088, '2026-11-24 22:57')],
      [sale('s', 5088, '2026-11-24 22:55')]
    );
    expect(r.pairs).toHaveLength(0);
  });

  it('keeps a saved split together and counts it done only when every purchase is saved', () => {
    const ok = (sale_invoice: string) => ({
      status: 'ok' as const,
      problems: [],
      note: null,
      by: 'نور',
      at: '',
      sale_invoice,
    });
    const both = pairTransfers(
      [
        purchase('1', 4000, '2026-11-24 22:43', { check: ok('s') }),
        purchase('2', 1088, '2026-11-24 22:57', { check: ok('s') }),
      ],
      [sale('s', 5088, '2026-11-24 22:55', { check: { ...ok('s'), purchase_serial: '1' } })]
    );
    expect(both.pairs.map((p) => [p.how, p.purchase.serial, p.rest.map((x) => x.serial)])).toEqual([
      ['saved', '1', ['2']],
    ]);
    expect(transferProgress(both)).toEqual({ done: 1, total: 1 });
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
