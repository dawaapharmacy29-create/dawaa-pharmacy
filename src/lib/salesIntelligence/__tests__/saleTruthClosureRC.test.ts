// Release Candidate closure: Sale Proof false positives, invoice identity, product evidence,
// phone-like contact names, stale proof, branch provenance and canonical Conversion.
import { describe, expect, it } from 'vitest';
import {
  deriveSaleAttributionAssessment,
  type CaseAttributionContext,
  type InvoiceItemEvidenceProvider,
} from '@/lib/salesIntelligence/saleAttributionEngine';
import type { CommercialConfirmationAssessment } from '@/lib/salesIntelligence/types';
import { computeSemanticSourceHash, saleProofFingerprint } from '@/lib/salesIntelligence/persistence/hashing';
import {
  extractTrailingCustomerCodeFromDisplayName,
  hasPhoneLikeTrailingDigits,
  normalizeEgyptianCustomerPhone,
} from '@/lib/customers/customerIdentity';
import { extractCustomerHintFromExportFileName } from '@/lib/whatsappExportCustomerHint';
import {
  deriveCanonicalSalesConversion,
  ratioPercent,
  ratioPercentOrZero,
} from '@/lib/salesIntelligence/canonicalConversionV1';

const CONFIRMED: CommercialConfirmationAssessment = {
  caseId: 'case-1',
  basketId: 'basket-1',
  basketVersion: 1,
  summaryPresented: true,
  customerConfirmed: true,
  staffConfirmed: true,
  announcedTotalPresent: true,
  modificationAfterConfirmation: false,
  currentState: 'commercial_confirmation_complete',
  primaryMessageIds: [],
  ruleIds: [],
  confidence: { level: 'strongly_inferred', score: 0.85, ruleIds: [], evidence: [] },
  needsHumanReview: false,
  humanReviewReasons: [],
};

type Item = { productNameRaw: string; productId?: string | null; quantity: number | null };

function ctx(items: Item[], overrides: Partial<CaseAttributionContext> = {}): CaseAttributionContext {
  return {
    caseId: 'case-1',
    customerId: 'cust-2490',
    customerPhone: '01100742008',
    customerCode: '2490',
    customerName: 'الحاج محمود صالح',
    branchNameRaw: 'فرع شكري',
    caseStartedAt: '2026-09-28T03:50:00.000Z',
    caseEndedAt: '2026-09-28T03:58:00.000Z',
    commercialConfirmation: CONFIRMED,
    activeAnnouncedTotal: null,
    activeBasketValue: null,
    activeBasketItems: items.map((item) => ({ ...item, resolutionStatus: 'proven' as const })),
    knownStaffIds: [],
    legacyMatchedInvoiceId: null,
    legacyMatchedInvoiceNumber: null,
    trustedInvoiceId: null,
    trustedInvoiceNumber: null,
    ...overrides,
  };
}

function invoice(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    invoice_number: `N-${id}`,
    customer_id: 'cust-2490',
    customer_code: '2490',
    customer_name: 'الحاج محمود صالح',
    customer_phone: '01100742008',
    branch: 'فرع شكري',
    invoice_datetime: '2026-09-28T03:56:00.000Z',
    net_amount: 300,
    ...overrides,
  };
}

function itemsBy(map: Record<string, Item[]>): InvoiceItemEvidenceProvider {
  return { getItemsForInvoice: (invoiceId) => map[invoiceId] ?? 'unavailable' };
}

const TRIMED = { productNameRaw: 'Trimed', quantity: 1 };
const PANADOL = { productNameRaw: 'Panadol', quantity: 2 };

