import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Panel } from '@/components/dashboard/DashboardPrimitives';

type Sale = { day: string; branch: string; amount: number; timing: string };
type Followup = {
  day: string;
  staff_code: string | null;
  task_type: string;
  staff_name: string | null;
  customer_name: string | null;
  customer_code: string | null;
  completed: boolean;
  completed_at: string | null;
  reply: string | null;
  bought_after: boolean;
  segment_at_followup: string | null;
  current_segment: string | null;
  sales: Sale[];
};
type Report = {
  day: string;
  branch: string;
  generated_at: string;
  replied: number;
  team: Array<{ staff_code: string | null; staff_name: string | null; due: number; completed: number; overdue: number; replied: number }>;
  followups: Followup[];
  uploads: Array<{ kind: string; at: string | null }>;
};

const TASK_LABELS: Record<string, string> = {
  regular_due: 'متابعة دورية', important: 'عميل مهم', lost: 'استرجاع عميل',
  yesterday: 'متابعة فاتورة أمس', declining: 'تراجع التعامل', at_risk: 'معرض يوقف',
  doctor_request: 'طلب دكتور', big_invoice: 'فاتورة كبيرة', new_customer: 'عميل جديد',
  uncoded_note: 'عميل بدون كود', other: 'أخرى',
};
const stamp = (value: string) => new Date(value).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });

