import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import { deriveConversationCases } from '@/lib/salesIntelligence/conversationCaseEngine';
import { buildCaseBaskets } from '@/lib/salesIntelligence/caseBasketEngine';
import { deriveCommercialConfirmationState } from '@/lib/salesIntelligence/commercialConfirmationEngine';
import {
  buildAttributionCandidate,
  deriveSaleAttributionAssessment,
  type CaseAttributionContext,
  type InvoiceItemEvidenceProvider,
} from '@/lib/salesIntelligence/saleAttributionEngine';
import type { CommercialConfirmationAssessment } from '@/lib/salesIntelligence/types';

const COMPLETE_CONFIRMATION: CommercialConfirmationAssessment = {
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

function baseCase(overrides: Partial<CaseAttributionContext> = {}): CaseAttributionContext {
  return {
    caseId: 'case-1',
    customerId: null,
    customerPhone: null,
    branchNameRaw: null,
    caseStartedAt: '2026-09-15T09:00:00.000Z',
    caseEndedAt: '2026-09-15T09:10:00.000Z',
    commercialConfirmation: COMPLETE_CONFIRMATION,
    activeAnnouncedTotal: null,
    activeBasketValue: null,
    activeBasketItems: [],
    knownStaffIds: [],
    legacyMatchedInvoiceId: null,
    legacyMatchedInvoiceNumber: null,
    trustedInvoiceId: null,
    trustedInvoiceNumber: null,
    ...overrides,
  };
}

function total(amount: number, basketVersion = 1) {
  return { amount, currency: 'EGP' as const, messageId: 'm1', staffId: null, announcedAt: '2026-09-15T09:01:00.000Z', basketVersion, supersededByTotalId: null };
}

describe('Sale Attribution Engine (Sales Intelligence Phase D) — Golden Cases', () => {
  describe('Direct/strong matches', () => {
    it('1. a direct, trusted invoice link is proven and official, overriding heuristic ranking', () => {
      const ctx = baseCase({ trustedInvoiceId: 'inv-100' });
      const assess = deriveSaleAttributionAssessment(ctx, [
        { id: 'inv-100', invoice_number: 'INV-100', invoice_datetime: '2026-09-20T00:00:00.000Z', net_amount: 5000 },
        { id: 'inv-200', invoice_number: 'INV-200', customer_id: 'irrelevant', invoice_datetime: '2026-09-15T09:15:00.000Z', net_amount: 180 },
      ]);
      expect(assess.selectedInvoiceId).toBe('inv-100');
      expect(assess.attributionLevel).toBe('proven');
      expect(assess.isOfficialForStaffEvaluation).toBe(true);
    });

    it('2. exact customer + exact branch + 20 min + exact total is strongly_inferred', () => {
      const ctx = baseCase({ customerId: 'cust-1', branchNameRaw: 'فرع شكري', activeAnnouncedTotal: total(180) });
      const candidate = buildAttributionCandidate(ctx, {
        id: 'inv-1',
        invoice_number: 'INV-1',
        customer_id: 'cust-1',
        branch: 'فرع شكري',
        invoice_datetime: '2026-09-15T09:30:00.000Z',
        net_amount: 180,
      });
      expect(candidate.customerIdMatch).toBe(true);
      expect(candidate.branchMatch).toBe('exact_canonical');
      expect(candidate.timeMatchStrength).toBe('very_strong');
      expect(candidate.announcedTotalMatch).toBe('exact');
      expect(candidate.confidenceAssessment.level).toBe('strongly_inferred');
    });

    it('3. exact phone + exact branch + short time + exact total is strongly_inferred', () => {
      const ctx = baseCase({ customerPhone: '01012345678', branchNameRaw: 'فرع الشامي', activeAnnouncedTotal: total(300) });
      const candidate = buildAttributionCandidate(ctx, {
        id: 'inv-1',
        invoice_number: 'INV-1',
        customer_phone: '01012345678',
        branch: 'فرع الشامي',
        invoice_datetime: '2026-09-15T09:20:00.000Z',
        net_amount: 300,
      });
      expect(candidate.phoneMatch).toBe(true);
      expect(candidate.confidenceAssessment.level).toBe('strongly_inferred');
    });

    it('4. phone normalization bridges formatting differences (0020-prefixed vs local) — the closest thing to a canonical identity match this schema supports', () => {
      const ctx = baseCase({ customerPhone: '01012345678' });
      const candidate = buildAttributionCandidate(ctx, {
        id: 'inv-1',
        invoice_number: 'INV-1',
        customer_phone: '0020 10 1234 5678',
        invoice_datetime: '2026-09-15T09:15:00.000Z',
        net_amount: 180,
      });
      expect(candidate.phoneMatch).toBe(true);
    });
  });

  describe('Timing', () => {
    it('5. invoice 5 minutes later is very_strong', () => {
      const ctx = baseCase();
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', invoice_datetime: '2026-09-15T09:15:00.000Z' });
      expect(c.timeMatchStrength).toBe('very_strong');
      expect(c.timeDistanceMinutes).toBe(5);
    });

    it('6. invoice ~1.5 hours later is strong', () => {
      const ctx = baseCase();
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', invoice_datetime: '2026-09-15T10:40:00.000Z' });
      expect(c.timeMatchStrength).toBe('strong');
    });

    it('7. invoice same day much later is weak', () => {
      const ctx = baseCase();
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', invoice_datetime: '2026-09-15T18:00:00.000Z' });
      expect(c.timeMatchStrength).toBe('weak');
    });

    it('8. invoice next day is very_weak', () => {
      const ctx = baseCase();
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', invoice_datetime: '2026-09-16T10:00:00.000Z' });
      expect(c.timeMatchStrength).toBe('very_weak');
    });

    it('9. a next-day invoice with a direct trusted link is STILL proven — time never overrides hard evidence', () => {
      const ctx = baseCase({ trustedInvoiceId: 'inv-1' });
      const assess = deriveSaleAttributionAssessment(ctx, [
        { id: 'inv-1', invoice_number: 'INV-1', invoice_datetime: '2026-09-16T10:00:00.000Z', net_amount: 180 },
      ]);
      expect(assess.attributionLevel).toBe('proven');
    });
  });

  describe('Announced Total', () => {
    it('10. an exact total match is classified exact', () => {
      const ctx = baseCase({ activeAnnouncedTotal: total(180) });
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', net_amount: 180 });
      expect(c.announcedTotalMatch).toBe('exact');
    });

    it('11. a small documented-tolerance difference (1000 vs 995) is near_match', () => {
      const ctx = baseCase({ activeAnnouncedTotal: total(1000) });
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', net_amount: 995 });
      expect(c.announcedTotalMatch).toBe('near_match');
    });

    it('12. a clearly different total is classified different, not an error', () => {
      const ctx = baseCase({ activeAnnouncedTotal: total(1000) });
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', net_amount: 400 });
      expect(c.announcedTotalMatch).toBe('different');
    });

    it('13. no announced total is not_available, never guessed', () => {
      const ctx = baseCase({ activeAnnouncedTotal: null });
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', net_amount: 180 });
      expect(c.announcedTotalMatch).toBe('not_available');
    });
  });

  describe('Identity conflicts', () => {
    it('14. same phone but a conflicting canonical customer_id is flagged, never guessed', () => {
      const ctx = baseCase({ customerId: 'cust-A', customerPhone: '01012345678' });
      const assess = deriveSaleAttributionAssessment(ctx, [
        { id: 'inv-1', customer_id: 'cust-B', customer_phone: '01012345678', invoice_datetime: '2026-09-15T09:20:00.000Z' },
      ]);
      expect(assess.selectedCandidate?.identityConflict).toBe('phone_vs_customer_id_conflict');
      expect(assess.attributionLevel).not.toBe('strongly_inferred');
      expect(assess.attributionLevel).not.toBe('proven');
      expect(assess.needsHumanReview).toBe(true);
      expect(assess.humanReviewReasons).toContain('customer_identity_conflict');
      expect(assess.isOfficialForStaffEvaluation).toBe(false);
    });

    it('15. a name-only similarity contributes NOTHING to identity matching — never sufficient for official attribution', () => {
      // The engine never reads customer_name for identity scoring at all — a name match, however
      // exact, cannot move customerIdMatch or phoneMatch. This is the enforcement mechanism.
      const ctx = baseCase({ customerId: null, customerPhone: null });
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', customer_name: 'Ahmed Mohamed', invoice_datetime: '2026-09-15T09:15:00.000Z' });
      expect(c.customerIdMatch).toBe(false);
      expect(c.phoneMatch).toBe(false);
      expect(c.confidenceAssessment.level).not.toBe('strongly_inferred');
      expect(c.confidenceAssessment.level).not.toBe('proven');
    });

    it('16. no customer identity at all on either side leaves identity evidence at false, not guessed', () => {
      const ctx = baseCase({ customerId: null, customerPhone: null });
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', invoice_datetime: '2026-09-15T09:15:00.000Z' });
      expect(c.customerIdMatch).toBe(false);
      expect(c.phoneMatch).toBe(false);
    });
  });

  describe('Branch', () => {
    it('17. an exact canonical branch match is classified exact_canonical', () => {
      const ctx = baseCase({ branchNameRaw: 'فرع شكري' });
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', branch: 'شكري' });
      expect(c.branchMatch).toBe('exact_canonical');
    });

    it('18. a non-canonical but consistently-normalized branch alias matches as normalized_alias_match', () => {
      const ctx = baseCase({ branchNameRaw: 'الفرع الرئيسي' });
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', branch: 'الفرع الرئيسي' });
      expect(c.branchMatch).toBe('normalized_alias_match');
    });

    it('19. a branch mismatch is flagged and caps the candidate below strongly_inferred', () => {
      const ctx = baseCase({ customerId: 'cust-1', branchNameRaw: 'فرع شكري', activeAnnouncedTotal: total(180) });
      const c = buildAttributionCandidate(ctx, {
        id: 'inv-1',
        customer_id: 'cust-1',
        branch: 'فرع الشامي',
        invoice_datetime: '2026-09-15T09:15:00.000Z',
        net_amount: 180,
      });
      expect(c.branchMatch).toBe('mismatch');
      expect(c.disqualifiers).toContain('branch_mismatch');
      expect(c.confidenceAssessment.level).not.toBe('strongly_inferred');
    });

    it('20. a missing branch on either side is unknown, never assumed to match or mismatch', () => {
      const ctx = baseCase({ branchNameRaw: null });
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', branch: 'فرع شكري' });
      expect(c.branchMatch).toBe('unknown');
    });
  });

  describe('Staff', () => {
    it('21. the invoice staff matching a known case contributor is classified same', () => {
      const ctx = baseCase({ knownStaffIds: ['staff-1'] });
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', staff_id: 'staff-1' });
      expect(c.staffMatch).toBe('same');
    });

    it('22. an invoice staff outside a known MULTI-staff case is classified compatible, not disqualified', () => {
      const ctx = baseCase({ knownStaffIds: ['staff-1', 'staff-2'] });
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', staff_id: 'staff-3' });
      expect(c.staffMatch).toBe('compatible');
      expect(c.disqualifiers).not.toContain('staff_mismatch');
    });

    it('23. a different single staff member never disqualifies an otherwise strong candidate', () => {
      const ctx = baseCase({
        customerId: 'cust-1',
        branchNameRaw: 'فرع شكري',
        activeAnnouncedTotal: total(180),
        knownStaffIds: ['staff-1'],
      });
      const assess = deriveSaleAttributionAssessment(ctx, [
        {
          id: 'inv-1',
          customer_id: 'cust-1',
          branch: 'فرع شكري',
          invoice_datetime: '2026-09-15T09:20:00.000Z',
          net_amount: 180,
          staff_id: 'staff-99',
        },
      ]);
      expect(assess.selectedCandidate?.staffMatch).toBe('different');
      expect(assess.attributionLevel).toBe('strongly_inferred');
      expect(assess.isOfficialForStaffEvaluation).toBe(true);
    });

    it('24. a staff match alone (no identity, no time, no total) is far short of any real attribution', () => {
      const ctx = baseCase({ knownStaffIds: ['staff-1'], caseEndedAt: null });
      const c = buildAttributionCandidate(ctx, { id: 'inv-1', staff_id: 'staff-1' });
      expect(c.confidenceAssessment.level).toBe('unknown');
    });
  });

  describe('Multiple invoices', () => {
    it('25. two candidates where one is clearly stronger selects the stronger one outright, not ambiguous', () => {
      const ctx = baseCase({ customerId: 'cust-1', branchNameRaw: 'فرع شكري', activeAnnouncedTotal: total(180) });
      const assess = deriveSaleAttributionAssessment(ctx, [
        { id: 'inv-weak', invoice_datetime: '2026-09-16T09:00:00.000Z', net_amount: 50 },
        { id: 'inv-strong', customer_id: 'cust-1', branch: 'فرع شكري', invoice_datetime: '2026-09-15T09:15:00.000Z', net_amount: 180 },
      ]);
      expect(assess.selectedInvoiceId).toBe('inv-strong');
      expect(assess.needsHumanReview).toBe(false);
      expect(assess.attributionLevel).toBe('strongly_inferred');
    });

    it('26. two equally plausible candidates are NOT auto-resolved — flagged for human review', () => {
      const ctx = baseCase({ customerId: 'cust-1', branchNameRaw: 'فرع شكري' });
      const assess = deriveSaleAttributionAssessment(ctx, [
        { id: 'inv-1', customer_id: 'cust-1', branch: 'فرع شكري', invoice_datetime: '2026-09-15T09:15:00.000Z' },
        { id: 'inv-2', customer_id: 'cust-1', branch: 'فرع شكري', invoice_datetime: '2026-09-15T09:20:00.000Z' },
      ]);
      expect(assess.needsHumanReview).toBe(true);
      expect(assess.humanReviewReasons).toContain('ambiguous_multiple_candidates');
      expect(assess.isOfficialForStaffEvaluation).toBe(false);
    });

    it('27. the closest-in-time invoice is NOT chosen when its customer/branch mismatch, over a farther invoice with a full match', () => {
      const ctx = baseCase({ customerId: 'cust-1', branchNameRaw: 'فرع شكري', activeAnnouncedTotal: total(180) });
      const assess = deriveSaleAttributionAssessment(ctx, [
        { id: 'inv-close', customer_id: 'cust-OTHER', branch: 'فرع الشامي', invoice_datetime: '2026-09-15T09:12:00.000Z', net_amount: 999 },
        { id: 'inv-far', customer_id: 'cust-1', branch: 'فرع شكري', invoice_datetime: '2026-09-15T10:30:00.000Z', net_amount: 180 },
      ]);
      expect(assess.selectedInvoiceId).toBe('inv-far');
    });
  });

  describe('Product-level evidence', () => {
    const basketItems = [{ productNameRaw: 'فيتامين د', quantity: 2 }];

    it('28. invoice items unavailable falls back safely and never blocks a strong attribution', () => {
      const ctx = baseCase({
        customerId: 'cust-1',
        branchNameRaw: 'فرع شكري',
        activeAnnouncedTotal: total(180),
        activeBasketItems: basketItems,
      });
      const c = buildAttributionCandidate(ctx, {
        id: 'inv-1',
        customer_id: 'cust-1',
        branch: 'فرع شكري',
        invoice_datetime: '2026-09-15T09:15:00.000Z',
        net_amount: 180,
      });
      expect(c.productMatch).toBe('unavailable');
      expect(c.quantityMatch).toBe('unavailable');
      expect(c.confidenceAssessment.level).toBe('strongly_inferred');
    });

    it('29. available item evidence that matches the basket is classified available_match', () => {
      const provider: InvoiceItemEvidenceProvider = {
        getItemsForInvoice: () => [{ productNameRaw: 'فيتامين د', quantity: 2, lineTotal: 180 }],
      };
      const ctx = baseCase({ activeBasketItems: basketItems });
      const c = buildAttributionCandidate(ctx, { id: 'inv-1' }, provider);
      expect(c.productMatch).toBe('available_match');
      expect(c.quantityMatch).toBe('available_match');
    });

    it('30. available item evidence that conflicts with the basket is classified available_mismatch and caps confidence', () => {
      const provider: InvoiceItemEvidenceProvider = {
        getItemsForInvoice: () => [{ productNameRaw: 'شامبو', quantity: 1, lineTotal: 70 }],
      };
      const ctx = baseCase({
        customerId: 'cust-1',
        branchNameRaw: 'فرع شكري',
        activeAnnouncedTotal: total(180),
        activeBasketItems: basketItems,
      });
      const c = buildAttributionCandidate(
        ctx,
        { id: 'inv-1', customer_id: 'cust-1', branch: 'فرع شكري', invoice_datetime: '2026-09-15T09:15:00.000Z', net_amount: 180 },
        provider
      );
      expect(c.productMatch).toBe('available_mismatch');
      expect(c.disqualifiers).toContain('product_mismatch');
      expect(c.confidenceAssessment.level).not.toBe('strongly_inferred');
    });
  });

  describe('Legacy V17 evidence', () => {
    it('31. V17 evidence adds supporting weight to an otherwise-strong candidate', () => {
      const ctx = baseCase({
        customerId: 'cust-1',
        branchNameRaw: 'فرع شكري',
        legacyMatchedInvoiceId: 'inv-1',
      });
      const withLegacy = buildAttributionCandidate(ctx, { id: 'inv-1', customer_id: 'cust-1', branch: 'فرع شكري', invoice_datetime: '2026-09-15T09:15:00.000Z' });
      const withoutLegacy = buildAttributionCandidate(
        baseCase({ customerId: 'cust-1', branchNameRaw: 'فرع شكري' }),
        { id: 'inv-1', customer_id: 'cust-1', branch: 'فرع شكري', invoice_datetime: '2026-09-15T09:15:00.000Z' }
      );
      expect(withLegacy.legacyEvidenceMatch).toBe(true);
      expect(withLegacy.confidenceAssessment.score).toBeGreaterThan(withoutLegacy.confidenceAssessment.score);
    });

    it('32. a V17-only match (no other evidence) never automatically becomes proven or official', () => {
      const ctx = baseCase({ legacyMatchedInvoiceId: 'inv-1', caseEndedAt: null });
      const c = buildAttributionCandidate(ctx, { id: 'inv-1' });
      expect(c.legacyEvidenceMatch).toBe(true);
      expect(c.confidenceAssessment.level).not.toBe('proven');
      expect(c.confidenceAssessment.level).not.toBe('strongly_inferred');
    });

    it('33. V17 pointing at a weaker invoice never outranks a stronger canonically-evidenced one', () => {
      const ctx = baseCase({
        customerId: 'cust-1',
        branchNameRaw: 'فرع شكري',
        activeAnnouncedTotal: total(180),
        legacyMatchedInvoiceId: 'inv-v17-only',
      });
      const assess = deriveSaleAttributionAssessment(ctx, [
        { id: 'inv-v17-only', invoice_datetime: '2026-09-20T00:00:00.000Z', net_amount: 9999 },
        { id: 'inv-strong', customer_id: 'cust-1', branch: 'فرع شكري', invoice_datetime: '2026-09-15T09:15:00.000Z', net_amount: 180 },
      ]);
      expect(assess.selectedInvoiceId).toBe('inv-strong');
    });
  });

  describe('Official attribution gate', () => {
    it('34. proven is always eligible', () => {
      const ctx = baseCase({ trustedInvoiceId: 'inv-1' });
      const assess = deriveSaleAttributionAssessment(ctx, [{ id: 'inv-1' }]);
      expect(assess.isOfficialForStaffEvaluation).toBe(true);
    });

    it('35. a clean strongly_inferred candidate above threshold is eligible', () => {
      const ctx = baseCase({ customerId: 'cust-1', branchNameRaw: 'فرع شكري', activeAnnouncedTotal: total(180) });
      const assess = deriveSaleAttributionAssessment(ctx, [
        { id: 'inv-1', customer_id: 'cust-1', branch: 'فرع شكري', invoice_datetime: '2026-09-15T09:15:00.000Z', net_amount: 180 },
      ]);
      expect(assess.attributionLevel).toBe('strongly_inferred');
      expect(assess.isOfficialForStaffEvaluation).toBe(true);
    });

    it('36. weak evidence is never official', () => {
      const ctx = baseCase();
      const assess = deriveSaleAttributionAssessment(ctx, [{ id: 'inv-1', invoice_datetime: '2026-09-15T18:00:00.000Z', net_amount: 40 }]);
      expect(assess.attributionLevel).not.toBe('proven');
      expect(assess.attributionLevel).not.toBe('strongly_inferred');
      expect(assess.isOfficialForStaffEvaluation).toBe(false);
    });

    it('37. an unresolved multiple-candidate ambiguity is never official', () => {
      const ctx = baseCase({ customerId: 'cust-1', branchNameRaw: 'فرع شكري' });
      const assess = deriveSaleAttributionAssessment(ctx, [
        { id: 'inv-1', customer_id: 'cust-1', branch: 'فرع شكري', invoice_datetime: '2026-09-15T09:15:00.000Z' },
        { id: 'inv-2', customer_id: 'cust-1', branch: 'فرع شكري', invoice_datetime: '2026-09-15T09:18:00.000Z' },
      ]);
      expect(assess.isOfficialForStaffEvaluation).toBe(false);
    });

    it('38. an identity conflict is never official', () => {
      const ctx = baseCase({ customerId: 'cust-A', customerPhone: '01012345678' });
      const assess = deriveSaleAttributionAssessment(ctx, [
        { id: 'inv-1', customer_id: 'cust-B', customer_phone: '01012345678', invoice_datetime: '2026-09-15T09:15:00.000Z' },
      ]);
      expect(assess.isOfficialForStaffEvaluation).toBe(false);
    });
  });

  describe('End-to-end Phase C -> D', () => {
    it('39. a commercially complete case with a matching invoice attributes strongly', () => {
      const ctx = baseCase({
        customerId: 'cust-1',
        branchNameRaw: 'فرع شكري',
        activeAnnouncedTotal: total(180),
        commercialConfirmation: { ...COMPLETE_CONFIRMATION, currentState: 'commercial_confirmation_complete' },
      });
      const assess = deriveSaleAttributionAssessment(ctx, [
        { id: 'inv-1', customer_id: 'cust-1', branch: 'فرع شكري', invoice_datetime: '2026-09-15T09:15:00.000Z', net_amount: 180 },
      ]);
      expect(assess.commercialConfirmationState).toBe('commercial_confirmation_complete');
      expect(assess.hasAttributedInvoice).toBe(true);
    });

    it('40. a commercially complete case with NO invoice stays unknown — commercial completion never invents a sale', () => {
      const ctx = baseCase({
        commercialConfirmation: { ...COMPLETE_CONFIRMATION, currentState: 'commercial_confirmation_complete' },
      });
      const assess = deriveSaleAttributionAssessment(ctx, []);
      expect(assess.commercialConfirmationState).toBe('commercial_confirmation_complete');
      expect(assess.hasAttributedInvoice).toBe(false);
      expect(assess.attributionLevel).toBe('unknown');
    });

    it('41. an INCOMPLETE commercial confirmation with a direct trusted invoice link is still proven — attribution is independent of commercial state', () => {
      const ctx = baseCase({
        trustedInvoiceId: 'inv-1',
        commercialConfirmation: { ...COMPLETE_CONFIRMATION, currentState: 'awaiting_customer_confirmation', customerConfirmed: false, staffConfirmed: false },
      });
      const assess = deriveSaleAttributionAssessment(ctx, [{ id: 'inv-1' }]);
      expect(assess.commercialConfirmationState).toBe('awaiting_customer_confirmation');
      expect(assess.attributionLevel).toBe('proven');
      expect(assess.isOfficialForStaffEvaluation).toBe(true);
    });

    it('42. a modified basket (v1 confirmed then modified to v2) attributes against v2\'s CURRENT total only — a stale v1 total never wins', () => {
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
      expect(baskets.length).toBe(2);
      expect(baskets[0].announcedTotal?.amount).toBe(180);
      expect(baskets[1].announcedTotal?.amount).toBe(250);

      const latest = baskets[baskets.length - 1];
      const ctx = baseCase({
        customerId: 'cust-1',
        activeAnnouncedTotal: latest.announcedTotal,
        activeBasketItems: (itemsByBasketId[latest.basketId] || []).map((i) => ({
          productNameRaw: i.productNameRaw,
          quantity: i.quantity,
        })),
        commercialConfirmation,
      });

      const staleV1Invoice = buildAttributionCandidate(ctx, {
        id: 'inv-old-total',
        customer_id: 'cust-1',
        invoice_datetime: '2026-09-15T09:15:00.000Z',
        net_amount: 180,
      });
      const currentV2Invoice = buildAttributionCandidate(ctx, {
        id: 'inv-new-total',
        customer_id: 'cust-1',
        invoice_datetime: '2026-09-15T09:15:00.000Z',
        net_amount: 250,
      });

      expect(staleV1Invoice.announcedTotalMatch).toBe('different');
      expect(currentV2Invoice.announcedTotalMatch).toBe('exact');

      const assess = deriveSaleAttributionAssessment(ctx, [
        { id: 'inv-old-total', customer_id: 'cust-1', invoice_datetime: '2026-09-15T09:15:00.000Z', net_amount: 180 },
        { id: 'inv-new-total', customer_id: 'cust-1', invoice_datetime: '2026-09-15T09:15:00.000Z', net_amount: 250 },
      ]);
      expect(assess.selectedInvoiceId).toBe('inv-new-total');
    });
  });
  it('rejects a statistical invoice that clearly predates the case start, even with exact identity and legacy support', () => {
    const ctx = baseCase({
      customerId: 'cust-1',
      customerPhone: '01015438338',
      branchNameRaw: 'فرع شكري',
      legacyMatchedInvoiceId: 'inv-old',
      caseStartedAt: '2026-09-15T18:14:37.000Z',
      caseEndedAt: '2026-09-15T18:46:43.000Z',
    });
    const assess = deriveSaleAttributionAssessment(ctx, [{
      id: 'inv-old',
      invoice_number: '72865',
      customer_id: 'cust-1',
      customer_phone: '01015438338',
      branch: 'فرع شكري',
      invoice_datetime: '2026-09-15T06:49:00.000Z',
      net_amount: 108,
    }]);
    expect(assess.selectedInvoiceId).toBeNull();
    expect(assess.attributionLevel).toBe('unknown');
    expect(assess.contradictions).toContain('temporal_inversion');
    expect(assess.isOfficialForStaffEvaluation).toBe(false);
  });

  it('treats an invoice created during the case interval as chronologically valid', () => {
    const ctx = baseCase({
      customerId: 'cust-1',
      caseStartedAt: '2026-09-15T06:46:45.000Z',
      caseEndedAt: '2026-09-15T06:47:59.000Z',
    });
    const candidate = buildAttributionCandidate(ctx, {
      id: 'inv-during',
      customer_id: 'cust-1',
      invoice_datetime: '2026-09-15T06:47:20.000Z',
      net_amount: 108,
    });
    expect(candidate.timeDistanceMinutes).toBe(0);
    expect(candidate.timeMatchStrength).toBe('very_strong');
    expect(candidate.disqualifiers).not.toContain('temporal_inversion_invoice_predates_case');
  });

  it('keeps a trusted but pre-case invoice visible yet blocks it from official staff evaluation', () => {
    const ctx = baseCase({
      trustedInvoiceId: 'trusted-old',
      caseStartedAt: '2026-09-15T18:00:00.000Z',
      caseEndedAt: '2026-09-15T18:10:00.000Z',
    });
    const assess = deriveSaleAttributionAssessment(ctx, [{
      id: 'trusted-old',
      invoice_datetime: '2026-09-15T06:49:00.000Z',
      net_amount: 108,
    }]);
    expect(assess.selectedInvoiceId).toBe('trusted-old');
    expect(assess.contradictions).toContain('temporal_inversion');
    expect(assess.needsHumanReview).toBe(true);
    expect(assess.isOfficialForStaffEvaluation).toBe(false);
  });

});