describe('RC closure — Sale Proof requires product evidence', () => {
  it('1. same customer + invoice within 30m + no product match -> NOT proven', () => {
    const a = deriveSaleAttributionAssessment(ctx([TRIMED]), [invoice('inv-1')], itemsBy({ 'inv-1': [{ productNameRaw: 'Pampers', quantity: 1 }] }));
    expect(a.attributionLevel).not.toBe('proven');
    expect(a.selectedCandidate?.directInvoiceLink ?? false).toBe(false);
  });

  it('1b. no basket product at all (media-only) is never auto-proven by time and identity alone', () => {
    const a = deriveSaleAttributionAssessment(ctx([]), [invoice('inv-1')], itemsBy({ 'inv-1': [{ productNameRaw: 'Trimed', quantity: 1 }] }));
    expect(a.attributionLevel).not.toBe('proven');
  });

  it('2. same customer + matching product -> proven, bound to the invoice id', () => {
    const a = deriveSaleAttributionAssessment(ctx([TRIMED]), [invoice('inv-1')], itemsBy({ 'inv-1': [{ productNameRaw: 'trimed ', quantity: 1 }] }));
    expect(a.attributionLevel).toBe('proven');
    expect(a.selectedInvoiceId).toBe('inv-1');
  });

  it('3. wrong customer + matching product -> NOT proven', () => {
    const a = deriveSaleAttributionAssessment(
      ctx([TRIMED]),
      [invoice('inv-1', { customer_id: 'cust-9', customer_code: '9999', customer_name: 'عميل آخر', customer_phone: '01011111111' })],
      itemsBy({ 'inv-1': [TRIMED] })
    );
    expect(a.attributionLevel).not.toBe('proven');
  });

  it('4/5. a trusted invoice number repeated in another branch links only the same-branch invoice', () => {
    const c = ctx([TRIMED], { trustedInvoiceNumber: '500' });
    const a = deriveSaleAttributionAssessment(
      c,
      [invoice('inv-shamy', { invoice_number: '500', branch: 'فرع الشامي' }), invoice('inv-shokry', { invoice_number: '500' })],
      itemsBy({ 'inv-shamy': [TRIMED], 'inv-shokry': [TRIMED] })
    );
    expect(a.selectedInvoiceId).toBe('inv-shokry');
    expect(a.attributionLevel).toBe('proven');
    const shamyOnly = deriveSaleAttributionAssessment(c, [invoice('inv-shamy', { invoice_number: '500', branch: 'فرع الشامي' })], itemsBy({ 'inv-shamy': [TRIMED] }));
    expect(shamyOnly.attributionLevel).not.toBe('proven');
  });

  it('5b. a row without a real invoice id is never a proof identity', () => {
    const a = deriveSaleAttributionAssessment(ctx([TRIMED], { trustedInvoiceNumber: 'N-x' }), [{ ...invoice('x'), id: undefined }], itemsBy({ 'N-x': [TRIMED] }));
    expect(a.attributionLevel).not.toBe('proven');
  });

  it('6. partial product match is qualified evidence, not proven', () => {
    const a = deriveSaleAttributionAssessment(ctx([TRIMED, PANADOL]), [invoice('inv-1')], itemsBy({ 'inv-1': [TRIMED] }));
    expect(a.attributionLevel).not.toBe('proven');
    expect(a.selectedCandidate?.productMatch).toBe('available_match');
    expect(a.selectedCandidate?.ruleIds).toContain('attribution.product.partial_basket_coverage');
  });

  it('7. normalized product variants and canonical product ids match', () => {
    const byName = deriveSaleAttributionAssessment(ctx([{ productNameRaw: 'بانادول  اكسترا', quantity: 1 }]), [invoice('inv-1')], itemsBy({ 'inv-1': [{ productNameRaw: 'بانادول اكسترا', quantity: 1 }] }));
    expect(byName.attributionLevel).toBe('proven');
    const byId = deriveSaleAttributionAssessment(ctx([{ productNameRaw: 'panadol extra', productId: 'p-7', quantity: 1 }]), [invoice('inv-1')], itemsBy({ 'inv-1': [{ productNameRaw: 'PANADOL EXTRA 24 TAB', productId: 'p-7', quantity: 1 }] }));
    expect(byId.attributionLevel).toBe('proven');
  });

  it('8/9. retry and re-import (same input, any row order) reach the same decision', () => {
    const rows = [invoice('inv-1'), invoice('inv-2', { invoice_datetime: '2026-09-28T09:00:00.000Z' })];
    const provider = itemsBy({ 'inv-1': [TRIMED], 'inv-2': [TRIMED] });
    const first = deriveSaleAttributionAssessment(ctx([TRIMED]), rows, provider);
    const retry = deriveSaleAttributionAssessment(ctx([TRIMED]), [...rows].reverse(), provider);
    expect(retry.selectedInvoiceId).toBe(first.selectedInvoiceId);
    expect(retry.attributionLevel).toBe(first.attributionLevel);
  });

  it('11. a newer invoice carrying the requested products beats an older one that does not', () => {
    const a = deriveSaleAttributionAssessment(
      ctx([TRIMED]),
      [invoice('inv-old', { invoice_datetime: '2026-09-28T03:52:00.000Z' }), invoice('inv-new', { invoice_datetime: '2026-09-28T03:57:00.000Z' })],
      itemsBy({ 'inv-old': [{ productNameRaw: 'Pampers', quantity: 1 }], 'inv-new': [TRIMED] })
    );
    expect(a.selectedInvoiceId).toBe('inv-new');
    expect(a.attributionLevel).toBe('proven');
  });

  it('12. two invoices that both pass the gate -> ambiguity, nothing proven', () => {
    const a = deriveSaleAttributionAssessment(
      ctx([TRIMED]),
      [invoice('inv-a'), invoice('inv-b', { invoice_datetime: '2026-09-28T03:57:00.000Z' })],
      itemsBy({ 'inv-a': [TRIMED], 'inv-b': [TRIMED] })
    );
    expect(a.attributionLevel).not.toBe('proven');
  });
});

