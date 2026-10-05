import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, Loader2, ShieldCheck, TrendingDown, TrendingUp, X } from 'lucide-react';
import { loadDoctorPerformanceIntelligence, type DoctorPerformanceIntelligence, type DoctorPerformanceMonth } from '@/lib/evaluations/doctorPerformanceIntelligenceService';

const fmt=(v:number|null,d=0)=>v===null?'غير متاح':v.toLocaleString('ar-EG',{maximumFractionDigits:d,minimumFractionDigits:d});
const pct=(v:number|null)=>v===null?'غير متاح':`${fmt(v,1)}%`;
const delta=(a:number|null,b:number|null)=>a===null||b===null||b===0?null:((a-b)/Math.abs(b))*100;
const coverageLabel=(m:DoctorPerformanceMonth)=>m.coverage==='available'?'متاح':m.coverage==='partial'?'جزئي':m.coverage==='not_applicable'?'غير منطبق':'غير متاح';
const confidenceLabel=(m:DoctorPerformanceMonth)=>m.confidence==='high'?'ثقة عالية':m.confidence==='medium'?'ثقة متوسطة':'ثقة منخفضة';

function comparisonBlockReason(current:DoctorPerformanceMonth,previous:DoctorPerformanceMonth){
 if(current.coverage==='not_applicable'||previous.coverage==='not_applicable') return 'المقارنة محجوبة لأن إحدى الدورتين تسبق أول Evidence موثوق.';
 if(!current.comparisonEligible) return current.comparisonReason;
 if(!previous.comparisonEligible) return previous.comparisonReason;
 return null;
}

function Metric({label,value,current,previous,blockedReason}:{label:string;value:string;current:number|null;previous:number|null;blockedReason:string|null}){
 const d=blockedReason?null:delta(current,previous);
 return <div className="rounded-xl border p-3" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-soft)'}}>
   <div className="text-[11px] font-black" style={{color:'var(--dawaa-theme-muted)'}}>{label}</div>
   <div className="mt-1 text-lg font-black" style={{color:'var(--dawaa-theme-heading)'}}>{value}</div>
   <div className="mt-1 flex items-start gap-1 text-[10px] font-bold" title={blockedReason||undefined} style={{color:d===null?'var(--dawaa-theme-muted)':d>=0?'var(--dawaa-status-success-text)':'var(--dawaa-status-danger-text)'}}>
     {d===null?null:d>=0?<TrendingUp size={12}/>:<TrendingDown size={12}/>}
     <span>{blockedReason?'المقارنة غير عادلة — اضغط/مرّر لمعرفة السبب':d===null?'لا توجد مقارنة رقمية موثوقة':`${d>=0?'+':''}${fmt(d,1)}% عن الدورة السابقة`}</span>
   </div>
 </div>
}

function MonthSummary({m}:{m:DoctorPerformanceMonth}){return <div className="rounded-xl border p-3" style={{borderColor:'var(--dawaa-theme-border)'}}>
 <div className="flex flex-wrap items-center justify-between gap-2">
  <div className="text-xs font-black" style={{color:'var(--dawaa-theme-heading)'}}>{m.displayLabel}</div>
  <div className="flex flex-wrap gap-2 text-[10px] font-black">
   <span className="rounded-full border px-2 py-1" style={{borderColor:'var(--dawaa-theme-border)'}}>{coverageLabel(m)}</span>
   <span className="rounded-full border px-2 py-1" style={{borderColor:'var(--dawaa-theme-border)'}}>{confidenceLabel(m)}</span>
  </div>
 </div>
 <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-bold sm:grid-cols-4">
  <span>المبيعات: {m.sales===null?'غير متاح':`${fmt(m.sales,0)} ج`}</span><span>الفواتير: {fmt(m.invoices)}</span>
  <span>العملاء: {fmt(m.customers)}</span><span>الساعات: {fmt(m.workedHours,1)}</span>
  <span>متوسط الفاتورة: {m.averageInvoice===null?'غير متاح':`${fmt(m.averageInvoice,0)} ج`}</span><span>مبيعات/ساعة: {m.salesPerHour===null?'غير متاح':`${fmt(m.salesPerHour,0)} ج`}</span>
  <span>المحادثات: {fmt(m.conversations)}</span><span>Conversion: {pct(m.conversionRate)}</span>
 </div>
 <div className="mt-3 rounded-lg border p-2 text-[10px] font-bold leading-5" style={{borderColor:'var(--dawaa-theme-border)',color:'var(--dawaa-theme-muted)'}}>
  {m.coverageReason} Evidence: بيع {m.salesEvidenceCount} · حضور {m.attendanceEvidenceCount} · محادثات {m.conversationEvidenceCount}.
 </div>
 </div>}

