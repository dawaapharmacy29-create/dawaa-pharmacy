import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Panel, MiniBox } from '@/components/dashboard/DashboardPrimitives';

export default function EvaluationDecisionHeaderV1(props:{
 employeeName:string; role:string; branch:string; cycle:string;
 score:number|null; completed:number; total:number; evidenceReady:boolean;
 status:string; blockers:string[]; incentive:number|null; settled:boolean;
}){
 const finalReady=props.score!==null&&props.evidenceReady&&props.blockers.length===0;
 return <Panel className="p-4">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div>
    <div className="flex items-center gap-2">
     {finalReady?<ShieldCheck size={20} style={{color:'var(--dawaa-status-success-text)'}}/>:<AlertTriangle size={20} style={{color:'var(--dawaa-status-warning-text)'}}/>}
     <h2 className="text-base font-black" style={{color:'var(--dawaa-theme-heading)'}}>قرار التقييم — {props.employeeName}</h2>
    </div>
    <p className="mt-1 text-xs font-bold" style={{color:'var(--dawaa-theme-muted)'}}>{props.role} · {props.branch} · {props.cycle}</p>
   </div>
   <span className="rounded-full border px-3 py-1 text-xs font-black" style={finalReady?{borderColor:'var(--dawaa-status-success-border)',color:'var(--dawaa-status-success-text)'}:{borderColor:'var(--dawaa-status-warning-border)',color:'var(--dawaa-status-warning-text)'}}>
    {finalReady?'مكتمل وقابل للاعتماد':'غير مكتمل'}
   </span>
  </div>
  <div className="mt-3 grid gap-2 sm:grid-cols-4">
   <MiniBox label="الدرجة النهائية" value={props.score===null?'—':`${props.score}/100`} tone={props.score===null?'amber':props.score>=80?'green':props.score>=60?'amber':'red'}/>
   <MiniBox label="الأدلة" value={props.evidenceReady?'مكتملة':'تحتاج مراجعة'} tone={props.evidenceReady?'green':'red'}/>
   <MiniBox label="المحاور" value={`${props.completed}/${props.total}`} tone={props.completed===props.total&&props.total>0?'green':'amber'}/>
   <MiniBox label={props.settled?'الحافز المعتمد':'الحافز الحالي'} value={props.incentive===null?'غير محدد':`${props.incentive.toLocaleString('ar-EG')} ج`} tone={props.settled?'green':'amber'}/>
  </div>
  {props.blockers.length?<div className="mt-3 rounded-xl border p-3 text-xs font-bold" style={{borderColor:'var(--dawaa-status-warning-border)',background:'var(--dawaa-status-warning-bg)',color:'var(--dawaa-status-warning-text)'}}>
   <div className="mb-1 flex items-center gap-1.5"><AlertTriangle size={14}/> أسباب منع الاعتماد</div>
   {props.blockers.map(x=><div key={x}>• {x}</div>)}
  </div>:<div className="mt-3 flex items-center gap-2 text-xs font-black" style={{color:'var(--dawaa-status-success-text)'}}><CheckCircle2 size={15}/> لا توجد موانع اعتماد حالية.</div>}
 </Panel>;
}
