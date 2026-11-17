import { describe, expect, it } from 'vitest';
import type { CaseIntelligenceView } from '../types';
import { analyzeConversationEvaluationCore } from '../conversationEvaluationCore';
import { deriveCanonicalComplaintAssessment } from '../complaintAssessmentEngine';
import { analyzeConversationEvaluationSales } from '../conversationEvaluationSales';

function makeView(overrides: Partial<CaseIntelligenceView> = {}): CaseIntelligenceView {
  const base: CaseIntelligenceView = {
    version: 'case-intelligence-v3',
    caseId: 'case-core',
    conversationId: 'conv-core',
    sourceCaseIdV22: null,
    interaction: {
      interactionId: 'i-core',
      startedAt: '2026-09-28T06:51:56.000Z',
      endedAt: '2026-09-28T06:58:45.000Z',
      messageCount: 4,
      meaningfulMessageCount: 4,
      messageIds: ['c1', 's1', 's2', 'c2'],
      messages: [
        { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T06:51:56.000Z', text: 'عايز بون كير علبتين', meaningful: true },
        { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T06:52:00.000Z', text: 'أهلا بحضرتك يا فندم', meaningful: true },
        { id: 's2', role: 'staff', sender: 'You', at: '2026-09-28T06:52:05.000Z', text: 'بون كير متوفر، علبتين صح؟', meaningful: true },
        { id: 'c2', role: 'customer', sender: 'Customer', at: '2026-09-28T06:52:10.000Z', text: 'ايوه', meaningful: true },
      ],
      triggerMessageId: 'c1',
      segmentationReason: null,
      caseType: 'sales_opportunity',
      caseStatus: 'sales_opportunity',
      confidence: { level: 'strongly_inferred', score: 0.95, evidence: [], ruleIds: [] },
    },
    customer: { customerId: 'cust', customerPhone: '01000000000', customerName: 'عميل', customerCode: '1', identityStatus: 'resolved', blockers: [] },
    branch: { branchId: null, branchNameRaw: 'فرع شكري' },
    staff: {
      participants: [{ sender: 'You', staffId: 'staff', messageIds: ['s1', 's2'], messageCount: 2 }],
      facts: [{ fact: 'stated_available', messageId: 's2', staffSender: 'You', staffId: 'staff', productKey: 'bon-care', source: 'customer_need' }],
    },
    need: {
      caseId: 'case-core',
      primaryNeed: 'عايز بون كير علبتين',
      primaryNeedMessageId: 'c1',
      products: [] as any,
      unlinkedAvailability: [],
      unlinkedAlternatives: [],
      objections: [],
      unresolvedNeed: false,
      needDeclined: false,
      needDeclineMessageIds: [],
      evidenceMessageIds: ['c1', 's2'],
      confidence: { level: 'strongly_inferred', score: 0.95, evidence: [], ruleIds: [] },
      needsHumanReview: false,
      humanReviewReasons: [],
    },
    products: [{
      productKey: 'bon-care',
      productNameRaw: 'بون كير',
      productId: null,
      roles: ['requested'],
      requestedQuantity: 2,
      offeredQuantity: null,
      finalQuantity: 2,
      availability: 'available',
      alternativeCount: 0,
      alternativeResponses: [],
      inFinalBasket: true,
      demandKey: null,
      lossOutcome: null,
      lossReason: null,
      followUpKeys: [],
    }],
    basket: { versions: [], activeBasketId: null, activeItems: [], announcedTotal: null, confirmed: false },
    journey: { caseId: 'case-core', currentState: 'opportunity_open', stateHistory: [], evidenceMessageIds: [], ruleIds: [], confidence: { level: 'strongly_inferred', score: 0.9, evidence: [], ruleIds: [] }, reviewRequired: false } as any,
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
    lostOpportunity: { caseId: 'case-core', state: 'open', reason: null, responsibility: 'unknown', recoverability: 'unknown', productLosses: [], evidenceMessageIds: [], ruleIds: [], confidence: { level: 'strongly_inferred', score: 0.9, evidence: [], ruleIds: [] }, needsHumanReview: false, humanReviewReasons: [] } as any,
    followUp: { caseId: 'case-core', decision: 'not_needed', opportunities: [], notNeededReason: null, evidenceMessageIds: [], ruleIds: [], confidence: { level: 'strongly_inferred', score: 0.9, evidence: [], ruleIds: [] }, needsHumanReview: false, humanReviewReasons: [] } as any,
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
      evidenceMessageIds: ['c1', 's1', 's2', 'c2'],
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
  return { ...base, ...overrides };
}

function complaintView(): CaseIntelligenceView {
  const v = makeView();
  v.interaction.caseType = 'mixed';
  v.interaction.messages = [
    { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T06:51:56Z', text: 'اي الطريقة السخيفة دي اللي المندوب بيتكلم بيها', meaningful: true },
    { id: 'image', role: 'customer', sender: 'Customer', at: '2026-09-28T06:51:57Z', text: '<image omitted>', meaningful: false },
    { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T06:52:00Z', text: 'حق حضرتك جدا وبعتذر على الموقف دا', meaningful: true },
    { id: 's2', role: 'staff', sender: 'You', at: '2026-09-28T06:52:05Z', text: 'انا صعدت الموضوع للاداره', meaningful: true },
  ];
  v.products = [];
  v.need = { ...v.need, primaryNeed: v.interaction.messages[0].text, primaryNeedMessageId: 'c1', evidenceMessageIds: ['c1'], products: [], unresolvedNeed: true };
  v.staff.facts = [];
  v.complaintAssessment = deriveCanonicalComplaintAssessment({ caseId: v.caseId, messages: v.interaction.messages });
  return v;
}

describe('complaint-only criterion applicability V57', () => {
  it('scores visible complaint understanding despite unavailable image and no SKU', () => {
    const v = complaintView();
    v.complaintAssessment = undefined; // Saved case views need not serialize this optional field.
    const result = analyzeConversationEvaluationCore(v).items.find(i => i.key === 'understanding');
    expect(result).toMatchObject({ status: 'assessed', pointsEarned: 10 });
    expect(result?.evidenceMessageIds).toEqual(['c1', 's1', 's2']);
    expect(result?.evidenceMessageIds).not.toContain('image');
  });
  it('does not turn a mixed-label complaint or callback into a sales-closing score', () => {
    const v = complaintView();
    v.lostOpportunity = { ...v.lostOpportunity, state: 'open', waitingOn: 'customer' };
    expect(analyzeConversationEvaluationSales(v).items.find(i => i.key === 'sales_closing'))
      .toMatchObject({ status: 'not_applicable', pointsEarned: null });
  });
  it('does not award understanding for a generic apology alone', () => {
    const v = complaintView();
    v.interaction.messages = v.interaction.messages.filter(m => m.id !== 's2').map(m => m.id === 's1' ? { ...m, text: 'بعتذر لحضرتك' } : m);
    v.complaintAssessment = deriveCanonicalComplaintAssessment({ caseId: v.caseId, messages: v.interaction.messages });
    expect(analyzeConversationEvaluationCore(v).items.find(i => i.key === 'understanding'))
      .toMatchObject({ status: 'insufficient_evidence', pointsEarned: null });
  });
  it('cannot borrow another doctor acknowledgment or remedy from canonical IDs outside the scoped messages', () => {
    const v = complaintView();
    v.interaction.messages = v.interaction.messages.filter(m => m.role !== 'staff');
    expect(analyzeConversationEvaluationCore(v).items.find(i => i.key === 'understanding'))
      .toMatchObject({ status: 'insufficient_evidence', pointsEarned: null });
  });
  it('keeps a real countable order evaluable when a complaint also exists', () => {
    const v = complaintView();
    v.sale = { ...v.sale, outcome: 'sale_proven', isSaleCountable: true };
    expect(analyzeConversationEvaluationSales(v).items.find(i => i.key === 'sales_closing')?.status).toBe('assessed');
  });
});

describe('conversation evaluation core 9C', () => {
  it('scores respectful repeated service language as professional and resolved product handling as strong understanding', () => {
    const result = analyzeConversationEvaluationCore(makeView());
    const tone = result.items.find((item) => item.key === 'tone');
    const understanding = result.items.find((item) => item.key === 'understanding');
    expect(tone).toMatchObject({ status: 'assessed', selectedOption: 'professional', pointsEarned: 10 });
    expect(understanding).toMatchObject({ status: 'assessed', selectedOption: 'strong', pointsEarned: 10 });
  });

  it('never penalizes understanding when the real request is hidden in unavailable media', () => {
    const v = makeView({
      interaction: {
        ...makeView().interaction,
        messages: [
          { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T06:51:56.000Z', text: 'عايزه الحاجات دي', meaningful: true },
          { id: 'c2', role: 'customer', sender: 'Customer', at: '2026-09-28T06:51:59.000Z', text: '<image omitted>', meaningful: false },
          { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T06:52:06.000Z', text: 'أهلا بحضرتك يا فندم', meaningful: true },
        ],
      },
      need: {
        ...makeView().need,
        primaryNeed: 'عايزه الحاجات دي',
        primaryNeedMessageId: 'c1',
        unresolvedNeed: true,
        evidenceMessageIds: ['c1'],
      },
      products: [],
      staff: { participants: [{ sender: 'You', staffId: 'staff', messageIds: ['s1'], messageCount: 1 }], facts: [] },
    });
    const result = analyzeConversationEvaluationCore(v);
    expect(result.items.find((item) => item.key === 'understanding')).toMatchObject({
      status: 'insufficient_evidence',
      pointsEarned: null,
    });
  });

  it('does not award professional tone from one polite greeting followed only by a neutral stock reply', () => {
    const base = makeView();
    const v = makeView({
      interaction: {
        ...base.interaction,
        messages: [
          { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'بون كير موجود؟', meaningful: true },
          { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T09:00:05.000Z', text: 'أهلا بحضرتك يا فندم', meaningful: true },
          { id: 's2', role: 'staff', sender: 'You', at: '2026-09-28T09:00:08.000Z', text: 'موجود', meaningful: true },
        ],
      },
    });
    expect(analyzeConversationEvaluationCore(v).items.find((item) => item.key === 'tone')).toMatchObject({
      selectedOption: 'acceptable',
      pointsEarned: 7,
    });
  });

  it('does not call one neutral short reply dry', () => {
    const base = makeView();
    const v = makeView({
      interaction: {
        ...base.interaction,
        messages: [
          { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'بون كير موجود؟', meaningful: true },
          { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T09:00:05.000Z', text: 'موجود', meaningful: true },
        ],
      },
    });
    const tone = analyzeConversationEvaluationCore(v).items.find((item) => item.key === 'tone');
    expect(tone).toMatchObject({ status: 'insufficient_evidence', pointsEarned: null });
  });

  it('requires a repeated terse pattern before assigning dry tone', () => {
    const base = makeView();
    const v = makeView({
      interaction: {
        ...base.interaction,
        messages: [
          { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'محتاج بون كير وعايز أعرف الكمية', meaningful: true },
          { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T09:00:05.000Z', text: 'اه', meaningful: true },
          { id: 's2', role: 'staff', sender: 'You', at: '2026-09-28T09:00:10.000Z', text: 'موجود', meaningful: true },
          { id: 's3', role: 'staff', sender: 'You', at: '2026-09-28T09:00:15.000Z', text: 'تمام', meaningful: true },
        ],
      },
    });
    expect(analyzeConversationEvaluationCore(v).items.find((item) => item.key === 'tone')).toMatchObject({
      selectedOption: 'dry',
      pointsEarned: 4,
    });
  });

  it('detects explicit dismissive wording without needing keyword-based inference about the whole conversation', () => {
    const base = makeView();
    const v = makeView({
      interaction: {
        ...base.interaction,
        messages: [
          { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'ممكن تساعدني؟', meaningful: true },
          { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T09:00:05.000Z', text: 'مش فاضي دلوقتي', meaningful: true },
        ],
      },
    });
    expect(analyzeConversationEvaluationCore(v).items.find((item) => item.key === 'tone')).toMatchObject({
      selectedOption: 'bad',
      pointsEarned: 0,
    });
  });

  it('treats a customer correction after a clarifying question as good clarification, not misunderstanding', () => {
    const base = makeView();
    const v = makeView({
      interaction: {
        ...base.interaction,
        messages: [
          { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'عايز فيتامين', meaningful: true },
          { id: 's1', role: 'staff', sender: 'You', at: '2026-09-28T09:00:05.000Z', text: 'حضرتك تقصد فيتامين د؟', meaningful: true },
          { id: 'c2', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:10.000Z', text: 'لا قصدي فيتامين سي', meaningful: true },
        ],
      },
      need: { ...base.need, primaryNeed: 'عايز فيتامين', primaryNeedMessageId: 'c1', unresolvedNeed: false, evidenceMessageIds: ['c1', 'c2'] },
      products: [],
      staff: { participants: [{ sender: 'You', staffId: 'staff', messageIds: ['s1'], messageCount: 1 }], facts: [] },
    });
    expect(analyzeConversationEvaluationCore(v).items.find((item) => item.key === 'understanding')).toMatchObject({
      selectedOption: 'strong',
      pointsEarned: 10,
    });
  });
});
