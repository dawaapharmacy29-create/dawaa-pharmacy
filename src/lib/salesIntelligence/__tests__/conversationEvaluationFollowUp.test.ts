import { describe, expect, it } from 'vitest';
import type { CaseIntelligenceView } from '../types';
import { analyzeConversationEvaluationFollowUp } from '../conversationEvaluationFollowUp';

function baseView(messages: CaseIntelligenceView['interaction']['messages']): CaseIntelligenceView {
  return {
    version: 'case-intelligence-v3',
    caseId: 'follow-case',
    conversationId: 'follow-conv',
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
    customer: { customerId: 'cust', customerPhone: '01000000000', customerName: 'عميل', customerCode: '1', identityStatus: 'resolved', blockers: [] },
    branch: { branchId: null, branchNameRaw: 'فرع شكري' },
    staff: { participants: [{ sender: 'You', staffId: 'staff', messageIds: messages.filter((m) => m.role === 'staff').map((m) => m.id), messageCount: messages.filter((m) => m.role === 'staff').length }], facts: [] },
    need: {
      caseId: 'follow-case',
      primaryNeed: 'محتاج الدواء',
      primaryNeedMessageId: messages.find((m) => m.role === 'customer')?.id || null,
      products: [] as any,
      unlinkedAvailability: [],
      unlinkedAlternatives: [],
      objections: [],
      unresolvedNeed: false,
      needDeclined: false,
      needDeclineMessageIds: [],
      evidenceMessageIds: messages.filter((m) => m.role === 'customer').map((m) => m.id),
      confidence: { level: 'strongly_inferred', score: 0.9, evidence: [], ruleIds: [] },
      needsHumanReview: false,
      humanReviewReasons: [],
    },
    products: [],
    basket: { versions: [], activeBasketId: null, activeItems: [], announcedTotal: null, confirmed: false },
    journey: { caseId: 'follow-case', currentState: 'opportunity_open', stateHistory: [], evidenceMessageIds: [], ruleIds: [], confidence: { level: 'strongly_inferred', score: 0.9, evidence: [], ruleIds: [] }, reviewRequired: false } as any,
    sale: { confirmationState: 'basket_in_progress', summaryPresented: false, customerConfirmed: false, staffConfirmed: false, confirmationMessageIds: [], invoiceCandidateIds: [], selectedInvoiceId: null, selectedInvoiceNumber: null, attributionLevel: 'unknown', proofState: 'unknown', outcome: 'open_opportunity', isSaleCountable: false, reasonCodes: [], contradictions: [] },
    unavailableDemand: [],
    lostOpportunity: { caseId: 'follow-case', state: 'open', reason: null, responsibility: 'unknown', recoverability: 'unknown', productLosses: [], evidenceMessageIds: [], ruleIds: [], confidence: { level: 'strongly_inferred', score: 0.9, evidence: [], ruleIds: [] }, needsHumanReview: false, humanReviewReasons: [] } as any,
    followUp: { caseId: 'follow-case', decision: 'not_needed', opportunities: [], notNeededReason: null } as any,
    coachingEvidence: { staffReplied: true, unansweredRequestMessageIds: [], alternativeOfferedProductKeys: [], unavailableWithoutAlternativeProductKeys: [], delayComplaintMessageIds: [], clearClosing: false, protocolCompliant: false, missingProtocolSteps: [] },
    evidenceSummary: { evidenceMessageIds: messages.map((m) => m.id), sectionConfidence: { interaction: 'strongly_inferred', need: 'strongly_inferred', journey: 'strongly_inferred', attribution: 'unknown', lostOpportunity: 'strongly_inferred' } },
    review: { required: false, reasons: [] },
  };
}

