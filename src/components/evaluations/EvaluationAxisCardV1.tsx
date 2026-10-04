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
 const noteMissing=weak&&!props.note.trim();
 const evidenceUnavailable=props.evidence.status==='unavailable';
 const stateLabel=evidenceUnavailable?'الدليل غير متاح':props.score?'تم التقييم':'بانتظار التقييم';
 return <Panel id={`evaluation-section-${props.axisKey}`} className="p-3">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div className="min-w-0 flex-1">
    <div className="flex flex-wrap items-center gap-2">
     <h3 className="text-sm font-black" style={{color:'var(--dawaa-theme-heading)'}}>{props.title}</h3>
     <span className="rounded-full border px-2 py-0.5 text-[10px] font-black" style={{borderColor:'var(--dawaa-theme-border)',color:'var(--dawaa-theme-primary-strong)'}}>{props.weight} نقطة</span>
     <span className="rounded-full px-2 py-0.5 text-[10px] font-black" style={{background:evidenceUnavailable?'var(--dawaa-status-danger-bg)':'var(--dawaa-theme-soft)',color:evidenceUnavailable?'var(--dawaa-status-danger-text)':'var(--dawaa-theme-muted)'}}>{stateLabel}</span>
    </div>
    <p className="mt-1 text-[11px] leading-5" style={{color:'var(--dawaa-theme-muted)'}}>{props.description}</p>
   </div>
   <div className="text-left">
    <div className="text-lg font-black" style={{color:props.score?'var(--dawaa-theme-heading)':'var(--dawaa-theme-muted)'}}>{props.score?`${props.earned}/${props.weight}`:'—'}</div>
    <div className="text-[10px] font-bold" style={{color:'var(--dawaa-theme-muted)'}}>الناتج الموزون</div>
   </div>
  </div>

  <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_230px]">
   <details className="group rounded-xl border p-2.5" style={{borderColor:evidenceUnavailable?'var(--dawaa-status-danger-border)':'var(--dawaa-theme-border)',background:evidenceUnavailable?'var(--dawaa-status-danger-bg)':'var(--dawaa-theme-soft)'}}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[11px] font-black" style={{color:evidenceUnavailable?'var(--dawaa-status-danger-text)':'var(--dawaa-theme-text)'}}>
     <span>{evidenceUnavailable?<AlertTriangle className="me-1 inline" size={14}/>:<CheckCircle2 className="me-1 inline" size={14}/>} {props.evidence.summary}</span><ChevronDown size={14}/>
    </summary>
    <div className="mt-2 space-y-1 border-t pt-2 text-[11px] font-bold" style={{borderColor:'var(--dawaa-theme-border)',color:'var(--dawaa-theme-muted)'}}>
     {props.evidence.details.map(x=><div key={x}>• {x}</div>)}
     <div>• الدليل يبرر القرار ولا ينشئ درجة تلقائية.</div>
     {props.evidence.examples?.map(ex=><a key={ex.id} href={`/reviews?section=history&id=${encodeURIComponent(ex.id)}`} target="_blank" rel="noreferrer" className="block rounded-lg border px-2 py-1.5" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-surface)',color:'var(--dawaa-theme-text)'}}>{ex.date||'بدون تاريخ'} · {ex.score}/100{ex.negativeReason?` · ${ex.negativeReason}`:''} · فتح الدليل ↗</a>)}
    </div>
   </details>

   <div className="rounded-xl border p-2.5" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-surface)'}}>
    <div className="mb-1 text-[10px] font-black" style={{color:'var(--dawaa-theme-muted)'}}>قرار المدير</div>
    <div className="flex gap-0.5">{[1,2,3,4,5].map(n=><button type="button" aria-label={`اختيار ${n} نجوم`} disabled={!props.canEdit||evidenceUnavailable} key={n} onClick={()=>props.onScore(n)} className="rounded-md p-0.5 disabled:cursor-not-allowed disabled:opacity-45"><Star className={n<=props.score?'fill-current':''} size={21} style={{color:n<=props.score?'var(--dawaa-status-warning-text)':'var(--dawaa-theme-border)'}}/></button>)}</div>
    {props.score?<div className="mt-1 text-[11px] font-black" style={{color:'var(--dawaa-theme-text)'}}>{props.score}/5{props.rubricText?` · ${props.rubricText}`:''}</div>:null}
   </div>
  </div>

  <textarea disabled={!props.canEdit} value={props.note} onChange={e=>props.onNote(e.target.value)} rows={1} placeholder={weak?'مطلوب سبب واضح للدرجة الضعيفة':'ملاحظة مختصرة عند الحاجة'} className="mt-2 w-full rounded-xl border px-2.5 py-2 text-xs disabled:opacity-70" style={{borderColor:noteMissing?'var(--dawaa-status-danger-border)':'var(--dawaa-theme-border)',background:noteMissing?'var(--dawaa-status-danger-bg)':'var(--dawaa-theme-surface)',color:'var(--dawaa-theme-text)'}}/>
  {noteMissing?<div className="mt-1 text-[10px] font-black" style={{color:'var(--dawaa-status-danger-text)'}}>الدرجة الضعيفة لا تُعتمد بدون سبب مكتوب.</div>:null}
 </Panel>;
}
