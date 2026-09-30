import { describe, expect, it } from 'vitest';
import type { CaseIntelligenceView } from '../types';
import { buildConversationClinicalReview } from '../conversationClinicalReview';

function view(messages: CaseIntelligenceView['interaction']['messages']): CaseIntelligenceView {
  return {
    version: 'case-intelligence-v3',
    caseId: 'clinical-case',
    conversationId: 'clinical-conv',
    sourceCaseIdV22: null,
    interaction: {
      interactionId: 'i',
      startedAt: messages[0]?.at || '2026-09-28T09:00:00.000Z',
      endedAt: messages[messages.length - 1]?.at || null,
      messageCount: messages.length,
      meaningfulMessageCount: messages.filter((m) => m.meaningful).length,
      messageIds: messages.map((m) => m.id),
      messages,
      triggerMessageId: messages[0]?.id || null,
      segmentationReason: null,
      caseType: 'sales_opportunity',
      caseStatus: 'sales_opportunity',
      confidence: { level: 'strongly_inferred', score: 0.9, evidence: [], ruleIds: [] },
    },
    customer: { customerId: 'c', customerPhone: null, customerName: 'عميل', customerCode: '1', identityStatus: 'resolved', blockers: [] },
    branch: { branchId: null, branchNameRaw: 'فرع شكري' },
    staff: { participants: [], facts: [] },
    need: {
      caseId: 'clinical-case',
      primaryNeed: messages.find((m) => m.role === 'customer')?.text || null,
      primaryNeedMessageId: messages.find((m) => m.role === 'customer')?.id || null,
      products: [],
      unlinkedAvailability: [],
      unlinkedAlternatives: [],
      objections: [],
      unresolvedNeed: false,
      needDeclined: false,
      needDeclineMessageIds: [],
      evidenceMessageIds: [],
      confidence: { level: 'strongly_inferred', score: 0.8, evidence: [], ruleIds: [] },
      needsHumanReview: false,
      humanReviewReasons: [],
    },
    products: [],
    basket: { versions: [], activeBasketId: null, activeItems: [], announcedTotal: null, confirmed: false },
    journey: { caseId: 'clinical-case', currentState: 'opportunity_open', stateHistory: [], evidenceMessageIds: [], ruleIds: [], confidence: { level: 'strongly_inferred', score: 0.8, evidence: [], ruleIds: [] }, reviewRequired: false } as any,
    sale: { confirmationState: 'unknown', summaryPresented: false, customerConfirmed: false, staffConfirmed: false, confirmationMessageIds: [], invoiceCandidateIds: [], selectedInvoiceId: null, selectedInvoiceNumber: null, attributionLevel: 'unknown', proofState: 'unknown', outcome: 'open_opportunity', isSaleCountable: false, reasonCodes: [], contradictions: [] },
    unavailableDemand: [],
    lostOpportunity: { caseId: 'clinical-case', state: 'open', reason: null, responsibility: 'unknown', recoverability: 'unknown', productLosses: [], evidenceMessageIds: [], ruleIds: [], confidence: { level: 'strongly_inferred', score: 0.8, evidence: [], ruleIds: [] }, needsHumanReview: false, humanReviewReasons: [] } as any,
    followUp: { caseId: 'clinical-case', decision: 'not_needed', opportunities: [], notNeededReason: null } as any,
    coachingEvidence: { staffReplied: true, unansweredRequestMessageIds: [], alternativeOfferedProductKeys: [], unavailableWithoutAlternativeProductKeys: [], delayComplaintMessageIds: [], clearClosing: false, protocolCompliant: false, missingProtocolSteps: [] },
    evidenceSummary: { evidenceMessageIds: [], sectionConfidence: { interaction: 'strongly_inferred', need: 'strongly_inferred', journey: 'strongly_inferred', attribution: 'unknown', lostOpportunity: 'strongly_inferred' } },
    review: { required: false, reasons: [] },
  };
}

describe('conversation clinical review router 9E', () => {
  it('routes consultation and dosage/usage to manual review without judging correctness', () => {
    const result = buildConversationClinicalReview(view([
      { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'ابني 5 سنين عنده كحة، ينفع له الدواء ده؟', meaningful: true },
      { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T09:00:20.000Z', text: 'حضرتك خليه ياخد 5 مل مرتين في اليوم بعد الأكل', meaningful: true },
      { id: 'c2', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:30.000Z', text: 'تمام', meaningful: true },
    ]));
    expect(result.detected).toBe(true);
    expect(result.manualReviewOnly).toBe(true);
    expect(result.consultation.present).toBe(true);
    expect(result.dosageUsage.present).toBe(true);
    expect(result.dosageUsage.triggerMessageIds).toEqual(['s1']);
  });

  it('does not treat a normal sales quantity as dosage instruction', () => {
    const result = buildConversationClinicalReview(view([
      { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'عايز 2 علبة بون كير', meaningful: true },
      { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T09:00:10.000Z', text: 'حاضر يا فندم علبتين', meaningful: true },
    ]));
    expect(result.detected).toBe(false);
    expect(result.dosageUsage.present).toBe(false);
  });

  it('marks missing media when it sits inside the clinical review slice but never interprets it', () => {
    const result = buildConversationClinicalReview(view([
      { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'دي روشتة الطفل', meaningful: true },
      { id: 'c2', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:01.000Z', text: '<image omitted>', meaningful: false },
      { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T09:00:20.000Z', text: 'تمام يا فندم', meaningful: true },
    ]));
    expect(result.consultation.present).toBe(true);
    expect(result.consultation.mediaContextMissing).toBe(true);
  });
});
