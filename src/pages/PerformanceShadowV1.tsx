import { useEffect, useMemo, useState } from 'react';
import { FlaskConical, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useStaffDirectory } from '@/hooks/useStaffDirectory';
import { mergeStaffChoices } from '@/lib/staffFallback';
import { isManagerRole, isDoctorRole } from '@/lib/security/userDataScope';
import { loadEmployeeMonthlyEvidence, type EmployeeMonthlyEvidence } from '@/lib/staff/employeeMonthlyEvidenceService';
import { evaluationCycleQueryBounds, evaluationCycleRangeFromLabel, latestClosedEvaluationCycleLabel } from '@/lib/evaluations/monthlyEvaluationCycle';
import { filterPerformanceScope, type PerformanceScope } from '@/lib/performance/performanceScope';
import { buildPerformanceShadow } from '@/lib/performance/performanceShadowModel';

type ScopeFilter = PerformanceScope;

export default function PerformanceShadowV1(){
  const {user}=useAuth();
  const manager=isManagerRole(user);
  const defaultCycle=latestClosedEvaluationCycleLabel(new Date());
  const [cycle,setCycle]=useState(defaultCycle);
  const [staffId,setStaffId]=useState('');
  const [scope,setScope]=useState<ScopeFilter>('all');
  const [branch,setBranch]=useState('');
  const [evidence,setEvidence]=useState<EmployeeMonthlyEvidence|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const {data:dir=[]}=useStaffDirectory();
  const choices=useMemo(()=>mergeStaffChoices(dir.filter(x=>x.source!=='alias'&&x.active&&x.id&&x.name)),[dir]);
  const branches=useMemo(()=>[...new Set(choices.map(x=>String(x.branch||'').trim()).filter(Boolean))].sort(),[choices]);
  const scoped=useMemo(()=>filterPerformanceScope(choices,scope,branch),[choices,scope,branch]);
  const visible=useMemo(()=>manager?scoped:scoped.filter(x=>x.id===(user?.staffId||user?.id)),[scoped,manager,user?.staffId,user?.id]);
  const selected=useMemo(()=>choices.find(x=>x.id===staffId),[choices,staffId]);
  useEffect(()=>{if(!visible.some(x=>x.id===staffId)&&visible.length)setStaffId(manager?visible[0].id:(user?.staffId||user?.id||visible[0].id));},[staffId,visible,manager,user?.staffId,user?.id]);
  useEffect(()=>{if(!staffId)return; const d=evaluationCycleQueryBounds(cycle); let dead=false; setLoading(true);setError(''); loadEmployeeMonthlyEvidence({staffId,...d}).then(x=>{if(!dead)setEvidence(x)}).catch(x=>{if(!dead)setError(x instanceof Error?x.message:'تعذر تحميل الأدلة')}).finally(()=>{if(!dead)setLoading(false)});return()=>{dead=true}},[staffId,cycle]);
  if(!isDoctorRole(user)&&!manager)return <div dir="rtl" className="p-6">هذه الصفحة متاحة للدكاترة والإدارة فقط.</div>;
  const shadow=evidence?buildPerformanceShadow(evidence,selected?.role):null;
  const axes=shadow?.axes||[];
  const allReady=Boolean(shadow?.ready);
  const overall=shadow?.score??null;
  return <div dir="rtl" className="space-y-5 p-4 md:p-6">
    <div className="dawaa-card dawaa-card--raised p-5">
      <div className="flex items-center gap-3"><FlaskConical className="h-6 w-6"/><div><h1 className="dawaa-title text-xl">Performance Shadow V1</h1><p className="dawaa-body text-sm">نسخة اختبار غير مالية — لا تكتب نقاطًا أو حوافز أو Payroll.</p></div></div>
      <div className="mt-4 flex flex-wrap gap-3">{manager&&<><select className="input-dark" value={scope} onChange={e=>setScope(e.target.value as ScopeFilter)}><option value="all">كل الموظفين</option><option value="branch">كل فرع لوحده</option><option value="warehouse">المخزن</option><option value="delivery">الدليفري</option><option value="doctors">الدكاترة</option></select>{scope==='branch'&&<select className="input-dark" value={branch} onChange={e=>setBranch(e.target.value)}><option value="">اختر الفرع</option>{branches.map(b=><option key={b} value={b}>{b}</option>)}</select>}<select className="input-dark" value={staffId} onChange={e=>setStaffId(e.target.value)}>{visible.map(s=><option key={s.id} value={s.id}>{s.name} — {s.branch||'بدون فرع'}</option>)}</select></>}<input className="input-dark" type="month" value={cycle} onChange={e=>setCycle(e.target.value)}/><div className="self-center text-xs dawaa-muted">الدورة: {evaluationCycleRangeFromLabel(cycle).displayLabel}</div></div>{manager&&<div className="mt-3 text-xs dawaa-muted">النطاق الحالي: {scope==='all'?'كل الموظفين':scope==='branch'?(branch||'اختر فرعًا'):scope==='warehouse'?'المخزن':scope==='delivery'?'الدليفري':'الدكاترة'} · {visible.length} موظف</div>}
    </div>
    {loading&&<div className="dawaa-card p-5">جاري بناء الـShadow من الأدلة الفعلية...</div>}
    {error&&<div className="dawaa-card p-5 text-red-300">{error}</div>}
    {evidence&&!loading&&<>
      <div className="dawaa-card p-5 flex items-center justify-between gap-4"><div><div className="text-sm dawaa-muted">Readiness</div><div className="mt-1 flex items-center gap-2 font-black">{allReady?<ShieldCheck className="h-5 w-5"/>:<ShieldAlert className="h-5 w-5"/>}{allReady?'READY':'NOT READY'}</div></div><div className="text-left"><div className="text-sm dawaa-muted">Shadow Score</div><div className="text-3xl font-black">{overall===null?'—':`${overall}/100`}</div></div></div>
      <div className="grid gap-3 md:grid-cols-2">{axes.map(x=><div key={x.key} className="dawaa-card p-4"><div className="flex justify-between gap-3"><div className="font-black">{x.label}</div><div className="text-sm">{x.score===null?'N/A':`${x.score}/100`} · وزن {x.weight}%</div></div><div className="mt-2 text-sm dawaa-muted">Coverage: {x.coverage}</div><div className="text-sm dawaa-muted">Confidence: {x.confidence}</div><div className="mt-2 text-xs dawaa-muted">{x.note}</div></div>)}</div>
      {!allReady&&<div className="dawaa-card p-5"><div className="font-black">لماذا التقييم غير جاهز؟</div><div className="mt-2 text-sm dawaa-muted">{shadow?.blockers.join('، ')||Object.keys(evidence.errors).join('، ')||'مصدر أساسي غير جاهز'}</div><div className="mt-2 text-xs dawaa-muted">دي نتيجة صحيحة في الـShadow: نقص الدليل لا يتحول إلى صفر.</div></div>}
    </>}
  </div>
}