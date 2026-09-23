// Phase I.C.1 — Trusted Invoice Evidence Bridge regression tests.
//
// See trustedInvoiceEvidenceBridge.ts's own header comment for the full I.C.0/I.C.1 investigation:
// whatsapp_review_sources.matched_invoice_id/invoice_match_status are populated by an automated
// statistical classifier, never a human; reviewer_confirmed approves the case's overall review
// record, never the invoice link specifically, and is `false` on all 98 Production rows today.
// These tests lock in the strict, conservative eligibility rule so a future change can never
// silently widen `proven` sale attribution to a statistical or unattributed signal.
import { describe, expect, it } from 'vitest';
import {
  resolveTrustedInvoiceEvidenceFromReviewSource,
  type ReviewSourceInvoiceEvidenceInput,
} from '../trustedInvoiceEvidenceBridge';
import { reviewSourceRowToBatchConversation } from '../persistence/reviewSourceBatchAdapter';
import { runSalesIntelligencePipeline, type SalesIntelligencePipelineInput } from '../salesIntelligencePipeline';

function baseReviewSourceInput(
  overrides: Partial<ReviewSourceInvoiceEvidenceInput> = {}
): ReviewSourceInvoiceEvidenceInput {
  return {
    sourceId: 'source-1',
    matchedInvoiceId: 'inv-uuid-1',
    matchedInvoiceNumber: '32069',
    invoiceMatchStatus: 'verified',
    reviewerConfirmed: true,
    reviewerId: 'reviewer-1',
    branch: 'فرع شكري',
    ...overrides,
  };
}

describe('I.C.1 — resolveTrustedInvoiceEvidenceFromReviewSource eligibility rule', () => {
  it('1. reviewer-confirmed + verified match (all 4 conditions met) -> proven trusted evidence', () => {
    const result = resolveTrustedInvoiceEvidenceFromReviewSource(baseReviewSourceInput());
    expect(result.trustedInvoiceId).toBe('inv-uuid-1');
    expect(result.trustedInvoiceNumber).toBe('32069');
    expect(result.evidenceType).toBe('reviewer_confirmed_verified_match');
    expect(result.confidence.level).toBe('proven');
    expect(result.ruleIds).toEqual(['trusted_invoice.eligible.reviewer_confirmed_verified_match']);
  });

  it('2. verified statistical match WITHOUT reviewer confirmation -> not proven, trustedInvoiceId null', () => {
    const result = resolveTrustedInvoiceEvidenceFromReviewSource(
      baseReviewSourceInput({ reviewerConfirmed: null, reviewerId: null })
    );
    expect(result.trustedInvoiceId).toBeNull();
    expect(result.evidenceType).toBe('none');
    expect(result.confidence.level).toBe('unknown');
    expect(result.ruleIds).toContain('trusted_invoice.ineligible.reviewer_not_confirmed');
  });

  it('3. probable match status -> never trusted, even with reviewer confirmation present', () => {
    const result = resolveTrustedInvoiceEvidenceFromReviewSource(
      baseReviewSourceInput({ invoiceMatchStatus: 'probable' })
    );
    expect(result.trustedInvoiceId).toBeNull();
    expect(result.ruleIds).toContain('trusted_invoice.ineligible.match_status_not_verified');
  });

  it('4. needs_review match status -> never trusted, even with reviewer confirmation present', () => {
    const result = resolveTrustedInvoiceEvidenceFromReviewSource(
      baseReviewSourceInput({ invoiceMatchStatus: 'needs_review' })
    );
    expect(result.trustedInvoiceId).toBeNull();
    expect(result.ruleIds).toContain('trusted_invoice.ineligible.match_status_not_verified');
  });

  it('5. matched_invoice_id present but reviewer_confirmed explicitly false -> not trusted', () => {
    const result = resolveTrustedInvoiceEvidenceFromReviewSource(
      baseReviewSourceInput({ reviewerConfirmed: false, reviewerId: null })
    );
    expect(result.trustedInvoiceId).toBeNull();
    expect(result.reviewerConfirmed).toBe(false);
    expect(result.ruleIds).toContain('trusted_invoice.ineligible.reviewer_not_confirmed');
  });

  it('6. duplicate invoice_number across two branches never causes a cross-branch trusted link', () => {
    // Real Production shape (I.C.0 audit): invoice_number "32069" exists once at فرع الشامي and
    // once at فرع شكري as two entirely different invoices with two different sales_invoices.id
    // values. Two review sources independently matching each branch's own invoice, both otherwise
    // eligible, must resolve to their OWN distinct trustedInvoiceId — never to each other's.
    const branchA = resolveTrustedInvoiceEvidenceFromReviewSource(
      baseReviewSourceInput({
        sourceId: 'source-branch-shamy',
        matchedInvoiceId: '31682815-branch-shamy-real-id',
        matchedInvoiceNumber: '32069',
        branch: 'فرع الشامي',
      })
    );
    const branchB = resolveTrustedInvoiceEvidenceFromReviewSource(
      baseReviewSourceInput({
        sourceId: 'source-branch-shokry',
        matchedInvoiceId: '22a61dc5-branch-shokry-real-id',
        matchedInvoiceNumber: '32069',
        branch: 'فرع شكري',
      })
    );
    expect(branchA.trustedInvoiceId).toBe('31682815-branch-shamy-real-id');
    expect(branchB.trustedInvoiceId).toBe('22a61dc5-branch-shokry-real-id');
    expect(branchA.trustedInvoiceId).not.toBe(branchB.trustedInvoiceId);
    expect(branchA.trustedInvoiceBranch).toBe('فرع الشامي');
    expect(branchB.trustedInvoiceBranch).toBe('فرع شكري');
    // The shared, non-unique number is carried for display only — identity always comes from the id.
    expect(branchA.trustedInvoiceNumber).toBe(branchB.trustedInvoiceNumber);
  });

  it('7. trusted id missing but invoice_number present -> never promotes to proven by number alone', () => {
    const result = resolveTrustedInvoiceEvidenceFromReviewSource(
      baseReviewSourceInput({ matchedInvoiceId: null, matchedInvoiceNumber: '32069' })
    );
    expect(result.trustedInvoiceId).toBeNull();
    expect(result.trustedInvoiceNumber).toBeNull();
    expect(result.ruleIds).toContain('trusted_invoice.ineligible.no_matched_invoice');
  });
});

