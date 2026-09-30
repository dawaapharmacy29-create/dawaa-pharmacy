import { describe, expect, it } from 'vitest';
import { REVIEW_CRITERIA } from '@/lib/conversationReviews';
import {
  runSalesIntelligencePipeline,
  type SalesIntelligencePipelineInput,
} from '../salesIntelligencePipeline';
import { analyzeConversationEvaluation } from '../conversationEvaluation';

function pipeline(raw:string,overrides:Partial<SalesIntelligencePipelineInput>={}){
  const result=runSalesIntelligencePipeline({
    conversationId:'eval-conv',
    rawWhatsAppExportText:raw,
    customerIdHint:'cust-1',
    customerNameHint:'عميل اختبار',
    customerCodeHint:'100',
    customerIdentityStatus:'resolved',
    staffIdBySender:{You:'staff-1'},
    resolveInvoiceCandidates:()=>[],
    ...overrides,
  });
  expect(result.caseAnalyses.length).toBeGreaterThan(0);
  return result.caseAnalyses[0].caseIntelligence;
}

describe('final conversation evaluation orchestrator 9L',()=>{
  it('contains all 19 official criteria exactly once and in official rubric order',()=>{
    const view=pipeline(`[9/28/26, 9:00:00 AM] Customer: السلام عليكم عايز بون كير
[9/28/26, 9:00:05 AM] You: وعليكم السلام، أهلا بحضرتك، مع حضرتك د شبل
[9/28/26, 9:00:10 AM] You: بون كير متوفر يا فندم
[9/28/26, 9:00:15 AM] Customer: تمام`);
    const result=analyzeConversationEvaluation(view,null);
    expect(result.items).toHaveLength(19);
    expect(result.items.map((item)=>item.key)).toEqual(REVIEW_CRITERIA.map((item)=>item.key));
    expect(new Set(result.items.map((item)=>item.key)).size).toBe(19);
  });

  it('routes consultation and dosage to manual review and excludes both from automatic score',()=>{
    const view=pipeline(`[9/28/26, 9:00:00 AM] Customer: ابني 5 سنين عنده كحة، ينفع له الدواء ده؟
[9/28/26, 9:00:10 AM] You: أهلا بحضرتك يا فندم
[9/28/26, 9:00:20 AM] You: خليه ياخد 5 مل مرتين في اليوم بعد الأكل
[9/28/26, 9:00:30 AM] Customer: تمام`);
    const result=analyzeConversationEvaluation(view,null);
    expect(result.items.find((item)=>item.key==='consultation_quality')).toMatchObject({
      status:'manual_review_required',pointsEarned:null,source:'manual_clinical'
    });
    expect(result.items.find((item)=>item.key==='dosage_explanation')).toMatchObject({
      status:'manual_review_required',pointsEarned:null,source:'manual_clinical'
    });
    expect(result.summary.manualReviewRequiredCount).toBe(2);
    expect(result.summary.manualClinicalExcludedFromScore).toBe(true);
    const scoredKeys=result.items.filter((item)=>item.status==='assessed').map((item)=>item.key);
    expect(scoredKeys).not.toContain('consultation_quality');
    expect(scoredKeys).not.toContain('dosage_explanation');
  });

  it('does not convert missing system evidence into a zero for an applicable operational criterion',()=>{
    const view=pipeline(`[9/28/26, 9:00:00 AM] Customer: بون كير موجود؟
[9/28/26, 9:00:05 AM] You: الصنف مش متوفر حاليا، هسجله لحضرتك ونتابع أول ما يوصل`);
    const result=analyzeConversationEvaluation(view,null);
    const registration=result.items.find((item)=>item.key==='customer_request_registration');
    if(registration?.status!=='not_applicable'){
      expect(registration).toMatchObject({status:'insufficient_evidence',pointsEarned:null});
    }
  });

  it('uses only assessed applicable automatic points in the score and shows coverage separately',()=>{
    const view=pipeline(`[9/28/26, 9:00:00 AM] Customer: السلام عليكم
[9/28/26, 9:00:04 AM] You: وعليكم السلام، أهلا وسهلا بحضرتك، مع حضرتك د شبل من صيدليات دواء
[9/28/26, 9:00:08 AM] Customer: شكرا
[9/28/26, 9:00:12 AM] You: العفو يا فندم، نتشرف بخدمة حضرتك في أي وقت`);
    const result=analyzeConversationEvaluation(view,null);
    expect(result.summary.autoScore).not.toBeNull();
    expect(result.summary.assessedAutoMaxPoints).toBeGreaterThan(0);
    expect(result.summary.applicableAutoMaxPoints).toBeGreaterThanOrEqual(result.summary.assessedAutoMaxPoints);
    expect(result.summary.evidenceCoveragePercent).toBeGreaterThanOrEqual(0);
    expect(result.summary.evidenceCoveragePercent).toBeLessThanOrEqual(100);
    expect(result.summary.automaticReliabilityPercent).toBeLessThanOrEqual(result.summary.averageAssessmentConfidence);
  });

  it('classifies per-criterion performance on the approved 8.5/7 thresholds only when assessed',()=>{
    const view=pipeline(`[9/28/26, 9:00:00 AM] Customer: السلام عليكم
[9/28/26, 9:00:02 AM] You: وعليكم السلام أهلا بحضرتك، مع حضرتك د شبل من صيدليات دواء، تحت أمر حضرتك`);
    const result=analyzeConversationEvaluation(view,null);
    const speed=result.items.find((item)=>item.key==='first_response_speed');
    expect(speed?.normalizedScore10).toBe(10);
    expect(speed?.performanceBand).toBe('strength');
    for(const item of result.items.filter((row)=>row.status!=='assessed')){
      expect(item.normalizedScore10).toBeNull();
      expect(item.performanceBand).toBeNull();
    }
  });
});
