import { describe, expect, it } from 'vitest';
import type { CaseIntelligenceView } from '../types';
import {
  buildConversationEvaluationSystemEvidenceSnapshot,
  systemIdentityMatches,
} from '../conversationEvaluationSystemEvidence';

function view():CaseIntelligenceView{
  return{
    version:'case-intelligence-v3',caseId:'c',conversationId:'conv',sourceCaseIdV22:null,
    interaction:{interactionId:'i',startedAt:'2026-09-28T09:00:00Z',endedAt:'2026-09-28T09:10:00Z',messageCount:1,meaningfulMessageCount:1,messageIds:['m1'],messages:[{id:'m1',role:'customer',sender:'Customer',at:'2026-09-28T09:00:00Z',text:'طلب',meaningful:true}],triggerMessageId:'m1',segmentationReason:null,caseType:'sales_opportunity',caseStatus:'sales_opportunity',confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]}},
    customer:{customerId:'cust-1',customerPhone:'01012345678',customerName:'عميل',customerCode:'2490',identityStatus:'resolved',blockers:[]},
    branch:{branchId:null,branchNameRaw:'فرع شكري'},
    staff:{participants:[{sender:'You',staffId:'staff-1',messageIds:[],messageCount:0}],facts:[]},
    need:{caseId:'c',primaryNeed:'طلب',primaryNeedMessageId:'m1',products:[],unlinkedAvailability:[],unlinkedAlternatives:[],objections:[],unresolvedNeed:false,needDeclined:false,needDeclineMessageIds:[],evidenceMessageIds:['m1'],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},needsHumanReview:false,humanReviewReasons:[]},
    products:[],basket:{versions:[],activeBasketId:null,activeItems:[],announcedTotal:null,confirmed:false},
    journey:{caseId:'c',currentState:'opportunity_open',stateHistory:[],evidenceMessageIds:[],ruleIds:[],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},reviewRequired:false} as any,
    sale:{confirmationState:'unknown',summaryPresented:false,customerConfirmed:false,staffConfirmed:false,confirmationMessageIds:[],invoiceCandidateIds:[],selectedInvoiceId:null,selectedInvoiceNumber:null,attributionLevel:'unknown',proofState:'unknown',outcome:'open_opportunity',isSaleCountable:false,reasonCodes:[],contradictions:[]},
    unavailableDemand:[],lostOpportunity:{caseId:'c',state:'open',waitingOn:null,reason:null,stage:'need',responsibility:'unknown',recoverability:'unknown',productKeys:[],productLosses:[],staffFacts:[],evidenceMessageIds:[],confidence:{level:'strongly_inferred',score:.8,evidence:[],ruleIds:[]},explanation:'x'} as any,
    followUp:{caseId:'c',decision:'not_needed',opportunities:[],notNeededReason:null} as any,
    coachingEvidence:{staffReplied:false,unansweredRequestMessageIds:[],alternativeOfferedProductKeys:[],unavailableWithoutAlternativeProductKeys:[],delayComplaintMessageIds:[],clearClosing:false,protocolCompliant:false,missingProtocolSteps:[]},
    evidenceSummary:{evidenceMessageIds:['m1'],sectionConfidence:{interaction:'strongly_inferred',need:'strongly_inferred',journey:'strongly_inferred',attribution:'unknown',lostOpportunity:'strongly_inferred'}},
    review:{required:false,reasons:[]},
  };
}

describe('conversation evaluation system evidence 9J-A',()=>{
  it('matches by canonical customer id before weaker identifiers',()=>{
    expect(systemIdentityMatches(view(),{customer_id:'cust-1',customer_code:'WRONG'})).toBe(true);
    expect(systemIdentityMatches(view(),{customer_id:'other',customer_code:'2490'})).toBe(false);
  });

  it('keeps only near-in-time request registrations and reports staff match',()=>{
    const snap=buildConversationEvaluationSystemEvidenceSnapshot(view(),{
      customerRequests:[
        {id:'r1',customer_id:'cust-1',customer_code:'2490',customer_phone:null,branch:'فرع شكري',medicine_name:'صنف',quantity:1,doctor_id:'staff-1',doctor_name:'دكتور',source_recorded_staff_id:null,created_by:null,created_by_name:null,requested_at:'2026-09-28T09:12:00Z',created_at:'2026-09-28T09:12:00Z',due_date:null,next_action_at:null,status:'open'},
        {id:'old',customer_id:'cust-1',customer_code:'2490',customer_phone:null,branch:'فرع شكري',medicine_name:'قديم',quantity:1,doctor_id:'staff-1',doctor_name:'دكتور',source_recorded_staff_id:null,created_by:null,created_by_name:null,requested_at:'2026-09-27T09:00:00Z',created_at:'2026-09-27T09:00:00Z',due_date:null,next_action_at:null,status:'open'},
      ]
    });
    expect(snap.customerRequests).toHaveLength(1);
    expect(snap.customerRequests[0].row.id).toBe('r1');
    expect(snap.customerRequests[0].staffMatched).toBe(true);
    expect(snap.customerRequests[0].minutesFromInteractionEnd).toBe(2);
  });

  it('keeps only exceptional followups near the interaction',()=>{
    const snap=buildConversationEvaluationSystemEvidenceSnapshot(view(),{
      exceptionalFollowups:[
        {id:'f1',customer_id:'cust-1',customer_code:'2490',customer_phone:null,branch:'فرع شكري',request_type:'exceptional_followup',followup_type:null,request_source:null,followup_reason:'مريض مزمن',request_details:'متابعة مهمة',followup_summary:null,requested_by_staff_id:'staff-1',staff_id:null,created_by:null,created_by_name:null,created_at:'2026-09-28T09:15:00Z'},
        {id:'normal',customer_id:'cust-1',customer_code:'2490',customer_phone:null,branch:'فرع شكري',request_type:'normal',followup_type:'daily',request_source:null,followup_reason:null,request_details:null,followup_summary:null,requested_by_staff_id:'staff-1',staff_id:null,created_by:null,created_by_name:null,created_at:'2026-09-28T09:15:00Z'},
      ]
    });
    expect(snap.exceptionalFollowups.map(x=>x.row.id)).toEqual(['f1']);
  });

  it('purchase history contains only invoices before the interaction',()=>{
    const snap=buildConversationEvaluationSystemEvidenceSnapshot(view(),{
      purchaseHistory:[
        {id:'old',invoice_number:'100',customer_id:'cust-1',customer_code:'2490',invoice_datetime:'2026-09-20T10:00:00Z',branch_name:'فرع شكري',net_total:100},
        {id:'current',invoice_number:'101',customer_id:'cust-1',customer_code:'2490',invoice_datetime:'2026-09-28T09:05:00Z',branch_name:'فرع شكري',net_total:200},
      ]
    });
    expect(snap.purchaseHistory.priorInvoiceCount).toBe(1);
    expect(snap.purchaseHistory.invoices[0].id).toBe('old');
  });
});
