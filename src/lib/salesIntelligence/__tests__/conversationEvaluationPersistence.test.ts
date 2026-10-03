import { describe, expect, it } from 'vitest';
import type { CaseIntelligenceView } from '../types';
import type { ConversationEvaluationResult } from '../conversationEvaluation';
import {
  buildCaseConversationReviewPayload,
  persistAutomaticCaseConversationReviewWithClient,
} from '../conversationEvaluationPersistence';

function view(): CaseIntelligenceView {
  return {
    version: 'case-intelligence-v3',
    caseId: 'source-1:interaction:2',
    conversationId: 'source-1',
    sourceCaseIdV22: null,
    interaction: {
      interactionId: 'i2',
      startedAt: '2026-09-28T09:00:00.000Z',
      endedAt: '2026-09-28T09:05:00.000Z',
      messageCount: 2,
      meaningfulMessageCount: 2,
      messageIds: ['c1','s1'],
      messages: [
        { id:'c1', role:'customer', sender:'Customer', at:'2026-09-28T09:00:00.000Z', text:'طلب', meaningful:true },
        { id:'s1', role:'staff', sender:'You', at:'2026-09-28T09:00:05.000Z', text:'حاضر', meaningful:true },
      ],
      triggerMessageId:'c1',
      segmentationReason:null,
      caseType:'sales_opportunity',
      caseStatus:'sales_opportunity',
      confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},
    },
    customer:{customerId:'cust',customerPhone:'01000000000',customerName:'عميل',customerCode:'2490',identityStatus:'resolved',blockers:[]},
    branch:{branchId:null,branchNameRaw:'فرع شكري'},
    staff:{participants:[{sender:'You',staffId:'staff-1',messageIds:['s1'],messageCount:1}],facts:[]},
    need:{caseId:'source-1:interaction:2',primaryNeed:'طلب',primaryNeedMessageId:'c1',products:[],unlinkedAvailability:[],unlinkedAlternatives:[],objections:[],unresolvedNeed:false,needDeclined:false,needDeclineMessageIds:[],evidenceMessageIds:['c1'],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},needsHumanReview:false,humanReviewReasons:[]},
    products:[],
    basket:{versions:[],activeBasketId:null,activeItems:[],announcedTotal:null,confirmed:false},
    journey:{caseId:'source-1:interaction:2',currentState:'opportunity_open',stateHistory:[],evidenceMessageIds:[],ruleIds:[],confidence:{level:'strongly_inferred',score:.8,evidence:[],ruleIds:[]},reviewRequired:false} as any,
    sale:{confirmationState:'unknown',summaryPresented:false,customerConfirmed:false,staffConfirmed:false,confirmationMessageIds:[],invoiceCandidateIds:[],selectedInvoiceId:null,selectedInvoiceNumber:'74966',attributionLevel:'proven',proofState:'proven',outcome:'sale_proven',isSaleCountable:true,reasonCodes:[],contradictions:[]},
    unavailableDemand:[],
    lostOpportunity:{caseId:'source-1:interaction:2',state:'won',reason:null,responsibility:'unknown',recoverability:'none',productLosses:[],evidenceMessageIds:[],ruleIds:[],confidence:{level:'strongly_inferred',score:.9,evidence:[],ruleIds:[]},needsHumanReview:false,humanReviewReasons:[]} as any,
    followUp:{caseId:'source-1:interaction:2',decision:'not_needed',opportunities:[],notNeededReason:'sale_proven'} as any,
    coachingEvidence:{staffReplied:true,unansweredRequestMessageIds:[],alternativeOfferedProductKeys:[],unavailableWithoutAlternativeProductKeys:[],delayComplaintMessageIds:[],clearClosing:false,protocolCompliant:false,missingProtocolSteps:[]},
    evidenceSummary:{evidenceMessageIds:['c1','s1'],sectionConfidence:{interaction:'strongly_inferred',need:'strongly_inferred',journey:'strongly_inferred',attribution:'proven',lostOpportunity:'strongly_inferred'}},
    review:{required:false,reasons:[]},
  };
}

function evaluation(): ConversationEvaluationResult {
  const keys = [
    'first_response_speed','greeting','doctor_name','customer_name','tone','understanding',
    'followup_after_wait','consultation_quality','dosage_explanation','unavailable_items',
    'sales_closing','cross_sell_upsell','angry_customer','order_confirmation','order_delay_handling',
    'customer_request_registration','exceptional_followup_recognition','purchase_history_usage','closing_message',
  ] as const;
  return {
    version:'conversation-evaluation-v1',
    caseId:'source-1:interaction:2',
    items: keys.map((key, index) => ({
      key,
      label:key,
      status: key === 'consultation_quality' || key === 'dosage_explanation'
        ? 'manual_review_required'
        : index < 4 ? 'assessed' : 'not_applicable',
      source: key === 'consultation_quality' || key === 'dosage_explanation'
        ? 'manual_clinical'
        : 'automatic',
      selectedOption: index < 4 ? 'x' : null,
      selectedLabel:index < 4 ? 'تم التقييم' : 'غير منطبق',
      pointsEarned:index < 4 ? 5 : null,
      maxPoints:10,
      normalizedScore10:index < 4 ? 5 : null,
      performanceBand:index < 4 ? 'needs_development' : null,
      confidence:90,
      reason:`reason-${key}`,
      evidenceMessageIds:index < 4 ? ['c1','s1'] : [],
      systemRecordIds:[],
    })),
    summary:{
      autoScore:50,
      level:'حرجة',
      earnedAutoPoints:20,
      assessedAutoMaxPoints:40,
      applicableAutoMaxPoints:40,
      evidenceCoveragePercent:100,
      averageAssessmentConfidence:90,
      automaticReliabilityPercent:90,
      assessedCount:4,
      notApplicableCount:13,
      insufficientEvidenceCount:0,
      manualReviewRequiredCount:2,
      manualClinicalExcludedFromScore:true,
    },
  };
}

