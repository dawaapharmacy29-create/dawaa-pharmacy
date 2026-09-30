import { describe, expect, it } from 'vitest';
import type { CaseIntelligenceView } from '../types';
import { analyzeConversationEvaluationClosing } from '../conversationEvaluationClosing';

function v(messages:CaseIntelligenceView['interaction']['messages']):CaseIntelligenceView{
 return{
  version:'case-intelligence-v3',caseId:'c',conversationId:'conv',sourceCaseIdV22:null,
  interaction:{interactionId:'i',startedAt:messages[0]?.at||'2026-09-28T09:00:00Z',endedAt:messages[messages.length-1]?.at||null,messageCount:messages.length,meaningfulMessageCount:messages.filter(m=>m.meaningful).length,messageIds:messages.map(m=>m.id),messages,triggerMessageId:messages[0]?.id||null,segmentationReason:null,caseType:'sales_opportunity',caseStatus:'sales_opportunity',confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]}},
  customer:{customerId:'cust',customerPhone:null,customerName:'عميل',customerCode:'1',identityStatus:'resolved',blockers:[]},
  branch:{branchId:null,branchNameRaw:'فرع شكري'},staff:{participants:[],facts:[]},
  need:{caseId:'c',primaryNeed:'طلب',primaryNeedMessageId:messages.find(m=>m.role==='customer')?.id||null,products:[],unlinkedAvailability:[],unlinkedAlternatives:[],objections:[],unresolvedNeed:false,needDeclined:false,needDeclineMessageIds:[],evidenceMessageIds:[],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},needsHumanReview:false,humanReviewReasons:[]},
  products:[],basket:{versions:[],activeBasketId:null,activeItems:[],announcedTotal:null,confirmed:false},
  journey:{caseId:'c',currentState:'sale_proven',reachedStates:['sale_proven'],evidenceMessageIds:[],reasonCodes:[],confidence:{level:'proven',score:1,evidence:[],ruleIds:[]},reviewRequired:false},
  sale:{confirmationState:'commercial_confirmation_complete',summaryPresented:true,customerConfirmed:true,staffConfirmed:true,confirmationMessageIds:[],invoiceCandidateIds:[],selectedInvoiceId:'inv',selectedInvoiceNumber:'1',attributionLevel:'proven',proofState:'proven',outcome:'sale_proven',isSaleCountable:true,reasonCodes:[],contradictions:[]},
  unavailableDemand:[],
  lostOpportunity:{caseId:'c',state:'won',waitingOn:null,reason:null,stage:'closing',responsibility:'unknown',recoverability:'none',productKeys:[],productLosses:[],staffFacts:[],evidenceMessageIds:[],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},explanation:'won'},
  followUp:{caseId:'c',decision:'not_needed',opportunities:[],notNeededReason:'sale_proven'},
  coachingEvidence:{staffReplied:true,unansweredRequestMessageIds:[],alternativeOfferedProductKeys:[],unavailableWithoutAlternativeProductKeys:[],delayComplaintMessageIds:[],clearClosing:true,protocolCompliant:true,missingProtocolSteps:[],protocolApplicability:'applicable'},
  evidenceSummary:{evidenceMessageIds:messages.map(m=>m.id),sectionConfidence:{interaction:'strongly_inferred',need:'strongly_inferred',journey:'proven',attribution:'proven',lostOpportunity:'strongly_inferred'}},
  review:{required:false,reasons:[]},
 };
}

describe('conversation evaluation closing 9K',()=>{
 it('awards official close only when it appears near a genuinely completed interaction',()=>{
  const x=v([
   {id:'c1',role:'customer',sender:'Customer',at:'2026-09-28T09:00:00Z',text:'تمام',meaningful:true},
   {id:'s1',role:'staff',sender:'You',at:'2026-09-28T09:00:10Z',text:'جاري الارسال، نتشرف بخدمة حضرتك 24 ساعة',meaningful:true},
  ]);
  expect(analyzeConversationEvaluationClosing(x).item)
   .toMatchObject({selectedOption:'official',pointsEarned:5});
 });

 it('treats a simpler respectful close separately',()=>{
  const x=v([
   {id:'c1',role:'customer',sender:'Customer',at:'2026-09-28T09:00:00Z',text:'شكرا يا دكتور',meaningful:true},
   {id:'s1',role:'staff',sender:'You',at:'2026-09-28T09:00:10Z',text:'العفو يا فندم، تحت أمر حضرتك',meaningful:true},
  ]);
  expect(analyzeConversationEvaluationClosing(x).item)
   .toMatchObject({selectedOption:'respectful',pointsEarned:3});
 });

 it('does not penalize a still-open commercial interaction for missing closing',()=>{
  const x=v([
   {id:'c1',role:'customer',sender:'Customer',at:'2026-09-28T09:00:00Z',text:'محتاج الصنف',meaningful:true},
   {id:'s1',role:'staff',sender:'You',at:'2026-09-28T09:00:10Z',text:'لحظات هراجع',meaningful:true},
  ]);
  x.journey={...x.journey,currentState:'basket_building',reachedStates:['need_identified','basket_building']};
  x.sale={...x.sale,outcome:'open_opportunity',proofState:'unknown',isSaleCountable:false};
  x.lostOpportunity={...x.lostOpportunity,state:'open',waitingOn:'staff',recoverability:'high'};
  expect(analyzeConversationEvaluationClosing(x).item)
   .toMatchObject({status:'not_applicable',pointsEarned:null});
 });

 it('does not mistake the opening delivery-service phrase for a closing message',()=>{
  const x=v([
   {id:'s0',role:'staff',sender:'You',at:'2026-09-28T09:00:00Z',text:'أهلا بحضرتك، خدمة التوصيل متاحة على مدار 24 ساعة',meaningful:true},
   {id:'c1',role:'customer',sender:'Customer',at:'2026-09-28T09:01:00Z',text:'تمام',meaningful:true},
   {id:'s1',role:'staff',sender:'You',at:'2026-09-28T09:01:10Z',text:'تم تأكيد الطلب',meaningful:true},
  ]);
  expect(analyzeConversationEvaluationClosing(x).item)
   .toMatchObject({selectedOption:'none_completed',pointsEarned:0});
 });

 it('allows customer courtesy after the pharmacy close without invalidating the close',()=>{
  const x=v([
   {id:'s1',role:'staff',sender:'You',at:'2026-09-28T09:00:00Z',text:'نتشرف بخدمة حضرتك في أي وقت',meaningful:true},
   {id:'c1',role:'customer',sender:'Customer',at:'2026-09-28T09:00:10Z',text:'تسلم يا دكتور',meaningful:true},
  ]);
  expect(analyzeConversationEvaluationClosing(x).item)
   .toMatchObject({selectedOption:'official',pointsEarned:5});
 });

 it('invalidates a close when customer opens a new request afterwards',()=>{
  const x=v([
   {id:'s1',role:'staff',sender:'You',at:'2026-09-28T09:00:00Z',text:'نتشرف بخدمة حضرتك في أي وقت',meaningful:true},
   {id:'c1',role:'customer',sender:'Customer',at:'2026-09-28T09:00:10Z',text:'ممكن كمان أعرف سعر صنف تاني؟',meaningful:true},
  ]);
  expect(analyzeConversationEvaluationClosing(x).item)
   .toMatchObject({selectedOption:'none_completed',pointsEarned:0});
 });
});
