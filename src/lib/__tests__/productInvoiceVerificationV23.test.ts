import { describe, expect, it } from 'vitest';
import { selectVerifiedProductInvoiceV23 } from '../salesIntelligence/productInvoiceVerificationV23';

describe('productInvoiceVerificationV23', () => {
  it('prefers the paid closed final invoice over a zero draft with the same product', () => {
    const match = selectVerifiedProductInvoiceV23({
      product: { productId: 'p-centrum', productCode: 'c-centrum', productName: 'CENTRUM MEN 30 TAB' },
      openedAt: '2026-09-12T06:01:00Z',
      lastStageAt: '2026-09-12T06:26:00Z',
      invoices: [
        {
          id: 'draft',
          invoice_number: '72367',
          invoice_datetime: '2026-09-12T06:09:00Z',
          close_datetime: null,
          net_total: 0,
        },
        {
          id: 'final',
          invoice_number: '72368',
          invoice_datetime: '2026-09-12T06:10:00Z',
          close_datetime: '2026-09-12T07:45:00Z',
          net_total: 510,
        },
      ],
      items: [
        { invoice_id: 'draft', product_id: 'p-centrum', product_code: 'c-centrum', product_name: 'CENTRUM MEN 30 TAB', quantity: 1, line_total: 0 },
        { invoice_id: 'final', product_id: 'p-centrum', product_code: 'c-centrum', product_name: 'CENTRUM MEN 30 TAB', quantity: 1, line_total: 330 },
      ],
    });

    expect(match).toMatchObject({
      invoiceId: 'final',
      invoiceNumber: '72368',
      invoiceValue: 510,
      productEvidence: 'product_id',
      finalPaid: true,
    });
  });

  it('never verifies a zero-value draft as a product sale even when the product item is present', () => {
    const match = selectVerifiedProductInvoiceV23({
      product: { productId: 'p-dermactive', productCode: 'dermactive-code', productName: 'DERMACTIVE SWEAT CONTROL REFRESHING ROLL ON 60ML' },
      openedAt: '2026-09-12T06:01:00Z',
      lastStageAt: '2026-09-12T06:26:00Z',
      invoices: [
        {
          id: 'draft-only',
          invoice_number: '72367',
          invoice_datetime: '2026-09-12T06:09:00Z',
          close_datetime: null,
          net_total: 0,
        },
      ],
      items: [
        { invoice_id: 'draft-only', product_id: 'p-dermactive', product_code: 'dermactive-code', product_name: 'DERMACTIVE SWEAT CONTROL REFRESHING ROLL ON 60ML', quantity: 1, line_total: 0 },
      ],
    });

    expect(match).toBeNull();
  });

  it('does not attach a nearby invoice when the requested product is absent from invoice items', () => {
    const match = selectVerifiedProductInvoiceV23({
      product: { productId: 'gast-reg', productCode: '40049', productName: 'GAST-REG 50MG 3AMP' },
      openedAt: '2026-09-01T08:38:00Z',
      lastStageAt: '2026-09-01T09:49:00Z',
      invoices: [
        {
          id: 'flex-invoice',
          invoice_number: '70655',
          invoice_datetime: '2026-09-02T06:17:00Z',
          close_datetime: '2026-09-02T06:30:00Z',
          net_total: 38,
        },
      ],
      items: [
        { invoice_id: 'flex-invoice', product_id: 'flexilax', product_code: '68114', product_name: 'Flexilax 30 tabs', quantity: 1, line_total: 28 },
      ],
    });

    expect(match).toBeNull();
  });

  it('verifies a sale when the exact product exists in a paid invoice inside the product time window', () => {
    const match = selectVerifiedProductInvoiceV23({
      product: { productId: 'isis-teen', productCode: '70271', productName: 'ISIS TEEN DERM GEL SENSITIVE 250ML' },
      openedAt: '2026-09-15T18:30:55Z',
      lastStageAt: '2026-09-15T19:30:18Z',
      invoices: [
        {
          id: 'isis-sale',
          invoice_number: '73006',
          invoice_datetime: '2026-09-15T22:23:00Z',
          close_datetime: '2026-09-15T22:24:00Z',
          net_total: 675,
        },
      ],
      items: [
        { invoice_id: 'isis-sale', product_id: 'isis-teen', product_code: '70271', product_name: 'ISIS TEEN DERM GEL SENSITIVE 250ML', quantity: 1, line_total: 675 },
      ],
    });

    expect(match).toMatchObject({
      invoiceNumber: '73006',
      invoiceValue: 675,
      productEvidence: 'product_id',
      finalPaid: true,
    });
  });

  it('uses the product-specific invoice rather than another later invoice from the same long conversation', () => {
    const match = selectVerifiedProductInvoiceV23({
      product: { productId: 'solo', productCode: 'solo-code', productName: 'Solofresh eye drops' },
      openedAt: '2026-09-14T14:21:31Z',
      lastStageAt: '2026-09-14T15:05:10Z',
      invoices: [
        {
          id: 'eye-order',
          invoice_number: '72743',
          invoice_datetime: '2026-09-14T14:30:00Z',
          close_datetime: '2026-09-14T15:38:00Z',
          net_total: 314,
        },
        {
          id: 'insulin-order',
          invoice_number: '72847',
          invoice_datetime: '2026-09-14T23:51:00Z',
          close_datetime: '2026-09-15T01:22:00Z',
          net_total: 565,
        },
      ],
      items: [
        { invoice_id: 'eye-order', product_id: 'solo', product_code: 'solo-code', product_name: 'Solofresh eye drops', quantity: 1, line_total: 67 },
        { invoice_id: 'insulin-order', product_id: 'tresiba', product_code: 'tresiba-code', product_name: 'Tresiba flexotouch 100 units/100ml', quantity: 1, line_total: 550 },
      ],
    });

    expect(match).toMatchObject({
      invoiceId: 'eye-order',
      invoiceNumber: '72743',
      invoiceValue: 314,
    });
  });
});
