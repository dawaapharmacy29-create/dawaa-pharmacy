import {
  REVIEW_CRITERIA,
  conversationLevel,
  type ReviewCriterionKey,
} from '@/lib/conversationReviews';
import type { CaseIntelligenceView } from './types';
import { analyzeConversationEvaluationFoundation } from './conversationEvaluationFoundation';
import { analyzeConversationEvaluationCore } from './conversationEvaluationCore';
import { analyzeConversationEvaluationFollowUp } from './conversationEvaluationFollowUp';
import { buildConversationClinicalReview } from './conversationClinicalReview';
import { analyzeConversationEvaluationAvailability } from './conversationEvaluationAvailability';
import { analyzeConversationEvaluationSales } from './conversationEvaluationSales';
import { analyzeConversationEvaluationServiceRecovery } from './conversationEvaluationServiceRecovery';
import { analyzeConversationEvaluationOrderConfirmation } from './conversationEvaluationOrderConfirmation';
import { analyzeConversationEvaluationOperational } from './conversationEvaluationOperational';
import { analyzeConversationEvaluationClosing } from './conversationEvaluationClosing';
import type { ConversationEvaluationSystemEvidenceSnapshot } from './conversationEvaluationSystemEvidence';

export type ConversationEvaluationFinalStatus =
  | 'assessed'
  | 'not_applicable'
  | 'insufficient_evidence'
  | 'manual_review_required';

export type ConversationPerformanceBand =
  | 'strength'
  | 'acceptable'
  | 'needs_development';

export interface ConversationEvaluationFinalItem {
  key: ReviewCriterionKey;
  label: string;
  status: ConversationEvaluationFinalStatus;
  source: 'automatic' | 'manual_clinical';
  selectedOption: string | null;
  selectedLabel: string;
  pointsEarned: number | null;
  maxPoints: number;
  normalizedScore10: number | null;
  performanceBand: ConversationPerformanceBand | null;
  confidence: number;
  reason: string;
  evidenceMessageIds: string[];
  systemRecordIds: string[];
}

export interface ConversationEvaluationSummary {
  autoScore: number | null;
  level: string | null;
  earnedAutoPoints: number;
  assessedAutoMaxPoints: number;
  applicableAutoMaxPoints: number;
  evidenceCoveragePercent: number;
  averageAssessmentConfidence: number;
  automaticReliabilityPercent: number;
  assessedCount: number;
  notApplicableCount: number;
  insufficientEvidenceCount: number;
  manualReviewRequiredCount: number;
  /** Medical consultation + dosage/usage are deliberately excluded from autoScore. */
  manualClinicalExcludedFromScore: true;
}

export interface ConversationEvaluationResult {
  version: 'conversation-evaluation-v1';
  caseId: string;
  items: ConversationEvaluationFinalItem[];
  summary: ConversationEvaluationSummary;
}

interface RawAssessment {
  key: ReviewCriterionKey | string;
  label: string;
  status: 'assessed' | 'not_applicable' | 'insufficient_evidence';
  selectedOption: string | null;
  selectedLabel: string;
  pointsEarned: number | null;
  maxPoints: number;
  confidence: number;
  reason: string;
  evidenceMessageIds: string[];
  systemRecordIds?: string[];
}

const criterionByKey = new Map(REVIEW_CRITERIA.map((criterion) => [criterion.key, criterion]));

function clamp(value:number,min=0,max=100){
  return Math.max(min,Math.min(max,Math.round(value)));
}

function band(points:number,maxPoints:number):{
  normalizedScore10:number;
  performanceBand:ConversationPerformanceBand;
}{
  const normalizedScore10=Math.round((points/Math.max(1,maxPoints))*100)/10;
  return{
    normalizedScore10,
    performanceBand:normalizedScore10>=8.5
      ?'strength'
      :normalizedScore10>=7
        ?'acceptable'
        :'needs_development',
  };
}

function normalizeAutomatic(item:RawAssessment):ConversationEvaluationFinalItem{
  const criterion=criterionByKey.get(item.key as ReviewCriterionKey);
  if(!criterion) throw new Error(`Unknown conversation evaluation criterion: ${item.key}`);
  const scored=item.status==='assessed' && item.pointsEarned!=null;
  const perf=scored?band(item.pointsEarned!,criterion.maxPoints):null;
  return{
    key:criterion.key,
    label:criterion.label,
    status:item.status,
    source:'automatic',
    selectedOption:item.selectedOption,
    selectedLabel:item.selectedLabel,
    pointsEarned:scored?item.pointsEarned:null,
    maxPoints:criterion.maxPoints,
    normalizedScore10:perf?.normalizedScore10??null,
    performanceBand:perf?.performanceBand??null,
    confidence:clamp(item.confidence),
    reason:item.reason,
    evidenceMessageIds:Array.from(new Set(item.evidenceMessageIds||[])),
    systemRecordIds:Array.from(new Set(item.systemRecordIds||[])),
  };
}

