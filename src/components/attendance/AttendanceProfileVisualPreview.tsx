import { useState } from 'react';
import EmployeeProfileDrawer, { type EmployeeAttendanceProfile } from './EmployeeProfileDrawer';

type DemoKey='empty'|'partial'|'complete';
const dayNames=['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'];
const date='2026-10-19';
const weeklySchedule=dayNames.map((day_name,index)=>({
  day_name,shift_date:null,is_off:index===6,
  shift_start:index===6?null:'09:00:00',
  shift_end:index===6?null:'17:00:00',
}));
function scenario(kind:DemoKey):EmployeeAttendanceProfile {
  const empty=kind==='empty',partial=kind==='partial';
  const acceptedDays=empty?24:partial?28:29;
  const missing=empty?24:partial?1:0;
  const evaluated=empty?0:partial?27:29;
  const days=Array.from({length:15},(_,index)=>{
    const shift_date='2026-10-'+String(19-index).padStart(2,'0');
    const has_summary=!empty&&(!partial||index!==2);
    return {
      shift_date,accepted_punches:2,review_punches:index===2?1:0,rejected_punches:0,
      first_in:shift_date+'T06:05:00+00:00',last_out:shift_date+'T14:01:00+00:00',
      punch_branches:[index%3===0?'فرع شكري':'فرع الشامي'],
      has_summary,summary_status:has_summary?'approved':null,
    };
  });
  return {
    staff:{id:'00000000-0000-0000-0000-000000000001',name:
      empty?'موظف تجريبي — بدون ملخص':partial?'موظف تجريبي — تغطية جزئية':'موظف تجريبي — تغطية كاملة',
      role:'صيدلي',branch:'فرع الشامي',active:true},
    weekly_schedule:weeklySchedule,
    rates:{evaluated_days:evaluated,on_time_days:partial?22:27,late_days:partial?4:2,very_late_days:0,
      early_leave_days:0,permission_days:1,absence_days:0,pending_review_days:partial?1:0,
      late_rate_pct:partial?15:7,permission_rate_pct:4},
    recent_days:empty?[]:days.filter(x=>x.has_summary).slice(0,10).map(x=>({
      attendance_date:x.shift_date,status:x.shift_date==='2026-10-17'?'pending_review':'approved',
      resolution_status:x.shift_date==='2026-10-17'?'missing_checkout':'on_time',
      first_in:x.first_in,last_out:x.last_out,late_minutes:0,early_leave_minutes:0,
      payroll_eligible_hours:8.0,
    })),
    processed_evidence:{source:'staff_attendance_logs',from:'2026-09-20',to:'2026-10-20',
      total_punches:acceptedDays*2+1,accepted_punches:acceptedDays*2,accepted_days:acceptedDays,
      summary_covered_days:acceptedDays-missing,missing_summary_days:missing,coverage_complete:!empty&&!partial,
      complete_pair_days:acceptedDays-1,manual_review_punches:1,rejected_punches:0,recent_days:days},
  };
}

export default function AttendanceProfileVisualPreview(){
  const [selected,setSelected]=useState<DemoKey>('partial');
  const [open,setOpen]=useState(true);
  const options:{key:DemoKey;label:string}[]=[
    {key:'empty',label:'بدون ملخص'},
    {key:'partial',label:'تغطية جزئية'},
    {key:'complete',label:'تغطية كاملة'},
  ];
  return <div className="min-h-screen dawaa-app-bg" dir="rtl">
    <header className="sticky top-0 z-[220] flex h-14 items-center justify-between border-b border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-4">
      <strong className="text-sm font-black text-[var(--dawaa-theme-heading)]">مركز الحضور — تجربة التصميم</strong>
      <span className="text-[11px] text-[var(--dawaa-theme-muted)]">معاينة آمنة · بيانات توضيحية فقط</span>
    </header>
    <main className="mx-auto max-w-4xl space-y-4 p-5">
      <h1 className="text-xl font-black text-[var(--dawaa-theme-heading)]">مراجعة نافذة ملف الموظف</h1>
      <p className="text-sm leading-relaxed text-[var(--dawaa-theme-muted)]">
        هذه نسخة عرض للتصميم باستخدام بيانات صناعية. لا تتصل بقاعدة بيانات الحضور ولا تسمح بتعديل أي بيانات فعلية.
      </p>
      <div className="flex flex-wrap gap-2">{options.map(item=><button type="button" key={item.key}
        onClick={()=>{setSelected(item.key);setOpen(true);}}
        className={selected===item.key?'btn-primary px-4 py-2 text-xs':'btn-secondary px-4 py-2 text-xs'}>
        {item.label}
      </button>)}</div>
      <button className="btn-primary px-4 py-2 text-sm" type="button" onClick={()=>setOpen(true)}>افتح نافذة الموظف</button>
      <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-4 text-xs text-[var(--dawaa-theme-muted)]">
        جرب حالات التغطية الثلاث، النزول داخل النافذة، وظهور الاسم أسفل الهيدر. لا توجد عمليات حفظ أو بصمات حقيقية هنا.
      </div>
    </main>
    {open&&<EmployeeProfileDrawer key={selected} staffId={scenario(selected).staff.id}
      previewProfile={scenario(selected)} onClose={()=>setOpen(false)}/>}
  </div>;
}
