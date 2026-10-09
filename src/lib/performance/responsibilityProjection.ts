import type { CanonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';
import type { EvaluationMetricProjection } from '@/lib/evaluations/evaluationMetrics';
import { taskEvidenceSourcesForRole } from './performanceEvidenceApplicability';

export type ResponsibilityState='ready'|'insufficient'|'unavailable'|'pending';
export type ResponsibilityProjection={
  state:ResponsibilityState; score:number|null; coverage:string; confidence:'high'|'medium'|'low'|'unavailable'; reasons:string[];
};

export function buildResponsibilityProjection(role:CanonicalStaffRole, metric:EvaluationMetricProjection|null|undefined):ResponsibilityProjection{
  const expected=taskEvidenceSourcesForRole(role);
  if(!expected.length) return {state:'unavailable',score:null,coverage:'مصادر المسؤولية غير محددة لهذا الدور',confidence:'unavailable',reasons:['Role evidence applicability is not configured.']};
  if(!metric) return {state:'unavailable',score:null,coverage:`0/${expected.length} مصادر متاحة`,confidence:'unavailable',reasons:['Canonical task evidence projection is unavailable.']};
  if(metric.taskActiveCount>0) return {state:'pending',score:null,coverage:`${metric.taskResolvedCount} محسومة · ${metric.taskActiveCount} معلقة`,confidence:metric.dataConfidence,reasons:['Active assigned work is still unresolved.',...metric.confidenceReasons]};
  if(!metric.isTaskEvidenceReady) return {state:metric.dataConfidence==='unavailable'?'unavailable':'insufficient',score:null,coverage:`${metric.taskResolvedCount} حالة محسومة · تغطية ${metric.sourceCoverageRate??'—'}%`,confidence:metric.dataConfidence,reasons:metric.confidenceReasons};
  return {state:'ready',score:metric.taskCompletionRate,coverage:`${metric.taskCompletedCount}/${metric.taskResolvedCount} مكتملة · تغطية ${metric.sourceCoverageRate??'—'}%`,confidence:metric.dataConfidence,reasons:metric.confidenceReasons};
}
