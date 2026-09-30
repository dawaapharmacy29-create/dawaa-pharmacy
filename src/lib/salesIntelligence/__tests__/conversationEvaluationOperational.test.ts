import { describe, expect, it } from 'vitest';
import type { CaseIntelligenceView } from '../types';
import { analyzeConversationEvaluationOperational } from '../conversationEvaluationOperational';
import type { ConversationEvaluationSystemEvidenceSnapshot } from '../conversationEvaluationSystemEvidence';

function view():CaseIntelligenceView{
 const v:any={
  version:'case-intelligence-v3',caseId:'c',conversationId:'conv',sourceCaseIdV22:null,
  interaction:{interactionId:'i',startedAt:'2026-09-28T09:00:00Z',endedAt:'2026-09-28T09:10:00Z',messageCount:2,meaningfulMessageCount:2,messageIds:['c1','s1'],messages:[
   {id:'c1',role:'customer',sender:'Customer',at:'2026-09-28T09:00:00Z',text:'الصنف ناقص؟',meaningful:true},
   {id:'s1',role:'staff',sender:'You',at:'2026-09-28T09:01:00Z',text:'هسجله لحضرتك ونتابع',meaningful:true},
  ],triggerMessageId:'c1',segmentationReason:null,caseType:'sales_opportunity',caseStatus:'sales_opportunity',confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]}},
  customer:{customerId:'cust',customerPhone:'01012345678',customerName:'عميل',customerCode:'2490',identityStatus:'resolved',blockers:[]},
  branch:{branchId:null,branchNameRaw:'فرع شكري'},staff:{participants:[{sender:'You',staffId:'staff-1',messageIds:['s1'],messageCount:1}],facts:[]},
  need:{caseId:'c',primaryNeed:'الصنف ناقص؟',primaryNeedMessageId:'c1',products:[],unlinkedAvailability:[],unlinkedAlternatives:[],objections:[],unresolvedNeed:false,needDeclined:false,needDeclineMessageIds:[],evidenceMessageIds:['c1'],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},needsHumanReview:false,humanReviewReasons:[]},
  products:[],basket:{versions:[],activeBasketId:null,activeItems:[],announcedTotal:null,confirmed:false},
  journey:{caseId:'c',currentState:'opportunity_open',stateHistory:[],evidenceMessageIds:[],ruleIds:[],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},reviewRequired:false},
  sale:{confirmationState:'unknown',summaryPresented:false,customerConfirmed:false,staffConfirmed:false,confirmationMessageIds:[],invoiceCandidateIds:[],selectedInvoiceId:null,selectedInvoiceNumber:null,attributionLevel:'unknown',proofState:'unknown',outcome:'open_opportunity',isSaleCountable:false,reasonCodes:[],contradictions:[]},
  unavailableDemand:[{demandKey:'d1',caseId:'c',conversationId:'conv',sourceCaseIdV22:null,customerId:'cust',customerIdentityStatus:'resolved',branchId:null,branchNameRaw:'فرع شكري',requestedAt:'2026-09-28T09:00:00Z',productKey:'bon',requestedProductRaw:'بون كير',resolvedProductId:null,quantityRequested:2,availabilityState:'unavailable',availabilityMessageId:'s1',statedByStaffName:'You',statedByStaffId:'staff-1',alternativeOffered:false,alternativeProductKey:null,alternativeProductRaw:null,alternativeProductId:null,alternativeOfferedByStaffName:null,alternativeOfferedByStaffId:null,alternativeResponse:null,followUpCandidate:true,followUpReason:'original_unavailable_no_alternative',followUpSuppressedBy:null,evidenceMessageIds:['c1','s1'],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},blockers:[]}],
  lostOpportunity:{caseId:'c',state:'recoverable',waitingOn:'stock',reason:'stock_unavailable',stage:'availability',responsibility:'inventory',recoverability:'high',productKeys:['bon'],productLosses:[],staffFacts:[],evidenceMessageIds:['c1','s1'],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},explanation:'x'},
  followUp:{caseId:'c',decision:'actionable',notNeededReason:null,opportunities:[{followUpKey:'f',caseId:'c',customerId:'cust',status:'actionable',reason:'stock_unavailable',priority:'medium',productKey:'bon',productId:null,productRaw:'بون كير',quantity:2,demandKey:'d1',duePolicy:'when_in_stock',requestedDelayDays:null,dueAt:null,assignedRole:'branch_staff',assignedStaffId:'staff-1',assignedStaffName:null,goal:'offer_original_product_when_available',nextBestAction:'contact_customer_when_product_available',blocker:null,suppressedBy:null,evidenceMessageIds:['c1','s1'],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]}}]},
  coachingEvidence:{staffReplied:true,unansweredRequestMessageIds:[],alternativeOfferedProductKeys:[],unavailableWithoutAlternativeProductKeys:['bon'],delayComplaintMessageIds:[],clearClosing:false,protocolCompliant:false,missingProtocolSteps:[]},
  evidenceSummary:{evidenceMessageIds:['c1','s1'],sectionConfidence:{interaction:'strongly_inferred',need:'strongly_inferred',journey:'strongly_inferred',attribution:'unknown',lostOpportunity:'strongly_inferred'}},
  review:{required:false,reasons:[]},
 };
 return v;
}

