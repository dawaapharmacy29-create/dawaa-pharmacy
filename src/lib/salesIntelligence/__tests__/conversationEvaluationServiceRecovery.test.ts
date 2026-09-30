import { describe, expect, it } from 'vitest';
import type { CaseIntelligenceView } from '../types';
import { analyzeConversationEvaluationServiceRecovery } from '../conversationEvaluationServiceRecovery';

function makeView(messages: CaseIntelligenceView['interaction']['messages']): CaseIntelligenceView {
  return {
    version:'case-intelligence-v3',caseId:'c',conversationId:'conv',sourceCaseIdV22:null,
    interaction:{interactionId:'i',startedAt:messages[0]?.at||'2026-09-28T09:00:00Z',endedAt:messages[messages.length-1]?.at||null,messageCount:messages.length,meaningfulMessageCount:messages.filter(m=>m.meaningful).length,messageIds:messages.map(m=>m.id),messages,triggerMessageId:messages[0]?.id||null,segmentationReason:null,caseType:'sales_opportunity',caseStatus:'sales_opportunity',confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]}},
    customer:{customerId:'cust',customerPhone:null,customerName:'عميل',customerCode:'1',identityStatus:'resolved',blockers:[]},
    branch:{branchId:null,branchNameRaw:'فرع شكري'},staff:{participants:[],facts:[]},
    need:{caseId:'c',primaryNeed:'طلب',primaryNeedMessageId:messages.find(m=>m.role==='customer')?.id||null,products:[],unlinkedAvailability:[],unlinkedAlternatives:[],objections:[],unresolvedNeed:false,needDeclined:false,needDeclineMessageIds:[],evidenceMessageIds:[],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},needsHumanReview:false,humanReviewReasons:[]},
    products:[],basket:{versions:[],activeBasketId:null,activeItems:[],announcedTotal:null,confirmed:false},
    journey:{caseId:'c',currentState:'opportunity_open',stateHistory:[],evidenceMessageIds:[],ruleIds:[],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},reviewRequired:false} as any,
    sale:{confirmationState:'unknown',summaryPresented:false,customerConfirmed:false,staffConfirmed:false,confirmationMessageIds:[],invoiceCandidateIds:[],selectedInvoiceId:null,selectedInvoiceNumber:null,attributionLevel:'unknown',proofState:'unknown',outcome:'open_opportunity',isSaleCountable:false,reasonCodes:[],contradictions:[]},
    unavailableDemand:[],
    lostOpportunity:{caseId:'c',state:'open',waitingOn:null,reason:null,stage:'fulfillment',responsibility:'unknown',recoverability:'unknown',productKeys:[],productLosses:[],staffFacts:[],evidenceMessageIds:[],confidence:{level:'strongly_inferred',score:.8,evidence:[],ruleIds:[]},explanation:'x'} as any,
    followUp:{caseId:'c',decision:'not_needed',opportunities:[],notNeededReason:null} as any,
    coachingEvidence:{staffReplied:true,unansweredRequestMessageIds:[],alternativeOfferedProductKeys:[],unavailableWithoutAlternativeProductKeys:[],delayComplaintMessageIds:[],clearClosing:false,protocolCompliant:false,missingProtocolSteps:[]},
    evidenceSummary:{evidenceMessageIds:messages.map(m=>m.id),sectionConfidence:{interaction:'strongly_inferred',need:'strongly_inferred',journey:'strongly_inferred',attribution:'unknown',lostOpportunity:'strongly_inferred'}},
    review:{required:false,reasons:[]},
  };
}

describe('conversation evaluation service recovery 9H',()=>{
  it('credits apology + action + resolution on a real complaint',()=>{
    const v=makeView([
      {id:'c1',role:'customer',sender:'Customer',at:'2026-09-28T09:00:00Z',text:'انا زعلان جدا من المشكلة دي',meaningful:true},
      {id:'s1',role:'staff',sender:'You',at:'2026-09-28T09:00:10Z',text:'حقك علينا يا فندم، هتابع الموضوع حالا',meaningful:true},
      {id:'s2',role:'staff',sender:'You',at:'2026-09-28T09:03:00Z',text:'تم التواصل واتحل الموضوع يا فندم',meaningful:true},
    ]);
    expect(analyzeConversationEvaluationServiceRecovery(v).items.find(i=>i.key==='angry_customer'))
      .toMatchObject({selectedOption:'solved',pointsEarned:10});
  });

  it('does not blame the doctor for an external delay when communication was handled fully',()=>{
    const v=makeView([
      {id:'s0',role:'staff',sender:'You',at:'2026-09-28T09:00:00Z',text:'معلش يا فندم المندوب هيتأخر شوية، هيكون عند حضرتك خلال 30 دقيقة',meaningful:true},
      {id:'s1',role:'staff',sender:'You',at:'2026-09-28T09:20:00Z',text:'المندوب في الطريق يا فندم',meaningful:true},
    ]);
    v.lostOpportunity={...v.lostOpportunity,responsibility:'delivery'};
    expect(analyzeConversationEvaluationServiceRecovery(v).items.find(i=>i.key==='order_delay_handling'))
      .toMatchObject({selectedOption:'outside_reason_handled',pointsEarned:15});
  });

  it('scores apology only after customer asks about delay as late apology',()=>{
    const v=makeView([
      {id:'c1',role:'customer',sender:'Customer',at:'2026-09-28T09:00:00Z',text:'الاوردر لسه مجاش ليه؟',meaningful:true},
      {id:'s1',role:'staff',sender:'You',at:'2026-09-28T09:01:00Z',text:'معلش يا فندم',meaningful:true},
    ]);
    expect(analyzeConversationEvaluationServiceRecovery(v).items.find(i=>i.key==='order_delay_handling'))
      .toMatchObject({selectedOption:'late_apology',pointsEarned:5});
  });

  it('scores no reply after delay complaint as not informed',()=>{
    const v=makeView([
      {id:'c1',role:'customer',sender:'Customer',at:'2026-09-28T09:00:00Z',text:'المندوب متأخر والاوردر فين؟',meaningful:true},
    ]);
    expect(analyzeConversationEvaluationServiceRecovery(v).items.find(i=>i.key==='order_delay_handling'))
      .toMatchObject({selectedOption:'not_informed',pointsEarned:0});
  });

  it('does not apply delay handling to ordinary slow chat response with no order context',()=>{
    const v=makeView([
      {id:'c1',role:'customer',sender:'Customer',at:'2026-09-28T09:00:00Z',text:'لسه حد هيرد عليا؟',meaningful:true},
      {id:'s1',role:'staff',sender:'You',at:'2026-09-28T09:20:00Z',text:'أهلا بحضرتك',meaningful:true},
    ]);
    expect(analyzeConversationEvaluationServiceRecovery(v).items.find(i=>i.key==='order_delay_handling'))
      .toMatchObject({status:'not_applicable',pointsEarned:null});
  });
});
