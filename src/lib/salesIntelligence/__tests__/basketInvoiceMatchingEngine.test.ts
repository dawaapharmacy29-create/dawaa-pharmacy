import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';
import { buildCaseBaskets } from '@/lib/salesIntelligence/caseBasketEngine';
import { deriveCommercialConfirmationState } from '@/lib/salesIntelligence/commercialConfirmationEngine';
import { deriveSaleAttributionAssessment } from '@/lib/salesIntelligence/saleAttributionEngine';
import {
  deriveBasketInvoiceMatch,
  resolveActiveBasket,
  type BasketInvoiceMatchingInput,
} from '@/lib/salesIntelligence/basketInvoiceMatchingEngine';
import type {
  CaseBasket,
  CaseBasketItem,
  SaleAttributionAssessment,
} from '@/lib/salesIntelligence/types';

function total(amount: number, basketVersion = 1) {
  return {
    amount,
    currency: 'EGP' as const,
    messageId: 'm1',
    staffId: null,
    announcedAt: '2026-09-15T09:01:00.000Z',
    basketVersion,
    supersededByTotalId: null,
  };
}

function basket(version: number, amount: number | null, status: CaseBasket['status'] = 'confirmed'): CaseBasket {
  return {
    basketId: `basket:${version}`,
    caseId: 'case-1',
    version,
    status,
    createdAt: '2026-09-15T09:00:00.000Z',
    confirmedAt: null,
    confirmedByCustomerAt: '2026-09-15T09:02:00.000Z',
    staffId: null,
    announcedTotal: amount == null ? null : total(amount, version),
    sourceMessageIds: [],
    confidence: { level: 'strongly_inferred', score: 0.8, ruleIds: [], evidence: [] },
    supersededByBasketId: null,
  };
}

function item(
  productNameRaw: string,
  quantity: number | null,
  resolutionStatus: CaseBasketItem['resolutionStatus'] = 'proven',
  productId: string | null = null
): CaseBasketItem {
  return {
    itemId: `item:${productNameRaw}`,
    basketId: 'basket:1',
    productNameRaw,
    productId,
    quantity,
    unit: null,
    unitPrice: null,
    lineTotal: null,
    sourceMessageId: 'm',
    confidence: { level: 'proven', score: 0.9, ruleIds: [], evidence: [] },
    resolutionStatus,
  };
}