describe('case-level conversation evaluation persistence 9N-B', () => {
  it('uses the injected service client and fails closed before any write for a non-current case', async () => {
    const calls:string[]=[];
    const client={
      from(table:string){
        calls.push(table);
        const chain:any={
          select(){return chain;},
          eq(){return chain;},
          maybeSingle(){return Promise.resolve({data:null,error:null});},
        };
        return chain;
      }
    };
    const outcome=await persistAutomaticCaseConversationReviewWithClient(client,{
      sourceId:'source-1',
      view:view(),
      evaluation:evaluation(),
    });
    expect(outcome).toMatchObject({status:'skipped_non_current_case',reviewId:null});
    expect(calls).toEqual(['sales_intelligence_current_case_analyses']);
  });

  it('updates the existing automatic review in place and reactivates it after a valid re-analysis', async () => {
    const updates:any[]=[];
    const client={
      from(table:string){
        const chain:any={
          select(){return chain;},
          eq(){return chain;},
          update(payload:any){updates.push({table,payload});return chain;},
          maybeSingle(){
            if(table==='sales_intelligence_current_case_analyses') return Promise.resolve({data:{case_id:'source-1:interaction:2'},error:null});
            if(table==='sales_intelligence_cases') return Promise.resolve({data:{case_id:'source-1:interaction:2',conversation_id:'source-1'},error:null});
            if(table==='conversation_sales_reviews') return Promise.resolve({data:{id:'review-1',evaluation_kind:'automatic'},error:null});
            if(table==='staff') return Promise.resolve({data:{id:'staff-1',name:'د شبل',branch:'فرع شكري',branch_id:null,role:'doctor'},error:null});
            return Promise.resolve({data:null,error:null});
          },
          then(resolve:any){return resolve({data:null,error:null});},
        };
        return chain;
      }
    };
    const outcome=await persistAutomaticCaseConversationReviewWithClient(client,{
      sourceId:'source-1',
      view:view(),
      evaluation:evaluation(),
    });
    expect(outcome).toMatchObject({status:'updated',reviewId:'review-1',finalScore:50,error:null});
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe('conversation_sales_reviews');
    expect(updates[0].payload).toMatchObject({
      is_current:true,
      superseded_at:null,
      superseded_reason:null,
      final_score:50,
      automatic_evaluation_version:'conversation-evaluation-v1',
    });
  });

  it('creates a case-specific fingerprint and stores the full automatic snapshot', () => {
    const payload=buildCaseConversationReviewPayload({
      sourceId:'source-1',
      view:view(),
      evaluation:evaluation(),
      staffRow:{id:'staff-1',name:'د شبل',branch:'فرع شكري',branch_id:null,role:'doctor'},
    });
    expect(payload.sales_intelligence_case_id).toBe('source-1:interaction:2');
    expect(payload.submission_fingerprint).toBe('auto-case:source-1:source-1:interaction:2');
    expect(payload.automatic_evaluation_version).toBe('conversation-evaluation-v1');
    expect(payload.automatic_evaluation_json.items).toHaveLength(19);
    expect(payload.evidence_coverage_percent).toBe(100);
  });

  it('never creates doctor points or penalties during the conversation-analysis stage', () => {
    const payload=buildCaseConversationReviewPayload({
      sourceId:'source-1',
      view:view(),
      evaluation:evaluation(),
      staffRow:{id:'staff-1',name:'د شبل',branch:'فرع شكري',branch_id:null,role:'doctor'},
    });
    expect(payload.point_impact).toBe(0);
    expect(payload.doctor_points_impact).toBe(0);
    expect(payload.base_points_impact).toBe(0);
    expect(payload.extra_penalty_points).toBe(0);
    expect(payload.positive_points).toBe(0);
    expect(payload.negative_points).toBe(0);
  });

  it('never writes automatic medical consultation or dosage scores', () => {
    const payload=buildCaseConversationReviewPayload({
      sourceId:'source-1',
      view:view(),
      evaluation:evaluation(),
      staffRow:{id:'staff-1',name:'د شبل',branch:'فرع شكري',branch_id:null,role:'doctor'},
    });
    expect(payload.consultation_quality_score).toBeNull();
    expect(payload.dosage_explanation_score).toBeNull();
    expect(payload.manual_clinical_review_required).toBe(true);
  });

  it('maps automatic criterion scores only from actually assessed evidence', () => {
    const payload=buildCaseConversationReviewPayload({
      sourceId:'source-1',
      view:view(),
      evaluation:evaluation(),
      staffRow:{id:'staff-1',name:'د شبل',branch:'فرع شكري',branch_id:null,role:'doctor'},
    });
    expect(payload.response_speed_score).toBe(5);
    expect(payload.greeting_score).toBe(5);
    expect(payload.tone_language_score).toBeNull();
  });
});
