import { AlertTriangle, CheckCircle2, ChevronDown, Star } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';

export type EvaluationAxisEvidenceView={
 status:string; summary:string; details:string[];
 examples?:Array<{id:string;date?:string|null;score:number;negativeReason?:string|null}>;
};

export default function EvaluationAxisCardV1(props:{
 axisKey:string; title:string; description:string; weight:number; score:number; earned:number;
 rubricText?:string|null; evidence:EvaluationAxisEvidenceView; note:string; canEdit:boolean;
 onScore:(score:number)=>void; onNote:(note:string)=>void;
}){
 const weak=props.score>0&&props.score<=2;
 const manualEvidence=props.evidence.status==='manual';
 const noteMissing=weak&&!props.note.trim();
 const manualNoteMissing=manualEvidence&&props.score>0&&props.note.trim().length<12;
 const decisionNoteMissing=noteMissing||manualNoteMissing;
 const evidenceUnavailable=props.evidence.status==='unavailable';
 const evidencePending=props.evidence.status==='pending'||props.evidence.status==='insufficient'||props.evidence.status==='partial';
 const evidenceBlocksDecision=evidenceUnavailable||evidencePending;
 const stateLabel=evidenceUnavailable?'الدليل غير متاح':evidencePending?'الدليل غير مكتمل':props.score?'تم التقييم':'بانتظار التقييم';
 const evidenceCount=props.evidence.details.filter(Boolean).length;
 const exampleCount=props.evidence.examples?.length||0;
 const compactEvidence=props.evidence.details.filter(Boolean);
 const sourceEvidence=compactEvidence.filter(x=>/^(مصدر الدليل|المصدر:)/.test(x));
 const limitEvidence=compactEvidence.filter(x=>/^(حدود الدليل|تغطية هذا الدليل)/.test(x));
 const factualEvidence=compactEvidence.filter(x=>!sourceEvidence.includes(x)&&!limitEvidence.includes(x));
 const primaryEvidence=factualEvidence.slice(0,4);
 const secondaryEvidence=factualEvidence.slice(4);
 const hasEvidenceDetails=compactEvidence.length>0||exampleCount>0;
 const evidenceQualityLabel=evidenceUnavailable?'غير قابل للقياس':evidencePending?'يحتاج استكمال':manualEvidence?'دليل يدوي مطلوب':exampleCount>=3||evidenceCount>=4?'دليل قوي':'دليل متاح';
 const evidenceQualityStyle=evidenceUnavailable
  ? {borderColor:'var(--dawaa-status-danger-border)',color:'var(--dawaa-status-danger-text)',background:'var(--dawaa-status-danger-bg)'}
  : evidencePending||manualEvidence
    ? {borderColor:'var(--dawaa-status-warning-border)',color:'var(--dawaa-status-warning-text)',background:'var(--dawaa-status-warning-bg)'}
    : {borderColor:'var(--dawaa-status-success-border)',color:'var(--dawaa-status-success-text)',background:'var(--dawaa-status-success-bg)'};
 const stateStyle=evidenceUnavailable
  ? {background:'var(--dawaa-status-danger-bg)',color:'var(--dawaa-status-danger-text)',borderColor:'var(--dawaa-status-danger-border)'}
  : evidencePending
    ? {background:'var(--dawaa-status-warning-bg)',color:'var(--dawaa-status-warning-text)',borderColor:'var(--dawaa-status-warning-border)'}
    : props.score
      ? {background:'var(--dawaa-status-success-bg)',color:'var(--dawaa-status-success-text)',borderColor:'var(--dawaa-status-success-border)'}
      : {background:'var(--dawaa-theme-soft)',color:'var(--dawaa-theme-muted)',borderColor:'var(--dawaa-theme-border)'};
 return <Panel id={`evaluation-section-${props.axisKey}`} className="overflow-hidden p-0">
  <div className="h-1 w-full" style={{background:evidenceUnavailable?'var(--dawaa-status-danger-border)':evidencePending?'var(--dawaa-status-warning-border)':props.score?'var(--dawaa-status-success-border)':'var(--dawaa-theme-border)'}}/>
  <div className="p-4 sm:p-5">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div className="min-w-0 flex-1">
    <div className="flex flex-wrap items-center gap-2">
     <h3 className="text-[15px] font-black" style={{color:'var(--dawaa-theme-heading)'}}>{props.title}</h3>
     <span className="rounded-full border px-2 py-0.5 text-xs font-black" style={{borderColor:'var(--dawaa-theme-border)',color:'var(--dawaa-theme-primary-strong)'}}>{props.weight} نقطة</span>
     <span className="rounded-full border px-2.5 py-1 text-[11px] font-black" style={stateStyle}>{stateLabel}</span>
    </div>
    <p className="mt-1 text-xs leading-5" style={{color:'var(--dawaa-theme-muted)'}}>{props.description}</p>
   </div>
   <div className="min-w-[82px] rounded-xl border px-3 py-2 text-center" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-soft)'}}>
    <div className="text-lg font-black" style={{color:props.score?'var(--dawaa-theme-heading)':'var(--dawaa-theme-muted)'}}>{props.score?`${props.earned}/${props.weight}`:'—'}</div>
    <div className="text-xs font-bold" style={{color:'var(--dawaa-theme-muted)'}}>الناتج الموزون</div>
   </div>
  </div>

  <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black">
   <span className="rounded-full border px-2 py-1" style={evidenceQualityStyle}>{evidenceQualityLabel}</span>
   <span className="rounded-full border px-2 py-1" style={{borderColor:'var(--dawaa-theme-border)',color:'var(--dawaa-theme-muted)'}}>{evidenceCount} حقيقة موثقة</span>
   {exampleCount?<span className="rounded-full border px-2 py-1" style={{borderColor:'var(--dawaa-theme-border)',color:'var(--dawaa-theme-muted)'}}>{exampleCount} واقعة قابلة للفتح</span>:null}
   <span className="rounded-full border px-2 py-1" style={{borderColor:'var(--dawaa-theme-border)',color:'var(--dawaa-theme-muted)'}}>الوزن {props.weight}%</span>
  </div>

  <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
   <div className="rounded-xl border p-3" style={{borderColor:evidenceUnavailable?'var(--dawaa-status-danger-border)':evidencePending?'var(--dawaa-status-warning-border)':'var(--dawaa-theme-border)',background:evidenceUnavailable?'var(--dawaa-status-danger-bg)':evidencePending?'var(--dawaa-status-warning-bg)':'var(--dawaa-theme-soft)'}}>
    <div className="flex items-start gap-2">
     {evidenceUnavailable||manualEvidence?<AlertTriangle className="mt-0.5 shrink-0" size={15} style={{color:evidenceUnavailable?'var(--dawaa-status-danger-text)':'var(--dawaa-status-warning-text)'}}/>:<CheckCircle2 className="mt-0.5 shrink-0" size={15} style={{color:evidencePending?'var(--dawaa-status-warning-text)':'var(--dawaa-status-success-text)'}}/>}
     <div className="min-w-0">
      <div className="text-[10px] font-black" style={{color:'var(--dawaa-theme-muted)'}}>ماذا تقول البيانات؟</div>
      <div className="mt-0.5 text-sm font-black leading-6" style={{color:evidenceUnavailable?'var(--dawaa-status-danger-text)':'var(--dawaa-theme-heading)'}}>{props.evidence.summary}</div>
     </div>
    </div>
    {primaryEvidence.length?<div className="mt-3">
     <div className="mb-1.5 text-[10px] font-black" style={{color:'var(--dawaa-theme-muted)'}}>أهم الوقائع</div>
     <div className="grid gap-1.5 sm:grid-cols-2">{primaryEvidence.map((x,index)=><div key={`${index}:${x}`} className="rounded-lg border px-2.5 py-2 text-xs font-bold leading-5" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-surface)',color:'var(--dawaa-theme-text)'}}>{x}</div>)}</div>
    </div>:null}
    <details className="group mt-2 rounded-lg border px-2.5 py-2" open={evidenceUnavailable||evidencePending} style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-surface)'}}>
     <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-black" style={{color:'var(--dawaa-theme-primary-strong)'}}>
      <span>{hasEvidenceDetails?'المصدر والحدود وكل الأدلة':'لا توجد تفاصيل إضافية'}</span><ChevronDown className="transition-transform group-open:rotate-180" size={14}/>
     </summary>
     <div className="mt-2 border-t pt-2 text-xs font-bold" style={{borderColor:'var(--dawaa-theme-border)',color:'var(--dawaa-theme-muted)'}}>
      {sourceEvidence.length||limitEvidence.length?<div className="grid gap-1.5 sm:grid-cols-2">{sourceEvidence.map(x=><div key={x} className="rounded-lg border px-2.5 py-2 text-[11px] leading-5" style={{borderColor:'var(--dawaa-status-info-border)',background:'var(--dawaa-theme-surface)',color:'var(--dawaa-theme-muted)'}}>{x}</div>)}{limitEvidence.map(x=><div key={x} className="rounded-lg border px-2.5 py-2 text-[11px] leading-5" style={{borderColor:'var(--dawaa-status-warning-border)',background:'var(--dawaa-theme-surface)',color:'var(--dawaa-theme-muted)'}}>{x}</div>)}</div>:null}
     {secondaryEvidence.length?<details className="mt-2 rounded-lg border px-2.5 py-2" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-surface)'}}><summary className="cursor-pointer list-none text-[11px] font-black" style={{color:'var(--dawaa-theme-primary-strong)'}}>+ {secondaryEvidence.length} تفاصيل إضافية</summary><div className="mt-2 grid gap-1.5 sm:grid-cols-2">{secondaryEvidence.map((x,index)=><div key={`more:${index}:${x}`} className="rounded-md border px-2 py-1.5 leading-5" style={{borderColor:'var(--dawaa-theme-border)'}}>{x}</div>)}</div></details>:null}
     <div className="mt-2 text-[10px] font-bold" style={{color:'var(--dawaa-theme-muted)'}}>الدليل يبرر القرار ولا ينشئ درجة تلقائية.</div>
     {exampleCount?<div className="mt-3 text-[10px] font-black" style={{color:'var(--dawaa-theme-muted)'}}>وقائع قابلة للمراجعة</div>:null}
     {props.evidence.examples?.length?<div className="mt-1 grid gap-1.5 sm:grid-cols-2">{props.evidence.examples.map(ex=><a key={ex.id} href={`/reviews?section=history&id=${encodeURIComponent(ex.id)}`} target="_blank" rel="noreferrer" className="rounded-lg border px-2 py-1.5" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-surface)',color:'var(--dawaa-theme-text)'}}><span className="font-black">{ex.date||'بدون تاريخ'} · {ex.score}/100</span>{ex.negativeReason?<span className="block truncate text-[10px] opacity-75">{ex.negativeReason}</span>:null}</a>)}</div>:null}
     </div>
    </details>
   </div>

   <div className="rounded-xl border p-3" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-surface)'}}>
    <div className="mb-2 text-xs font-black" style={{color:'var(--dawaa-theme-muted)'}}>قرار المدير</div>
    <div className="flex gap-0.5">{[1,2,3,4,5].map(n=><button type="button" aria-label={`اختيار ${n} نجوم`} disabled={!props.canEdit||evidenceBlocksDecision} key={n} onClick={()=>props.onScore(n)} className="rounded-md p-0.5 disabled:cursor-not-allowed disabled:opacity-45"><Star className={n<=props.score?'fill-current':''} size={21} style={{color:n<=props.score?'var(--dawaa-status-warning-text)':'var(--dawaa-theme-border)'}}/></button>)}</div>
    {props.score?<div className="mt-1 text-xs font-black" style={{color:'var(--dawaa-theme-text)'}}>{props.score}/5{props.rubricText?` · ${props.rubricText}`:''}</div>:null}
   </div>
  </div>

  <textarea disabled={!props.canEdit} value={props.note} onChange={e=>props.onNote(e.target.value)} rows={2} placeholder={manualEvidence?'مطلوب واقعة أو نتيجة موثقة تبرر الدرجة':weak?'مطلوب سبب واضح للدرجة الضعيفة':'ملاحظة مختصرة عند الحاجة'} className="mt-3 w-full rounded-xl border px-3 py-2.5 text-xs leading-5 disabled:opacity-70" style={{borderColor:decisionNoteMissing?'var(--dawaa-status-danger-border)':'var(--dawaa-theme-border)',background:decisionNoteMissing?'var(--dawaa-status-danger-bg)':'var(--dawaa-theme-surface)',color:'var(--dawaa-theme-text)'}}/>
  {evidenceBlocksDecision?<div className="mt-1 text-xs font-black" style={{color:'var(--dawaa-status-warning-text)'}}>لا يمكن اتخاذ قرار على هذا المحور قبل اكتمال الدليل المطلوب.</div>:null}
  {noteMissing?<div className="mt-1 text-xs font-black" style={{color:'var(--dawaa-status-danger-text)'}}>الدرجة الضعيفة لا تُعتمد بدون سبب مكتوب.</div>:null}
  {manualNoteMissing?<div className="mt-1 text-xs font-black" style={{color:'var(--dawaa-status-danger-text)'}}>هذا المحور يعتمد على دليل يدوي؛ اكتب واقعة أو نتيجة واضحة (12 حرفًا على الأقل) قبل الاعتماد.</div>:null}
  </div>
 </Panel>;
}
