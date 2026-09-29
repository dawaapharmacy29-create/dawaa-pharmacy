import { describe, expect, it } from 'vitest';
import { selectVerifiedProductInvoiceV23 } from '@/lib/salesIntelligence/productInvoiceVerificationV23';

const invoice = {
  id: 'inv-1',
  invoice_number: '1001',
  invoice_datetime: '2026-09-15T10:05:00.000Z',
  close_datetime: '2026-09-15T10:06:00.000Z',
  net_total: 250,
};

describe('productInvoiceVerificationV23 return-aware evidence', () => {
  it('does not count a fully returned line as positive product-sale evidence', () => {
    const match = selectVerifiedProductInvoiceV23({
      product: { productId: 'p1', productCode: 'C1', productName: 'Product A' },
      openedAt: '2026-09-15T10:00:00.000Z',
      lastStageAt: '2026-09-15T10:10:00.000Z',
      invoices: [invoice],
      items: [{
        invoice_id: 'inv-1',
        product_id: 'p1',
        product_code: 'C1',
        product_name: 'Product A',
        quantity: 2,
        returned_quantity: 2,
        effective_quantity: 0,
        line_total: 0,
      }],
    });

    expect(match).toBeNull();
  });

  it('keeps a partially returned line when effective sold quantity remains positive', () => {
    const match = selectVerifiedProductInvoiceV23({
      product: { productId: 'p1', productCode: 'C1', productName: 'Product A' },
      openedAt: '2026-09-15T10:00:00.000Z',
      lastStageAt: '2026-09-15T10:10:00.000Z',
      invoices: [invoice],
      items: [{
        invoice_id: 'inv-1',
        product_id: 'p1',
        product_code: 'C1',
        product_name: 'Product A',
        quantity: 2,
        returned_quantity: 1,
        effective_quantity: 1,
        line_total: 125,
      }],
    });

    expect(match?.invoiceId).toBe('inv-1');
    expect(match?.productEvidence).toBe('product_id');
  });

  it('derives effective quantity from original minus returned when explicit effective quantity is absent', () => {
    const match = selectVerifiedProductInvoiceV23({
      product: { productCode: 'C1', productName: 'Product A' },
      openedAt: '2026-09-15T10:00:00.000Z',
      lastStageAt: '2026-09-15T10:10:00.000Z',
      invoices: [invoice],
      items: [{
        invoice_id: 'inv-1',
        product_code: 'C1',
        product_name: 'Product A',
        quantity: 1,
        returned_quantity: 1,
        line_total: 0,
      }],
    });

    expect(match).toBeNull();
  });
});
