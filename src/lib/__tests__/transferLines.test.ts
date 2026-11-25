import { describe, expect, it } from 'vitest';
import { compareTransferLines, nameSimilarity } from '../purchaseReview/invoiceLines';

describe('مطابقة أصناف التحويل', () => {
  it('reads two names of one item as the same, and different sizes as different', () => {
    expect(
      nameSimilarity('pampers premium 1 60 pcs', 'PAMPERS PREM 1 60PCS')
    ).toBeGreaterThanOrEqual(0.5);
    expect(nameSimilarity('pampers premium 1 60 pcs', 'pampers premium 2 60 pcs')).toBe(0);
    expect(nameSimilarity('INDERAL 40 MG 50 TAB', 'inderal 40mg 50 tab')).toBe(1);
    expect(nameSimilarity('CONCOR 5 30TAB', 'CONCOR 10 30TAB')).toBe(0);
    expect(nameSimilarity('brufen 600mg 10 sachets', 'panadol 600mg 10 sachets')).toBe(0);
  });

  it('finds the same code and quantity, a different quantity, a duplicate code, and what is on one side only', () => {
    const rows = compareTransferLines(
      [
        { code: '47724', name: 'INDERAL 40 MG 50 TAB', qty: 1 },
        { code: '5', name: 'pampers premium 1 60 pcs', qty: 2, price: 420 },
        { code: '1088', name: 'FURAZOL TAB', qty: 1 },
        { code: '777', name: 'ranexa 500 mg 60 tab', qty: 1 },
      ],
      [
        { code: '47724', name: 'INDERAL 40 MG 50 TAB', qty: 1 },
        { code: '10', name: 'PAMPERS PREM 1 60PCS', qty: 1, price: 420 },
        { code: '1088', name: 'FURAZOL TAB', qty: 0.5 },
        { code: '999', name: 'NASONEX SPRAY', qty: 1 },
      ]
    );
    expect(rows.map((r) => [r.check, r.sale?.code ?? null, r.purchase?.code ?? null])).toEqual([
      ['code', '5', '10'],
      ['qty', '1088', '1088'],
      ['only_sale', '777', null],
      ['only_purchase', null, '999'],
      ['ok', '47724', '47724'],
    ]);
    expect(rows[0].qtyDiffers).toBe(true);
  });

  it('adds up one code written on two lines', () => {
    const rows = compareTransferLines(
      [
        { code: '1', name: 'A 1', qty: 1 },
        { code: '1', name: 'A 1', qty: 1 },
      ],
      [{ code: '1', name: 'A 1', qty: 2 }]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].check).toBe('ok');
  });
});
