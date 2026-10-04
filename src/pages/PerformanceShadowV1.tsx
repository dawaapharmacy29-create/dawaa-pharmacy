import { useEffect, useMemo, useState } from 'react';
import { FlaskConical, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useStaffDirectory } from '@/hooks/useStaffDirectory';
import { mergeStaffChoices } from '@/lib/staffFallback';
import { isManagerRole, isDoctorRole } from '@/lib/security/userDataScope';
import { loadEmployeeMonthlyEvidence, type EmployeeMonthlyEvidence } from '@/lib/staff/employeeMonthlyEvidenceService';
import { evaluationCycleQueryBounds, evaluationCycleRangeFromLabel, latestClosedEvaluationCycleLabel } from '@/lib/evaluations/monthlyEvaluationCycle';

type Axis = { key: string; label: string; weight: number; score: number | null; coverage: string; confidence: 'high'|'medium'|'low'|'unavailable'; note: string };

function clamp(n:number){ return Math.max(0,Math.min(100,Math.round(n))); }
function confidence(samples:number, good=10){ return samples >= good ? 'high' as const : samples > 0 ? 'medium' as const : 'unavailable' as const; }

function buildAxes(e: EmployeeMonthlyEvidence): Axis[] {
  const a=e.coaching.attendance, c=e.coaching.conversation, f=e.coaching.followups, i=e.coaching.inventory, s=e.coaching.salesQuality;
  const attendanceResolved=Math.max(0,a.resolvedDays);
  const discipline=attendanceResolved ? clamp(100 - (a.absenceCases*15) - (a.veryLateCases*5) - (Math.max(0,a.lateCases-a.veryLateCases)*2) - (a.earlyLeaveCases*3)) : null;
  const customer=c.coreAverage===null ? null : clamp(c.coreAverage*10);
  const sales=s.conversation.sampleSufficient && s.conversation.salesQuality!==null ? clamp(s.conversation.salesQuality*10) : null;
  const follow=f.total>0 ? clamp(f.completionPct) : null;
  const inventoryMeasured=i.weekly.measuredWeeks>0 || i.stagnant.assignedItems>0;
  const inventory=inventoryMeasured ? clamp(
    ((i.weekly.measuredWeeks ? (i.weekly.onTrackWeeks+i.weekly.aheadWeeks)/i.weekly.measuredWeeks*100 : 100)*0.7) +
    ((i.stagnant.configuredTargets && i.stagnant.targetAchievementPct!==null ? i.stagnant.targetAchievementPct : 100)*0.3)
  ) : null;
  return [
    {key:'discipline',label:'الالتزام والانضباط',weight:15,score:discipline,coverage:attendanceResolved?`${attendanceResolved} يوم محسوم`:'لا توجد أيام محسومة',confidence:confidence(attendanceResolved,10),note:'من سجل الحضور المحسوم فقط؛ الحالات المعلقة لا تتحول لغياب.'},
    {key:'customer',label:'خدمة العميل',weight:20,score:customer,coverage:`${c.reviewCount} مراجعة`,confidence:confidence(c.reviewCount,c.minSamples),note:'من أبعاد خدمة العميل الأساسية فقط.'},
    {key:'sales',label:'جودة البيع والاستشارة',weight:20,score:sales,coverage:`${s.conversation.samples} عينة`,confidence:s.conversation.sampleSufficient?'high':s.conversation.samples?'low':'unavailable',note:'Shadow فقط؛ البيع الفعلي لا يساوي جودة الاستشارة.'},
    {key:'followups',label:'المتابعات',weight:15,score:follow,coverage:f.total?`${f.completed}/${f.total} مكتملة`:'لا توجد حالات مؤهلة ظاهرة',confidence:f.total?'medium':'unavailable',note:f.total?'يقيس التنفيذ من الحالات المسجلة.':'N/A وليس صفر.'},
    {key:'inventory',label:'المخزون',weight:15,score:inventory,coverage:`${i.weekly.measuredWeeks} أسبوع مقاس · ${i.stagnant.assignedItems} صنف مسند`,confidence:inventoryMeasured?(i.sourceStatus==='available'?'medium':'low'):'unavailable',note:'لا يعتبر النقص أو الراكد خطأ فرديًا بدون مسؤولية مثبتة.'},
    {key:'responsibility',label:'المسؤولية التشغيلية',weight:15,score:null,coverage:'لم يُربط Projection المسؤولية بعد',confidence:'unavailable',note:'متعمد: لا نستخدم Proxy أو نقاط قديمة حتى لا نصنع درجة وهمية.'},
  ];
}