describe('RC closure — stale Sale Proof', () => {
  const base = { rawWhatsAppExportText: 'same text', branchIdentityMappingVersion: 'v1' };
  const unknown = { salesOutcome: { outcome: 'unknown', saleProofState: 'unknown' }, attribution: { selectedInvoiceId: null, selectedCandidate: null } };
  const proven = (id: string) => ({ salesOutcome: { outcome: 'sale_proven', saleProofState: 'proven' }, attribution: { selectedInvoiceId: id, selectedCandidate: { directInvoiceLink: true } } });

  it('10. a proof change with unchanged text produces a new analysis hash; no proof keeps the old hash', async () => {
    const legacyHash = await computeSemanticSourceHash(base);
    expect(await computeSemanticSourceHash({ ...base, saleProofFingerprint: saleProofFingerprint(unknown) })).toBe(legacyHash);
    const provenA = await computeSemanticSourceHash({ ...base, saleProofFingerprint: saleProofFingerprint(proven('inv-a')) });
    const provenB = await computeSemanticSourceHash({ ...base, saleProofFingerprint: saleProofFingerprint(proven('inv-b')) });
    expect(provenA).not.toBe(legacyHash);
    expect(provenB).not.toBe(provenA);
  });

  it('10b. a retry reaching the same proof is a no-op (same hash, no duplicate proof)', async () => {
    const one = await computeSemanticSourceHash({ ...base, saleProofFingerprint: saleProofFingerprint(proven('inv-a')) });
    const two = await computeSemanticSourceHash({ ...base, saleProofFingerprint: saleProofFingerprint(proven('inv-a')) });
    expect(two).toBe(one);
  });
});

