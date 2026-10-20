import { describe, expect, it } from 'vitest';
import { deriveCanonicalCustomerRequestAssessment } from '../../customerRequestQualificationEngine';
import { buildCanonicalCustomerRequestActionRows } from '../canonicalCustomerRequestProjector';

const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';
const STAFF_ID = '44444444-4444-4444-8444-444444444444';
const PRODUCT_ID = '55555555-5555-4555-8555-555555555555';
const RAW = [
  '[10/17/26, 10:00:00 AM] Customer: عايز بانادول',
  '[10/17/26, 10:01:00 AM] You: مش متوفر حاليا',
].join('\n');

function analysis(
  caseId = 'case-1',
  availabilityState: 'unavailable' | 'check_pending' = 'unavailable',
  branchNameRaw = 'شكري'
) {
  const productKey = 'panadol';
  const demandKey = `${caseId}:demand:product:${PRODUCT_ID}`;
  const result = {
    caseId,
    conversationId: '11111111-1111-4111-8111-111111111111',
    conversationCase: {
      customerPhone: '01000000000',
      branchNameRaw,
    },
    customerNeed: {
      caseId,
      primaryNeed: 'عايز بانادول',
      primaryNeedMessageId: 'm1',
      products: [
        {
          key: productKey,
          productNameRaw: 'بانادول',
          productId: PRODUCT_ID,
          productCode: 'P1',
          canonicalName: 'Panadol',
          requestedQuantity: 2,
          offeredQuantity: null,
          finalQuantity: null,
          roles: ['requested'],
          availability: availabilityState,
          availabilityEvidence: [],
          alternatives: [],
          evidenceMessageIds: ['m1', 'm2'],
          confidence: { level: 'proven', score: 0.98, evidence: [], ruleIds: [] },
        },
      ],
      unlinkedAvailability: [],
      unlinkedAlternatives: [],
      objections: [],
      unresolvedNeed: true,
      needDeclined: false,
      needDeclineMessageIds: [],
      evidenceMessageIds: ['m1', 'm2'],
      confidence: { level: 'proven', score: 0.98, evidence: [], ruleIds: [] },
      needsHumanReview: false,
      humanReviewReasons: [],
    },
    unavailableDemand: [
      {
        demandKey,
        caseId,
        conversationId: '11111111-1111-4111-8111-111111111111',
        sourceCaseIdV22: null,
        customerId: CUSTOMER_ID,
        customerIdentityStatus: 'resolved',
        branchId: null,
        branchNameRaw,
        requestedAt: '2026-10-17T07:00:00.000Z',
        productKey,
        requestedProductRaw: 'بانادول',
        resolvedProductId: PRODUCT_ID,
        quantityRequested: 2,
        availabilityState,
        availabilityMessageId: 'm2',
        statedByStaffName: 'You',
        statedByStaffId: STAFF_ID,
        alternativeOffered: false,
        alternativeProductKey: null,
        alternativeProductRaw: null,
        alternativeProductId: null,
        alternativeOfferedByStaffName: null,
        alternativeOfferedByStaffId: null,
        alternativeResponse: null,
        followUpCandidate: true,
        followUpReason:
          availabilityState === 'check_pending'
            ? 'availability_check_pending'
            : 'original_unavailable_no_alternative',
        followUpSuppressedBy: null,
        evidenceMessageIds: ['m1', 'm2'],
        confidence: { level: 'proven', score: 0.98, evidence: [], ruleIds: [] },
        blockers: [],
      },
    ],
    salesOutcome: {
      caseId,
      outcome: 'open_opportunity',
      saleProofState: 'unknown',
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: false,
      needsHumanReview: false,
      reasonCodes: [],
    },
    lostOpportunity: {
      caseId,
      state: 'recoverable',
      waitingOn: 'stock',
      reason: 'stock_unavailable',
      stage: 'availability',
      responsibility: 'inventory',
      recoverability: 'high',
      productKeys: [productKey],
      productLosses: [
        {
          productKey,
          requestedProductRaw: 'بانادول',
          productId: PRODUCT_ID,
          outcome: 'recoverable',
          reason: 'stock_unavailable',
          demandKey,
          evidenceMessageIds: ['m1', 'm2'],
        },
      ],
      staffFacts: [],
      evidenceMessageIds: ['m1', 'm2'],
      confidence: { level: 'proven', score: 0.98, evidence: [], ruleIds: [] },
      explanation: 'fixture',
    },
  } as any;
  result.customerRequestAssessment = deriveCanonicalCustomerRequestAssessment(result);
  return result;
}

