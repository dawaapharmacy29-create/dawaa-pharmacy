import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';
import { buildCaseBaskets } from '@/lib/salesIntelligence/caseBasketEngine';
import {
  assessOrderConfirmationProtocol,
  deriveCommercialConfirmationState,
} from '@/lib/salesIntelligence/commercialConfirmationEngine';
import { deriveSaleAttributionAssessment } from '@/lib/salesIntelligence/saleAttributionEngine';
import { deriveBasketInvoiceMatch } from '@/lib/salesIntelligence/basketInvoiceMatchingEngine';
import {
  deriveProtocolPolicyComplianceState,
  deriveSalesIntegrityAssessment,
  type SalesIntegrityInput,
} from '@/lib/salesIntelligence/salesIntegrityEngine';
import type {
  BasketInvoiceDifference,
  BasketInvoiceMatch,
  CommercialConfirmationAssessment,
  OrderConfirmationProtocolAssessment,
  SaleAttributionAssessment,
  SaleAttributionCandidate,
} from '@/lib/salesIntelligence/types';

function cc(overrides: Partial<CommercialConfirmationAssessment> = {}): CommercialConfirmationAssessment {
  return {
    caseId: 'c1',
    basketId: 'b1',
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
    ...overrides,
  };
}

function protocol(overrides: Partial<OrderConfirmationProtocolAssessment> = {}): OrderConfirmationProtocolAssessment {
  return {
    caseId: 'c1',
    basketId: 'b1',
    basketVersion: 1,
    summaryCompliant: true,
    announcedTotalCompliant: true,
    customerConfirmationCompliant: true,
    staffFinalConfirmationCompliant: true,
    protocolCompliant: true,
    missingProtocolSteps: [],
    ...overrides,
  };
}