export default function PerformanceShadowV1(){
  const {user}=useAuth();
  const manager=isManagerRole(user);
  const defaultCycle=latestClosedEvaluationCycleLabel(new Date());
  const [cycle,setCycle]=useState(defaultCycle);
  const [staffId,setStaffId]=useState('');
  const [evidence,setEvidence]=useState<EmployeeMonthlyEvidence|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const {data:dir=[]}=useStaffDirectory();
  const choices=useMemo(()=>mergeStaffChoices(dir.filter(x=>x.source!=='alias'&&x.active&&x.id&&x.name)),[dir]);
  const visible=useMemo(()=>manager?choices:choices.filter(x=>x.id===(user?.staffId||user?.id)),[choices,manager,user?.staffId,user?.id]);
  useEffect(()=>{if(!staffId&&visible.length)setStaffId(manager?visible[0].id:(user?.staffId||user?.id||visible[0].id));},[staffId,visible,manager,user?.staffId,user?.id]);
  useEffect(()=>{if(!staffId)return; const d=evaluationCycleQueryBounds(cycle); let dead=false; setLoading(true);setError(''); loadEmployeeMonthlyEvidence({staffId,...d}).then(x=>{if(!dead)setEvidence(x)}).catch(x=>{if(!dead)setError(x instanceof Error?x.message:'تعذر تحميل الأدلة')}).finally(()=>{if(!dead)setLoading(false)});return()=>{dead=true}},[staffId,cycle]);
  if(!isDoctorRole(user)&&!manager)return <div dir="rtl" className="p-6">هذه الصفحة متاحة للدكاترة والإدارة فقط.</div>;
  const axes=evidence?buildAxes(evidence):[];
  const blockers=axes.filter(x=>x.score===null||x.confidence==='low'||x.confidence==='unavailable');
  const allReady=Boolean(evidence?.ready)&&blockers.length===0;
  const overall=allReady?Math.round(axes.reduce((sum,x)=>sum+(x.score||0)*x.weight,0)/100):null;
  return <div dir="rtl" className="space-y-5 p-4 md:p-6">
    <div className="dawaa-card dawaa-card--raised p-5">
      <div className="flex items-center gap-3"><FlaskConical className="h-6 w-6"/><div><h1 className="dawaa-title text-xl">Performance Shadow V1</h1><p className="dawaa-body text-sm">نسخة اختبار غير مالية — لا تكتب نقاطًا أو حوافز أو Payroll.</p></div></div>
      <div className="mt-4 flex flex-wrap gap-3">{manager&&<select className="input-dark" value={staffId} onChange={e=>setStaffId(e.target.value)}>{visible.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>}<input className="input-dark" type="month" value={cycle} onChange={e=>setCycle(e.target.value)}/><div className="self-center text-xs dawaa-muted">الدورة: {evaluationCycleRangeFromLabel(cycle).displayLabel}</div></div>
    </div>
    {loading&&<div className="dawaa-card p-5">جاري بناء الـShadow من الأدلة الفعلية...</div>}
    {error&&<div className="dawaa-card p-5 text-red-300">{error}</div>}
    {evidence&&!loading&&<>
      <div className="dawaa-card p-5 flex items-center justify-between gap-4"><div><div className="text-sm dawaa-muted">Readiness</div><div className="mt-1 flex items-center gap-2 font-black">{allReady?<ShieldCheck className="h-5 w-5"/>:<ShieldAlert className="h-5 w-5"/>}{allReady?'READY':'NOT READY'}</div></div><div className="text-left"><div className="text-sm dawaa-muted">Shadow Score</div><div className="text-3xl font-black">{overall===null?'—':`${overall}/100`}</div></div></div>
      <div className="grid gap-3 md:grid-cols-2">{axes.map(x=><div key={x.key} className="dawaa-card p-4"><div className="flex justify-between gap-3"><div className="font-black">{x.label}</div><div className="text-sm">{x.score===null?'N/A':`${x.score}/100`} · وزن {x.weight}%</div></div><div className="mt-2 text-sm dawaa-muted">Coverage: {x.coverage}</div><div className="text-sm dawaa-muted">Confidence: {x.confidence}</div><div className="mt-2 text-xs dawaa-muted">{x.note}</div></div>)}</div>
      {!allReady&&<div className="dawaa-card p-5"><div className="font-black">لماذا التقييم غير جاهز؟</div><div className="mt-2 text-sm dawaa-muted">{blockers.map(x=>x.label).join('، ')||Object.keys(evidence.errors).join('، ')||'مصدر أساسي غير جاهز'}</div><div className="mt-2 text-xs dawaa-muted">دي نتيجة صحيحة في الـShadow: نقص الدليل لا يتحول إلى صفر.</div></div>}
    </>}
  </div>
}