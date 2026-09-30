import { describe, expect, it } from 'vitest';
import type { CaseIntelligenceView } from '../types';
import { analyzeConversationEvaluationSales } from '../conversationEvaluationSales';

function base(): CaseIntelligenceView {
  return {
    version:'case-intelligence-v3',
    caseId:'sale-case',conversationId:'conv',sourceCaseIdV22:null,
    interaction:{interactionId:'i',startedAt:'2026-09-28T09:00:00Z',endedAt:'2026-09-28T09:05:00Z',messageCount:2,meaningfulMessageCount:2,messageIds:['c1','s1'],messages:[
      {id:'c1',role:'customer',sender:'Customer',at:'2026-09-28T09:00:00Z',text:'عايز بون كير',meaningful:true},
      {id:'s1',role:'staff',sender:'You',at:'2026-09-28T09:00:10Z',text:'حاضر يا فندم',meaningful:true},
    ],triggerMessageId:'c1',segmentationReason:null,caseType:'sales_opportunity',caseStatus:'sales_opportunity',confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]}},
    customer:{customerId:'c',customerPhone:null,customerName:'عميل',customerCode:'1',identityStatus:'resolved',blockers:[]},
    branch:{branchId:null,branchNameRaw:'فرع شكري'},
    staff:{participants:[{sender:'You',staffId:'staff',messageIds:['s1'],messageCount:1}],facts:[]},
    need:{caseId:'sale-case',primaryNeed:'عايز بون كير',primaryNeedMessageId:'c1',products:[],unlinkedAvailability:[],unlinkedAlternatives:[],objections:[],unresolvedNeed:false,needDeclined:false,needDeclineMessageIds:[],evidenceMessageIds:['c1'],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},needsHumanReview:false,humanReviewReasons:[]},
    products:[],
    basket:{versions:[],activeBasketId:null,activeItems:[],announcedTotal:null,confirmed:false},
    journey:{caseId:'sale-case',currentState:'opportunity_open',stateHistory:[],evidenceMessageIds:[],ruleIds:[],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},reviewRequired:false} as any,
    sale:{confirmationState:'basket_in_progress',summaryPresented:false,customerConfirmed:false,staffConfirmed:false,confirmationMessageIds:[],invoiceCandidateIds:[],selectedInvoiceId:null,selectedInvoiceNumber:null,attributionLevel:'unknown',proofState:'unknown',outcome:'open_opportunity',isSaleCountable:false,reasonCodes:[],contradictions:[]},
    unavailableDemand:[],
    lostOpportunity:{caseId:'sale-case',state:'open',waitingOn:'staff',reason:null,stage:'closing',responsibility:'unknown',recoverability:'high',productKeys:[],productLosses:[],staffFacts:[],evidenceMessageIds:['c1','s1'],confidence:{level:'strongly_inferred',score:.8,evidence:[],ruleIds:[]},explanation:'open',} as any,
    followUp:{caseId:'sale-case',decision:'not_needed',opportunities:[],notNeededReason:null} as any,
    coachingEvidence:{staffReplied:true,unansweredRequestMessageIds:[],alternativeOfferedProductKeys:[],unavailableWithoutAlternativeProductKeys:[],delayComplaintMessageIds:[],clearClosing:false,protocolCompliant:false,missingProtocolSteps:[]},
    evidenceSummary:{evidenceMessageIds:['c1','s1'],sectionConfidence:{interaction:'strongly_inferred',need:'strongly_inferred',journey:'strongly_inferred',attribution:'unknown',lostOpportunity:'strongly_inferred'}},
    review:{required:false,reasons:[]},
  };
}

describe('conversation evaluation sales 9G', () => {
  it('does not award perfect closing merely because a trusted invoice proved the sale', () => {
    const v=base();
    v.sale={...v.sale,outcome:'sale_proven',proofState:'proven',isSaleCountable:true,selectedInvoiceId:'inv',selectedInvoiceNumber:'74966'};
    v.lostOpportunity={...v.lostOpportunity,state:'won',waitingOn:null};
    expect(analyzeConversationEvaluationSales(v).items.find(i=>i.key==='sales_closing'))
      .toMatchObject({selectedOption:'helped',pointsEarned:8});
  });

  it('awards clear closing when proven sale also has conversation confirmation', () => {
    const v=base();
    v.sale={...v.sale,outcome:'sale_proven',proofState:'proven',isSaleCountable:true,summaryPresented:true,customerConfirmed:true,staffConfirmed:true,confirmationMessageIds:['s1']};
    v.basket={...v.basket,confirmed:true};
    v.lostOpportunity={...v.lostOpportunity,state:'won',waitingOn:null};
    expect(analyzeConversationEvaluationSales(v).items.find(i=>i.key==='sales_closing'))
      .toMatchObject({selectedOption:'clear_order',pointsEarned:10});
  });

  it('marks a staff-caused lost opportunity as missed', () => {
    const v=base();
    v.lostOpportunity={...v.lostOpportunity,state:'lost',waitingOn:null,reason:'staff_no_response',responsibility:'staff',evidenceMessageIds:['c1']};
    expect(analyzeConversationEvaluationSales(v).items.find(i=>i.key==='sales_closing'))
      .toMatchObject({selectedOption:'missed',pointsEarned:0});
  });

  it('never penalizes cross-sell when no extra product was actually offered', () => {
    expect(analyzeConversationEvaluationSales(base()).items.find(i=>i.key==='cross_sell_upsell'))
      .toMatchObject({status:'not_applicable',pointsEarned:null});
  });

  it('recognizes an accepted offered-only product as successful cross-sell structurally', () => {
    const v=base();
    v.products=[{
      productKey:'extra',productNameRaw:'منتج إضافي',productId:null,roles:['offered','accepted','final_basket'],requestedQuantity:null,offeredQuantity:1,finalQuantity:1,availability:'available',alternativeCount:0,alternativeResponses:[],inFinalBasket:true,demandKey:null,lossOutcome:null,lossReason:null,followUpKeys:[]
    }];
    v.need.products=[{
      key:'extra',productNameRaw:'منتج إضافي',productId:null,requestedQuantity:null,offeredQuantity:1,finalQuantity:1,roles:['offered','accepted','final_basket'],availability:'available',availabilityEvidence:[],alternatives:[],evidenceMessageIds:['s1'],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]}
    }];
    expect(analyzeConversationEvaluationSales(v).items.find(i=>i.key==='cross_sell_upsell'))
      .toMatchObject({selectedOption:'useful',pointsEarned:10});
  });
});
