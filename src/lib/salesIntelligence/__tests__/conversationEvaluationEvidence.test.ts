import { describe, expect, it } from 'vitest';
import { REVIEW_CRITERIA } from '@/lib/conversationReviews';
import type { CaseIntelligenceView } from '../types';
import {
  CONVERSATION_EVALUATION_CONTRACT,
  buildConversationEvaluationEvidence,
} from '../conversationEvaluationEvidence';

function baseView(): CaseIntelligenceView {
  return {
    version: 'case-intelligence-v3',
    caseId: 'case-1',
    conversationId: 'conv-1',
    sourceCaseIdV22: null,
    interaction: {
      interactionId: 'i-1',
      startedAt: '2026-09-28T03:51:56.000Z',
      endedAt: '2026-09-28T03:58:45.000Z',
      messageCount: 2,
      meaningfulMessageCount: 2,
      messageIds: ['m1', 'm2'],
      messages: [
        { id: 'm1', role: 'customer', sender: 'Customer', at: '2026-09-28T03:51:56.000Z', text: 'عايز الدواء ده', meaningful: true },
        { id: 'm2', role: 'staff', sender: 'You', at: '2026-09-28T03:52:06.000Z', text: 'أهلا بحضرتك', meaningful: true },
      ],
      triggerMessageId: 'm1',
      segmentationReason: null,
      caseType: 'sales_opportunity',
      caseStatus: 'sales_opportunity',
      confidence: { level: 'strongly_inferred', score: 0.8, evidence: [], ruleIds: [] },
    },
    customer: { customerId: 'cust-1', customerPhone: '01000000000', identityStatus: 'resolved', blockers: [] },
    branch: { branchId: null, branchNameRaw: 'فرع شكري' },
    staff: {
      participants: [{ sender: 'You', staffId: 'staff-1', messageIds: ['m2'], messageCount: 1 }],
      facts: [],
    },
    need: {
      caseId: 'case-1',
      primaryNeed: 'عايز الدواء ده',
      primaryNeedMessageId: 'm1',
      products: [],
      unlinkedAvailability: [],
      unlinkedAlternatives: [],
      objections: [],
      unresolvedNeed: true,
      needDeclined: false,
      needDeclineMessageIds: [],
      evidenceMessageIds: ['m1'],
      confidence: { level: 'strongly_inferred', score: 0.8, evidence: [], ruleIds: [] },
      needsHumanReview: false,
      humanReviewReasons: [],
    },
    products: [],
    basket: { versions: [], activeBasketId: null, activeItems: [], announcedTotal: null, confirmed: false },
    journey: {
      caseId: 'case-1',
      currentState: 'opportunity_open',
      stateHistory: [],
      evidenceMessageIds: ['m1'],
      ruleIds: [],
      confidence: { level: 'strongly_inferred', score: 0.8, evidence: [], ruleIds: [] },
      reviewRequired: false,
    } as any,
    sale: {
      confirmationState: 'unknown',
      summaryPresented: false,
      customerConfirmed: false,
      staffConfirmed: false,
      confirmationMessageIds: [],
      invoiceCandidateIds: [],
      selectedInvoiceId: null,
      selectedInvoiceNumber: null,
      attributionLevel: 'unknown',
      proofState: 'unknown',
      outcome: 'open_opportunity',
      isSaleCountable: false,
      reasonCodes: [],
      contradictions: [],
    },
    unavailableDemand: [],
    lostOpportunity: {
      caseId: 'case-1',
      state: 'open',
      reason: null,
      responsibility: 'unknown',
      recoverability: 'unknown',
      productLosses: [],
      evidenceMessageIds: [],
      ruleIds: [],
      confidence: { level: 'strongly_inferred', score: 0.7, evidence: [], ruleIds: [] },
      needsHumanReview: false,
      humanReviewReasons: [],
    } as any,
    followUp: {
      caseId: 'case-1',
      decision: 'not_needed',
      opportunities: [],
      notNeededReason: null,
      evidenceMessageIds: [],
      ruleIds: [],
      confidence: { level: 'strongly_inferred', score: 0.7, evidence: [], ruleIds: [] },
      needsHumanReview: false,
      humanReviewReasons: [],
    } as any,
    coachingEvidence: {
      staffReplied: true,
      unansweredRequestMessageIds: [],
      alternativeOfferedProductKeys: [],
      unavailableWithoutAlternativeProductKeys: [],
      delayComplaintMessageIds: [],
      clearClosing: false,
      protocolCompliant: false,
      missingProtocolSteps: [],
    },
    evidenceSummary: {
      evidenceMessageIds: ['m1', 'm2'],
      sectionConfidence: {
        interaction: 'strongly_inferred',
        need: 'strongly_inferred',
        journey: 'strongly_inferred',
        attribution: 'unknown',
        lostOpportunity: 'strongly_inferred',
      },
    },
    review: { required: false, reasons: [] },
  };
}

describe('conversation evaluation evidence contract', () => {
  it('covers every official review criterion exactly once', () => {
    const officialKeys = REVIEW_CRITERIA.map((item) => item.key).sort();
    const contractKeys = Object.keys(CONVERSATION_EVALUATION_CONTRACT).sort();
    expect(contractKeys).toEqual(officialKeys);
    expect(contractKeys).toHaveLength(19);
  });

  it('never makes external-system criteria ready when the external evidence is missing', () => {
    const snapshot = buildConversationEvaluationEvidence(baseView());
    expect(snapshot.criteria.find((item) => item.key === 'purchase_history_usage')?.readiness)
      .toBe('needs_external_evidence');
  });

  it('does not convert a non-applicable criterion into a negative finding', () => {
    const snapshot = buildConversationEvaluationEvidence(baseView());
    expect(snapshot.criteria.find((item) => item.key === 'angry_customer')?.readiness)
      .toBe('not_applicable');
    expect(snapshot.criteria.find((item) => item.key === 'order_delay_handling')?.readiness)
      .toBe('not_applicable');
  });

  it('marks core interaction + need criteria ready when canonical evidence exists', () => {
    const snapshot = buildConversationEvaluationEvidence(baseView());
    expect(snapshot.criteria.find((item) => item.key === 'first_response_speed')?.readiness).toBe('ready');
    expect(snapshot.criteria.find((item) => item.key === 'greeting')?.readiness).toBe('ready');
    expect(snapshot.criteria.find((item) => item.key === 'understanding')?.readiness).toBe('ready');
  });

  it('routes consultation and dosage to manual review instead of automatic scoring', () => {
    const v = baseView();
    v.interaction.messages = [
      { id: 'm1', role: 'customer', sender: 'Customer', at: '2026-09-28T03:51:56.000Z', text: 'طفل عنده كحة، ينفع الدواء ده؟', meaningful: true },
      { id: 'm2', role: 'staff', sender: 'You', at: '2026-09-28T03:52:06.000Z', text: 'خليه ياخد 5 مل مرتين في اليوم', meaningful: true },
    ];
    const snapshot = buildConversationEvaluationEvidence(v);
    expect(snapshot.criteria.find((item) => item.key === 'consultation_quality')?.readiness)
      .toBe('manual_review_required');
    expect(snapshot.criteria.find((item) => item.key === 'dosage_explanation')?.readiness)
      .toBe('manual_review_required');
  });

  it('allows external criteria only after their real system source is present', () => {
    const snapshot = buildConversationEvaluationEvidence(baseView(), {
      purchaseHistoryAvailable: true,
      operationalRequestLogAvailable: true,
    });
    expect(snapshot.criteria.find((item) => item.key === 'purchase_history_usage')?.readiness).toBe('ready');
  });
});