function sys():ConversationEvaluationSystemEvidenceSnapshot{
 return{
  version:'conversation-evaluation-system-evidence-v1',caseId:'c',
  customerRequests:[],
  exceptionalFollowups:[],
  purchaseHistory:{invoices:[],priorInvoiceCount:0,lastPurchaseAt:null},
 };
}

describe('conversation evaluation operational 9J-B',()=>{
 it('scores timely complete matching request registration',()=>{
  const s=sys();s.customerRequests=[{identityMatched:true,staffMatched:true,minutesFromInteractionEnd:3,row:{id:'r1',customer_id:'cust',customer_code:'2490',customer_phone:'01012345678',branch:'فرع شكري',medicine_name:'بون كير',quantity:2,doctor_id:'staff-1',doctor_name:'دكتور',source_recorded_staff_id:null,created_by:null,created_by_name:null,requested_at:'2026-09-28T09:13:00Z',created_at:'2026-09-28T09:13:00Z',due_date:'2026-09-29',next_action_at:null,status:'open'}}];
  expect(analyzeConversationEvaluationOperational(view(),s).items.find(i=>i.key==='customer_request_registration'))
   .toMatchObject({selectedOption:'registered_complete',pointsEarned:15});
 });

 it('does not accept an old or other-doctor record as proof of registration',()=>{
  const s=sys();s.customerRequests=[{identityMatched:true,staffMatched:false,minutesFromInteractionEnd:3,row:{id:'r1',customer_id:'cust',customer_code:'2490',customer_phone:'01012345678',branch:'فرع شكري',medicine_name:'بون كير',quantity:2,doctor_id:'other',doctor_name:'دكتور آخر',source_recorded_staff_id:null,created_by:null,created_by_name:null,requested_at:'2026-09-28T09:13:00Z',created_at:'2026-09-28T09:13:00Z',due_date:'2026-09-29',next_action_at:null,status:'open'}}];
  expect(analyzeConversationEvaluationOperational(view(),s).items.find(i=>i.key==='customer_request_registration'))
   .toMatchObject({selectedOption:'promised_not_registered',pointsEarned:0});
 });

 it('recognizes and scores a documented exceptional followup only when conversation itself has a clear signal',()=>{
  const v=view();v.interaction.messages[0].text='أنا مريض سكر وباخد العلاج كل شهر';
  const s=sys();s.exceptionalFollowups=[{identityMatched:true,staffMatched:true,minutesFromInteractionEnd:5,row:{id:'f1',customer_id:'cust',customer_code:'2490',customer_phone:'01012345678',branch:'فرع شكري',request_type:'exceptional_followup',followup_type:null,request_source:null,followup_reason:'مريض مزمن - متابعة علاج السكر الشهري',request_details:'متابعة موعد الدواء بشكل شهري',followup_summary:null,requested_by_staff_id:'staff-1',staff_id:null,created_by:null,created_by_name:null,created_at:'2026-09-28T09:15:00Z'}}];
  expect(analyzeConversationEvaluationOperational(v,s).items.find(i=>i.key==='exceptional_followup_recognition'))
   .toMatchObject({selectedOption:'registered_correctly',pointsEarned:10});
 });

 it('does not apply purchase history merely because old invoices exist',()=>{
  const s=sys();s.purchaseHistory={priorInvoiceCount:2,lastPurchaseAt:'2026-09-20T09:00:00Z',invoices:[{id:'i1',invoice_number:'1',customer_id:'cust',customer_code:'2490',invoice_datetime:'2026-09-20T09:00:00Z',branch_name:'فرع شكري',net_total:100}]};
  expect(analyzeConversationEvaluationOperational(view(),s).items.find(i=>i.key==='purchase_history_usage'))
   .toMatchObject({status:'not_applicable',pointsEarned:null});
 });

 it('scores ignored history only when the current conversation explicitly makes prior history relevant',()=>{
  const v=view();v.interaction.messages[0].text='عايز نفس اللي كنت باخده المرة اللي فاتت';
  const s=sys();s.purchaseHistory={priorInvoiceCount:1,lastPurchaseAt:'2026-09-20T09:00:00Z',invoices:[{id:'i1',invoice_number:'1',customer_id:'cust',customer_code:'2490',invoice_datetime:'2026-09-20T09:00:00Z',branch_name:'فرع شكري',net_total:100}]};
  expect(analyzeConversationEvaluationOperational(v,s).items.find(i=>i.key==='purchase_history_usage'))
   .toMatchObject({selectedOption:'ignored',pointsEarned:0});
 });
});