describe('I.C.1 — reviewSourceRowToBatchConversation wiring', () => {
  it('leaves trustedInvoiceId/trustedInvoiceNumber null when the review source row carries no reviewer-confirmation columns (current Production reality)', () => {
    const input = reviewSourceRowToBatchConversation({
      id: 'row-1',
      raw_text: 'x',
      conversation_started_at: null,
      matched_invoice_id: 'inv-uuid-1',
      matched_invoice_number: '32069',
      invoice_match_status: 'verified',
    });
    expect(input.trustedInvoiceId).toBeNull();
    expect(input.trustedInvoiceNumber).toBeNull();
    // legacy evidence-only fields stay populated, exactly as before I.C.1.
    expect(input.legacyMatchedInvoiceId).toBe('inv-uuid-1');
    expect(input.legacyMatchedInvoiceNumber).toBe('32069');
  });

  it('sets trustedInvoiceId/trustedInvoiceNumber only when all four eligibility conditions hold', () => {
    const input = reviewSourceRowToBatchConversation({
      id: 'row-2',
      raw_text: 'x',
      conversation_started_at: null,
      matched_invoice_id: 'inv-uuid-2',
      matched_invoice_number: '70655',
      invoice_match_status: 'verified',
      reviewer_confirmed: true,
      reviewer_id: 'reviewer-9',
    });
    expect(input.trustedInvoiceId).toBe('inv-uuid-2');
    expect(input.trustedInvoiceNumber).toBe('70655');
  });
});

describe('I.C.1 — end-to-end pipeline: a trusted invoice link reaches `proven` while item/quantity evidence stays honestly unavailable', () => {
  function baseInput(overrides: Partial<SalesIntelligencePipelineInput> = {}): SalesIntelligencePipelineInput {
    return {
      conversationId: 'conv-ic1',
      rawWhatsAppExportText: '',
      resolveInvoiceCandidates: () => [],
      ...overrides,
    };
  }

  it('8. trustedInvoiceId from the bridge drives attributionLevel=proven, but sales_invoice_items_v21 being empty keeps item/quantity evidence unavailable and scope header_only', () => {
    const trustedEvidence = resolveTrustedInvoiceEvidenceFromReviewSource(baseReviewSourceInput());
    expect(trustedEvidence.trustedInvoiceId).toBe('inv-uuid-1');

    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`;

    const result = runSalesIntelligencePipeline(
      baseInput({
        rawWhatsAppExportText: raw,
        customerIdHint: 'cust-ic1',
        trustedInvoiceId: trustedEvidence.trustedInvoiceId,
        trustedInvoiceNumber: trustedEvidence.trustedInvoiceNumber,
        // No itemEvidenceProvider override -> defaults to unavailableInvoiceItemEvidenceProvider,
        // exactly mirroring Production's sales_invoice_items_v21 = 0 rows (I.C.0 finding).
        resolveInvoiceCandidates: () => [
          { id: 'inv-uuid-1', customer_id: 'cust-ic1', invoice_datetime: '2026-09-15T09:05:00.000Z', net_amount: 180 },
        ],
      })
    );
    const a = result.caseAnalyses[0];
    expect(a.attribution.attributionLevel).toBe('proven');
    expect(a.attribution.selectedCandidate?.directInvoiceLink).toBe(true);
    expect(a.basketInvoiceMatch.itemEvidenceReady).toBe(false);
    expect(a.integrityAssessment.integrityEvaluationScope).toBe('header_only');
    expect(a.integrityAssessment.canEvaluateItemIntegrity).toBe(false);
    expect(a.integrityAssessment.exceptions.some((e) => e.stage === 'invoice_items')).toBe(false);
  });
});
