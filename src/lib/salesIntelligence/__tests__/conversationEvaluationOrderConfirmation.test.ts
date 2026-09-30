import { describe, expect, it } from 'vitest';
import type { CaseIntelligenceView } from '../types';
import { analyzeConversationEvaluationOrderConfirmation } from '../conversationEvaluationOrderConfirmation';

function v():CaseIntelligenceView{
  return{
    version:'case-intelligence-v3',caseId:'c',conversationId:'conv',sourceCaseIdV22:null,
    interaction:{interactionId:'i',startedAt:'2026-09-28T09:00:00Z',endedAt:'2026-09-28T09:05:00Z',messageCount:2,meaningfulMessageCount:2,messageIds:['c1','s1'],messages:[
      {id:'c1',role:'customer',sender:'Customer',at:'2026-09-28T09:00:00Z',text:'تمام',meaningful:true},
      {id:'s1',role:'staff',sender:'You',at:'2026-09-28T09:01:00Z',text:'تم تأكيد الطلب',meaningful:true},
    ],triggerMessageId:'c1',segmentationReason:null,caseType:'sales_opportunity',caseStatus:'sales_opportunity',confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]}},
    customer:{customerId:'cust',customerPhone:null,customerName:'عميل',customerCode:'1',identityStatus:'resolved',blockers:[]},
    branch:{branchId:null,branchNameRaw:'فرع شكري'},staff:{participants:[],facts:[]},
    need:{caseId:'c',primaryNeed:'طلب',primaryNeedMessageId:'c1',products:[],unlinkedAvailability:[],unlinkedAlternatives:[],objections:[],unresolvedNeed:false,needDeclined:false,needDeclineMessageIds:[],evidenceMessageIds:[],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},needsHumanReview:false,humanReviewReasons:[]},
    products:[],basket:{versions:[],activeBasketId:null,activeItems:[],announcedTotal:null,confirmed:true},
    journey:{caseId:'c',currentState:'sale_proven',stateHistory:[],evidenceMessageIds:[],ruleIds:[],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},reviewRequired:false} as any,
    sale:{confirmationState:'commercial_confirmation_complete',summaryPresented:true,customerConfirmed:true,staffConfirmed:true,confirmationMessageIds:['c1','s1'],invoiceCandidateIds:[],selectedInvoiceId:'inv',selectedInvoiceNumber:'1',attributionLevel:'proven',proofState:'proven',outcome:'sale_proven',isSaleCountable:true,reasonCodes:[],contradictions:[]},
    unavailableDemand:[],lostOpportunity:{caseId:'c',state:'won',waitingOn:null,reason:null,stage:'closing',responsibility:'unknown',recoverability:'none',productKeys:[],productLosses:[],staffFacts:[],evidenceMessageIds:[],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},explanation:'won'} as any,
    followUp:{caseId:'c',decision:'not_needed',opportunities:[],notNeededReason:'sale_proven'} as any,
    coachingEvidence:{staffReplied:true,unansweredRequestMessageIds:[],alternativeOfferedProductKeys:[],unavailableWithoutAlternativeProductKeys:[],delayComplaintMessageIds:[],clearClosing:true,protocolCompliant:true,missingProtocolSteps:[],protocolApplicability:'applicable'},
    evidenceSummary:{evidenceMessageIds:['c1','s1'],sectionConfidence:{interaction:'strongly_inferred',need:'strongly_inferred',journey:'strongly_inferred',attribution:'proven',lostOpportunity:'strongly_inferred'}},
    review:{required:false,reasons:[]},
  };
}

describe('conversation evaluation order confirmation 9I',()=>{
  it('awards full only when applicable protocol is complete',()=>{
    expect(analyzeConversationEvaluationOrderConfirmation(v()).item)
      .toMatchObject({selectedOption:'full',pointsEarned:10});
  });

  it('does not penalize a case where protocol was not reached',()=>{
    const x=v();x.coachingEvidence.protocolApplicability='not_reached';x.coachingEvidence.protocolCompliant=false;x.coachingEvidence.missingProtocolSteps=['final_basket_summary','announced_total'];
    expect(analyzeConversationEvaluationOrderConfirmation(x).item)
      .toMatchObject({status:'not_applicable',pointsEarned:null});
  });

  it('treats missing total alone as minor missing',()=>{
    const x=v();x.coachingEvidence.protocolCompliant=false;x.coachingEvidence.missingProtocolSteps=['announced_total'];
    expect(analyzeConversationEvaluationOrderConfirmation(x).item)
      .toMatchObject({selectedOption:'minor_missing',pointsEarned:7});
  });

  it('treats missing basket summary or customer confirmation as important',()=>{
    const x=v();x.coachingEvidence.protocolCompliant=false;x.coachingEvidence.missingProtocolSteps=['final_basket_summary'];
    expect(analyzeConversationEvaluationOrderConfirmation(x).item)
      .toMatchObject({selectedOption:'important_missing',pointsEarned:0});
  });

  it('does not let a proven invoice erase missing confirmation behavior',()=>{
    const x=v();x.sale={...x.sale,outcome:'sale_proven',proofState:'proven',isSaleCountable:true};x.coachingEvidence.protocolCompliant=false;x.coachingEvidence.missingProtocolSteps=['customer_final_confirmation'];
    expect(analyzeConversationEvaluationOrderConfirmation(x).item)
      .toMatchObject({selectedOption:'important_missing',pointsEarned:0});
  });
});