export default function DoctorPerformanceEye({staffId,staffName,cycleLabel}:{staffId:string;staffName:string;cycleLabel:string}){
 const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[data,setData]=useState<DoctorPerformanceIntelligence|null>(null),[error,setError]=useState('');
 useEffect(()=>{setData(null);setError('')},[staffId,cycleLabel]);
 async function show(){setOpen(true);if(data)return;setLoading(true);try{setData(await loadDoctorPerformanceIntelligence({staffId,staffName,cycleLabel}))}catch(e){setError(e instanceof Error?e.message:'تعذر تحميل أداء الدكتور')}finally{setLoading(false)}}
 const cur=data?.months[0],prev=data?.months[1];
 const blockedReason=cur&&prev?comparisonBlockReason(cur,prev):null;
 return <>
  <button type="button" onClick={()=>void show()} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black" style={{borderColor:'var(--dawaa-theme-border)',color:'var(--dawaa-theme-primary-strong)',background:'var(--dawaa-theme-soft)'}} title="عرض ذكاء أداء الدكتور"><Eye size={16}/> عين أداء الدكتور</button>
  {open?<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3" dir="rtl"><div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border p-4 shadow-2xl" style={{background:'var(--dawaa-theme-surface)',borderColor:'var(--dawaa-theme-border)'}}>
   <div className="flex items-start justify-between gap-3"><div><div className="text-lg font-black" style={{color:'var(--dawaa-theme-heading)'}}>عين أداء الدكتور — {staffName}</div><div className="mt-1 text-xs font-bold" style={{color:'var(--dawaa-theme-muted)'}}>مقارنة 3 دورات: حجم البيع + جودة التحويل + الكفاءة لكل ساعة، مع Coverage وConfidence قبل أي استنتاج</div></div><button onClick={()=>setOpen(false)}><X/></button></div>
   {loading?<div className="flex items-center justify-center gap-2 p-12 font-black"><Loader2 className="animate-spin"/> جاري بناء التحليل…</div>:error?<div className="p-8 text-center font-black">{error}</div>:cur&&prev?<>
    <div className="mt-4 rounded-xl border p-3" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-soft)'}}>
     <div className="flex items-start gap-2">
      {blockedReason?<AlertTriangle size={18}/>:<CheckCircle2 size={18}/>}
      <div><div className="text-xs font-black" style={{color:'var(--dawaa-theme-heading)'}}>{blockedReason?'المقارنة بين آخر دورتين محجوبة':'المقارنة بين آخر دورتين مؤهلة'}</div>
      <div className="mt-1 text-[11px] font-bold leading-5" style={{color:'var(--dawaa-theme-muted)'}}>{blockedReason||'الدورتان لديهما Coverage كافٍ وEvidence فعلي؛ يمكن عرض الاتجاهات الرقمية.'}</div></div>
     </div>
    </div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
     <Metric label="المبيعات الشهرية" value={cur.sales===null?'غير متاح':`${fmt(cur.sales)} ج`} current={cur.sales} previous={prev.sales} blockedReason={blockedReason}/>
     <Metric label="متوسط الفاتورة" value={cur.averageInvoice===null?'غير متاح':`${fmt(cur.averageInvoice)} ج`} current={cur.averageInvoice} previous={prev.averageInvoice} blockedReason={blockedReason}/>
     <Metric label="العملاء الفريدون" value={fmt(cur.customers)} current={cur.customers} previous={prev.customers} blockedReason={blockedReason}/>
     <Metric label="Conversion المحادثات" value={pct(cur.conversionRate)} current={cur.conversionRate} previous={prev.conversionRate} blockedReason={blockedReason}/>
     <Metric label="مبيعات لكل ساعة" value={cur.salesPerHour===null?'غير متاح':`${fmt(cur.salesPerHour)} ج/س`} current={cur.salesPerHour} previous={prev.salesPerHour} blockedReason={blockedReason}/>
     <Metric label="فواتير لكل ساعة" value={fmt(cur.invoicesPerHour,2)} current={cur.invoicesPerHour} previous={prev.invoicesPerHour} blockedReason={blockedReason}/>
     <Metric label="عملاء لكل ساعة" value={fmt(cur.customersPerHour,2)} current={cur.customersPerHour} previous={prev.customersPerHour} blockedReason={blockedReason}/>
     <Metric label="ساعات العمل المسجلة" value={cur.workedHours===null?'غير متاح':`${fmt(cur.workedHours,1)} س`} current={cur.workedHours} previous={prev.workedHours} blockedReason={blockedReason}/>
    </div>
    <div className="mt-4 space-y-2">{data!.months.map(m=><MonthSummary key={m.cycleLabel} m={m}/>)}</div>
    <div className="mt-4 rounded-xl border p-3 text-[11px] font-bold leading-6" style={{borderColor:'var(--dawaa-theme-border)',color:'var(--dawaa-theme-muted)'}}>
      <div className="flex items-center gap-2 font-black" style={{color:'var(--dawaa-theme-heading)'}}><ShieldCheck size={16}/> مصدر الحقيقة</div>
      هوية المبيعات: {cur.salesIdentity==='canonical'?'Canonical staff invoice truth':'المصدر غير متاح'}. لا يتحول غياب المصدر أو الدورة السابقة لأول Evidence إلى صفر. Conversion = المحادثات المراجعة التي تحولت لبيع ÷ المحادثات المراجعة، ويظهر فقط من الدليل المسجل.
      {data!.firstEvidenceDate?<div className="mt-1">أول Evidence موثوق داخل النطاق المتاح: {data!.firstEvidenceDate}.</div>:null}
    </div>
   </>:null}
  </div></div>:null}
 </>;
}