describe('RC closure — phone-like contact names are not customer codes', () => {
  it('13. phone-like contact labels and file names yield no customer code', () => {
    for (const label of ['+20 100 123 4567', '01012345678', '+201012345678', '201012345678', '+20 100 123', 'عميل 010 1234 5678']) {
      expect(hasPhoneLikeTrailingDigits(label)).toBe(true);
      expect(extractTrailingCustomerCodeFromDisplayName(label)).toBe('');
      expect(extractCustomerHintFromExportFileName(`WhatsApp Chat with ${label}.txt`).codeHint).toBe(null);
    }
  });

  it('14. phone forms normalize to one mobile', () => {
    for (const phone of ['01012345678', '+201012345678', '201012345678', '00201012345678']) {
      expect(normalizeEgyptianCustomerPhone(phone)).toBe('01012345678');
    }
  });

  it('15. a real numeric customer code after a name is kept', () => {
    expect(extractTrailingCustomerCodeFromDisplayName('عبد الرحمن ابو عرب 17765')).toBe('17765');
    expect(extractTrailingCustomerCodeFromDisplayName('Ahmed - 2490')).toBe('2490');
    expect(extractCustomerHintFromExportFileName('WhatsApp Chat with الحاج محمود صالح 2490.txt').codeHint).toBe('2490');
  });
});

describe('RC closure — canonical Conversion', () => {
  const sale = (caseId: string, extra: Record<string, unknown> = {}) => ({ caseId, caseType: 'sales_opportunity' as const, outcome: 'sale_proven' as const, invoiceEvidenceAvailable: true, ...extra });

  it('19/20. numerator is Sale Proof only; denominator is eligible commercial cases', () => {
    const result = deriveCanonicalSalesConversion([
      sale('c1'),
      sale('c2', { outcome: 'order_confirmed_unproven' }),
      sale('c3', { outcome: 'open_opportunity' }),
      sale('c4', { caseType: 'information_only', outcome: 'information_only' }),
      sale('c5', { caseType: 'complaint', outcome: 'unknown' }),
      sale('c6', { caseType: 'follow_up', outcome: 'unknown' }),
    ]);
    expect(result).toEqual({ eligibleCases: 3, provenSales: 1, pendingEvidenceCases: 0, conversionRatePercent: 33 });
  });

  it('21. the same case counted twice is one opportunity', () => {
    const result = deriveCanonicalSalesConversion([sale('c1'), sale('c1', { outcome: 'open_opportunity' }), sale('c2', { outcome: 'open_opportunity' })]);
    expect(result.eligibleCases).toBe(2);
    expect(result.provenSales).toBe(1);
  });

  it('22. a time-only invoice (strongly supported, not proven) is not a conversion', () => {
    const result = deriveCanonicalSalesConversion([sale('c1', { outcome: 'order_confirmed_unproven' })]);
    expect(result.provenSales).toBe(0);
    expect(result.conversionRatePercent).toBe(0);
  });

  it('23. unavailable evidence is pending, not a failed conversion; no data is null, not 0', () => {
    const result = deriveCanonicalSalesConversion([sale('c1', { outcome: 'unknown', invoiceEvidenceAvailable: false })]);
    expect(result).toEqual({ eligibleCases: 0, provenSales: 0, pendingEvidenceCases: 1, conversionRatePercent: null });
    expect(ratioPercent(1, 0)).toBe(null);
    expect(ratioPercentOrZero(1, 0)).toBe(0);
    expect(ratioPercent(1, 3)).toBe(33);
  });
});

describe('RC closure — Production-only canonical writers', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { evaluateCanonicalWriterInventory } = require('../../../../scripts/check-canonical-writer-source-control.cjs');

  it('24. every source-controlled writer has a CREATE; every Production-only canonical writer is emitted as a blocker', () => {
    const result = evaluateCanonicalWriterInventory();
    expect(result.errors).toEqual([]);
    expect(result.blockers).toContain('sales_intelligence_write_case_analysis');
    expect(result.blockers).toContain('dawaa_reconcile_sales_intelligence_case_v22_v1');
  });

  it('25. one canonical writer per truth target', () => {
    const result = evaluateCanonicalWriterInventory();
    expect(result.errors.filter((e: string) => e.startsWith('duplicate canonical writer'))).toEqual([]);
  });
});
