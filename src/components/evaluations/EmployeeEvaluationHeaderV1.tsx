import { AlertTriangle, CalendarDays, ChevronDown, Clock3, ReceiptText, UserRound } from 'lucide-react';
import { Panel, MiniBox } from '@/components/dashboard/DashboardPrimitives';
import type { EvaluationHeaderSummary } from '@/lib/evaluations/employeeEvaluationHeaderService';

const roleLabels={doctor:'دكتور',assistant:'مساعد صيدلي',warehouse:'مخزن',delivery:'دليفري',manager:'إدارة',customer_service:'خدمة عملاء',other:'موظف'} as const;
const n=(v:number|null,d=0)=>v==null?'—':v.toLocaleString('en-US',{maximumFractionDigits:d});

export default function EmployeeEvaluationHeaderV1(props:{name:string;role:string;branch:string;cycle:string;summary:EvaluationHeaderSummary|null;loading:boolean}){
 const s=props.summary;
 const salesAvailable=s?.sales.state==='available';
 const attendanceAvailable=s?.attendance.state==='available';
 const conversationAvailable=s?.conversations.state==='available';
 return <Panel className="overflow-hidden p-0">
  <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3.5" style={{borderColor:'var(--dawaa-theme-border)'}}>
   <div className="flex items-center gap-3">
    <span className="flex h-10 w-10 items-center justify-center rounded-xl border" style={{background:'var(--dawaa-theme-accent-soft)',color:'var(--dawaa-theme-primary-strong)',borderColor:'var(--dawaa-theme-accent-border)'}}><UserRound size={20}/></span>
    <div>
     <h2 className="text-base font-black" style={{color:'var(--dawaa-theme-heading)'}}>{props.name}</h2>
     <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs font-bold" style={{color:'var(--dawaa-theme-muted)'}}><span>{props.role}</span><span>·</span><span>{props.branch}</span><span>·</span><span>{props.cycle}</span>{s?<><span>·</span><span>{roleLabels[s.roleGroup]}</span></>:null}</div>
    </div>
   </div>
   <span className="rounded-full border px-3 py-1 text-xs font-black" style={{borderColor:'var(--dawaa-theme-border)',color:'var(--dawaa-theme-primary-strong)'}}>{props.loading?'جاري تجميع الحقيقة':'حقيقة الموظف في الدورة'}</span>
  </div>

  {s?<div className="p-4">
   <div className={`grid gap-2 sm:grid-cols-2 ${s.roleGroup==='doctor'?'lg:grid-cols-4':'lg:grid-cols-3'}`}>
    {s.roleGroup!=='manager'?<>
     <MiniBox label="الحضور الفعلي" value={attendanceAvailable?n(s.attendance.workedDays):'—'} tone={attendanceAvailable?'green':'amber'}/>
     <MiniBox label="التأخير" value={attendanceAvailable?(`${n(s.attendance.lateDays)} يوم`):'—'} tone={attendanceAvailable?(s.attendance.lateDays?'amber':'green'):'amber'}/>
    </>:null}
    {s.roleGroup==='doctor'?<>
     <MiniBox label="مبيعات الدورة" value={salesAvailable&&s.sales.total!=null?`${n(s.sales.total)} ج`:'—'} tone={salesAvailable?'green':'amber'}/>
     <MiniBox label="المحادثات المقيمة" value={conversationAvailable?n(s.conversations.count):'—'} tone={conversationAvailable?'green':'amber'}/>
    </>:s.roleGroup!=='manager'?<MiniBox label="ساعات العمل" value={attendanceAvailable&&s.attendance.workedHours!=null?`${n(s.attendance.workedHours,1)} س`:'—'} tone={attendanceAvailable?'cyan':'amber'}/>:<MiniBox label="نوع الدليل" value="نتيجة الفريق/الفرع" tone="cyan"/>}
   </div>

   {s.warnings.length?<div className="mt-3 flex items-start gap-2 rounded-xl border p-2.5 text-[11px] font-bold" style={{borderColor:'var(--dawaa-status-warning-border)',background:'var(--dawaa-status-warning-bg)',color:'var(--dawaa-status-warning-text)'}}><AlertTriangle size={14}/><span>{s.warnings.join(' · ')}</span></div>:null}

   <details className="group mt-3 rounded-xl border" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-soft)'}}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-black" style={{color:'var(--dawaa-theme-heading)'}}>
     <span>{s.roleGroup==='manager'?'حدود دليل الدور':'تفاصيل حقيقة الدورة'}</span>
     <span className="flex items-center gap-1 text-[10px] font-bold" style={{color:'var(--dawaa-theme-muted)'}}>{s.roleGroup==='manager'?'القرار مبني على الفريق/الفرع':'الفواتير · الوقت · الإجازات'} <ChevronDown size={14} className="transition-transform group-open:rotate-180"/></span>
    </summary>
    <div className="space-y-4 border-t p-3" style={{borderColor:'var(--dawaa-theme-border)'}}>
     {s.roleGroup==='manager'?<div className="text-xs font-bold leading-6" style={{color:'var(--dawaa-theme-muted)'}}>لا نستخدم الحضور الشخصي أو الإجازات أو المحادثات الشخصية كحقيقة تقييم للدور القيادي. كل محور قيادي يعتمد على نتيجة الفريق أو الفرع والواقعة الموثقة الخاصة به.</div>:null}
     {s.roleGroup==='doctor'?<div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-black" style={{color:'var(--dawaa-theme-heading)'}}><ReceiptText size={14}/> البيع والمحادثات</div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
       <MiniBox label="مبيعات الدورة" value={salesAvailable&&s.sales.total!=null?`${n(s.sales.total)} ج`:'—'} tone={salesAvailable?'green':'amber'}/>
       <MiniBox label="الفواتير" value={salesAvailable?n(s.sales.invoices):'—'} tone={salesAvailable?'cyan':'amber'}/>
       <MiniBox label="متوسط الفاتورة" value={salesAvailable&&s.sales.avgInvoice!=null?`${n(s.sales.avgInvoice,1)} ج`:'—'} tone={salesAvailable?'cyan':'amber'}/>
       <MiniBox label="العملاء" value={salesAvailable?n(s.sales.customers):'—'} tone={salesAvailable?'cyan':'amber'}/>
       <MiniBox label="المحادثات المقيمة" value={conversationAvailable?n(s.conversations.count):'—'} tone={conversationAvailable?'green':'amber'}/>
       <MiniBox label="متوسط المحادثات" value={conversationAvailable&&s.conversations.average!=null?`${n(s.conversations.average,1)}/10`:'—'} tone={conversationAvailable?'cyan':'amber'}/>
      </div>
     </div>:null}

     {s.roleGroup!=='manager'?<div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-black" style={{color:'var(--dawaa-theme-heading)'}}><Clock3 size={14}/> الحضور والوقت</div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
       <MiniBox label="أيام الحضور" value={attendanceAvailable?n(s.attendance.workedDays):'—'} tone={attendanceAvailable?'green':'amber'}/>
       <MiniBox label="ساعات العمل" value={attendanceAvailable&&s.attendance.workedHours!=null?`${n(s.attendance.workedHours,1)} س`:'—'} tone={attendanceAvailable?'cyan':'amber'}/>
       <MiniBox label="أيام الجدول" value={attendanceAvailable?n(s.attendance.scheduledDays):'—'} tone={attendanceAvailable?'cyan':'amber'}/>
       <MiniBox label="أيام التأخير" value={attendanceAvailable?n(s.attendance.lateDays):'—'} tone={attendanceAvailable?(s.attendance.lateDays?'amber':'green'):'amber'}/>
       <MiniBox label="الأذونات" value={s.timeOff.permissions==null?'—':`${n(s.timeOff.permissions)} · ${n(s.timeOff.permissionMinutes)} د`} tone="cyan"/>
       <MiniBox label="الإجازة الأسبوعية" value={n(s.timeOff.weeklyOffDays)} tone="cyan"/>
       <MiniBox label="إجازات أخرى معتمدة" value={n(s.timeOff.otherApprovedLeaveDays)} tone="cyan"/>
      </div>
     </div>:null}

     {s.roleGroup!=='manager'?<div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-black" style={{color:'var(--dawaa-theme-heading)'}}><CalendarDays size={14}/> الإجازات السنوية</div>
      <div className="grid gap-2 sm:grid-cols-3">
       <MiniBox label="سنوية مستخدمة في الدورة" value={n(s.timeOff.annualLeaveCycleDays)} tone="cyan"/>
       <MiniBox label="سنوية مستخدمة خلال السنة" value={n(s.timeOff.annualLeaveYearUsed)} tone="cyan"/>
       <MiniBox label="رصيد السنوية" value={n(s.timeOff.annualLeaveYearBalance)} tone={s.timeOff.annualLeaveYearBalance==null?'amber':'green'}/>
      </div>
     </div>:null}
    </div>
   </details>
  </div>:<div className="p-4 text-sm font-bold" style={{color:'var(--dawaa-theme-muted)'}}>{props.loading?'جاري تجميع حقيقة الموظف للدورة…':'تعذر تحميل ملخص الدورة؛ لا يتم افتراض أرقام بديلة.'}</div>}
 </Panel>;
}
