import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Panel, MiniBox } from '@/components/dashboard/DashboardPrimitives';

export default function FinalEvaluationReviewV1(props:{
 ready:boolean; blockers:string[]; score:number|null; completed:number; total:number;
 criticalCount:number; incentive:number|null; incentiveSettled:boolean;
 strengths:string; development:string; managerNotes:string;
}){
 return <Panel className="overflow-hidden p-0" style={props.ready?{borderColor:'var(--dawaa-status-success-border)'}:{borderColor:'var(--dawaa-status-warning-border)'}}>
  <div className="h-1 w-full" style={{background:props.ready?'var(--dawaa-status-success-border)':'var(--dawaa-status-warning-border)'}}/>
  <div className="p-4 sm:p-5">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div className="flex items-start gap-2">
    {props.ready?<ShieldCheck size={20} style={{color:'var(--dawaa-status-success-text)'}}/>:<AlertTriangle size={20} style={{color:'var(--dawaa-status-warning-text)'}}/>}
    <div><h3 className="text-base font-black" style={{color:'var(--dawaa-theme-heading)'}}>{props.ready?'جاهز للاعتماد':'راجع قبل الاعتماد'}</h3>
    <p className="mt-0.5 text-xs font-bold" style={{color:'var(--dawaa-theme-muted)'}}>ملخص واحد للقرار النهائي وما سيصل للموظف.</p></div>
   </div>
   <span className="rounded-full border px-3 py-1 text-xs font-black" style={{borderColor:props.ready?'var(--dawaa-status-success-border)':'var(--dawaa-status-warning-border)',color:props.ready?'var(--dawaa-status-success-text)':'var(--dawaa-status-warning-text)'}}>{props.ready?'جاهز':`${props.blockers.length} ملاحظة`}</span>
  </div>
  <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
   <MiniBox label="الدرجة" value={props.score===null?`غير مكتمل · ${props.completed}/${props.total}`:`${props.score}/100`} tone={props.score===null?'amber':props.score>=80?'green':props.score>=60?'amber':'red'}/>
   <MiniBox label="المحاور" value={`${props.completed}/${props.total}`} tone={props.completed===props.total&&props.total>0?'green':'amber'}/>
   <MiniBox label="مخالفات حرجة" value={String(props.criticalCount)} tone={props.criticalCount?'red':'green'}/>
   <MiniBox label={props.incentiveSettled?'الحافز المعتمد':'الحافز الحالي'} value={props.incentive===null?'غير محدد':`${props.incentive.toLocaleString('ar-EG')} ج`} tone={props.incentiveSettled?'green':'amber'}/>
  </div>
  {props.blockers.length?<div className="mt-3 rounded-xl border p-3 text-xs font-bold" style={{borderColor:'var(--dawaa-status-warning-border)',background:'var(--dawaa-status-warning-bg)',color:'var(--dawaa-status-warning-text)'}}>{props.blockers.map(x=><div key={x}>• {x}</div>)}</div>:<div className="mt-3 flex items-center gap-2 text-xs font-black" style={{color:'var(--dawaa-status-success-text)'}}><CheckCircle2 size={15}/> كل شروط الاعتماد مكتملة.</div>}
  {props.score!==null?<div className="mt-3 grid gap-2 lg:grid-cols-2">
   <div className="rounded-xl border p-3" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-soft)'}}><div className="text-xs font-black" style={{color:'var(--dawaa-status-success-text)'}}>نقاط القوة</div><div className="mt-1 whitespace-pre-wrap text-xs font-bold leading-6" style={{color:'var(--dawaa-theme-text)'}}>{props.strengths.trim()||'لم تُكتب نقاط قوة بعد.'}</div></div>
   <div className="rounded-xl border p-3" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-soft)'}}><div className="text-xs font-black" style={{color:'var(--dawaa-status-warning-text)'}}>خطة التطوير</div><div className="mt-1 whitespace-pre-wrap text-xs font-bold leading-6" style={{color:'var(--dawaa-theme-text)'}}>{props.development.trim()||'لا توجد خطة تطوير مكتوبة بعد.'}</div></div>
   {props.managerNotes.trim()?<div className="rounded-xl border p-3 lg:col-span-2" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-surface)'}}><div className="text-xs font-black" style={{color:'var(--dawaa-theme-primary-strong)'}}>ملاحظة المدير</div><div className="mt-1 whitespace-pre-wrap text-xs font-bold leading-6" style={{color:'var(--dawaa-theme-text)'}}>{props.managerNotes}</div></div>:null}
  </div>:null}
  </div>
 </Panel>;
}
