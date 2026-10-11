import type { CanonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';
import type { TaskEvidenceSourceType } from '@/lib/tasks/taskEvidence';
import type { TaskEvidenceSourceBatch } from '@/lib/tasks/taskCompletionProjection';
import { buildTaskCompletionProjection } from '@/lib/tasks/taskCompletionProjection';
import { buildEvaluationMetrics, type EvaluationMetricProjection } from '@/lib/evaluations/evaluationMetrics';
import { taskEvidenceSourcesForRole } from './performanceEvidenceApplicability';

export type PerformanceTaskEvidenceInput={
  staffId:string;
  branch:string;
  role:CanonicalStaffRole;
  batches:TaskEvidenceSourceBatch[];
};

function unavailableBatch(sourceType:TaskEvidenceSourceType,reason:string):TaskEvidenceSourceBatch{
  return {sourceType,availability:'unavailable',evidence:[],reason,observedAt:new Date().toISOString()};
}

/**
 * Pure production read-model composer.
 * Source readers/adapters stay upstream; this function never queries UI state,
 * writes points, incentives, payroll, or infers missing evidence as failure.
 */
export function buildPerformanceTaskEvidenceReadModel(input:PerformanceTaskEvidenceInput):EvaluationMetricProjection|null{
  const expected=taskEvidenceSourcesForRole(input.role);
  if(!expected.length)return null;
  const supplied=new Map(input.batches.map(batch=>[batch.sourceType,batch]));
  const batches=expected.map(sourceType=>supplied.get(sourceType)??unavailableBatch(sourceType,'Applicable evidence source was not supplied.'));
  const projections=buildTaskCompletionProjection(batches);
  let projection=projections.find(row=>row.subjectStaffId===input.staffId&&row.branch===input.branch);

  // No evidence row must still remain visible as unavailable/insufficient, never disappear into a zero.
  if(!projection){
    projection={
      subjectStaffId:input.staffId,branch:input.branch,completed:0,missed:0,active:0,cancelled:0,resolved:0,completionRate:null,onTimeCompleted:0,lateCompleted:0,
      sources:batches.map(batch=>({
        sourceType:batch.sourceType,availability:batch.availability,evidenceCount:0,resolvedCount:0,completedCount:0,missedCount:0,activeCount:0,cancelledCount:0,
        reason:batch.reason?.trim()||null,observedAt:batch.observedAt||null
      })),
      availableSourceCount:batches.filter(x=>x.availability==='available').length,
      partialSourceCount:batches.filter(x=>x.availability==='partial').length,
      unavailableSourceCount:batches.filter(x=>x.availability==='unavailable').length,
      hasUnavailableSources:batches.some(x=>x.availability==='unavailable')
    };
  }
  return buildEvaluationMetrics([projection],[{subjectStaffId:input.staffId,branch:input.branch,expectedSourceTypes:expected}])[0]??null;
}