describe('conversation evaluation follow-up 9D', () => {
  it('credits a return within five minutes after a real promise', () => {
    const view = baseView([
      { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'ممكن تشوف الصنف؟', meaningful: true },
      { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T09:00:10.000Z', text: 'لحظات يا فندم هراجع وأرجع لحضرتك', meaningful: true },
      { id: 'c2', role: 'customer', sender: 'Customer', at: '2026-09-28T09:02:00.000Z', text: 'تمام', meaningful: true },
      { id: 's2', role: 'staff', sender: 'You', at: '2026-09-28T09:04:10.000Z', text: 'متوفر يا فندم', meaningful: true },
    ]);
    expect(analyzeConversationEvaluationFollowUp(view).item).toMatchObject({
      status: 'assessed',
      selectedOption: 'within_5',
      pointsEarned: 10,
      waitSeconds: 240,
    });
  });

  it('an unresolved promise at the end of the export is pending — no penalty, no forgotten customer', () => {
    const view = baseView([
      { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'الصنف موجود؟', meaningful: true },
      { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T09:00:10.000Z', text: 'هراجع وأرجع لحضرتك', meaningful: true },
    ]);
    view.followUp = {
      caseId: 'follow-case',
      decision: 'actionable',
      notNeededReason: null,
      opportunities: [{
        followUpKey: 'f1',
        caseId: 'follow-case',
        customerId: 'cust',
        status: 'actionable',
        reason: 'staff_promised_check',
        priority: 'high',
        productKey: null,
        productId: null,
        productRaw: null,
        quantity: null,
        demandKey: null,
        duePolicy: 'same_shift',
        requestedDelayDays: null,
        dueAt: null,
        assignedRole: 'pharmacist',
        assignedStaffId: 'staff',
        assignedStaffName: null,
        goal: 'complete_promised_check',
        nextBestAction: 'complete_promised_check',
        blocker: null,
        suppressedBy: null,
        evidenceMessageIds: ['s1'],
        confidence: { level: 'strongly_inferred', score: 0.85, evidence: [], ruleIds: [] },
      }],
    } as any;

    const item = analyzeConversationEvaluationFollowUp(view).item;
    expect(item).toMatchObject({
      status: 'insufficient_evidence',
      selectedOption: null,
      pointsEarned: null,
    });
    expect(item.lifecycle?.status).toBe('pending');
    expect(item.lifecycle?.penaltyEligible).toBe(false);
  });

  it('uses the canonical unresolved follow-up to prove a MATURE promise was never completed', () => {
    const view = baseView([
      { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'الصنف موجود؟', meaningful: true },
      { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T09:00:10.000Z', text: 'هراجع وأرجع لحضرتك', meaningful: true },
      { id: 'c2', role: 'customer', sender: 'Customer', at: '2026-09-28T12:30:00.000Z', text: 'يا دكتور', meaningful: true },
    ]);
    view.followUp = {
      caseId: 'follow-case',
      decision: 'actionable',
      notNeededReason: null,
      opportunities: [{
        followUpKey: 'f1',
        caseId: 'follow-case',
        customerId: 'cust',
        status: 'actionable',
        reason: 'staff_promised_check',
        priority: 'high',
        productKey: null,
        productId: null,
        productRaw: null,
        quantity: null,
        demandKey: null,
        duePolicy: 'same_shift',
        requestedDelayDays: null,
        dueAt: null,
        assignedRole: 'pharmacist',
        assignedStaffId: 'staff',
        assignedStaffName: null,
        goal: 'complete_promised_check',
        nextBestAction: 'complete_promised_check',
        blocker: null,
        suppressedBy: null,
        evidenceMessageIds: ['s1'],
        confidence: { level: 'strongly_inferred', score: 0.85, evidence: [], ruleIds: [] },
      }],
    } as any;

    const item = analyzeConversationEvaluationFollowUp(view).item;
    expect(item).toMatchObject({
      status: 'assessed',
      selectedOption: 'never',
      pointsEarned: 0,
    });
  });

  it('past the SLA but not yet mature is overdue for human review, still without penalty', () => {
    const view = baseView([
      { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'الصنف موجود؟', meaningful: true },
      { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T09:00:10.000Z', text: 'هراجع وأرجع لحضرتك', meaningful: true },
      { id: 'c2', role: 'customer', sender: 'Customer', at: '2026-09-28T09:45:00.000Z', text: 'يا دكتور', meaningful: true },
    ]);
    view.followUp = {
      caseId: 'follow-case',
      decision: 'actionable',
      notNeededReason: null,
      opportunities: [{
        followUpKey: 'f1',
        caseId: 'follow-case',
        customerId: 'cust',
        status: 'actionable',
        reason: 'staff_promised_check',
        priority: 'high',
        productKey: null,
        productId: null,
        productRaw: null,
        quantity: null,
        demandKey: null,
        duePolicy: 'same_shift',
        requestedDelayDays: null,
        dueAt: null,
        assignedRole: 'pharmacist',
        assignedStaffId: 'staff',
        assignedStaffName: null,
        goal: 'complete_promised_check',
        nextBestAction: 'complete_promised_check',
        blocker: null,
        suppressedBy: null,
        evidenceMessageIds: ['s1'],
        confidence: { level: 'strongly_inferred', score: 0.85, evidence: [], ruleIds: [] },
      }],
    } as any;

    const item = analyzeConversationEvaluationFollowUp(view).item;
    expect(item.status).toBe('insufficient_evidence');
    expect(item.pointsEarned).toBeNull();
    expect(item.lifecycle?.status).toBe('overdue');
  });

  it('does not attach a later staff reply to the old promise after the customer opened a new substantive request', () => {
    const view = baseView([
      { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'الصنف موجود؟', meaningful: true },
      { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T09:00:10.000Z', text: 'هراجع وأرجع لحضرتك', meaningful: true },
      { id: 'c2', role: 'customer', sender: 'Customer', at: '2026-09-28T09:02:00.000Z', text: 'وعايز كمان أسأل عن دواء تاني', meaningful: true },
      { id: 's2', role: 'staff', sender: 'You', at: '2026-09-28T09:03:00.000Z', text: 'اتفضل يا فندم', meaningful: true },
    ]);
    expect(analyzeConversationEvaluationFollowUp(view).item).toMatchObject({
      status: 'insufficient_evidence',
      pointsEarned: null,
    });
  });

  it('is not applicable when no promise exists', () => {
    const view = baseView([
      { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'الصنف موجود؟', meaningful: true },
      { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T09:00:10.000Z', text: 'موجود يا فندم', meaningful: true },
    ]);
    expect(analyzeConversationEvaluationFollowUp(view).item).toMatchObject({
      status: 'not_applicable',
      pointsEarned: null,
    });
  });
});
