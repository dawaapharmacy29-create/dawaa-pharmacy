import { describe, expect, it } from 'vitest';
import {
  buildInvoiceItemEvidenceProvider,
  snapshotInvoiceItemEvidence,
} from '@/lib/salesIntelligence/invoiceItemEvidenceRepository';

describe('Invoice item evidence repository', () => {
  it('maps an item directly through canonical invoice_id', () => {
    const provider = buildInvoiceItemEvidenceProvider(
      [{ id: 'inv-1', invoice_number: '100', branch: 'فرع شكري' }] as any[],
      [{
        invoice_id: 'inv-1',
        invoice_number: '100',
        branch: 'فرع شكري',
        product_id: 'product-uuid-1',
        product_code: 'P100',
        product_name: 'Vitamin D',
        quantity: 2,
        line_total: 180,
      }]
    );
    const items = provider.getItemsForInvoice('inv-1', '100');
    expect(items).not.toBe('unavailable');
    if (items === 'unavailable') return;
    expect(items[0]).toMatchObject({
      productId: 'product-uuid-1',
      productCode: 'P100',
      productNameRaw: 'Vitamin D',
      quantity: 2,
      lineTotal: 180,
    });
  });

  it('falls back to invoice_number + normalized branch only when that pair is unique', () => {
    const provider = buildInvoiceItemEvidenceProvider(
      [
        { id: 'shokry-100', invoice_number: '100', branch: 'فرع شكري' },
        { id: 'shami-100', invoice_number: '100', branch: 'فرع الشامي' },
      ] as any[],
      [{
        invoice_id: null,
        invoice_number: '100',
        branch: 'شكري',
        product_name: 'Vitamin D',
        quantity: 1,
        line_total: 90,
      }]
    );
    expect(provider.getItemsForInvoice('shokry-100', '100')).not.toBe('unavailable');
    expect(provider.getItemsForInvoice('shami-100', '100')).toBe('unavailable');
  });

  it('never guesses when invoice_number + branch still points to more than one candidate', () => {
    const provider = buildInvoiceItemEvidenceProvider(
      [
        { id: 'inv-a', invoice_number: '100', branch: 'فرع شكري' },
        { id: 'inv-b', invoice_number: '100', branch: 'فرع شكري' },
      ] as any[],
      [{
        invoice_id: null,
        invoice_number: '100',
        branch: 'فرع شكري',
        product_name: 'Vitamin D',
        quantity: 1,
        line_total: 90,
      }]
    );
    expect(provider.getItemsForInvoice('inv-a', '100')).toBe('unavailable');
    expect(provider.getItemsForInvoice('inv-b', '100')).toBe('unavailable');
  });

  it('aggregates duplicate invoice lines with the same exact product code before matching', () => {
    const provider = buildInvoiceItemEvidenceProvider(
      [{ id: 'inv-1', invoice_number: '35205', branch: 'فرع الشامي' }] as any[],
      [
        {
          invoice_id: 'inv-1', invoice_number: '35205', branch: 'فرع الشامي',
          product_code: '83183', product_name: 'be bem 4 58 piece', quantity: 1,
          unit_price: 363, line_total: 362.82,
        },
        {
          invoice_id: 'inv-1', invoice_number: '35205', branch: 'فرع الشامي',
          product_code: '83183', product_name: 'be bem 4 58 piece', quantity: 1,
          unit_price: 363, line_total: 362.82,
        },
      ]
    );
    const items = provider.getItemsForInvoice('inv-1', '35205');
    expect(items).not.toBe('unavailable');
    if (items === 'unavailable') return;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      productCode: '83183',
      quantity: 2,
      unitPrice: 363,
    });
    expect(items[0].lineTotal).toBeCloseTo(725.64, 2);
  });

  it('does not merge same-name lines when neither canonical product id nor product code exists', () => {
    const provider = buildInvoiceItemEvidenceProvider(
      [{ id: 'inv-1', invoice_number: '100', branch: 'فرع شكري' }] as any[],
      [
        { invoice_id: 'inv-1', invoice_number: '100', branch: 'فرع شكري', product_name: 'Unknown Product', quantity: 1, line_total: 10 },
        { invoice_id: 'inv-1', invoice_number: '100', branch: 'فرع شكري', product_name: 'Unknown Product', quantity: 1, line_total: 10 },
      ]
    );
    const items = provider.getItemsForInvoice('inv-1', '100');
    expect(items).not.toBe('unavailable');
    if (items === 'unavailable') return;
    expect(items).toHaveLength(2);
  });

  it('returns unavailable, not an empty array, when no line-item evidence exists', () => {
    const provider = buildInvoiceItemEvidenceProvider(
      [{ id: 'inv-1', invoice_number: '100', branch: 'فرع شكري' }] as any[],
      []
    );
    expect(provider.getItemsForInvoice('inv-1', '100')).toBe('unavailable');
  });

  it('produces a stable evidence snapshot independent of invoice id input order', () => {
    const provider = buildInvoiceItemEvidenceProvider(
      [
        { id: 'inv-1', invoice_number: '100', branch: 'فرع شكري' },
        { id: 'inv-2', invoice_number: '101', branch: 'فرع شكري' },
      ] as any[],
      [
        { invoice_id: 'inv-2', invoice_number: '101', branch: 'فرع شكري', product_name: 'B', quantity: 1, line_total: 10 },
        { invoice_id: 'inv-1', invoice_number: '100', branch: 'فرع شكري', product_name: 'A', quantity: 2, line_total: 20 },
      ]
    );
    expect(snapshotInvoiceItemEvidence(provider, ['inv-2', 'inv-1']))
      .toEqual(snapshotInvoiceItemEvidence(provider, ['inv-1', 'inv-2']));
  });
});
