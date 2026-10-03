import { describe, expect, it } from 'vitest';
import { buildPurchaseDemandEvidence } from '../purchaseDemandEvidenceV1';

const now = new Date('2026-10-03T12:00:00.000Z');
const base = {
  branch: 'فرع شكري',
  productCode: '54727',
  invoiceDate: '2026-09-29T10:00:00.000Z',
  customerId: null,
  customerCode: null,
};

describe('buildPurchaseDemandEvidence', () => {
  it('aggregates repeated lines in the same invoice before counting frequency', () => {
    const rows = [
      { ...base, invoiceNumber: '100', quantity: 0.67 },
      { ...base, invoiceNumber: '100', quantity: 0.33 },
      { ...base, invoiceNumber: '101', invoiceDate: '2026-09-30T10:00:00.000Z', quantity: 1 },
    ];
    const [evidence] = buildPurchaseDemandEvidence(rows, { now });
    expect(evidence.invoices_30d).toBe(2);
    expect(evidence.units_30d).toBe(2);
    expect(evidence.typical_invoice_qty_30d).toBe(1);
    expect(evidence.source_coverage_start_at).toBe('2026-09-29T10:00:00.000Z');
    expect(evidence.source_coverage_days).toBe(2);
  });

  it('detects a one-invoice bulk burst without turning it into recurrence', () => {
    const [evidence] = buildPurchaseDemandEvidence([
      { ...base, invoiceNumber: '200', quantity: 75, customerCode: 'C1' },
    ], { now });
    expect(evidence.invoices_30d).toBe(1);
    expect(evidence.dominant_invoice_share_30d).toBe(1);
    expect(evidence.behavior_class).toBe('burst_one_off');
  });

  it('keeps unknown-customer invoices in frequency but out of customer concentration', () => {
    const [evidence] = buildPurchaseDemandEvidence([
      { ...base, invoiceNumber: '300', quantity: 1 },
      { ...base, invoiceNumber: '301', invoiceDate: '2026-09-30T10:00:00.000Z', quantity: 1 },
      { ...base, invoiceNumber: '302', invoiceDate: '2026-10-01T10:00:00.000Z', quantity: 1 },
    ], { now });
    expect(evidence.invoices_30d).toBe(3);
    expect(evidence.customers_30d).toBe(0);
    expect(evidence.known_customer_invoices_30d).toBe(0);
    expect(evidence.dominant_customer_share_30d).toBeNull();
  });

  it('maps branch names and canonicalizes numeric codes ending in .0', () => {
    const [evidence] = buildPurchaseDemandEvidence([
      { ...base, branch: 'فرع الشامي', productCode: '123.0', invoiceNumber: '400', quantity: 1 },
    ], { now });
    expect(evidence.branch).toBe('دواء الشامي');
    expect(evidence.product_code).toBe('123');
  });

  it('ignores non-pharmacy branches instead of guessing a mapping', () => {
    const result = buildPurchaseDemandEvidence([
      { ...base, branch: 'مخزن د.وائل', invoiceNumber: '500', quantity: 5 },
    ], { now });
    expect(result).toEqual([]);
  });

  it('does not let an old row outside the requested window contaminate evidence', () => {
    const [evidence] = buildPurchaseDemandEvidence([
      { ...base, invoiceNumber: 'old', invoiceDate: '2026-08-01T10:00:00.000Z', quantity: 50 },
      { ...base, invoiceNumber: 'new', quantity: 2 },
    ], { now, windowDays: 30 });
    expect(evidence.units_30d).toBe(2);
    expect(evidence.invoices_30d).toBe(1);
  });

  it('is deterministic when the same source rows are recalculated', () => {
    const rows = [
      { ...base, invoiceNumber: '600', quantity: 1, customerCode: 'A' },
      { ...base, invoiceNumber: '601', invoiceDate: '2026-09-30T10:00:00.000Z', quantity: 2, customerCode: 'B' },
    ];
    expect(buildPurchaseDemandEvidence(rows, { now })).toEqual(buildPurchaseDemandEvidence(rows, { now }));
  });
});