function attribution(overrides: Partial<SaleAttributionAssessment> = {}): SaleAttributionAssessment {
  return {
    caseId: 'c1',
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

function bim(overrides: Partial<BasketInvoiceMatch> = {}): BasketInvoiceMatch {
  return {
    matchId: 'm1',
    caseId: 'c1',
    basketId: 'b1',
    basketVersion: 1,
    invoiceId: 'inv-1',
    invoiceNumber: 'INV-1',
    totalMatch: 'exact',
    itemMatch: 'insufficient_data',
    quantityMatch: 'insufficient_data',
    overallMatch: 'partial',
    headerEvidenceReady: true,
    itemEvidenceReady: false,
    integrityEvaluationScope: 'header_only',
    differences: [],
    confidence: { level: 'strongly_inferred', score: 0.8, ruleIds: [], evidence: [] },
    needsHumanReview: false,
    humanReviewReasons: [],
    ruleIds: [],
    ...overrides,
  };
}

function diff(overrides: Partial<BasketInvoiceDifference>): BasketInvoiceDifference {
  return {
    type: 'total_mismatch',
    key: 'total',
    before: null,
    after: null,
    explanation: 'none',
    evidence: [],
    confidence: { level: 'proven', score: 0.9, ruleIds: [], evidence: [] },
    ...overrides,
  };
}

function baseInput(overrides: Partial<SalesIntegrityInput> = {}): SalesIntegrityInput {
  return {
    caseId: 'c1',
    commercialConfirmation: cc(),
    protocolAssessment: protocol(),
    attribution: attribution(),
    basketInvoiceMatch: bim(),
    ...overrides,
  };
}

describe('Sales Integrity Engine (Sales Intelligence Phase F) — Golden Cases', () => {
  describe('Clean flows', () => {
    it('1. complete case + strong invoice + exact header -> no header exception', () => {
      const a = deriveSalesIntegrityAssessment(baseInput());
      expect(a.exceptions.filter((e) => e.stage === 'invoice_header')).toEqual([]);
    });

    it('2. complete case + header exact + item data unavailable -> clean header, item integrity not evaluated (not an error)', () => {
      const a = deriveSalesIntegrityAssessment(baseInput());
      expect(a.exceptions).toEqual([]);
      expect(a.canEvaluateHeaderIntegrity).toBe(true);
      expect(a.canEvaluateItemIntegrity).toBe(false);
      expect(a.integrityEvaluationScope).toBe('header_only');
    });

    it('3. protocol incomplete but commercial/invoice clean -> protocol exception only', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          commercialConfirmation: cc({ announcedTotalPresent: false }),
          protocolAssessment: protocol({ announcedTotalCompliant: false, protocolCompliant: false, missingProtocolSteps: ['announced_total'] }),
          basketInvoiceMatch: bim({ totalMatch: 'insufficient_data', headerEvidenceReady: false, overallMatch: 'insufficient_data', integrityEvaluationScope: 'insufficient' }),
        })
      );
      expect(a.exceptionCount).toBe(1);
      expect(a.exceptions[0].type).toBe('final_total_missing');
      expect(a.exceptions.some((e) => e.type === 'unexplained_total_difference')).toBe(false);
    });
  });

  describe('No invoice / attribution', () => {
    it('4. commercially complete + no invoice candidate at all', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          attribution: attribution({ candidateCount: 0, selectedInvoiceId: null, selectedInvoiceNumber: null, attributionLevel: 'unknown', hasAttributedInvoice: false }),
          basketInvoiceMatch: bim({ invoiceId: null, invoiceNumber: null, totalMatch: 'insufficient_data', headerEvidenceReady: false, overallMatch: 'insufficient_data', integrityEvaluationScope: 'insufficient' }),
        })
      );
      const e = a.exceptions.find((x) => x.type === 'confirmed_case_without_attributed_invoice');
      expect(e).toBeDefined();
      expect(e?.ruleIds).toContain('integrity.attribution.commercial_record_not_found');
    });

    it('5. commercially complete + weak invoice candidate — distinguished from "no candidate"', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          attribution: attribution({ attributionLevel: 'weakly_inferred', isOfficialForStaffEvaluation: false }),
          basketInvoiceMatch: bim({ totalMatch: 'insufficient_data', headerEvidenceReady: false, overallMatch: 'insufficient_data', integrityEvaluationScope: 'insufficient' }),
        })
      );
      const e = a.exceptions.find((x) => x.type === 'confirmed_case_without_attributed_invoice');
      expect(e?.ruleIds).toContain('integrity.attribution.invoice_attribution_not_reliable');
    });

    it('6. commercially complete + ambiguous invoice candidates — its own distinct type', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          attribution: attribution({ candidateCount: 2, contradictions: ['ambiguous_multiple_candidates'], attributionLevel: 'weakly_inferred', isOfficialForStaffEvaluation: false }),
          basketInvoiceMatch: bim({ totalMatch: 'insufficient_data', headerEvidenceReady: false, overallMatch: 'insufficient_data', integrityEvaluationScope: 'insufficient' }),
        })
      );
      expect(a.exceptions.some((e) => e.type === 'ambiguous_invoice_attribution')).toBe(true);
      expect(a.exceptions.some((e) => e.type === 'confirmed_case_without_attributed_invoice')).toBe(false);
    });

    it('7. identity conflict', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({ attribution: attribution({ selectedCandidate: { identityConflict: 'phone_vs_customer_id_conflict', branchMatch: 'unknown' } as SaleAttributionCandidate }) })
      );
      expect(a.exceptions.some((e) => e.type === 'identity_conflict')).toBe(true);
    });

    it('8. branch conflict', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({ attribution: attribution({ selectedCandidate: { identityConflict: 'none', branchMatch: 'mismatch' } as SaleAttributionCandidate }) })
      );
      expect(a.exceptions.some((e) => e.type === 'branch_conflict')).toBe(true);
    });

    it('9. competing case claim', () => {
      const a = deriveSalesIntegrityAssessment(baseInput({ attribution: attribution({ competingCaseIds: ['case-2'] }) }));
      expect(a.exceptions.some((e) => e.type === 'competing_case_attribution')).toBe(true);
    });
  });

  describe('Total', () => {
    it('10. exact total -> no total exception', () => {
      const a = deriveSalesIntegrityAssessment(baseInput({ basketInvoiceMatch: bim({ totalMatch: 'exact' }) }));
      expect(a.exceptions.some((e) => e.stage === 'invoice_header')).toBe(false);
    });

    it('11. near total -> no total exception (within tolerance is not integrity-worthy)', () => {
      const a = deriveSalesIntegrityAssessment(baseInput({ basketInvoiceMatch: bim({ totalMatch: 'near_match' }) }));
      expect(a.exceptions.some((e) => e.stage === 'invoice_header')).toBe(false);
    });

    it('12. raw mismatch + documented delivery fee -> confirmed_total_invoice_mismatch, explained=true, severity info', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          basketInvoiceMatch: bim({
            totalMatch: 'mismatch',
            differences: [
              diff({ type: 'total_mismatch', before: 980, after: 1050 }),
              diff({ type: 'explained_difference', before: 980, after: 1050, explanation: 'delivery_fee', confidence: { level: 'strongly_inferred', score: 0.75, ruleIds: [], evidence: [] } }),
            ],
          }),
        })
      );
      const e = a.exceptions.find((x) => x.stage === 'invoice_header');
      expect(e?.type).toBe('confirmed_total_invoice_mismatch');
      expect(e?.explained).toBe(true);
      expect(e?.explanationKind).toBe('delivery_fee');
      expect(e?.severity).toBe('info');
    });

    it('13. raw mismatch + documented discount -> explained', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          basketInvoiceMatch: bim({
            totalMatch: 'mismatch',
            differences: [
              diff({ type: 'total_mismatch', before: 1000, after: 950 }),
              diff({ type: 'explained_difference', before: 1000, after: 950, explanation: 'discount', confidence: { level: 'strongly_inferred', score: 0.75, ruleIds: [], evidence: [] } }),
            ],
          }),
        })
      );
      const e = a.exceptions.find((x) => x.stage === 'invoice_header');
      expect(e?.explained).toBe(true);
      expect(e?.explanationKind).toBe('discount');
    });

    it('14. unexplained mismatch -> unexplained_total_difference, severity high_priority', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          basketInvoiceMatch: bim({
            totalMatch: 'mismatch',
            differences: [
              diff({ type: 'total_mismatch', before: 180, after: 500 }),
              diff({ type: 'unexplained_difference', before: 180, after: 500, confidence: { level: 'unknown', score: 0.3, ruleIds: [], evidence: [] } }),
            ],
          }),
        })
      );
      const e = a.exceptions.find((x) => x.stage === 'invoice_header');
      expect(e?.type).toBe('unexplained_total_difference');
      expect(e?.explained).toBe(false);
      expect(e?.severity).toBe('high_priority');
      expect(e?.difference).toBe(320);
    });

    it('15. no announced total -> no total exception is generated from missing header evidence itself (only the protocol exception fires)', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          commercialConfirmation: cc({ announcedTotalPresent: false }),
          protocolAssessment: protocol({ announcedTotalCompliant: false, protocolCompliant: false, missingProtocolSteps: ['announced_total'] }),
          basketInvoiceMatch: bim({ totalMatch: 'insufficient_data', headerEvidenceReady: false, overallMatch: 'insufficient_data', integrityEvaluationScope: 'insufficient' }),
        })
      );
      expect(a.exceptions.some((e) => e.type === 'unexplained_total_difference' || e.type === 'confirmed_total_invoice_mismatch')).toBe(false);
    });
  });

  describe('Protocol', () => {
    it('16. missing final total', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({ protocolAssessment: protocol({ announcedTotalCompliant: false, protocolCompliant: false, missingProtocolSteps: ['announced_total'] }) })
      );
      expect(a.exceptions.some((e) => e.type === 'final_total_missing')).toBe(true);
    });

    it('17. missing staff final confirmation', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({ protocolAssessment: protocol({ staffFinalConfirmationCompliant: false, protocolCompliant: false, missingProtocolSteps: ['staff_final_confirmation'] }) })
      );
      expect(a.exceptions.some((e) => e.type === 'staff_final_confirmation_missing')).toBe(true);
    });

    it('18. basket modified after confirmation, not yet re-confirmed', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({ commercialConfirmation: cc({ modificationAfterConfirmation: true, currentState: 'modified_after_confirmation' }) })
      );
      expect(a.exceptions.some((e) => e.type === 'basket_modified_after_confirmation')).toBe(true);
    });

    it('19. fully compliant protocol -> no protocol exceptions', () => {
      const a = deriveSalesIntegrityAssessment(baseInput());
      expect(a.exceptions.some((e) => e.stage === 'basket_confirmation')).toBe(false);
    });
  });

  describe('Item scope', () => {
    it('20. header_only never emits a missing-item exception even if differences somehow carry one (defensive)', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          basketInvoiceMatch: bim({
            integrityEvaluationScope: 'header_only',
            itemEvidenceReady: false,
            differences: [diff({ type: 'missing_item', key: 'فيتامين د', before: 2, after: null })],
          }),
        })
      );
      expect(a.exceptions.some((e) => e.type === 'confirmed_item_missing_from_invoice')).toBe(false);
    });

    it('21. header_only never emits a quantity exception', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          basketInvoiceMatch: bim({
            integrityEvaluationScope: 'header_only',
            itemEvidenceReady: false,
            differences: [diff({ type: 'quantity_mismatch', key: 'فيتامين د', before: 2, after: 3 })],
          }),
        })
      );
      expect(a.exceptions.some((e) => e.type === 'confirmed_quantity_mismatch')).toBe(false);
    });

    it('22. header_and_items with an exact item set -> no item exceptions', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          basketInvoiceMatch: bim({ integrityEvaluationScope: 'header_and_items', itemEvidenceReady: true, itemMatch: 'exact', quantityMatch: 'exact', differences: [] }),
        })
      );
      expect(a.exceptions).toEqual([]);
    });

    it('23. missing confirmed item', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          basketInvoiceMatch: bim({
            integrityEvaluationScope: 'header_and_items',
            itemEvidenceReady: true,
            itemMatch: 'partial',
            differences: [diff({ type: 'missing_item', key: 'شامبو', before: 1, after: null })],
          }),
        })
      );
      const e = a.exceptions.find((x) => x.type === 'confirmed_item_missing_from_invoice');
      expect(e?.expectedValue).toBe(1);
    });

    it('24. extra invoice item', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          basketInvoiceMatch: bim({
            integrityEvaluationScope: 'header_and_items',
            itemEvidenceReady: true,
            itemMatch: 'partial',
            differences: [diff({ type: 'extra_item', key: 'صابون', before: null, after: 1 })],
          }),
        })
      );
      expect(a.exceptions.some((e) => e.type === 'extra_invoice_item')).toBe(true);
    });

    it('25. quantity mismatch', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          basketInvoiceMatch: bim({
            integrityEvaluationScope: 'header_and_items',
            itemEvidenceReady: true,
            quantityMatch: 'partial',
            differences: [diff({ type: 'quantity_mismatch', key: 'فيتامين د', before: 2, after: 3 })],
          }),
        })
      );
      const e = a.exceptions.find((x) => x.type === 'confirmed_quantity_mismatch');
      expect(e?.difference).toBe(1);
    });

    it('26. an unknown basket quantity never produces a confirmed_quantity_mismatch exception', () => {
      // Phase E already never emits a quantity_mismatch difference when the basket quantity is
      // unknown — Phase F simply has nothing to convert, proving the "never reimplement" contract.
      const a = deriveSalesIntegrityAssessment(
        baseInput({ basketInvoiceMatch: bim({ integrityEvaluationScope: 'header_and_items', itemEvidenceReady: true, itemMatch: 'exact', quantityMatch: 'insufficient_data', differences: [] }) })
      );
      expect(a.exceptions.some((e) => e.type === 'confirmed_quantity_mismatch')).toBe(false);
    });

    it('27. an unresolved product identity match carries through with its weaker (non-proven) confidence, never upgraded', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          basketInvoiceMatch: bim({
            integrityEvaluationScope: 'header_and_items',
            itemEvidenceReady: true,
            itemMatch: 'partial',
            differences: [diff({ type: 'missing_item', key: 'التاني', before: 2, after: null, confidence: { level: 'weakly_inferred', score: 0.4, ruleIds: [], evidence: [] } })],
          }),
        })
      );
      const e = a.exceptions.find((x) => x.type === 'confirmed_item_missing_from_invoice');
      expect(e?.confidence.level).toBe('weakly_inferred');
    });

    it('28. an ambiguous product alias produces product_identity_conflict, not a silent pick', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          basketInvoiceMatch: bim({
            integrityEvaluationScope: 'header_and_items',
            itemEvidenceReady: true,
            itemMatch: 'partial',
            differences: [],
            humanReviewReasons: ['ambiguous_product_alias'],
          }),
        })
      );
      expect(a.exceptions.some((e) => e.type === 'product_identity_conflict')).toBe(true);
    });
  });

  describe('Invoice status', () => {
    it('29. cancelled invoice', () => {
      const a = deriveSalesIntegrityAssessment(baseInput({ invoiceStatusHint: 'cancelled' }));
      const e = a.exceptions.find((x) => x.type === 'cancelled_invoice_linked_to_case');
      expect(e?.severity).toBe('high_priority');
    });

    it('30. returned invoice', () => {
      const a = deriveSalesIntegrityAssessment(baseInput({ invoiceStatusHint: 'returned' }));
      const e = a.exceptions.find((x) => x.type === 'returned_invoice_linked_to_case');
      expect(e?.severity).toBe('high_priority');
    });

    it('31. a normal invoice with no status hint produces no status exception', () => {
      const a = deriveSalesIntegrityAssessment(baseInput({ invoiceStatusHint: null }));
      expect(a.exceptions.some((e) => e.type === 'cancelled_invoice_linked_to_case' || e.type === 'returned_invoice_linked_to_case')).toBe(false);
    });
  });

  describe('Deduplication', () => {
    it('32. one total mismatch never generates both confirmed_total_invoice_mismatch AND unexplained_total_difference at once', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          basketInvoiceMatch: bim({
            totalMatch: 'mismatch',
            differences: [diff({ type: 'total_mismatch', before: 180, after: 500 }), diff({ type: 'unexplained_difference', before: 180, after: 500 })],
          }),
        })
      );
      const headerExceptions = a.exceptions.filter((e) => e.stage === 'invoice_header' && e.type !== 'cancelled_invoice_linked_to_case' && e.type !== 'returned_invoice_linked_to_case');
      expect(headerExceptions.length).toBe(1);
    });

    it('33. one missing item produces exactly one canonical exception', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          basketInvoiceMatch: bim({
            integrityEvaluationScope: 'header_and_items',
            itemEvidenceReady: true,
            itemMatch: 'partial',
            differences: [diff({ type: 'missing_item', key: 'شامبو', before: 1, after: null })],
          }),
        })
      );
      expect(a.exceptions.filter((e) => e.type === 'confirmed_item_missing_from_invoice').length).toBe(1);
    });

    it('34. multiple distinct missing items remain individually distinguishable, never collapsed', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          basketInvoiceMatch: bim({
            integrityEvaluationScope: 'header_and_items',
            itemEvidenceReady: true,
            itemMatch: 'partial',
            differences: [
              diff({ type: 'missing_item', key: 'شامبو', before: 1, after: null }),
              diff({ type: 'missing_item', key: 'صابون', before: 2, after: null }),
            ],
          }),
        })
      );
      const missing = a.exceptions.filter((e) => e.type === 'confirmed_item_missing_from_invoice');
      expect(missing.length).toBe(2);
      expect(new Set(missing.map((e) => e.exceptionId)).size).toBe(2);
      expect(missing.map((e) => e.expectedValue).sort()).toEqual([1, 2]);
    });
  });

  describe('Severity', () => {
    it('35. a protocol omission is severity review, never high_priority', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({ protocolAssessment: protocol({ announcedTotalCompliant: false, protocolCompliant: false, missingProtocolSteps: ['announced_total'] }) })
      );
      expect(a.exceptions.find((e) => e.type === 'final_total_missing')?.severity).toBe('review');
    });

    it('36. an unexplained financial mismatch is high_priority', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          basketInvoiceMatch: bim({
            totalMatch: 'mismatch',
            differences: [diff({ type: 'total_mismatch', before: 180, after: 500 }), diff({ type: 'unexplained_difference', before: 180, after: 500 })],
          }),
        })
      );
      expect(a.highestSeverity).toBe('high_priority');
    });

    it('37. no reliable invoice after a complete confirmation is high_priority', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          attribution: attribution({ candidateCount: 0, selectedInvoiceId: null, selectedInvoiceNumber: null, attributionLevel: 'unknown', hasAttributedInvoice: false }),
          basketInvoiceMatch: bim({ invoiceId: null, invoiceNumber: null, totalMatch: 'insufficient_data', headerEvidenceReady: false, overallMatch: 'insufficient_data', integrityEvaluationScope: 'insufficient' }),
        })
      );
      expect(a.highestSeverity).toBe('high_priority');
    });
  });

  describe('End-to-end', () => {
    function runPipeline(raw: string, invoiceRows: Array<Record<string, unknown>>, extra: { invoiceStatusHint?: 'cancelled' | 'returned' | null } = {}) {
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
      const protocolAssessment = assessOrderConfirmationProtocol(commercialConfirmation);
      const latest = baskets[baskets.length - 1];
      const attributionAssessment = deriveSaleAttributionAssessment(
        {
          caseId: cases[0].caseId,
          customerId: 'cust-1',
          customerPhone: null,
          branchNameRaw: null,
          caseEndedAt: cases[0].endedAt,
          commercialConfirmation,
          activeAnnouncedTotal: latest.announcedTotal,
          activeBasketValue: null,
          activeBasketItems: (itemsByBasketId[latest.basketId] || []).map((i) => ({ productNameRaw: i.productNameRaw, quantity: i.quantity })),
          knownStaffIds: [],
          legacyMatchedInvoiceId: null,
          legacyMatchedInvoiceNumber: null,
          trustedInvoiceId: null,
          trustedInvoiceNumber: null,
        },
        invoiceRows
      );
      const matchedInvoiceRow = invoiceRows.find((r) => r.id === attributionAssessment.selectedInvoiceId) ?? null;
      const basketInvoiceMatch = deriveBasketInvoiceMatch({
        caseId: cases[0].caseId,
        baskets,
        itemsByBasketId,
        attribution: attributionAssessment,
        invoiceRow: matchedInvoiceRow,
      });
      const integrity = deriveSalesIntegrityAssessment({
        caseId: cases[0].caseId,
        commercialConfirmation,
        protocolAssessment,
        attribution: attributionAssessment,
        basketInvoiceMatch,
        invoiceStatusHint: extra.invoiceStatusHint ?? null,
      });
      return { baskets, attributionAssessment, basketInvoiceMatch, integrity };
    }

    it('38. B -> C -> D -> E -> F: a completely clean flow produces zero exceptions', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
      const { integrity } = runPipeline(raw, [
        { id: 'inv-1', customer_id: 'cust-1', invoice_datetime: '2026-09-15T09:05:00.000Z', net_amount: 180 },
      ]);
      expect(integrity.exceptions).toEqual([]);
      expect(integrity.needsHumanReview).toBe(false);
    });

    it('39. complete order but invoice total differs, unexplained -> unexplained_total_difference', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
      const { integrity } = runPipeline(raw, [
        { id: 'inv-1', customer_id: 'cust-1', invoice_datetime: '2026-09-15T09:05:00.000Z', net_amount: 900 },
      ]);
      expect(integrity.exceptions.some((e) => e.type === 'unexplained_total_difference')).toBe(true);
    });

    it('40. a modified basket (v1 -> v2) is evaluated only against v2 through the full pipeline', () => {
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
      const { baskets, basketInvoiceMatch, integrity } = runPipeline(raw, [
        { id: 'inv-new', customer_id: 'cust-1', invoice_datetime: '2026-09-15T09:07:00.000Z', net_amount: 250 },
      ]);
      expect(basketInvoiceMatch.basketVersion).toBe(baskets[baskets.length - 1].version);
      expect(integrity.exceptions).toEqual([]);
    });

    it('41. an invoice matching the SUPERSEDED v1 total (not current v2) produces a real total exception, never silently accepted', () => {
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
      const { integrity } = runPipeline(raw, [
        { id: 'inv-old', customer_id: 'cust-1', invoice_datetime: '2026-09-15T09:07:00.000Z', net_amount: 180 },
      ]);
      const e = integrity.exceptions.find((x) => x.stage === 'invoice_header');
      expect(e).toBeDefined();
      expect(e?.expectedValue).toBe(250); // v2's total, never v1's stale 180
    });

    it('42. item data unavailable through the full pipeline never invents an item exception', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;
      const { basketInvoiceMatch, integrity } = runPipeline(raw, [
        { id: 'inv-1', customer_id: 'cust-1', invoice_datetime: '2026-09-15T09:05:00.000Z', net_amount: 180 },
      ]);
      expect(basketInvoiceMatch.itemEvidenceReady).toBe(false);
      expect(integrity.exceptions.filter((e) => e.stage === 'invoice_items')).toEqual([]);
      expect(integrity.canEvaluateItemIntegrity).toBe(false);
    });
  });

  describe('Protocol Policy Compliance (Phase G.1)', () => {
    it('1. not_applicable/not_reached/unknown applicability pass straight through, regardless of policy date', () => {
      expect(
        deriveProtocolPolicyComplianceState({ applicability: 'not_applicable', protocolCompliant: false, caseEndedAt: null, protocolPolicyEffectiveAt: '2026-01-01' })
      ).toBe('not_applicable');
      expect(
        deriveProtocolPolicyComplianceState({ applicability: 'not_reached', protocolCompliant: false, caseEndedAt: null, protocolPolicyEffectiveAt: null })
      ).toBe('not_reached');
      expect(
        deriveProtocolPolicyComplianceState({ applicability: 'unknown', protocolCompliant: false, caseEndedAt: null, protocolPolicyEffectiveAt: undefined })
      ).toBe('unknown');
    });

    it('2. protocolPolicyEffectiveAt omitted (undefined) preserves pre-G.1 behavior: always enforced once applicable', () => {
      expect(
        deriveProtocolPolicyComplianceState({ applicability: 'applicable', protocolCompliant: false, caseEndedAt: null, protocolPolicyEffectiveAt: undefined })
      ).toBe('non_compliant');
      expect(
        deriveProtocolPolicyComplianceState({ applicability: 'applicable', protocolCompliant: true, caseEndedAt: null, protocolPolicyEffectiveAt: undefined })
      ).toBe('compliant');
    });

    it('3. protocolPolicyEffectiveAt explicitly null -> not_enforced for every applicable case, whatever protocolCompliant says', () => {
      expect(
        deriveProtocolPolicyComplianceState({ applicability: 'applicable', protocolCompliant: false, caseEndedAt: '2026-06-01', protocolPolicyEffectiveAt: null })
      ).toBe('not_enforced');
    });

    it('4. a case ending BEFORE the configured effective date -> not_enforced, never non_compliant', () => {
      expect(
        deriveProtocolPolicyComplianceState({
          applicability: 'applicable', protocolCompliant: false,
          caseEndedAt: '2026-01-01T00:00:00.000Z', protocolPolicyEffectiveAt: '2026-06-01T00:00:00.000Z',
        })
      ).toBe('not_enforced');
    });

    it('5. a case ending ON/AFTER the configured effective date -> evaluated for real (compliant or non_compliant)', () => {
      expect(
        deriveProtocolPolicyComplianceState({
          applicability: 'applicable', protocolCompliant: false,
          caseEndedAt: '2026-07-01T00:00:00.000Z', protocolPolicyEffectiveAt: '2026-06-01T00:00:00.000Z',
        })
      ).toBe('non_compliant');
      expect(
        deriveProtocolPolicyComplianceState({
          applicability: 'applicable', protocolCompliant: true,
          caseEndedAt: '2026-07-01T00:00:00.000Z', protocolPolicyEffectiveAt: '2026-06-01T00:00:00.000Z',
        })
      ).toBe('compliant');
    });

    it('6. an opted-in comparison with no comparable case timestamp -> unknown, never a guess', () => {
      expect(
        deriveProtocolPolicyComplianceState({
          applicability: 'applicable', protocolCompliant: false, caseEndedAt: null, protocolPolicyEffectiveAt: '2026-06-01T00:00:00.000Z',
        })
      ).toBe('unknown');
    });

    it('7. wired end-to-end: an applicable+non-compliant case with a future effective date suppresses the protocol exceptions', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          commercialConfirmation: cc({ announcedTotalPresent: false }),
          protocolAssessment: protocol({ announcedTotalCompliant: false, protocolCompliant: false, missingProtocolSteps: ['announced_total'], applicability: 'applicable' }),
          caseEndedAt: '2026-01-01T00:00:00.000Z',
          protocolPolicyEffectiveAt: '2027-01-01T00:00:00.000Z',
        })
      );
      expect(a.exceptions.some((e) => e.type === 'final_total_missing')).toBe(false);
      expect(a.protocolPolicyCompliance).toBe('not_enforced');
    });

    it('8. wired end-to-end: applicability not_reached suppresses protocol exceptions even though missingProtocolSteps is non-empty', () => {
      const a = deriveSalesIntegrityAssessment(
        baseInput({
          commercialConfirmation: cc({ currentState: 'basket_in_progress', summaryPresented: false, customerConfirmed: false, staffConfirmed: false, announcedTotalPresent: false }),
          protocolAssessment: protocol({
            summaryCompliant: false, announcedTotalCompliant: false, customerConfirmationCompliant: false, staffFinalConfirmationCompliant: false,
            protocolCompliant: false, missingProtocolSteps: ['final_basket_summary', 'announced_total', 'customer_final_confirmation', 'staff_final_confirmation'],
            applicability: 'not_reached',
          }),
          basketInvoiceMatch: bim({ totalMatch: 'insufficient_data', headerEvidenceReady: false, overallMatch: 'insufficient_data', integrityEvaluationScope: 'insufficient' }),
        })
      );
      expect(a.exceptionCount).toBe(0);
      expect(a.protocolPolicyCompliance).toBe('not_reached');
    });
  });
});
