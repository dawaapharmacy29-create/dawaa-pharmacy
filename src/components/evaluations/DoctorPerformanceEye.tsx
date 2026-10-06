import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Eye, FileText, Lightbulb, Loader2, PackageSearch, ShieldCheck, TrendingDown, TrendingUp, X } from 'lucide-react';
import { loadDoctorPerformanceIntelligence, type DoctorPerformanceIntelligence, type DoctorPerformanceMonth } from '@/lib/evaluations/doctorPerformanceIntelligenceService';
import { supabase } from '@/lib/supabase';
import { evaluationCycleRangeFromLabel } from '@/lib/evaluations/monthlyEvaluationCycle';

const fmt=(v:number|null,d=0)=>v===null?'غير متاح':v.toLocaleString('ar-EG',{maximumFractionDigits:d,minimumFractionDigits:d});
const pct=(v:number|null)=>v===null?'غير متاح':`${fmt(v,1)}%`;
const delta=(a:number|null,b:number|null)=>a===null||b===null||b===0?null:((a-b)/Math.abs(b))*100;
const coverageLabel=(m:DoctorPerformanceMonth)=>m.coverage==='available'?'متاح':m.coverage==='partial'?'جزئي':m.coverage==='not_applicable'?'غير منطبق':'غير متاح';
const confidenceLabel=(m:DoctorPerformanceMonth)=>m.confidence==='high'?'ثقة عالية':m.confidence==='medium'?'ثقة متوسطة':'ثقة منخفضة';

function comparisonBlockReason(current:DoctorPerformanceMonth,previous:DoctorPerformanceMonth){
 if(current.coverage==='not_applicable'||previous.coverage==='not_applicable') return 'المقارنة محجوبة لأن إحدى الدورتين تسبق أول Evidence موثوق.';
 if(!current.comparisonEligible) return current.comparisonReason;
 if(current.comparisonMode==='same_period') return current.comparisonSnapshot?null:'تعذر بناء نافذة Same-period موثوقة.';
 if(!previous.comparisonEligible) return previous.comparisonReason;
 return null;
}

