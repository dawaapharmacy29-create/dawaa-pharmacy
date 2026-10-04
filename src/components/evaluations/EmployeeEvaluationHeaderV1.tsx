import { AlertTriangle, CalendarDays, Clock3, ReceiptText, UserRound } from 'lucide-react';
import { Panel, MiniBox } from '@/components/dashboard/DashboardPrimitives';
import type { EvaluationHeaderSummary } from '@/lib/evaluations/employeeEvaluationHeaderService';

const roleLabels={doctor:'دكتور',assistant:'مساعد صيدلي',warehouse:'مخزن',delivery:'دليفري',manager:'إدارة',customer_service:'خدمة عملاء',other:'موظف'} as const;
const n=(v:number|null,d=0)=>v==null?'—':v.toLocaleString('en-US',{maximumFractionDigits:d});
export default function EmployeeEvaluationHeaderV1(props:{name:string;role:string;branch:string;cycle:string;summary:EvaluationHeaderSummary|null;loading:boolean}){
 const s=props.summary;
 return <Panel className="overflow-hidden p-0">
  <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3.5" style={{borderColor:'var(--dawaa-theme-border)'}}>
   <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border" style={{background:'var(--dawaa-theme-accent-soft)',color:'var(--dawaa-theme-primary-strong)',borderColor:'var(--dawaa-theme-accent-border)'}}><UserRound size={20}/></span><div><h2 className="text-base font-black" style={{color:'var(--dawaa-theme-heading)'}}>{props.name}</h2><div className="mt-0.5 flex flex-wrap gap-1.5 text-xs font-bold" style={{color:'var(--dawaa-theme-muted)'}}><span>{props.role}</span><span>·</span><span>{props.branch}</span><span>·</span><span>{props.cycle}</span>{s?<><span>·</span><span>{roleLabels[s.roleGroup]}</span></>:null}</div></div></div>
   <span className="rounded-full border px-3 py-1 text-xs font-black" style={{borderColor:'var(--dawaa-theme-border)',color:'var(--dawaa-theme-primary-strong)'}}>{props.loading?'جاري تحميل الملخص':'ملخص الدورة'}</span>
  </div>
  {s?<div className="space-y-4 p-4">
   {s.roleGroup==='doctor'?<div><div className="mb-2 flex items-center gap-1.5 text-[11px] font-black" style={{color:'var(--dawaa-theme-heading)'}}><ReceiptText size={14}/> المبيعات والمحادثات</div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
    <MiniBox label="مبيعات الدورة" value={s.sales.total==null?'—':`${n(s.sales.total)} ج`} tone={s.sales.state==='available'?'green':'amber'}/>
    <MiniBox label="الفواتير" value={s.sales.state==='available'?n(s.sales.invoices):'—'} tone={s.sales.state==='available'?'cyan':'amber'}/><MiniBox label="متوسط الفاتورة" value={s.sales.state==='available'&&s.sales.avgInvoice!=null?`${n(s.sales.avgInvoice,1)} ج`:'—'} tone={s.sales.state==='available'?'cyan':'amber'}/>
    <MiniBox label="العملاء" value={s.sales.state==='available'?n(s.sales.customers):'—'} tone={s.sales.state==='available'?'cyan':'amber'}/><MiniBox label="المحادثات المقيمة" value={s.conversations.state==='available'?n(s.conversations.count):'—'} tone={s.conversations.state==='available'?'green':'amber'}/><MiniBox label="متوسط المحادثات" value={s.conversations.average==null?'—':`${n(s.conversations.average,1)}/10`} tone="cyan"/>
   </div></div>:null}
   <div><div className="mb-2 flex items-center gap-1.5 text-[11px] font-black" style={{color:'var(--dawaa-theme-heading)'}}><Clock3 size={14}/> الحضور والوقت</div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
    <MiniBox label="أيام الحضور" value={n(s.attendance.workedDays)} tone={s.attendance.state==='available'?'green':'amber'}/><MiniBox label="ساعات العمل" value={s.attendance.workedHours==null?'—':`${n(s.attendance.workedHours,1)} س`} tone="cyan"/><MiniBox label="أيام الجدول" value={n(s.attendance.scheduledDays)} tone="cyan"/><MiniBox label="أيام التأخير" value={n(s.attendance.lateDays)} tone={s.attendance.lateDays?'amber':'green'}/>
    <MiniBox label="الأذونات" value={s.timeOff.permissions==null?'—':`${n(s.timeOff.permissions)} · ${n(s.timeOff.permissionMinutes)} د`} tone="cyan"/><MiniBox label="الإجازة الأسبوعية" value={n(s.timeOff.weeklyOffDays)} tone="cyan"/><MiniBox label="إجازات أخرى معتمدة" value={n(s.timeOff.otherApprovedLeaveDays)} tone="cyan"/>
   </div></div>
   <div><div className="mb-2 flex items-center gap-1.5 text-[11px] font-black" style={{color:'var(--dawaa-theme-heading)'}}><CalendarDays size={14}/> الإجازات السنوية</div><div className="grid gap-2 sm:grid-cols-3"><MiniBox label="سنوية مستخدمة في الدورة" value={n(s.timeOff.annualLeaveCycleDays)} tone="cyan"/><MiniBox label="سنوية مستخدمة خلال السنة" value={n(s.timeOff.annualLeaveYearUsed)} tone="cyan"/><MiniBox label="رصيد السنوية" value={n(s.timeOff.annualLeaveYearBalance)} tone={s.timeOff.annualLeaveYearBalance==null?'amber':'green'}/></div></div>
   {s.warnings.length?<div className="flex items-start gap-2 rounded-xl border p-2.5 text-[11px] font-bold" style={{borderColor:'var(--dawaa-status-warning-border)',background:'var(--dawaa-status-warning-bg)',color:'var(--dawaa-status-warning-text)'}}><AlertTriangle size={14}/><span>{s.warnings.join(' · ')}</span></div>:null}
  </div>:<div className="p-4 text-sm font-bold" style={{color:'var(--dawaa-theme-muted)'}}>{props.loading?'جاري تجميع حقيقة الموظف للدورة…':'تعذر تحميل ملخص الدورة؛ لا يتم افتراض أرقام بديلة.'}</div>}
 </Panel>;
}
