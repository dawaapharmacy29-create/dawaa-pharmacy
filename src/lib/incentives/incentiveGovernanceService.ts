import { supabase } from '@/lib/supabase';

export type IncentiveCycleStatus = 'open' | 'preview' | 'manager_review' | 'finance_review' | 'approved' | 'paid' | 'reopened';
export type IncentiveCycle = { id: string; cycleStart: string; cycleEnd: string; status: IncentiveCycleStatus; rulesVersion: string; summary: Record<string, number>; lockedAt?: string | null };
export type IncentiveSnapshot = {
  id: string; cycleId: string; staffId: string; staffName: string; branch: string; role: string;
  performanceScore: number | null; approvedWeeks: number; dataCoveragePercent: number | null;
  performanceIncentive: number; targetAmount: number; salesAmount: number; targetAchievementPercent: number | null;
  targetBonus: number; otherIncentives: number; deductions: number; totalIncentive: number;
  eligible: boolean; eligibilityReasons: string[]; sourceSnapshot: Record<string, unknown>;
};
export type IncentiveAppeal = { id: string; cycleId: string; staffId: string; staffName: string; criterionKey?: string | null; reason: string; evidenceUrl?: string | null; status: string; resolution?: string | null; submittedAt: string };
export type IncentiveAudit = { id: number; cycleId: string; action: string; fromStatus?: string | null; toStatus?: string | null; actorName?: string | null; reason?: string | null; details: Record<string, unknown>; createdAt: string };
export type IncentiveRisk = { cycleId: string; riskType: string; severity: string; message: string; referenceId?: string | null };

const num = (value: unknown) => Number(value || 0);
const mapCycle = (r: any): IncentiveCycle => ({ id:r.id, cycleStart:r.cycle_start, cycleEnd:r.cycle_end, status:r.status, rulesVersion:r.rules_version, summary:r.summary_snapshot || {}, lockedAt:r.locked_at });
const mapSnapshot = (r:any): IncentiveSnapshot => ({ id:r.id,cycleId:r.cycle_id,staffId:r.staff_id,staffName:r.staff_name,branch:r.branch||'—',role:r.role||'—',performanceScore:r.performance_score==null?null:num(r.performance_score),approvedWeeks:num(r.approved_weeks),dataCoveragePercent:r.data_coverage_percent==null?null:num(r.data_coverage_percent),performanceIncentive:num(r.performance_incentive),targetAmount:num(r.target_amount),salesAmount:num(r.sales_amount),targetAchievementPercent:r.target_achievement_percent==null?null:num(r.target_achievement_percent),targetBonus:num(r.target_bonus),otherIncentives:num(r.other_incentives),deductions:num(r.deductions),totalIncentive:num(r.total_incentive),eligible:Boolean(r.eligible),eligibilityReasons:Array.isArray(r.eligibility_reasons)?r.eligibility_reasons:[],sourceSnapshot:r.source_snapshot||{} });

export async function fetchIncentiveGovernance() {
  const cyclesResult = await supabase.from('incentive_cycles').select('*').order('cycle_start',{ascending:false}).limit(24);
  if (cyclesResult.error) throw new Error(cyclesResult.error.message);
  const cycles = (cyclesResult.data || []).map(mapCycle);
  return { cycles };
}

export async function fetchIncentiveCycleDetails(cycleId: string) {
  const [snapshots, appeals, audit, risks] = await Promise.all([
    supabase.from('incentive_cycle_staff_snapshots').select('*').eq('cycle_id',cycleId).order('staff_name'),
    supabase.from('incentive_appeals').select('*').eq('cycle_id',cycleId).order('submitted_at',{ascending:false}),
    supabase.from('incentive_governance_audit').select('*').eq('cycle_id',cycleId).order('created_at',{ascending:false}),
    supabase.from('incentive_cycle_risks_v1').select('*').eq('cycle_id',cycleId),
  ]);
  for (const result of [snapshots, appeals, audit, risks]) if (result.error) throw new Error(result.error.message);
  return {
    snapshots:(snapshots.data||[]).map(mapSnapshot),
    appeals:(appeals.data||[]).map((r:any)=>({id:r.id,cycleId:r.cycle_id,staffId:r.staff_id,staffName:r.staff_name,criterionKey:r.criterion_key,reason:r.reason,evidenceUrl:r.evidence_url,status:r.status,resolution:r.resolution,submittedAt:r.submitted_at})) as IncentiveAppeal[],
    audit:(audit.data||[]).map((r:any)=>({id:r.id,cycleId:r.cycle_id,action:r.action,fromStatus:r.from_status,toStatus:r.to_status,actorName:r.actor_name,reason:r.reason,details:r.details||{},createdAt:r.created_at})) as IncentiveAudit[],
    risks:(risks.data||[]).map((r:any)=>({cycleId:r.cycle_id,riskType:r.risk_type,severity:r.severity,message:r.message,referenceId:r.reference_id})) as IncentiveRisk[],
  };
}

export async function transitionIncentiveCycle(cycleId:string,nextStatus:IncentiveCycleStatus,actor:{id:string;name:string},reason?:string) {
  const { error } = await supabase.rpc('transition_incentive_cycle',{p_cycle_id:cycleId,p_next_status:nextStatus,p_actor_staff_id:actor.id,p_actor_name:actor.name,p_reason:reason||null});
  if (error) throw new Error(error.message);
}

export async function submitIncentiveAppeal(input:{cycleId:string;staffId:string;staffName:string;criterionKey:string;reason:string;evidenceUrl?:string}) {
  const { error } = await supabase.rpc('submit_incentive_appeal',{p_cycle_id:input.cycleId,p_staff_id:input.staffId,p_staff_name:input.staffName,p_criterion_key:input.criterionKey,p_reason:input.reason,p_evidence_url:input.evidenceUrl||null});
  if (error) throw new Error(error.message);
}

export function buildGovernanceCsv(rows: IncentiveSnapshot[]) {
  const headers=['اسم الموظف','الوظيفة','الفرع','درجة الأداء','الأسابيع المعتمدة','تغطية البيانات %','حافز الأداء','التارجت','المبيعات','تحقيق التارجت %','حافز التارجت','حوافز أخرى','الخصومات','صافي الحافز','الأهلية','أسباب عدم الأهلية'];
  const quote=(v:unknown)=>`"${String(v??'').replace(/"/g,'""')}"`;
  return '\ufeff'+[headers,...rows.map(r=>[r.staffName,r.role,r.branch,r.performanceScore??'',r.approvedWeeks,r.dataCoveragePercent??'',r.performanceIncentive,r.targetAmount,r.salesAmount,r.targetAchievementPercent??'',r.targetBonus,r.otherIncentives,r.deductions,r.totalIncentive,r.eligible?'مؤهل':'يحتاج مراجعة',r.eligibilityReasons.join('؛ ')])].map(row=>row.map(quote).join(',')).join('\n');
}