function Metric({label,value,current,previous,blockedReason,samePeriod=false}:{label:string;value:string;current:number|null;previous:number|null;blockedReason:string|null;samePeriod?:boolean}){
 const d=blockedReason?null:delta(current,previous);
 return <div className="rounded-xl border p-3" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-soft)'}}>
   <div className="text-[11px] font-black" style={{color:'var(--dawaa-theme-muted)'}}>{label}</div>
   <div className="mt-1 text-lg font-black" style={{color:'var(--dawaa-theme-heading)'}}>{value}</div>
   <div className="mt-1 flex items-start gap-1 text-[10px] font-bold" title={blockedReason||undefined} style={{color:d===null?'var(--dawaa-theme-muted)':d>=0?'var(--dawaa-status-success-text)':'var(--dawaa-status-danger-text)'}}>
     {d===null?null:d>=0?<TrendingUp size={12}/>:<TrendingDown size={12}/>}
     <span>{blockedReason?'المقارنة غير عادلة — اضغط/مرّر لمعرفة السبب':d===null?'لا توجد مقارنة رقمية موثوقة':`${d>=0?'+':''}${fmt(d,1)}% ${samePeriod?'عن نفس الفترة من الدورة السابقة':'عن الدورة السابقة'}`}</span>
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
 const [evidenceOpen,setEvidenceOpen]=useState(false),[evidenceLoading,setEvidenceLoading]=useState(false),[evidenceError,setEvidenceError]=useState('');
 const [evidenceConversations,setEvidenceConversations]=useState<any[]>([]),[evidenceProducts,setEvidenceProducts]=useState<any[]>([]);
 const [evidenceFocus,setEvidenceFocus]=useState<'all'|'conversion'|'opportunity'|'availability'>('all');
 useEffect(()=>{setData(null);setError('')},[staffId,cycleLabel]);
 useEffect(()=>{
  if(!open)return;
  const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false)};
  window.addEventListener('keydown',onKeyDown);
  return()=>window.removeEventListener('keydown',onKeyDown);
 },[open]);
 async function show(){setOpen(true);if(data)return;setLoading(true);try{setData(await loadDoctorPerformanceIntelligence({staffId,staffName,cycleLabel}))}catch(e){setError(e instanceof Error?e.message:'تعذر تحميل أداء الدكتور')}finally{setLoading(false)}}
 async function loadEvidence(focus:'all'|'conversion'|'opportunity'|'availability'='all'){
  if(!cur||evidenceLoading)return;
  setEvidenceFocus(focus);
  if(evidenceOpen&&focus==='all'){setEvidenceOpen(false);return}
  setEvidenceOpen(true);
  if(evidenceConversations.length||evidenceProducts.length)return;
  setEvidenceLoading(true);setEvidenceError('');
  try{
   const range=evaluationCycleRangeFromLabel(cur.cycleLabel);
   const startDate=range.start.toISOString().slice(0,10);
   const endExclusive=range.endExclusive.toISOString().slice(0,10);
   const end=new Date(`${endExclusive}T12:00:00Z`);end.setUTCDate(end.getUTCDate()-1);
   const endDate=end.toISOString().slice(0,10);
   const [sources,products]=await Promise.all([
    supabase.from('whatsapp_review_sources').select('id,customer_name,customer_code,conversation_started_at,followup_required,invoice_match_status,matched_invoice_number,matched_invoice_value,review_status').eq('staff_id',staffId).gte('conversation_started_at',`${startDate}T00:00:00`).lte('conversation_started_at',`${endDate}T23:59:59`).order('conversation_started_at',{ascending:false}).limit(80),
    supabase.from('whatsapp_product_journey_detail_v1').select('source_id,customer_name,customer_code,product_name,current_stage,leakage_reason,next_action,invoice_match_status,matched_invoice_number,matched_invoice_value,confidence').eq('staff_id',staffId).eq('cycle_start',startDate).eq('cycle_end',endDate).limit(120)
   ]);
   if(sources.error)throw sources.error;if(products.error)throw products.error;
   setEvidenceConversations(sources.data||[]);setEvidenceProducts(products.data||[]);
  }catch(e){setEvidenceError(e instanceof Error?e.message:'تعذر تحميل الأدلة التفصيلية')}finally{setEvidenceLoading(false)}
 }
 const cur=data?.months[0],prev=data?.months[1];
 const blockedReason=cur&&prev?comparisonBlockReason(cur,prev):null;
 const snap=cur?.comparisonMode==='same_period'?cur.comparisonSnapshot:null;
 const nonSalesComparisonReason=snap?'الدورة جارية: لا يظهر Delta لهذا المؤشر حتى تتوفر له نافذة Same-period مساوية وموثوقة.':blockedReason;
 const cmp=(fullCurrent:number|null,fullPrevious:number|null,sameCurrent:number|null|undefined,samePrevious:number|null|undefined)=>
   snap?[sameCurrent??null,samePrevious??null] as const:[fullCurrent,fullPrevious] as const;
 const visibleConversations=evidenceFocus==='opportunity'?evidenceConversations.filter(item=>item.followup_required||item.invoice_match_status!=='verified'):evidenceConversations;
 const visibleProducts=evidenceFocus==='opportunity'?evidenceProducts.filter(item=>Boolean(item.leakage_reason)||Boolean(item.next_action)):evidenceFocus==='availability'?evidenceProducts.filter(item=>String(item.current_stage||'').toLowerCase().includes('unavailable')||String(item.leakage_reason||'').toLowerCase().includes('unavailable')||String(item.leakage_reason||'').includes('غير متاح')):evidenceProducts;
 return <>
  <button type="button" onClick={()=>void show()} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black" style={{borderColor:'var(--dawaa-theme-border)',color:'var(--dawaa-theme-primary-strong)',background:'var(--dawaa-theme-soft)'}} title="عرض ذكاء أداء الدكتور"><Eye size={16}/> عين أداء الدكتور</button>
  {open?<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3" dir="rtl" role="dialog" aria-modal="true" onMouseDown={(event)=>{if(event.target===event.currentTarget)setOpen(false)}}><div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border p-4 shadow-2xl" onMouseDown={(event)=>event.stopPropagation()} style={{background:'var(--dawaa-theme-surface)',borderColor:'var(--dawaa-theme-border)'}}>
   <div className="flex items-start justify-between gap-3"><div><div className="text-lg font-black" style={{color:'var(--dawaa-theme-heading)'}}>عين أداء الدكتور — {staffName}</div><div className="mt-1 text-xs font-bold" style={{color:'var(--dawaa-theme-muted)'}}>مقارنة 3 دورات: حجم البيع + جودة التحويل + الكفاءة لكل ساعة، مع Coverage وConfidence قبل أي استنتاج</div></div><button onClick={()=>setOpen(false)}><X/></button></div>
   {loading?<div className="flex items-center justify-center gap-2 p-12 font-black"><Loader2 className="animate-spin"/> جاري بناء التحليل…</div>:error?<div className="p-8 text-center font-black">{error}</div>:cur&&prev?<>
    <div className="mt-4 rounded-xl border p-3" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-soft)'}}>
     <div className="flex items-start gap-2">
      {blockedReason?<AlertTriangle size={18}/>:<CheckCircle2 size={18}/>}
      <div><div className="text-xs font-black" style={{color:'var(--dawaa-theme-heading)'}}>{blockedReason?'المقارنة بين آخر دورتين محجوبة':cur.comparisonMode==='same_period'?`مقارنة عادلة — أول ${cur.comparisonSnapshot?.days||0} يوم من كل دورة${cur.comparisonSnapshot?.dataAsOf?` · البيانات حتى ${cur.comparisonSnapshot.dataAsOf}`:''}`:'المقارنة بين آخر دورتين مؤهلة'}</div>
      <div className="mt-1 text-[11px] font-bold leading-5" style={{color:'var(--dawaa-theme-muted)'}}>{blockedReason||'الدورتان لديهما Coverage كافٍ وEvidence فعلي؛ يمكن عرض الاتجاهات الرقمية.'}</div></div>
     </div>
    </div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
     <Metric label="المبيعات الشهرية" value={cur.sales===null?'غير متاح':`${fmt(cur.sales)} ج`} current={cmp(cur.sales,prev.sales,snap?.sales,snap?.previousSales)[0]} previous={cmp(cur.sales,prev.sales,snap?.sales,snap?.previousSales)[1]} blockedReason={blockedReason} samePeriod={cur.comparisonMode==='same_period'}/>
     <Metric label="متوسط الفاتورة" value={cur.averageInvoice===null?'غير متاح':`${fmt(cur.averageInvoice)} ج`} current={cmp(cur.averageInvoice,prev.averageInvoice,snap?.averageInvoice,snap?.previousAverageInvoice)[0]} previous={cmp(cur.averageInvoice,prev.averageInvoice,snap?.averageInvoice,snap?.previousAverageInvoice)[1]} blockedReason={blockedReason} samePeriod={cur.comparisonMode==='same_period'}/>
     <Metric label="العملاء الفريدون" value={fmt(cur.customers)} current={cmp(cur.customers,prev.customers,snap?.customers,snap?.previousCustomers)[0]} previous={cmp(cur.customers,prev.customers,snap?.customers,snap?.previousCustomers)[1]} blockedReason={blockedReason} samePeriod={cur.comparisonMode==='same_period'}/>
     <Metric label="Conversion المحادثات" value={pct(cur.conversionRate)} current={cur.conversionRate} previous={prev.conversionRate} blockedReason={nonSalesComparisonReason}/>
     <Metric label="مبيعات لكل ساعة" value={cur.salesPerHour===null?'غير متاح':`${fmt(cur.salesPerHour)} ج/س`} current={cur.salesPerHour} previous={prev.salesPerHour} blockedReason={nonSalesComparisonReason}/>
     <Metric label="فواتير لكل ساعة" value={fmt(cur.invoicesPerHour,2)} current={cur.invoicesPerHour} previous={prev.invoicesPerHour} blockedReason={nonSalesComparisonReason}/>
     <Metric label="عملاء لكل ساعة" value={fmt(cur.customersPerHour,2)} current={cur.customersPerHour} previous={prev.customersPerHour} blockedReason={nonSalesComparisonReason}/>
     <Metric label="ساعات العمل المسجلة" value={cur.workedHours===null?'غير متاح':`${fmt(cur.workedHours,1)} س`} current={cur.workedHours} previous={prev.workedHours} blockedReason={nonSalesComparisonReason}/>
    </div>
    <div className="mt-4 rounded-xl border p-3" style={{borderColor:'var(--dawaa-theme-border)'}}>
     <div className="flex items-center gap-2 text-sm font-black" style={{color:'var(--dawaa-theme-heading)'}}><Lightbulb size={17}/> التشخيص الذكي — الدورة الحالية</div>
     <div className="mt-3 grid gap-2 md:grid-cols-2">
      {cur.diagnoses.map((d,index)=><button type="button" onClick={()=>void loadEvidence(d.kind==='conversion'?'conversion':d.kind==='opportunity'?'opportunity':d.kind==='customer_impact'&&d.title.includes('التوافر')?'availability':'all')} key={`${d.kind}-${index}`} className="rounded-xl border p-3 text-right" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-soft)'}}>
       <div className="flex items-center justify-between gap-2"><div className="text-xs font-black" style={{color:'var(--dawaa-theme-heading)'}}>{d.title}</div><span className="text-[10px] font-black" style={{color:d.severity==='attention'?'var(--dawaa-status-danger-text)':d.severity==='positive'?'var(--dawaa-status-success-text)':'var(--dawaa-theme-muted)'}}>{d.severity==='attention'?'يحتاج انتباه':d.severity==='positive'?'إشارة إيجابية':'للمراجعة'}</span></div>
       <div className="mt-1 text-[11px] font-bold leading-5" style={{color:'var(--dawaa-theme-muted)'}}>{d.detail}</div>
       <div className="mt-2 flex flex-wrap gap-1">{d.evidence.map(e=><span key={e} className="rounded-full border px-2 py-1 text-[10px] font-bold" style={{borderColor:'var(--dawaa-theme-border)'}}>{e}</span>)}</div>
       <div className="mt-2 text-[10px] font-black" style={{color:'var(--dawaa-theme-primary-strong)'}}>عرض الدليل المرتبط ←</div>
      </button>)}
     </div>
    </div>
    <div className="mt-4 rounded-xl border p-3" style={{borderColor:'var(--dawaa-theme-border)'}}>
     <div className="text-sm font-black" style={{color:'var(--dawaa-theme-heading)'}}>Customer Impact — دليل العميل والفرص</div>
     {cur.customerImpact.available?<div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-bold sm:grid-cols-3 lg:grid-cols-5">
      <span>فرص تجارية: {fmt(cur.customerImpact.commercialConversations)}</span>
      <span>بيع مؤكد: {fmt(cur.customerImpact.verifiedSaleConversations)}</span>
      <span>إيراد مؤكد: {cur.customerImpact.verifiedRevenue===null?'غير متاح':`${fmt(cur.customerImpact.verifiedRevenue)} ج`}</span>
      <span>Conversion مؤكد: {pct(cur.customerImpact.verifiedConversionRate)}</span>
      <span>متابعات مطلوبة: {fmt(cur.customerImpact.followupsNeeded)}</span>
      <span>فقد بيع: {fmt(cur.customerImpact.saleLeakage)}</span>
      <span>عدم توافر: {fmt(cur.customerImpact.unavailableProducts)}</span>
      <span>ترشيحات مقبولة: {fmt(cur.customerImpact.acceptedProducts)}</span>
      <span>شكاوى: {fmt(cur.customerImpact.complaints)}</span>
     </div>:<div className="mt-2 text-[11px] font-bold" style={{color:'var(--dawaa-theme-muted)'}}>مصدر Customer Impact غير متاح؛ لن يتحول غيابه إلى صفر أو حكم سلبي.</div>}
    </div>
    <div className="mt-4 rounded-xl border p-3" style={{borderColor:'var(--dawaa-theme-border)'}}>
     <button type="button" onClick={()=>void loadEvidence('all')} className="flex w-full items-center justify-between gap-3 text-right">
      <div><div className="flex items-center gap-2 text-sm font-black" style={{color:'var(--dawaa-theme-heading)'}}><FileText size={16}/> Evidence Drill-down</div><div className="mt-1 text-[11px] font-bold" style={{color:'var(--dawaa-theme-muted)'}}>افتح الدليل الذي يقف خلف Customer Impact: العميل، المحادثة، الفاتورة، الصنف وسبب فقد البيع.</div></div>
      <ChevronDown size={17} className={evidenceOpen?'rotate-180 transition-transform':'transition-transform'}/>
     </button>
     {evidenceOpen?<div className="mt-3">
      {evidenceFocus!=='all'?<div className="mb-2 flex items-center justify-between rounded-lg border p-2 text-[10px] font-black" style={{borderColor:'var(--dawaa-theme-border)'}}><span>فلتر الدليل: {evidenceFocus==='conversion'?'التحويل والبيع المؤكد':evidenceFocus==='opportunity'?'فقد البيع والمتابعة':'التوافر وتأثيره'}</span><button type="button" onClick={()=>setEvidenceFocus('all')} style={{color:'var(--dawaa-theme-primary-strong)'}}>عرض كل الأدلة</button></div>:null}
      {evidenceLoading?<div className="flex items-center gap-2 p-4 text-xs font-black"><Loader2 size={15} className="animate-spin"/> جاري تحميل Evidence…</div>:evidenceError?<div className="rounded-lg border p-3 text-xs font-bold" style={{borderColor:'var(--dawaa-theme-border)'}}>{evidenceError}</div>:<div className="grid gap-3 lg:grid-cols-2">
       <div className="rounded-xl border p-2" style={{borderColor:'var(--dawaa-theme-border)'}}><div className="mb-2 flex items-center gap-2 text-xs font-black"><FileText size={14}/> المحادثات والفواتير</div><div className="max-h-80 space-y-2 overflow-y-auto">
        {visibleConversations.map(item=><div key={item.id} className="rounded-lg border p-2 text-[11px]" style={{borderColor:'var(--dawaa-theme-border)'}}><div className="font-black">{item.customer_name||'عميل غير محدد'} {item.customer_code?`#${item.customer_code}`:''}</div><div className="mt-1" style={{color:'var(--dawaa-theme-muted)'}}>{String(item.conversation_started_at||'').replace('T',' ').slice(0,16)} · {item.invoice_match_status==='verified'?`فاتورة مؤكدة ${item.matched_invoice_number||''} — ${fmt(Number(item.matched_invoice_value||0))} ج`:'بدون بيع مؤكد'}{item.followup_required?' · متابعة مطلوبة':''}</div></div>)}
        {!visibleConversations.length?<div className="p-3 text-[11px]" style={{color:'var(--dawaa-theme-muted)'}}>لا توجد محادثات تفصيلية مرتبطة بهذه الدورة.</div>:null}
       </div></div>
       <div className="rounded-xl border p-2" style={{borderColor:'var(--dawaa-theme-border)'}}><div className="mb-2 flex items-center gap-2 text-xs font-black"><PackageSearch size={14}/> الأصناف والفرص</div><div className="max-h-80 space-y-2 overflow-y-auto">
        {visibleProducts.map((item,index)=><div key={`${item.source_id}-${item.product_name}-${index}`} className="rounded-lg border p-2 text-[11px]" style={{borderColor:'var(--dawaa-theme-border)'}}><div className="font-black">{item.product_name||'صنف غير محدد'} · {item.customer_name||'عميل غير محدد'}</div><div className="mt-1" style={{color:'var(--dawaa-theme-muted)'}}>{item.current_stage||'مرحلة غير محددة'}{item.leakage_reason?` · سبب فقد البيع: ${item.leakage_reason}`:''}{item.next_action?` · التالي: ${item.next_action}`:''}{item.invoice_match_status==='verified'?` · بيع مؤكد ${fmt(Number(item.matched_invoice_value||0))} ج`:''}</div></div>)}
        {!visibleProducts.length?<div className="p-3 text-[11px]" style={{color:'var(--dawaa-theme-muted)'}}>لا توجد رحلات أصناف تفصيلية مرتبطة بهذه الدورة.</div>:null}
       </div></div>
      </div>}
     </div>:null}
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