function source(staffId: string | null = STAFF_ID) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    raw_text: RAW,
    customer_name: 'عميل اختبار',
    customer_code: '17',
    staff_id: staffId,
  };
}

describe('canonical customer request projector', () => {
  it('projects only a qualified request as a human-approval proposal', () => {
    const result = buildCanonicalCustomerRequestActionRows([analysis()], [source()]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      action_type: 'customer_request',
      status: 'proposed',
      auto_eligible: false,
      customer_id: CUSTOMER_ID,
      staff_id: STAFF_ID,
      product_id: PRODUCT_ID,
      product_code: 'P1',
      product_name: 'Panadol',
      confidence: 98,
    });
    expect(result.rows[0].followup_identity).toMatch(/^fu1\|chat:/);
  });

  it('keeps the operation identity stable across case re-segmentation', () => {
    const first = buildCanonicalCustomerRequestActionRows([analysis('case-1')], [source()]);
    const second = buildCanonicalCustomerRequestActionRows([analysis('case-99')], [source()]);
    expect(first.rows[0].followup_identity).toBe(second.rows[0].followup_identity);
  });

  it('does not project an availability check that is still pending', () => {
    const result = buildCanonicalCustomerRequestActionRows(
      [analysis('case-1', 'check_pending')],
      [source()]
    );
    expect(result.rows).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ reason: 'not_qualified' });
  });

  it('fails closed when the source staff identity required by approval is absent', () => {
    const result = buildCanonicalCustomerRequestActionRows([analysis()], [source(null)]);
    expect(result.rows).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ reason: 'missing_staff_identity' });
  });
  it('uses the pipeline qualification and never requalifies mutable demand evidence', () => {
    const canonical = analysis();
    canonical.unavailableDemand[0].availabilityState = 'check_pending';
    const result = buildCanonicalCustomerRequestActionRows([canonical], [source()]);
    expect(result.rows).toHaveLength(1);
    delete canonical.customerRequestAssessment;
    const missing = buildCanonicalCustomerRequestActionRows([canonical], [source()]);
    expect(missing.rows).toEqual([]);
    expect(missing.skipped[0].reason).toBe('missing_canonical_assessment');
  });

  it('refuses a request whose resolved conversation staff evidence names another doctor', () => {
    const canonical = analysis();
    canonical.caseIntelligence = { staff: { participants: [
      { sender: 'You', staffId: '99999999-9999-4999-8999-999999999999', messageIds: ['m2'], messageCount: 1 },
    ], facts: [] } };
    const conflict = buildCanonicalCustomerRequestActionRows([canonical], [source()]);
    expect(conflict.rows).toEqual([]);
    expect(conflict.skipped[0]).toMatchObject({ reason: 'staff_evidence_conflict' });

    canonical.caseIntelligence.staff.participants[0].staffId = STAFF_ID;
    expect(buildCanonicalCustomerRequestActionRows([canonical], [source()]).rows).toHaveLength(1);
    canonical.caseIntelligence.staff.participants[0].staffId = null;
    expect(buildCanonicalCustomerRequestActionRows([canonical], [source()]).rows).toHaveLength(1);
  });

  it.each(['كل الفروع', 'غير محدد', 'المخزن', 'فرع جديد غير معتمد'])('keeps a %s request for review instead of projecting it', (branch) => {
    const canonical = analysis('case-1', 'unavailable', branch);
    expect(canonical.customerRequestAssessment.requests[0]).toMatchObject({
      status: 'review_required',
      blockers: ['branch_unknown'],
    });
    const result = buildCanonicalCustomerRequestActionRows([canonical], [source()]);
    expect(result.rows).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ reason: 'not_qualified' });
  });

  it.each(['شكري', 'فرع شكري', 'فرع الشامي'])('still projects a real %s transaction branch', (branch) => {
    const result = buildCanonicalCustomerRequestActionRows([analysis('case-1', 'unavailable', branch)], [source()]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].branch).toBe(branch);
  });

  it('refuses a stale qualified decision whose case branch is account-wide scope', () => {
    const canonical = analysis();
    canonical.conversationCase.branchNameRaw = 'كل الفروع';
    const result = buildCanonicalCustomerRequestActionRows([canonical], [source()]);
    expect(result.rows).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ reason: 'non_transaction_branch' });
  });

});