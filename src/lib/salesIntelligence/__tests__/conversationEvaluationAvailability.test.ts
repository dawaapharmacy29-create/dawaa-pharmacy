import { describe, expect, it } from 'vitest';
import type { CaseIntelligenceView, UnavailableDemand } from '../types';
import { analyzeConversationEvaluationAvailability } from '../conversationEvaluationAvailability';

function demand(overrides: Partial<UnavailableDemand> = {}): UnavailableDemand {
  return {
    demandKey: 'd1',
    caseId: 'c',
    conversationId: 'conv',
    sourceCaseIdV22: null,
    customerId: 'cust',
    customerIdentityStatus: 'resolved',
    branchId: null,
    branchNameRaw: 'فرع شكري',
    requestedAt: '2026-09-28T09:00:00.000Z',
    productKey: 'product-a',
    requestedProductRaw: 'صنف أ',
    resolvedProductId: null,
    quantityRequested: 1,
    availabilityState: 'unavailable',
    availabilityMessageId: 's1',
    statedByStaffName: 'You',
    statedByStaffId: 'staff',
    alternativeOffered: false,
    alternativeProductKey: null,
    alternativeProductRaw: null,
    alternativeProductId: null,
    alternativeOfferedByStaffName: null,
    alternativeOfferedByStaffId: null,
    alternativeResponse: null,
    followUpCandidate: false,
    followUpReason: null,
    followUpSuppressedBy: null,
    evidenceMessageIds: ['c1', 's1'],
    confidence: { level: 'strongly_inferred', score: 0.9, evidence: [], ruleIds: [] },
    blockers: [],
    ...overrides,
  };
}

function view(demands: UnavailableDemand[], staffTexts: Record<string,string>): CaseIntelligenceView {
  const messages: CaseIntelligenceView['interaction']['messages'] = [
    { id: 'c1', role: 'customer', sender: 'Customer', at: '2026-09-28T09:00:00.000Z', text: 'الصنف موجود؟', meaningful: true },
    ...Object.entries(staffTexts).map(([id,text],i) => ({ id, role: 'staff' as const, sender: 'You', at: `2026-09-28T09:00:${String(10+i).padStart(2,'0')}.000Z`, text, meaningful: true })),
  ];
  return {
    version: 'case-intelligence-v3',
    caseId: 'c',
    conversationId: 'conv',
    sourceCaseIdV22: null,
    interaction: { interactionId:'i',startedAt:messages[0].at,endedAt:messages[messages.length-1].at,messageCount:messages.length,meaningfulMessageCount:messages.length,messageIds:messages.map(m=>m.id),messages,triggerMessageId:'c1',segmentationReason:null,caseType:'sales_opportunity',caseStatus:'sales_opportunity',confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]} },
    customer:{customerId:'cust',customerPhone:null,customerName:'عميل',customerCode:'1',identityStatus:'resolved',blockers:[]},
    branch:{branchId:null,branchNameRaw:'فرع شكري'},
    staff:{participants:[{sender:'You',staffId:'staff',messageIds:Object.keys(staffTexts),messageCount:Object.keys(staffTexts).length}],facts:[]},
    need:{caseId:'c',primaryNeed:'الصنف موجود؟',primaryNeedMessageId:'c1',products:[],unlinkedAvailability:[],unlinkedAlternatives:[],objections:[],unresolvedNeed:false,needDeclined:false,needDeclineMessageIds:[],evidenceMessageIds:['c1'],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},needsHumanReview:false,humanReviewReasons:[]},
    products:[],
    basket:{versions:[],activeBasketId:null,activeItems:[],announcedTotal:null,confirmed:false},
    journey:{caseId:'c',currentState:'opportunity_open',stateHistory:[],evidenceMessageIds:[],ruleIds:[],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},reviewRequired:false} as any,
    sale:{confirmationState:'unknown',summaryPresented:false,customerConfirmed:false,staffConfirmed:false,confirmationMessageIds:[],invoiceCandidateIds:[],selectedInvoiceId:null,selectedInvoiceNumber:null,attributionLevel:'unknown',proofState:'unknown',outcome:'open_opportunity',isSaleCountable:false,reasonCodes:[],contradictions:[]},
    unavailableDemand:demands,
    lostOpportunity:{caseId:'c',state:'recoverable',reason:'stock_unavailable',responsibility:'inventory',recoverability:'high',productLosses:[],evidenceMessageIds:demands.flatMap(d=>d.evidenceMessageIds),ruleIds:[],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},needsHumanReview:false,humanReviewReasons:[]} as any,
    followUp:{caseId:'c',decision:'not_needed',opportunities:[],notNeededReason:null} as any,
    coachingEvidence:{staffReplied:true,unansweredRequestMessageIds:[],alternativeOfferedProductKeys:[],unavailableWithoutAlternativeProductKeys:[],delayComplaintMessageIds:[],clearClosing:false,protocolCompliant:false,missingProtocolSteps:[]},
    evidenceSummary:{evidenceMessageIds:messages.map(m=>m.id),sectionConfidence:{interaction:'strongly_inferred',need:'strongly_inferred',journey:'strongly_inferred',attribution:'unknown',lostOpportunity:'strongly_inferred'}},
    review:{required:false,reasons:[]},
  };
}

describe('conversation evaluation availability 9F', () => {
  it('gives full structural credit when an alternative is offered with an explanation', () => {
    const d=demand({alternativeOffered:true,alternativeProductRaw:'بديل ب',evidenceMessageIds:['c1','s1','s2']});
    const result=analyzeConversationEvaluationAvailability(view([d],{s1:'الصنف مش متوفر يا فندم',s2:'في بديل ب بنفس المادة والتركيز'}));
    expect(result.item).toMatchObject({status:'assessed',selectedOption:'alternative_explained',pointsEarned:10});
    expect(result.item.reason).toContain('ليس على الملاءمة الطبية');
  });

  it('scores an offered alternative without explanation separately', () => {
    const d=demand({alternativeOffered:true,alternativeProductRaw:'بديل ب',evidenceMessageIds:['c1','s1','s2']});
    expect(analyzeConversationEvaluationAvailability(view([d],{s1:'مش متوفر',s2:'في بديل ب'})).item)
      .toMatchObject({selectedOption:'alternative_no_explain',pointsEarned:7});
  });

  it('credits real stock-check/follow-up help even when no alternative was offered', () => {
    const d=demand({availabilityState:'check_pending',followUpCandidate:true,followUpReason:'availability_check_pending'});
    expect(analyzeConversationEvaluationAvailability(view([d],{s1:'لحظات هراجع المخزون وارجع لحضرتك'})).item)
      .toMatchObject({selectedOption:'helped_without_alternative',pointsEarned:8});
  });

  it('distinguishes saying unavailable only with no help', () => {
    const d=demand();
    expect(analyzeConversationEvaluationAvailability(view([d],{s1:'مش موجود'})).item)
      .toMatchObject({selectedOption:'unavailable_only',pointsEarned:3});
  });

  it('does not apply when no canonical unavailable demand exists', () => {
    expect(analyzeConversationEvaluationAvailability(view([],{s1:'موجود يا فندم'})).item)
      .toMatchObject({status:'not_applicable',pointsEarned:null});
  });
});
