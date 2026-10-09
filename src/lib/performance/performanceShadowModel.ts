import { canonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';
import { evaluationProfileForRole } from '@/lib/evaluations/staffEvaluationProfilesV3';
import type { EmployeeMonthlyEvidence } from '@/lib/staff/employeeMonthlyEvidenceService';
import { buildResponsibilityProjection } from './responsibilityProjection';

export type ShadowConfidence='high'|'medium'|'low'|'unavailable';
export type ShadowAxisState='ready'|'insufficient'|'not_applicable'|'unavailable'|'pending'|'policy_pending';
export type ShadowAxis={key:string;label:string;weight:number;score:number|null;state:ShadowAxisState;coverage:string;confidence:ShadowConfidence;note:string};
export type ShadowReadiness={ready:boolean;score:number|null;blockers:string[];axes:ShadowAxis[]};
const clamp=(n:number)=>Math.max(0,Math.min(100,Math.round(n)));
const conf=(n:number,good=10):ShadowConfidence=>n>=good?'high':n>0?'medium':'unavailable';

export function buildPerformanceShadow(e:EmployeeMonthlyEvidence,roleValue?:unknown):ShadowReadiness{
 const role=canonicalStaffRole(roleValue);let axes:ShadowAxis[];
 if(role!=='doctor'){
  axes=evaluationProfileForRole(roleValue).sections.map(x=>({key:x.key,label:x.title,weight:x.weight,score:null,state:'unavailable',coverage:'في انتظار ربط Evidence الخاص بالدور',confidence:'unavailable',note:'لا توجد درجة افتراضية قبل ربط Evidence canonical.'}));
 }else{
  const a=e.coaching.attendance,c=e.coaching.conversation,f=e.coaching.followups,i=e.coaching.inventory,s=e.coaching.salesQuality;
  const attendanceResolved=Math.max(0,a.resolvedDays);
  const customerReady=c.sampleSufficient&&c.coreAverage!==null;
  const salesReady=s.conversation.sampleSufficient&&s.conversation.salesQuality!==null;
  const inventoryComplete=i.sourceStatus==='available'&&i.weekly.measuredWeeks>0&&i.stagnant.assignedItems>0&&i.stagnant.configuredTargets===i.stagnant.assignedItems&&i.stagnant.targetAchievementPct!==null;
  const responsibility=buildResponsibilityProjection(role,e.taskEvaluation);
  axes=[
   {key:'discipline',label:'الالتزام والانضباط',weight:15,score:null,state:'policy_pending',coverage:attendanceResolved?`${attendanceResolved} يوم محسوم · ${a.onTimeDays} في الموعد · ${a.lateCases+a.veryLateCases} تأخير · ${a.absenceCases} غياب مؤكد`:'لا توجد أيام محسومة',confidence:conf(attendanceResolved),note:'الدليل ظاهر لكن معادلة السياسة لم تعتمد بعد.'},
   {key:'customer',label:'خدمة العميل',weight:20,score:customerReady?clamp(c.coreAverage!*10):null,state:customerReady?'ready':c.reviewCount?'insufficient':'unavailable',coverage:`${c.reviewCount} مراجعة`,confidence:conf(c.reviewCount,c.minSamples),note:'لا Score بدون عينة كافية.'},
   {key:'sales',label:'جودة البيع والاستشارة',weight:20,score:salesReady?clamp(s.conversation.salesQuality!*10):null,state:salesReady?'ready':s.conversation.samples?'insufficient':'unavailable',coverage:`${s.conversation.samples} عينة`,confidence:salesReady?'high':s.conversation.samples?'low':'unavailable',note:'البيع الفعلي لا يساوي جودة الاستشارة.'},
   {key:'followups',label:'المتابعات',weight:15,score:f.total>0?clamp(f.completionPct):null,state:f.total>0?'ready':e.health.followups==='available'?'not_applicable':'unavailable',coverage:f.total?`${f.completed}/${f.total} مكتملة`:'لا توجد حالات مؤهلة ظاهرة',confidence:f.total?'medium':e.health.followups==='available'?'medium':'unavailable',note:f.total?'من الحالات المسجلة فقط.':'عدم وجود حالات لا يتحول إلى صفر.'},
   {key:'inventory',label:'المخزون',weight:15,score:inventoryComplete?clamp((((i.weekly.onTrackWeeks+i.weekly.aheadWeeks)/i.weekly.measuredWeeks)*100*.7)+(i.stagnant.targetAchievementPct!*.3)):null,state:inventoryComplete?'ready':i.sourceStatus==='unavailable'?'unavailable':'insufficient',coverage:`${i.weekly.measuredWeeks} أسبوع مقاس · ${i.stagnant.assignedItems} صنف مسند`,confidence:inventoryComplete?'medium':i.sourceStatus==='unavailable'?'unavailable':'low',note:'لا يوجد default 100 لأي جزء مفقود.'},
   {key:'responsibility',label:'المسؤولية التشغيلية',weight:15,score:responsibility.score,state:responsibility.state,coverage:responsibility.coverage,confidence:responsibility.confidence,note:responsibility.reasons.join(' · ')||'Canonical TaskEvidence projection.'}
  ];
 }
 const blockers=axes.filter(x=>x.state!=='ready'&&x.state!=='not_applicable').map(x=>x.label);
 const scorable=axes.filter(x=>x.state!=='not_applicable');
 const ready=Boolean(e.ready)&&scorable.length>0&&scorable.every(x=>x.state==='ready'&&x.score!==null);
 const weight=scorable.reduce((n,x)=>n+x.weight,0);
 const score=ready&&weight?Math.round(scorable.reduce((n,x)=>n+(x.score??0)*x.weight,0)/weight):null;
 return {ready,score,blockers,axes};
}