function clinicalItem(
  key:'consultation_quality'|'dosage_explanation',
  present:boolean,
  evidenceMessageIds:string[],
  reason:string
):ConversationEvaluationFinalItem{
  const criterion=criterionByKey.get(key)!;
  if(!present){
    return{
      key,label:criterion.label,status:'not_applicable',source:'manual_clinical',
      selectedOption:null,selectedLabel:'غير منطبق على المحادثة',pointsEarned:null,
      maxPoints:criterion.maxPoints,normalizedScore10:null,performanceBand:null,confidence:100,
      reason,evidenceMessageIds:[],systemRecordIds:[],
    };
  }
  return{
    key,label:criterion.label,status:'manual_review_required',source:'manual_clinical',
    selectedOption:null,selectedLabel:'مراجعة يدوية — بلا درجة آلية',pointsEarned:null,
    maxPoints:criterion.maxPoints,normalizedScore10:null,performanceBand:null,confidence:100,
    reason,evidenceMessageIds:Array.from(new Set(evidenceMessageIds)),systemRecordIds:[],
  };
}

/**
 * One final conversation analysis. It evaluates the conversation, NOT the doctor's monthly score.
 *
 * Scoring rule:
 * - only AUTOMATIC + ASSESSED criteria enter autoScore;
 * - not-applicable criteria are excluded;
 * - insufficient evidence is excluded from points but lowers evidence coverage;
 * - consultation and dosage/usage are always manual-only and never enter autoScore.
 */
export function analyzeConversationEvaluation(
  view:CaseIntelligenceView,
  systemEvidence:ConversationEvaluationSystemEvidenceSnapshot|null=null
):ConversationEvaluationResult{
  const foundation=analyzeConversationEvaluationFoundation(view);
  const core=analyzeConversationEvaluationCore(view);
  const followup=analyzeConversationEvaluationFollowUp(view);
  const clinical=buildConversationClinicalReview(view);
  const availability=analyzeConversationEvaluationAvailability(view);
  const sales=analyzeConversationEvaluationSales(view);
  const recovery=analyzeConversationEvaluationServiceRecovery(view);
  const orderConfirmation=analyzeConversationEvaluationOrderConfirmation(view);
  const operational=analyzeConversationEvaluationOperational(view,systemEvidence);
  const closing=analyzeConversationEvaluationClosing(view);

  const automaticRaw:RawAssessment[]=[
    ...foundation.items,
    ...core.items,
    followup.item,
    availability.item,
    ...sales.items,
    ...recovery.items,
    orderConfirmation.item,
    ...operational.items,
    closing.item,
  ] as RawAssessment[];

  const collected:ConversationEvaluationFinalItem[]=[
    ...automaticRaw.map(normalizeAutomatic),
    clinicalItem(
      'consultation_quality',
      clinical.consultation.present,
      clinical.consultation.evidenceMessageIds,
      clinical.consultation.reason
    ),
    clinicalItem(
      'dosage_explanation',
      clinical.dosageUsage.present,
      clinical.dosageUsage.evidenceMessageIds,
      clinical.dosageUsage.reason
    ),
  ];

  const byKey=new Map<ReviewCriterionKey,ConversationEvaluationFinalItem>();
  for(const item of collected){
    if(byKey.has(item.key)) throw new Error(`Duplicate conversation evaluation criterion: ${item.key}`);
    byKey.set(item.key,item);
  }

  const items=REVIEW_CRITERIA.map((criterion)=>{
    const item=byKey.get(criterion.key);
    if(!item) throw new Error(`Missing conversation evaluation criterion: ${criterion.key}`);
    return item;
  });
  if(items.length!==19) throw new Error(`Conversation evaluation must contain exactly 19 criteria, got ${items.length}`);

  const autoItems=items.filter((item)=>item.source==='automatic');
  const applicableAuto=autoItems.filter((item)=>item.status!=='not_applicable');
  const assessed=autoItems.filter((item)=>item.status==='assessed'&&item.pointsEarned!=null);

  const earnedAutoPoints=assessed.reduce((sum,item)=>sum+(item.pointsEarned??0),0);
  const assessedAutoMaxPoints=assessed.reduce((sum,item)=>sum+item.maxPoints,0);
  const applicableAutoMaxPoints=applicableAuto.reduce((sum,item)=>sum+item.maxPoints,0);

  const autoScore=assessedAutoMaxPoints>0
    ?clamp((earnedAutoPoints/assessedAutoMaxPoints)*100)
    :null;
  const evidenceCoveragePercent=applicableAutoMaxPoints>0
    ?clamp((assessedAutoMaxPoints/applicableAutoMaxPoints)*100)
    :100;
  const confidenceWeight=assessed.reduce((sum,item)=>sum+item.maxPoints,0);
  const averageAssessmentConfidence=confidenceWeight>0
    ?clamp(
      assessed.reduce((sum,item)=>sum+item.confidence*item.maxPoints,0)/confidenceWeight
    )
    :0;
  const automaticReliabilityPercent=clamp(
    (averageAssessmentConfidence*evidenceCoveragePercent)/100
  );

  return{
    version:'conversation-evaluation-v1',
    caseId:view.caseId,
    items,
    summary:{
      autoScore,
      level:autoScore==null?null:conversationLevel(autoScore),
      earnedAutoPoints,
      assessedAutoMaxPoints,
      applicableAutoMaxPoints,
      evidenceCoveragePercent,
      averageAssessmentConfidence,
      automaticReliabilityPercent,
      assessedCount:items.filter((item)=>item.status==='assessed').length,
      notApplicableCount:items.filter((item)=>item.status==='not_applicable').length,
      insufficientEvidenceCount:items.filter((item)=>item.status==='insufficient_evidence').length,
      manualReviewRequiredCount:items.filter((item)=>item.status==='manual_review_required').length,
      manualClinicalExcludedFromScore:true,
    },
  };
}