function exportReport(report: Report) {
  const rows: Array<Array<string | number | null>> = [
    ['القسم','اليوم','الفرع','الموظف','اسم العميل','نوع المهمة','الرد','شراء لاحق','الشريحة وقت المتابعة','الشريحة الحالية','تاريخ البيع','فرع البيع','القيمة','توقيت البيع','المستحق','المنفذ','المتأخر','عملاء ردوا','وقت الرفع','كود العميل','حالة المهمة','وقت التنفيذ'],
    ['إجمالي الردود',report.day,report.branch,null,null,null,null,null,null,null,null,null,null,null,null,null,null,report.replied],
  ];
  for (const t of report.team) rows.push(['الفريق',report.day,report.branch,t.staff_name ?? t.staff_code,null,null,null,null,null,null,null,null,null,null,t.due,t.completed,t.overdue,t.replied]);
  for (const f of report.followups) {
    const base = [f.day,report.branch,f.staff_name ?? f.staff_code,f.customer_name,TASK_LABELS[f.task_type] ?? 'أخرى',f.reply,f.bought_after ? 'نعم' : null,f.segment_at_followup,f.current_segment];
    const extra = [null,null,null,null,null,f.customer_code,f.completed ? 'منفذة' : 'غير مكتملة',f.completed_at];
    rows.push(['متابعة',...base,null,null,null,null,...extra]);
    for (const s of f.sales) rows.push(['بيع',...base,s.day,s.branch,s.amount,s.timing,...extra]);
  }
  for (const u of report.uploads) rows.push(['الرفع',report.day,report.branch,null,null,u.kind,null,null,null,null,null,null,null,null,null,null,null,null,u.at]);
  const csv = rows.map((row) => Array.from({ length: rows[0].length }, (_, index) => row[index]).map((cell) => '"' + String(typeof cell === 'string' && /^[\s]*[=+@-]/.test(cell) ? "'" + cell : cell ?? '').replaceAll('"','""') + '"').join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff',csv], {type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = `customer-service-${report.day}-${report.branch === 'فرع شكري' ? 'shokry' : 'shamy'}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CustomerServiceReport() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  const previous = new Date(today + 'T00:00:00Z');
  previous.setUTCDate(previous.getUTCDate() - 1);
  const [day, setDay] = useState(() => previous.toISOString().slice(0, 10));
  const [branch, setBranch] = useState('فرع شكري');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('dawaa_cs_named_report_v1', { p_day: day, p_branch: branch });
        if (error) throw error;
        if (current) setReport(data as Report);
      } catch {
        if (current) setError(true);
      }
    })();
    return () => { current = false; };
  }, [day, branch, refresh]);
  const reset = () => { setError(false); setReport(null); };

  return (
    <div className="space-y-4" dir="rtl">
      <Panel>
        <h1 className="text-lg font-black">تقرير خدمة العملاء</h1>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label>اليوم <input className="input-field" type="date" max={today} value={day}
            onChange={(event) => { if (!event.target.value || day === event.target.value) return; reset(); setDay(event.target.value); }} /></label>
          <label>الفرع <select className="input-field" value={branch}
            onChange={(event) => { reset(); setBranch(event.target.value); }}>
            <option>فرع شكري</option><option>فرع الشامي</option>
          </select></label>
          <button type="button" className="btn-secondary" onClick={() => { reset(); setRefresh((n) => n + 1); }}>تحديث</button>
          <button type="button" className="btn-secondary" disabled={!report} onClick={() => report && exportReport(report)}>تنزيل CSV</button>
        </div>
        {error ? <p role="alert">تعذر تحميل التقرير. راجع صلاحية إدارة مهام خدمة العملاء والتاريخ المختار.</p> : null}
        {!report && !error ? <p role="status">جارٍ تحميل التقرير…</p> : null}
      </Panel>
      {report ? <>
        <Panel>
          <h2 className="font-black">ملخص اليوم</h2>
          <p>{report.team.reduce((n,t) => n + t.due, 0)} مهمة مستحقة · {report.team.reduce((n,t) => n + t.completed, 0)} منفذة · {report.team.reduce((n,t) => n + t.overdue, 0)} متأخرة</p>
          <p>{report.replied} عميل رد · {report.followups.filter((f) => f.bought_after).length} متابعة اتسجّل بعدها شراء</p>
        </Panel>
        <Panel>
          <h2 className="font-black">أداء الفريق · {report.replied} عميل رد</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead><tr><th>الموظف</th><th>المستحق</th><th>المنفذ</th><th>المتأخر</th><th>عملاء ردوا</th></tr></thead>
              <tbody>{report.team.map((t) => <tr key={t.staff_code ?? 'unassigned'}><td>{t.staff_name ?? t.staff_code ?? 'غير مسند'}</td><td>{t.due}</td><td>{t.completed}</td><td>{t.overdue}</td><td>{t.replied}</td></tr>)}</tbody>
            </table>
          </div>
          {!report.team.length ? <p>مفيش مهام مسجلة للفترة المختارة.</p> : null}
        </Panel>
        <Panel>
          <h2 className="font-black">المتابعات والمبيعات</h2>
          <p className="text-xs opacity-75">المبيعات من ٧ أيام قبل يوم المهمة إلى ٧ أيام بعده. الشراء اللاحق بيعبّر عن ترتيب زمني. شريحة وقت المتابعة بتظهر لما مصدر المهمة يدل عليها.</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead><tr><th>التاريخ</th><th>الموظف</th><th>المهمة</th><th>العميل</th><th>النتيجة</th><th>الشريحة وقتها</th><th>الحالية</th><th>المبيعات</th></tr></thead>
              <tbody>{report.followups.map((f,index) => <tr key={`${f.customer_code ?? 'uncoded'}:${index}`} className="border-t border-[var(--dawaa-theme-border)] align-top">
                <td>{f.day}</td><td>{f.staff_name ?? f.staff_code ?? 'غير مسند'}</td><td>{TASK_LABELS[f.task_type] ?? 'أخرى'}</td>
                <td>{f.customer_name ?? 'الاسم غير مسجل'}{f.customer_code ? <div className="text-xs">كود {f.customer_code}</div> : null}</td>
                <td>{f.completed ? 'منفذة' : 'غير مكتملة'} · {f.reply ?? 'الرد غير مسجل'}
                  {f.bought_after ? ' · اشترى بعدها' : ''}
                  {f.completed_at ? <div className="text-xs">{stamp(f.completed_at)}</div> : null}
                </td>
                <td>{f.segment_at_followup ?? 'غير موثقة'}</td><td>{f.current_segment ?? 'غير موثقة'}</td>
                <td>{f.sales.length ? <ul>{f.sales.map((sale,i) => <li key={i}>{sale.day} · {sale.amount} ج · {sale.branch} · {sale.timing}</li>)}</ul> : '—'}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </Panel>
        <Panel>
          <h2 className="font-black">حالة الملفات اليومية</h2>
          <ul>{report.uploads.map((u) => <li key={u.kind}>{u.kind} · {u.at ? stamp(u.at) : 'مفيش رفع موثق'}</li>)}</ul>
          <p className="mt-2 text-xs opacity-75">آخر تحديث {stamp(report.generated_at)}</p>
        </Panel>
      </> : null}
    </div>
  );
}
