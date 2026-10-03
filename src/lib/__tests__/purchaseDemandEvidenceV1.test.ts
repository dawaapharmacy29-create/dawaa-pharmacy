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
    expect(evidence.source_coverage_start_at).toBeNull();
    expect(evidence.source_coverage_days).toBeNull();
    expect(evidence.source_max_invoice_at).toBeNull();
    expect(evidence.evidence_quality_class).toBe('review');
    expect(evidence.observed_span_days).toBe(2);
  });

  it('detects a one-invoice bulk burst without turning it into recurrence', () => {
    const [evidence] = buildPurchaseDemandEvidence([
      { ...base, invoiceNumber: '200', quantity: 75, customerCode: 'C1' },
    ], { now });
    expect(evidence.invoices_30d).toBe(1);
    expect(evidence.dominant_invoice_share_30d).toBe(1);
    expect(evidence.behavior_class).toBe('burst_one_off');
    expect(evidence.evidence_quality_class).toBe('review');
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

  it('tracks partial source coverage separately from product activity', () => {
    const [evidence] = buildPurchaseDemandEvidence([
      { ...base, invoiceNumber: 'coverage', quantity: 1 },
    ], { now, sourceCoverageStart: new Date('2026-09-25T00:00:00.000Z') });
    expect(evidence.source_coverage_start_at).toBe('2026-09-25T00:00:00.000Z');
    expect(evidence.source_coverage_days).toBe(9);
    expect(evidence.observed_span_days).toBe(1);
    expect(evidence.evidence_quality_class).toBe('review');
  });

  it('does not let an old row outside the requested window contaminate evidence', () => {
    const [evidence] = buildPurchaseDemandEvidence([
      { ...base, invoiceNumber: 'old', invoiceDate: '2026-08-01T10:00:00.000Z', quantity: 50 },
      { ...base, invoiceNumber: 'new', quantity: 2 },
    ], { now, windowDays: 30 });
    expect(evidence.units_30d).toBe(2);
    expect(evidence.invoices_30d).toBe(1);
  });

  it('does not let one bulk invoice erase genuine recurring demand', () => {
    const rows = [
      { ...base, invoiceNumber: 'r1', invoiceDate: '2026-09-05T10:00:00.000Z', quantity: 2, customerCode: 'A' },
      { ...base, invoiceNumber: 'r2', invoiceDate: '2026-09-08T10:00:00.000Z', quantity: 2, customerCode: 'B' },
      { ...base, invoiceNumber: 'r3', invoiceDate: '2026-09-12T10:00:00.000Z', quantity: 2, customerCode: 'C' },
      { ...base, invoiceNumber: 'r4', invoiceDate: '2026-09-16T10:00:00.000Z', quantity: 12, customerCode: 'D' },
      { ...base, invoiceNumber: 'r5', invoiceDate: '2026-09-20T10:00:00.000Z', quantity: 2, customerCode: 'A' },
      { ...base, invoiceNumber: 'r6', invoiceDate: '2026-09-24T10:00:00.000Z', quantity: 2, customerCode: 'B' },
      { ...base, invoiceNumber: 'r7', invoiceDate: '2026-09-28T10:00:00.000Z', quantity: 2, customerCode: 'C' },
    ];
    const [evidence] = buildPurchaseDemandEvidence(rows, { now, sourceCoverageStart: new Date('2026-09-03T12:00:00.000Z'), sourceMaxInvoiceAt: new Date('2026-10-01T10:00:00.000Z') });
    expect(evidence.invoices_30d).toBe(7);
    expect(evidence.behavior_class).not.toBe('burst_one_off');
    expect(evidence.outlier_share_30d).toBeGreaterThan(0);
    expect(evidence.evidence_quality_class).not.toBe('review');
  });

  it('keeps repeated single-customer demand visible but penalizes concentration', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      ...base,
      invoiceNumber: `c${i}`,
      invoiceDate: new Date(Date.UTC(2026, 8, 5 + i * 4, 10)).toISOString(),
      quantity: 2,
      customerCode: 'ONE',
    }));
    const [evidence] = buildPurchaseDemandEvidence(rows, { now });
    expect(evidence.behavior_class).toBe('concentrated');
    expect(evidence.dominant_customer_share_30d).toBe(1);
    expect(evidence.evidence_confidence_score).toBeGreaterThan(0);
  });

  it('is deterministic when the same source rows are recalculated', () => {
    const rows = [
      { ...base, invoiceNumber: '600', quantity: 1, customerCode: 'A' },
      { ...base, invoiceNumber: '601', invoiceDate: '2026-09-30T10:00:00.000Z', quantity: 2, customerCode: 'B' },
    ];
    expect(buildPurchaseDemandEvidence(rows, { now })).toEqual(buildPurchaseDemandEvidence(rows, { now }));
  });

  it('marks conflicting duplicate-line customer identity unknown instead of picking the first customer', () => {
    const rows = [
      { ...base, invoiceNumber: 'conflict-1', quantity: 0.5, customerId: 'A', customerCode: null },
      { ...base, invoiceNumber: 'conflict-1', quantity: 0.5, customerId: 'B', customerCode: null },
      { ...base, invoiceNumber: 'conflict-2', invoiceDate: '2026-09-30T10:00:00.000Z', quantity: 1, customerId: 'C', customerCode: null },
    ];
    const [evidence] = buildPurchaseDemandEvidence(rows, {
      now,
      sourceCoverageStart: new Date('2026-09-03T12:00:00.000Z'),
      sourceMaxInvoiceAt: new Date('2026-10-01T10:00:00.000Z'),
    });
    expect(evidence.invoices_30d).toBe(2);
    expect(evidence.known_customer_invoices_30d).toBe(1);
    expect(evidence.customers_30d).toBe(1);
  });

  it('never upgrades quality when source coverage is unproven', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      ...base,
      invoiceNumber: `u${i}`,
      invoiceDate: new Date(Date.UTC(2026, 8, 4 + i * 2, 10)).toISOString(),
      quantity: 1,
      customerCode: `C${i % 4}`,
    }));
    const [evidence] = buildPurchaseDemandEvidence(rows, { now });
    expect(evidence.source_coverage_start_at).toBeNull();
    expect(evidence.source_coverage_days).toBeNull();
    expect(evidence.evidence_quality_class).toBe('review');
  });

  it('keeps quality in review when coverage is proven but source freshness is not', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      ...base,
      invoiceNumber: `f${i}`,
      invoiceDate: new Date(Date.UTC(2026, 8, 5 + i * 3, 10)).toISOString(),
      quantity: 1,
      customerCode: `F${i % 4}`,
    }));
    const [evidence] = buildPurchaseDemandEvidence(rows, {
      now,
      sourceCoverageStart: new Date('2026-09-03T12:00:00.000Z'),
    });
    expect(evidence.source_coverage_days).not.toBeNull();
    expect(evidence.source_max_invoice_at).toBeNull();
    expect(evidence.evidence_quality_class).toBe('review');
  });

  it('uses proven dataset freshness independently from the product last sale', () => {
    const [evidence] = buildPurchaseDemandEvidence([
      { ...base, invoiceNumber: 'fresh-source', invoiceDate: '2026-09-20T10:00:00.000Z', quantity: 1 },
    ], {
      now,
      sourceCoverageStart: new Date('2026-09-03T12:00:00.000Z'),
      sourceMaxInvoiceAt: new Date('2026-10-02T09:00:00.000Z'),
    });
    expect(evidence.last_sale_at).toBe('2026-09-20T10:00:00.000Z');
    expect(evidence.source_max_invoice_at).toBe('2026-10-02T09:00:00.000Z');
  });

});