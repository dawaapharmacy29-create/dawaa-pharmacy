import { canonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';
import { evaluationProfileForRole } from '@/lib/evaluations/staffEvaluationProfilesV3';
import type { EmployeeMonthlyEvidence } from '@/lib/staff/employeeMonthlyEvidenceService';

export type ShadowConfidence = 'high'|'medium'|'low'|'unavailable';
export type ShadowAxis = { key:string; label:string; weight:number; score:number|null; coverage:string; confidence:ShadowConfidence; note:string };
export type ShadowReadiness = { ready:boolean; score:number|null; blockers:string[]; axes:ShadowAxis[] };

const clamp=(n:number)=>Math.max(0,Math.min(100,Math.round(n)));
const confidence=(samples:number,good=10):ShadowConfidence=>samples>=good?'high':samples>0?'medium':'unavailable';

export function buildPerformanceShadow(e:EmployeeMonthlyEvidence, roleValue?:unknown):ShadowReadiness {
  const role=canonicalStaffRole(roleValue);
  let axes:ShadowAxis[];
  if(role!=='doctor'){
    const profile=evaluationProfileForRole(roleValue);
    axes=profile.sections.map(section=>({
      key:section.key,label:section.title,weight:section.weight,score:null,
      coverage:'في انتظار ربط Evidence الخاص بالدور',confidence:'unavailable',
      note:'لا توجد درجة افتراضية: سيظهر Score فقط بعد ربط Evidence canonical لهذا المحور.'
    }));
  } else {
    const a=e.coaching.attendance,c=e.coaching.conversation,f=e.coaching.followups,i=e.coaching.inventory,s=e.coaching.salesQuality;
    const attendanceResolved=Math.max(0,a.resolvedDays);
    const customer=c.coreAverage===null?null:clamp(c.coreAverage*10);
    const sales=s.conversation.sampleSufficient&&s.conversation.salesQuality!==null?clamp(s.conversation.salesQuality*10):null;
    const follow=f.total>0?clamp(f.completionPct):null;
    const inventoryMeasured=i.weekly.measuredWeeks>0||i.stagnant.assignedItems>0;
    const inventory=inventoryMeasured?clamp(
      ((i.weekly.measuredWeeks?(i.weekly.onTrackWeeks+i.weekly.aheadWeeks)/i.weekly.measuredWeeks*100:100)*0.7)+
      ((i.stagnant.configuredTargets&&i.stagnant.targetAchievementPct!==null?i.stagnant.targetAchievementPct:100)*0.3)
    ):null;
    axes=[
      {key:'discipline',label:'الالتزام والانضباط',weight:15,score:null,coverage:attendanceResolved?`${attendanceResolved} يوم محسوم · ${a.onTimeDays} في الموعد · ${a.lateCases+a.veryLateCases} تأخير · ${a.absenceCases} غياب مؤكد`:'لا توجد أيام محسومة',confidence:confidence(attendanceResolved,10),note:'Evidence فقط حتى اعتماد Metric/Policy عادلة؛ لا توجد معادلة خصم مؤقتة.'},
      {key:'customer',label:'خدمة العميل',weight:20,score:customer,coverage:`${c.reviewCount} مراجعة`,confidence:confidence(c.reviewCount,c.minSamples),note:'من أبعاد خدمة العميل الأساسية فقط.'},
      {key:'sales',label:'جودة البيع والاستشارة',weight:20,score:sales,coverage:`${s.conversation.samples} عينة`,confidence:s.conversation.sampleSufficient?'high':s.conversation.samples?'low':'unavailable',note:'Shadow فقط؛ البيع الفعلي لا يساوي جودة الاستشارة.'},
      {key:'followups',label:'المتابعات',weight:15,score:follow,coverage:f.total?`${f.completed}/${f.total} مكتملة`:'لا توجد حالات مؤهلة ظاهرة',confidence:f.total?'medium':'unavailable',note:f.total?'يقيس التنفيذ من الحالات المسجلة.':'N/A وليس صفر.'},
      {key:'inventory',label:'المخزون',weight:15,score:inventory,coverage:`${i.weekly.measuredWeeks} أسبوع مقاس · ${i.stagnant.assignedItems} صنف مسند`,confidence:inventoryMeasured?(i.sourceStatus==='available'?'medium':'low'):'unavailable',note:'لا يعتبر النقص أو الراكد خطأ فرديًا بدون مسؤولية مثبتة.'},
      {key:'responsibility',label:'المسؤولية التشغيلية',weight:15,score:null,coverage:'في انتظار TaskEvidence Projection',confidence:'unavailable',note:'لا نستخدم Proxy أو نقاط قديمة حتى لا نصنع درجة وهمية.'},
    ];
  }
  const blockers=axes.filter(x=>x.score===null||x.confidence==='low'||x.confidence==='unavailable').map(x=>x.label);
  const ready=Boolean(e.ready)&&blockers.length===0;
  const score=ready?Math.round(axes.reduce((sum,x)=>sum+(x.score??0)*x.weight,0)/100):null;
  return {ready,score,blockers,axes};
}
