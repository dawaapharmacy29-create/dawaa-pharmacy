import { describe, expect, it } from 'vitest';
import type { TransferDay, TransferLine } from '../customerServiceTasks/morning';
import { transferAccuracy } from '../purchaseReview/transferAccuracy';

const l = (code: string, name: string, qty: number): TransferLine => ({
  code,
  name,
  qty,
  price: 0,
  total: 0,
});

const day: TransferDay = {
  day: '2026-11-25',
  branch: 'فرع شكري',
  sale_branch: 'فرع الشامي',
  can_pick: true,
  from: '',
  to: '',
  purchases: [
    {
      store: 'الادارة فرع شكري',
      serial: '22011',
      invoice_at: '2026-11-25 08:00',
      supplier_name: 'دواء الشامي',
      supplier_invoice_no: '5001',
      items: 3,
      net: 500,
      entered_by: 'د كريم',
      note: null,
      lines: [l('10', 'PAMPERS PREM 1 60PCS', 1), l('1088', 'FURAZOL TAB', 0.5), l('7', 'X 1', 1)],
      check: null,
    },
  ],
  sales: [
    {
      invoice: '5001',
      at: '2026-11-25 07:50',
      net: 500,
      seller: 'د اميرة',
      lines: 3,
      note: null,
      items: [l('5', 'pampers premium 1 60 pcs', 1), l('1088', 'FURAZOL TAB', 1), l('7', 'X 1', 1)],
      check: null,
    },
  ],
};

describe('تقرير دقة التحويلات', () => {
  it('collects the duplicate codes, the doctors and the items to count', () => {
    const r = transferAccuracy([day]);
    expect(r).toMatchObject({ transfers: 1, compared: 1, withIssues: 1, noLines: 0 });
    expect(r.issues.map((i) => i.check)).toEqual(['code', 'qty']);
    expect(r.issues[0].route).toBe('فرع الشامي → فرع شكري');
    expect(r.codePairs).toEqual([
      expect.objectContaining({
        saleCode: '5',
        purchaseCode: '10',
        times: 1,
        people: ['د اميرة', 'د كريم'],
      }),
    ]);
    expect(r.doctors.map((d) => [d.name, d.soldWithIssues, d.receivedWithIssues])).toEqual([
      ['د اميرة', 1, 0],
      ['د كريم', 0, 1],
    ]);
    expect(r.suspects).toContainEqual(
      expect.objectContaining({ branch: 'فرع شكري', code: '1088', offBy: -0.5 })
    );
  });

  it('counts a transfer without purchase items as not compared', () => {
    const r = transferAccuracy([{ ...day, purchases: [{ ...day.purchases[0], lines: [] }] }]);
    expect(r).toMatchObject({ transfers: 1, compared: 0, noLines: 1, issues: [] });
  });
});