function attribution(overrides: Partial<SaleAttributionAssessment> = {}): SaleAttributionAssessment {
  return {
    caseId: 'case-1',
    commercialConfirmationState: 'commercial_confirmation_complete',
    candidateCount: 1,
    selectedInvoiceId: 'inv-1',
    selectedInvoiceNumber: 'INV-1',
    selectedCandidate: null,
    alternativeCandidates: [],
    attributionLevel: 'strongly_inferred',
    confidence: { level: 'strongly_inferred', score: 0.7, ruleIds: [], evidence: [] },
    primaryEvidence: [],
    contradictions: [],
    needsHumanReview: false,
    humanReviewReasons: [],
    isOfficialForStaffEvaluation: true,
    legacyEvidenceUsed: false,
    ruleIds: [],
    hasAttributedInvoice: true,
    competingCaseIds: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<BasketInvoiceMatchingInput> = {}): BasketInvoiceMatchingInput {
  return {
    caseId: 'case-1',
    baskets: [basket(1, 180)],
    itemsByBasketId: {},
    attribution: attribution(),
    invoiceRow: { id: 'inv-1', net_amount: 180 },
    ...overrides,
  };
}

describe('Basket <-> Invoice Matching Engine (Sales Intelligence Phase E) — Golden Cases', () => {
  it('1. compares against v2 (active) only when v1 is superseded — never the old version', () => {
    const m = deriveBasketInvoiceMatch(
      baseInput({
        baskets: [{ ...basket(1, 180), status: 'superseded', supersededByBasketId: 'basket:2' }, basket(2, 250)],
        invoiceRow: { id: 'inv-1', net_amount: 250 },
      })
    );
    expect(m.basketVersion).toBe(2);
    expect(m.totalMatch).toBe('exact');
  });

  it('2. an exact total match is classified exact', () => {
    const m = deriveBasketInvoiceMatch(baseInput());
    expect(m.totalMatch).toBe('exact');
  });

  it('3. a near-total difference (within the 3% relative tolerance) is classified near_match', () => {
    // basket=180, tolerance=max(1, 180*0.03)=5.4 EGP — diff of 4 EGP is within it.
    const m = deriveBasketInvoiceMatch(baseInput({ invoiceRow: { id: 'inv-1', net_amount: 184 } }));
    expect(m.totalMatch).toBe('near_match');
  });

  it('4. a clearly different total is classified mismatch', () => {
    const m = deriveBasketInvoiceMatch(baseInput({ invoiceRow: { id: 'inv-1', net_amount: 500 } }));
    expect(m.totalMatch).toBe('mismatch');
  });

  it('5. no announced total is insufficient_data, never guessed', () => {
    const m = deriveBasketInvoiceMatch(baseInput({ baskets: [basket(1, null)] }));
    expect(m.totalMatch).toBe('insufficient_data');
  });

  it('6. invoice item data unavailable never fabricates a missing/extra item, and caps overallMatch at partial even with an exact total', () => {
    const m = deriveBasketInvoiceMatch(baseInput({ itemsByBasketId: { 'basket:1': [item('فيتامين د', 2)] } }));
    expect(m.itemEvidenceReady).toBe(false);
    expect(m.itemMatch).toBe('insufficient_data');
    expect(m.quantityMatch).toBe('insufficient_data');
    expect(m.differences.filter((d) => d.type === 'missing_item' || d.type === 'extra_item')).toEqual([]);
    expect(m.totalMatch).toBe('exact');
    expect(m.overallMatch).not.toBe('exact');
    expect(m.overallMatch).toBe('partial');
  });

  it('7. an exact item set with available evidence is classified exact at every level', () => {
    const m = deriveBasketInvoiceMatch(
      baseInput({
        itemsByBasketId: { 'basket:1': [item('فيتامين د', 2)] },
        itemEvidenceProvider: { getItemsForInvoice: () => [{ productNameRaw: 'فيتامين د', quantity: 2, lineTotal: 180 }] },
      })
    );
    expect(m.itemMatch).toBe('exact');
    expect(m.quantityMatch).toBe('exact');
    expect(m.overallMatch).toBe('exact');
  });

  it('7b. canonical products.id matches even when basket and invoice display names differ', () => {
    const m = deriveBasketInvoiceMatch(
      baseInput({
        itemsByBasketId: { 'basket:1': [item('فيتامين د المكتوب في الشات', 2, 'proven', 'product-uuid-1')] },
        itemEvidenceProvider: {
          getItemsForInvoice: () => [{
            productNameRaw: 'Vitamin D3 1000 IU',
            productId: 'product-uuid-1',
            productCode: 'P100',
            quantity: 2,
            lineTotal: 180,
          }],
        },
      })
    );
    expect(m.itemMatch).toBe('exact');
    expect(m.quantityMatch).toBe('exact');
  });

  it('8. a basket item missing from the invoice is reported as missing_item, never guessed silently', () => {
    const m = deriveBasketInvoiceMatch(
      baseInput({
        baskets: [basket(1, 250)],
        itemsByBasketId: { 'basket:1': [item('فيتامين د', 2), item('شامبو', 1)] },
        invoiceRow: { id: 'inv-1', net_amount: 180 },
        itemEvidenceProvider: { getItemsForInvoice: () => [{ productNameRaw: 'فيتامين د', quantity: 2, lineTotal: 180 }] },
      })
    );
    expect(m.itemMatch).toBe('partial');
    const missing = m.differences.find((d) => d.type === 'missing_item');
    expect(missing?.key).toBe('شامبو');
  });

  it('9. an invoice item not in the basket is reported as extra_item', () => {
    const m = deriveBasketInvoiceMatch(
      baseInput({
        itemsByBasketId: { 'basket:1': [item('فيتامين د', 2)] },
        invoiceRow: { id: 'inv-1', net_amount: 250 },
        itemEvidenceProvider: {
          getItemsForInvoice: () => [
            { productNameRaw: 'فيتامين د', quantity: 2, lineTotal: 180 },
            { productNameRaw: 'شامبو', quantity: 1, lineTotal: 70 },
          ],
        },
      })
    );
    expect(m.itemMatch).toBe('partial');
    const extra = m.differences.find((d) => d.type === 'extra_item');
    expect(extra?.key).toBe('شامبو');
  });

  it('10. a wrong quantity on a matched item is reported as quantity_mismatch', () => {
    const m = deriveBasketInvoiceMatch(
      baseInput({
        itemsByBasketId: { 'basket:1': [item('فيتامين د', 2)] },
        itemEvidenceProvider: { getItemsForInvoice: () => [{ productNameRaw: 'فيتامين د', quantity: 3, lineTotal: 270 }] },
      })
    );
    expect(m.quantityMatch).toBe('mismatch');
    const diff = m.differences.find((d) => d.type === 'quantity_mismatch');
    expect(diff?.before).toBe(2);
    expect(diff?.after).toBe(3);
  });

  it('11. an unresolved product identity (a raw pronoun, never invented into a real name) is compared as-is and correctly reported missing, not crashed on', () => {
    const m = deriveBasketInvoiceMatch(
      baseInput({
        itemsByBasketId: { 'basket:1': [item('التاني', null, 'unknown')] },
        itemEvidenceProvider: { getItemsForInvoice: () => [{ productNameRaw: 'فيتامين د', quantity: 2, lineTotal: 180 }] },
      })
    );
    expect(m.itemMatch).toBe('mismatch');
    expect(m.differences.some((d) => d.type === 'missing_item' && d.key === 'التاني')).toBe(true);
  });

  it('12. a documented delivery fee explains a real total gap and is never flagged as suspicious', () => {
    const m = deriveBasketInvoiceMatch(
      baseInput({
        invoiceRow: { id: 'inv-1', net_amount: 240 },
        documentedAdjustments: [
          { kind: 'delivery_fee', amount: 60, evidence: [{ sourceTable: 'x', sourceId: '', description: 'مصاريف توصيل 60 جنيه مذكورة في المحادثة' }] },
        ],
      })
    );
    expect(m.totalMatch).toBe('mismatch');
    const explained = m.differences.find((d) => d.type === 'explained_difference');
    expect(explained?.explanation).toBe('delivery_fee');
    expect(m.needsHumanReview).toBe(false);
  });

  it('13. a documented discount explains a real total gap', () => {
    const m = deriveBasketInvoiceMatch(
      baseInput({
        invoiceRow: { id: 'inv-1', net_amount: 120 },
        documentedAdjustments: [
          { kind: 'discount', amount: -60, evidence: [{ sourceTable: 'x', sourceId: '', description: 'خصم 60 جنيه مذكور في المحادثة' }] },
        ],
      })
    );
    const explained = m.differences.find((d) => d.type === 'explained_difference');
    expect(explained?.explanation).toBe('discount');
  });

  it('14. an undocumented total difference stays unexplained and IS flagged for human review — no explanation invented without evidence', () => {
    const m = deriveBasketInvoiceMatch(baseInput({ invoiceRow: { id: 'inv-1', net_amount: 500 } }));
    const unexplained = m.differences.find((d) => d.type === 'unexplained_difference');
    expect(unexplained).toBeDefined();
    expect(unexplained?.explanation).toBe('none');
    expect(m.needsHumanReview).toBe(true);
    expect(m.humanReviewReasons).toContain('unexplained_basket_invoice_difference');
  });

  it('15. a cancelled/returned invoice never counts as a valid match, regardless of numbers lining up', () => {
    const m = deriveBasketInvoiceMatch(baseInput({ invoiceCancelledOrReturned: true }));
    expect(m.overallMatch).toBe('mismatch');
    expect(m.needsHumanReview).toBe(true);
    expect(m.humanReviewReasons).toContain('invoice_cancelled_or_returned');
  });

  it('16. weak attribution confidence does not distort the real basket-invoice match quality — an exact match is still reported exact', () => {
    const m = deriveBasketInvoiceMatch(
      baseInput({
        attribution: attribution({ attributionLevel: 'weakly_inferred', isOfficialForStaffEvaluation: false }),
        itemsByBasketId: { 'basket:1': [item('فيتامين د', 2)] },
        itemEvidenceProvider: { getItemsForInvoice: () => [{ productNameRaw: 'فيتامين د', quantity: 2, lineTotal: 180 }] },
      })
    );
    expect(m.overallMatch).toBe('exact');
  });

  it('17. an unknown attribution (Phase D found no safe candidate) returns insufficient_data across the board, never a guess', () => {
    const m = deriveBasketInvoiceMatch(
      baseInput({
        attribution: attribution({ attributionLevel: 'unknown', selectedInvoiceId: null, selectedInvoiceNumber: null, hasAttributedInvoice: false }),
        invoiceRow: null,
      })
    );
    expect(m.totalMatch).toBe('insufficient_data');
    expect(m.itemMatch).toBe('insufficient_data');
    expect(m.quantityMatch).toBe('insufficient_data');
    expect(m.overallMatch).toBe('insufficient_data');
    expect(m.basketId).toBeNull();
    expect(m.invoiceId).toBeNull();
  });

  it('18. an invoice that matches an OLD (superseded) basket total but NOT the current one is correctly reported as a mismatch — the active-basket invariant holds even when a stale match would look perfect', () => {
    const m = deriveBasketInvoiceMatch(
      baseInput({
        baskets: [{ ...basket(1, 180), status: 'superseded', supersededByBasketId: 'basket:2' }, basket(2, 250)],
        invoiceRow: { id: 'inv-1', net_amount: 180 },
      })
    );
    expect(m.basketVersion).toBe(2);
    expect(m.totalMatch).toBe('mismatch');
  });

  it('end-to-end: a modified basket (v1 -> v2) run through the real B/C/D/E pipeline matches only against v2', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] Customer: كمان عايز شامبو للشعر
[9/15/26, 9:04:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
1 قطعة شامبو
إجمالي الحساب 250 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:05:00 AM] Customer: ايوه تمام
[9/15/26, 9:06:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
    const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
    const understanding = buildConversationUnderstandingV32(sessions[0]);
    const cases = deriveConversationCases({ understanding, conversationId: 'conv-1' });
    const interaction = understanding.interactions[0];
    const scoped = understanding.messages.filter((m) => interaction.messageIds.includes(m.id));
    const { baskets, itemsByBasketId, summaryEvents, customerConfirmationEvents, staffFinalConfirmationEvents } =
      buildCaseBaskets(cases[0].caseId, scoped);
    const commercialConfirmation = deriveCommercialConfirmationState(
      cases[0].caseId,
      baskets,
      summaryEvents,
      customerConfirmationEvents,
      staffFinalConfirmationEvents
    );
    const attributionAssessment = deriveSaleAttributionAssessment(
      {
        caseId: cases[0].caseId,
        customerId: 'cust-1',
        customerPhone: null,
        branchNameRaw: null,
        caseEndedAt: cases[0].endedAt,
        commercialConfirmation,
        activeAnnouncedTotal: baskets[baskets.length - 1].announcedTotal,
        activeBasketValue: null,
        activeBasketItems: (itemsByBasketId[baskets[baskets.length - 1].basketId] || []).map((i) => ({
          productNameRaw: i.productNameRaw,
          quantity: i.quantity,
        })),
        knownStaffIds: [],
        legacyMatchedInvoiceId: null,
        legacyMatchedInvoiceNumber: null,
        trustedInvoiceId: null,
        trustedInvoiceNumber: null,
      },
      [{ id: 'inv-old', customer_id: 'cust-1', invoice_datetime: cases[0].endedAt, net_amount: 180 },
       { id: 'inv-new', customer_id: 'cust-1', invoice_datetime: cases[0].endedAt, net_amount: 250 }]
    );
    expect(attributionAssessment.selectedInvoiceId).toBe('inv-new');

    const match = deriveBasketInvoiceMatch({
      caseId: cases[0].caseId,
      baskets,
      itemsByBasketId,
      attribution: attributionAssessment,
      invoiceRow: { id: 'inv-new', net_amount: 250 },
    });
    expect(match.basketVersion).toBe(baskets[baskets.length - 1].version);
    expect(match.totalMatch).toBe('exact');
  });

  describe('Active basket selection hardening (Phase E.1)', () => {
    it('1. v2 before v1 in the input array — v2 is still selected (never array position)', () => {
      const v1 = { ...basket(1, 180), status: 'superseded' as const, supersededByBasketId: 'basket:2' };
      const v2 = basket(2, 250);
      const resolution = resolveActiveBasket([v2, v1]);
      expect(resolution.outcome).toBe('selected');
      expect(resolution.outcome === 'selected' && resolution.basket.basketId).toBe('basket:2');
    });

    it('2. v1/v2/v3 shuffled — the highest valid (non-superseded) version is selected regardless of order', () => {
      const v1 = { ...basket(1, 100), status: 'superseded' as const, supersededByBasketId: 'basket:2' };
      const v2 = { ...basket(2, 200), status: 'superseded' as const, supersededByBasketId: 'basket:3' };
      const v3 = basket(3, 300);
      const shuffled = [v3, v1, v2];
      const resolution = resolveActiveBasket(shuffled);
      expect(resolution.outcome).toBe('selected');
      expect(resolution.outcome === 'selected' && resolution.basket.version).toBe(3);
    });

    it('3. two baskets incorrectly both marked non-superseded — needs_human_review, never a guess', () => {
      const v1 = basket(1, 100); // 'confirmed', NOT superseded
      const v2 = basket(2, 200); // also 'confirmed', NOT superseded — a real invariant violation
      const resolution = resolveActiveBasket([v1, v2]);
      expect(resolution.outcome).toBe('needs_human_review');
      expect(resolution.outcome === 'needs_human_review' && resolution.conflictingBaskets.length).toBe(2);
    });

    it('4. all versions superseded (or no baskets at all) — insufficient_data', () => {
      const v1 = { ...basket(1, 100), status: 'superseded' as const, supersededByBasketId: 'basket:2' };
      const v2 = { ...basket(2, 200), status: 'superseded' as const, supersededByBasketId: 'basket:3' };
      expect(resolveActiveBasket([v1, v2]).outcome).toBe('insufficient_data');
      expect(resolveActiveBasket([]).outcome).toBe('insufficient_data');
    });

    it('wiring: deriveBasketInvoiceMatch surfaces a genuine active-basket conflict as insufficient_data + human review, never silently picking one', () => {
      const v1 = basket(1, 100);
      const v2 = basket(2, 200);
      const m = deriveBasketInvoiceMatch(baseInput({ baskets: [v1, v2] }));
      expect(m.overallMatch).toBe('insufficient_data');
      expect(m.basketId).toBeNull();
      expect(m.needsHumanReview).toBe(true);
      expect(m.humanReviewReasons).toContain('conflicting_active_basket_versions');
    });
  });

  describe('Amount tolerance semantics (Phase E.1)', () => {
    it('100 -> 120 (20 EGP, but 20%) is NOT a near-match — a flat absolute tolerance must never hide a large percentage gap on a small basket', () => {
      const m = deriveBasketInvoiceMatch(baseInput({ baskets: [basket(1, 100)], invoiceRow: { id: 'inv-1', net_amount: 120 } }));
      expect(m.totalMatch).toBe('mismatch');
    });

    it('1000 -> 1010 (1%) is reasonably a near-match', () => {
      const m = deriveBasketInvoiceMatch(baseInput({ baskets: [basket(1, 1000)], invoiceRow: { id: 'inv-1', net_amount: 1010 } }));
      expect(m.totalMatch).toBe('near_match');
    });

    it('a documented delivery fee explains a real (beyond-tolerance) gap as evidence, not as a widened tolerance', () => {
      // Note: a 20 EGP gap on a 980 EGP basket (~2%) actually falls WITHIN the 3% near-match band
      // itself under this tolerance — a small legitimate adjustment often does, and that is fine;
      // the explanation mechanism exists distinctly for gaps tolerance does NOT already cover, so
      // this test uses a gap well beyond near-match to prove the mechanism itself, independent of
      // where the tolerance boundary happens to sit.
      const m = deriveBasketInvoiceMatch(
        baseInput({
          baskets: [basket(1, 980)],
          invoiceRow: { id: 'inv-1', net_amount: 1050 },
          documentedAdjustments: [{ kind: 'delivery_fee', amount: 70, evidence: [{ sourceTable: 'x', sourceId: '', description: 'مصاريف توصيل 70 جنيه' }] }],
        })
      );
      expect(m.totalMatch).toBe('mismatch');
      const explained = m.differences.find((d) => d.type === 'explained_difference');
      expect(explained?.explanation).toBe('delivery_fee');
    });
  });

  describe('Raw mismatch stays separate from explanation (Phase E.1 §3)', () => {
    it('basket=1000, invoice=950, documented discount=50 — totalMatch stays "mismatch" as the raw fact; the explanation is a SEPARATE difference entry, never a reclassification to near_match/exact', () => {
      const m = deriveBasketInvoiceMatch(
        baseInput({
          baskets: [basket(1, 1000)],
          invoiceRow: { id: 'inv-1', net_amount: 950 },
          documentedAdjustments: [{ kind: 'discount', amount: -50, evidence: [{ sourceTable: 'x', sourceId: '', description: 'خصم موثق 50 جنيه' }] }],
        })
      );
      expect(m.totalMatch).toBe('mismatch');
      expect(m.totalMatch).not.toBe('near_match');
      expect(m.totalMatch).not.toBe('exact');
      const rawFact = m.differences.find((d) => d.type === 'total_mismatch');
      expect(rawFact).toBeDefined();
      const explanation = m.differences.find((d) => d.type === 'explained_difference');
      expect(explanation?.explanation).toBe('discount');
    });
  });

  describe('Product identity confidence audit (Phase E.1 §4)', () => {
    it('a canonical productId/productCode match is proven', () => {
      const basketItemWithId: CaseBasketItem = { ...item('فيتامين د', 2), productId: 'PROD-001' };
      const m = deriveBasketInvoiceMatch(
        baseInput({
          itemsByBasketId: { 'basket:1': [basketItemWithId] },
          itemEvidenceProvider: { getItemsForInvoice: () => [{ productNameRaw: 'اسم مختلف تمامًا', productCode: 'PROD-001', quantity: 2, lineTotal: 180 }] },
        })
      );
      const qtyDiffs = m.differences.filter((d) => d.type === 'quantity_mismatch');
      expect(qtyDiffs.length).toBe(0); // quantities agree (2=2); prove basis via itemMatch instead
      expect(m.itemMatch).toBe('exact');
    });

    it('a normalized-exact-name-only match is strongly_inferred, never proven', () => {
      const m = deriveBasketInvoiceMatch(
        baseInput({
          itemsByBasketId: { 'basket:1': [item('فيتامين د', 3)] },
          itemEvidenceProvider: { getItemsForInvoice: () => [{ productNameRaw: 'فيتامين د', quantity: 2, lineTotal: 180 }] },
        })
      );
      const qtyDiff = m.differences.find((d) => d.type === 'quantity_mismatch');
      expect(qtyDiff).toBeDefined();
      expect(qtyDiff?.confidence.level).toBe('strongly_inferred');
      expect(qtyDiff?.confidence.level).not.toBe('proven');
    });

    it('an ambiguous alias (two invoice items normalize to the same key) is never silently picked — flagged for human review', () => {
      const m = deriveBasketInvoiceMatch(
        baseInput({
          itemsByBasketId: { 'basket:1': [item('فيتامين د', 2)] },
          itemEvidenceProvider: {
            getItemsForInvoice: () => [
              { productNameRaw: 'فيتامين د', quantity: 2, lineTotal: 90 },
              { productNameRaw: 'فيتامين  د', quantity: 3, lineTotal: 90 }, // normalizes to the same key (extra space collapses)
            ],
          },
        })
      );
      expect(m.needsHumanReview).toBe(true);
      expect(m.humanReviewReasons).toContain('ambiguous_product_alias');
      expect(m.itemMatch).not.toBe('exact');
    });

    it('an unresolved basket item (Phase B never resolved its identity) stays unknown-confidence and is not silently treated as a clean match even if its raw text happens to equal an invoice item', () => {
      const m = deriveBasketInvoiceMatch(
        baseInput({
          itemsByBasketId: { 'basket:1': [item('التاني', 2, 'unknown')] },
          itemEvidenceProvider: { getItemsForInvoice: () => [{ productNameRaw: 'التاني', quantity: 2, lineTotal: 90 }] },
        })
      );
      expect(m.needsHumanReview).toBe(true);
      expect(m.humanReviewReasons).toContain('unresolved_product_identity');
      // Never compared for quantity — no quantity_mismatch/agreement claim was made about it.
      expect(m.differences.some((d) => d.type === 'quantity_mismatch' && d.key === 'التاني')).toBe(false);
    });
  });

  describe('Quantity semantics (Phase E.1 §5)', () => {
    it('an unknown basket quantity never produces a quantity mismatch', () => {
      const m = deriveBasketInvoiceMatch(
        baseInput({
          itemsByBasketId: { 'basket:1': [item('فيتامين د', null)] },
          itemEvidenceProvider: { getItemsForInvoice: () => [{ productNameRaw: 'فيتامين د', quantity: 2, lineTotal: 180 }] },
        })
      );
      expect(m.differences.some((d) => d.type === 'quantity_mismatch')).toBe(false);
    });

    it('an explicit basket quantity (2) vs invoice quantity (3) is a real quantity_mismatch', () => {
      const m = deriveBasketInvoiceMatch(
        baseInput({
          itemsByBasketId: { 'basket:1': [item('فيتامين د', 2)] },
          itemEvidenceProvider: { getItemsForInvoice: () => [{ productNameRaw: 'فيتامين د', quantity: 3, lineTotal: 270 }] },
        })
      );
      expect(m.differences.some((d) => d.type === 'quantity_mismatch')).toBe(true);
    });

    it('an ambiguous alias is excluded from quantity comparison — identity must be resolved first', () => {
      const m = deriveBasketInvoiceMatch(
        baseInput({
          itemsByBasketId: { 'basket:1': [item('شامبو', 5)] },
          itemEvidenceProvider: {
            getItemsForInvoice: () => [
              { productNameRaw: 'شامبو', quantity: 1, lineTotal: 70 },
              { productNameRaw: 'شامبو', quantity: 9, lineTotal: 70 },
            ],
          },
        })
      );
      expect(m.differences.some((d) => d.type === 'quantity_mismatch' && d.key === 'شامبو')).toBe(false);
    });
  });

  describe('Sales Integrity readiness/scope contract (Phase E.1 §7)', () => {
    it('header_and_items scope when both a real total AND item evidence are available', () => {
      const m = deriveBasketInvoiceMatch(
        baseInput({
          itemsByBasketId: { 'basket:1': [item('فيتامين د', 2)] },
          itemEvidenceProvider: { getItemsForInvoice: () => [{ productNameRaw: 'فيتامين د', quantity: 2, lineTotal: 180 }] },
        })
      );
      expect(m.headerEvidenceReady).toBe(true);
      expect(m.itemEvidenceReady).toBe(true);
      expect(m.integrityEvaluationScope).toBe('header_and_items');
    });

    it('header_only scope when the total is comparable but item evidence is unavailable — the common case today', () => {
      const m = deriveBasketInvoiceMatch(baseInput());
      expect(m.headerEvidenceReady).toBe(true);
      expect(m.itemEvidenceReady).toBe(false);
      expect(m.integrityEvaluationScope).toBe('header_only');
    });

    it('insufficient scope when there is no active basket (or attribution is unknown) — never header_only by accident', () => {
      const m = deriveBasketInvoiceMatch(baseInput({ baskets: [] }));
      expect(m.integrityEvaluationScope).toBe('insufficient');
    });
  });
});
