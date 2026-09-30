import { describe, expect, it } from 'vitest';
import type { CaseIntelligenceView } from '../types';
import { analyzeConversationEvaluationFoundation } from '../conversationEvaluationFoundation';

function viewWith(messages: CaseIntelligenceView['interaction']['messages'], customerName: string | null = 'الحاج محمود صالح'): CaseIntelligenceView {
  return {
    version: 'case-intelligence-v3',
    caseId: 'case-foundation',
    conversationId: 'conv-1',
    sourceCaseIdV22: null,
    interaction: {
      interactionId: 'i-1',
      startedAt: messages[0]?.at || '2026-09-28T06:51:56.000Z',
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
    customer: {
      customerId: customerName ? 'cust-2490' : null,
      customerPhone: customerName ? '01100742008' : null,
      customerName,
      customerCode: customerName ? '2490' : null,
      identityStatus: customerName ? 'resolved' : 'unresolved',
      blockers: customerName ? [] : ['customer_identity_unresolved'],
    },
    branch: { branchId: null, branchNameRaw: 'فرع شكري' },
    staff: {
      participants: [{ sender: 'You', staffId: 'staff-shibl', messageIds: messages.filter((m) => m.role === 'staff').map((m) => m.id), messageCount: messages.filter((m) => m.role === 'staff').length }],
      facts: [],
    },
    need: {
      caseId: 'case-foundation',
      primaryNeed: messages.find((m) => m.role === 'customer')?.text || null,
      primaryNeedMessageId: messages.find((m) => m.role === 'customer')?.id || null,
      products: [],
      unlinkedAvailability: [],
      unlinkedAlternatives: [],
      objections: [],
      unresolvedNeed: false,
      needDeclined: false,
      needDeclineMessageIds: [],
      evidenceMessageIds: messages.filter((m) => m.role === 'customer').map((m) => m.id),
      confidence: { level: 'strongly_inferred', score: 0.8, evidence: [], ruleIds: [] },
      needsHumanReview: false,
      humanReviewReasons: [],
    },
    products: [],
    basket: { versions: [], activeBasketId: null, activeItems: [], announcedTotal: null, confirmed: false },
    journey: { caseId: 'case-foundation', currentState: 'opportunity_open', stateHistory: [], evidenceMessageIds: [], ruleIds: [], confidence: { level: 'strongly_inferred', score: 0.8, evidence: [], ruleIds: [] }, reviewRequired: false } as any,
    sale: {
      confirmationState: 'basket_in_progress',
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
    lostOpportunity: { caseId: 'case-foundation', state: 'open', reason: null, responsibility: 'unknown', recoverability: 'unknown', productLosses: [], evidenceMessageIds: [], ruleIds: [], confidence: { level: 'strongly_inferred', score: 0.8, evidence: [], ruleIds: [] }, needsHumanReview: false, humanReviewReasons: [] } as any,
    followUp: { caseId: 'case-foundation', decision: 'not_needed', opportunities: [], notNeededReason: null, evidenceMessageIds: [], ruleIds: [], confidence: { level: 'strongly_inferred', score: 0.8, evidence: [], ruleIds: [] }, needsHumanReview: false, humanReviewReasons: [] } as any,
    coachingEvidence: {
      staffReplied: messages.some((m) => m.role === 'staff'),
      unansweredRequestMessageIds: [],
      alternativeOfferedProductKeys: [],
      unavailableWithoutAlternativeProductKeys: [],
      delayComplaintMessageIds: [],
      clearClosing: false,
      protocolCompliant: false,
      missingProtocolSteps: [],
    },
    evidenceSummary: {
      evidenceMessageIds: messages.map((m) => m.id),
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

const MAHMOUD_CASE = [
  { id: 'm1', role: 'customer' as const, sender: 'الحاج محمود صالح ٢٤٩٠', at: '2026-09-28T06:51:56.000Z', text: 'السلام عليكم\nلو سمحت يادكتور عايزه الحاجات دي', meaningful: true },
  { id: 'm2', role: 'customer' as const, sender: 'الحاج محمود صالح ٢٤٩٠', at: '2026-09-28T06:51:59.000Z', text: '<image omitted>', meaningful: false },
  { id: 'm3', role: 'staff' as const, sender: 'You', at: '2026-09-28T06:52:02.000Z', text: 'وعليكم السلام ورحمه الله وبركاته', meaningful: true },
  { id: 'm4', role: 'staff' as const, sender: 'You', at: '2026-09-28T06:52:06.000Z', text: 'أهلًا وسهلًا بحضرتك✨\nنورتنا في صيدليات دواء 💚\nمع حضرتك د شبل\nخدمة التوصيل متاحة على مدار ٢٤ ساعة 🚗', meaningful: true },
  { id: 'm5', role: 'customer' as const, sender: 'الحاج محمود صالح ٢٤٩٠', at: '2026-09-28T06:52:10.000Z', text: 'اهلا بحضرتك يادكتور', meaningful: true },
];

describe('conversation evaluation foundation 9B', () => {
  it('scores the real Mahmoud-style opening from the exact interaction evidence', () => {
    const result = analyzeConversationEvaluationFoundation(viewWith(MAHMOUD_CASE));
    const byKey = new Map(result.items.map((item) => [item.key, item]));

    expect(byKey.get('first_response_speed')).toMatchObject({
      status: 'assessed',
      selectedOption: 'within_5',
      pointsEarned: 10,
      measuredValue: 6,
    });
    expect(byKey.get('greeting')).toMatchObject({
      status: 'assessed',
      selectedOption: 'official_full',
      pointsEarned: 10,
    });
    expect(byKey.get('doctor_name')).toMatchObject({
      status: 'assessed',
      selectedOption: 'start',
      pointsEarned: 10,
    });
    expect(byKey.get('customer_name')).toMatchObject({
      status: 'assessed',
      selectedOption: 'not_used_good',
      pointsEarned: 5,
    });
    expect(byKey.get('greeting')?.evidenceMessageIds).toEqual(['m3', 'm4']);
  });

  it('uses canonical customer identity, never the inbound sender label, for name-use scoring', () => {
    const messages = [
      { id: 'c1', role: 'customer' as const, sender: 'Random Sender 999', at: '2026-09-28T09:00:00.000Z', text: 'محتاج دواء', meaningful: true },
      { id: 's1', role: 'staff' as const, sender: 'You', at: '2026-09-28T09:00:10.000Z', text: 'أهلا يا محمود، تحت أمر حضرتك', meaningful: true },
    ];
    const result = analyzeConversationEvaluationFoundation(viewWith(messages, 'الحاج محمود صالح'));
    expect(result.items.find((item) => item.key === 'customer_name')).toMatchObject({
      selectedOption: 'used',
      pointsEarned: 10,
    });
  });

  it('does not grade customer-name usage when identity is unresolved', () => {
    const result = analyzeConversationEvaluationFoundation(viewWith(MAHMOUD_CASE, null));
    expect(result.items.find((item) => item.key === 'customer_name')).toMatchObject({
      status: 'not_applicable',
      pointsEarned: null,
    });
  });

  it('never turns the customer greeting into a pharmacy greeting', () => {
    const messages = [
      { id: 'c1', role: 'customer' as const, sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'السلام عليكم', meaningful: true },
      { id: 's1', role: 'staff' as const, sender: 'You', at: '2026-09-28T09:00:30.000Z', text: 'موجود', meaningful: true },
    ];
    const result = analyzeConversationEvaluationFoundation(viewWith(messages));
    expect(result.items.find((item) => item.key === 'greeting')).toMatchObject({
      selectedOption: 'direct_reply',
      pointsEarned: 2,
    });
  });

  it('does not invent a response-time score when no staff reply exists', () => {
    const messages = [
      { id: 'c1', role: 'customer' as const, sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'محتاج دواء', meaningful: true },
    ];
    const result = analyzeConversationEvaluationFoundation(viewWith(messages));
    expect(result.items.find((item) => item.key === 'first_response_speed')).toMatchObject({
      status: 'insufficient_evidence',
      pointsEarned: null,
    });
    expect(result.items.find((item) => item.key === 'greeting')).toMatchObject({
      selectedOption: 'none',
      pointsEarned: 0,
    });
  });
});
