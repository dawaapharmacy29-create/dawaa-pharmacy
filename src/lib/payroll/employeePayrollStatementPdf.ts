import { getEmployeePayrollStatementV1, type EmployeePayrollStatementV1 } from './payrollStatementService';

const esc = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const num = (value: unknown) => { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; };
const money = (value: unknown) => num(value).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';
const mins = (value: unknown) => Math.max(0, Math.round(num(value)));
const durationHours = (value: unknown) => {
  const total = Math.max(0, Math.round(num(value) * 60));
  const h = Math.floor(total / 60); const m = total % 60;
  if (!h) return m.toLocaleString('ar-EG') + ' دقيقة';
  return m ? h.toLocaleString('ar-EG') + ':' + String(m).padStart(2, '0') + ' ساعة' : h.toLocaleString('ar-EG') + ' ساعة';
};
const weekday = (value: string) => {
  const d = new Date(value + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ar-EG', { weekday: 'long', timeZone: 'Africa/Cairo' }).format(d);
};

function shell(title: string, body: string, preview: boolean) {
  const watermark = preview ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:.06;font-size:64px;font-weight:900;transform:rotate(-28deg)">معاينة - غير نهائي</div>' : '';
  return '<section class="statement-page" style="position:relative;width:794px;min-height:1123px;box-sizing:border-box;padding:34px;background:#fff;color:#182936;font-family:Tahoma,Arial,sans-serif;direction:rtl;overflow:hidden">' +
    watermark +
    '<header style="border-bottom:3px solid #087e79;padding-bottom:12px;margin-bottom:16px"><div style="font-size:22px;font-weight:900">صيدليات دواء · ' + esc(title) + '</div></header>' +
    body +
    '<footer style="position:absolute;bottom:22px;right:34px;left:34px;border-top:1px solid #dbe4e6;padding-top:8px;font-size:9px;color:#687c83">كشف مولد من Payroll Statement V1 - تفاصيل الأرقام مرتبطة بمصادرها المعتمدة.</footer>' +
  '</section>';
}

function card(label: string, value: string, hint = '') {
  return '<div style="border:1px solid #d6e3e2;border-radius:10px;padding:10px;background:#f8fbfb"><div style="font-size:10px;color:#687c83">' + esc(label) + '</div><div style="font-size:17px;font-weight:900;margin-top:4px">' + esc(value) + '</div>' + (hint ? '<div style="font-size:9px;color:#687c83;margin-top:3px">' + esc(hint) + '</div>' : '') + '</div>';
}

function row(label: string, value: string, emphasis = false) {
  return '<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #e7ecec;font-size:11px"><span>' + esc(label) + '</span><b style="' + (emphasis ? 'font-size:13px;color:#087e79' : '') + '">' + esc(value) + '</b></div>';
}

function buildPages(data: EmployeePayrollStatementV1) {
  const financial = data.financial;
  const engine = data.payroll_engine;
  const overtime = data.overtime.summary;
  const attendance = data.attendance.summary;
  const preview = !financial.frozen;
  const pages: string[] = [];

  const headline = '<div style="display:flex;justify-content:space-between;gap:16px;margin-bottom:16px;font-size:12px"><div><b>الموظف:</b> ' + esc(data.staff.name) + '<br/><b>الفرع:</b> ' + esc(data.staff.branch || '-') + '</div><div><b>الدورة:</b> ' + esc(data.cycle.start) + ' إلى ' + esc(data.cycle.end) + '<br/><b>الحالة:</b> ' + esc(data.finalization.ready ? 'جاهز للإقفال' : 'قيد المراجعة') + '</div></div>';
  const cards = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">' +
    card('ساعات الأساسي', durationHours(engine.base_payable_hours), 'سعر الساعة ' + money(engine.true_hourly_rate)) +
    card('الأساسي', money(financial.earnings.base_salary)) +
    card('إضافي معتمد', money(financial.earnings.approved_overtime), durationHours(overtime.approved_hours)) +
    card('صافي الراتب', money(financial.display_net_salary), financial.frozen ? 'قيمة مجمدة' : 'Preview') +
  '</div>';
  const earnings = '<h2 style="font-size:14px;color:#087e79">المستحقات</h2>' +
    row('الراتب الأساسي', money(financial.earnings.base_salary)) +
    row('الحوافز الآلية', money(financial.earnings.automated_incentives_total)) +
    row('حافز اللستة', money(financial.earnings.list_incentive)) +
    row('Overtime معتمد', money(financial.earnings.approved_overtime)) +
    row('حوافز يدوية أخرى', money(financial.earnings.manual_other_incentives));
  const deductions = '<h2 style="font-size:14px;color:#a84444;margin-top:14px">الخصومات والتسويات</h2>' +
    row('عجز / إكسبير', money(financial.adjustments.expiry_shortage_deduction)) +
    row('خصم عام فرع', money(financial.adjustments.branch_general_deduction)) +
    row('خصم فردي', money(financial.adjustments.individual_deduction)) +
    row('خصومات أخرى', money(financial.adjustments.other_deduction)) +
    row('تسوية يدوية (+/-)', money(financial.adjustments.manual_adjustment)) +
    row('إجمالي الخصومات', money(financial.adjustments.deductions_total), true);
  const ruleBox = '<div style="margin-top:16px;border:1px solid #b7d9d6;border-radius:10px;padding:12px;background:#eef8f6;font-size:10px;line-height:1.7"><b>قاعدة الحساب:</b> حافز الأداء داخل إجمالي الحوافز الآلية مرة واحدة فقط. الأوفر تايم المعلق أو المرفوض لا يدخل المرتب. نقاط الأداء غير المالية لا تخصم جنيهات إلا بعد تحويلها لبند مالي معتمد.</div>';
  pages.push(shell('كشف راتب الموظف', headline + cards + earnings + deductions + ruleBox, preview));

  const attendanceRows = data.attendance.days;
  const attendanceChunks: typeof attendanceRows[] = [];
  for (let i = 0; i < attendanceRows.length; i += 13) attendanceChunks.push(attendanceRows.slice(i, i + 13));
  attendanceChunks.forEach((chunk, pageIndex) => {
    const tableRows = chunk.map((d) => '<tr>' +
      '<td>' + esc(weekday(d.date)) + '<br/><span style="font-size:9px;color:#687c83">' + esc(d.date) + '</span></td>' +
      '<td>' + esc(d.resolution_status || d.status || '-') + '</td>' +
      '<td>' + esc(durationHours(d.payroll_eligible_hours ?? d.candidate_hours)) + '</td>' +
      '<td>' + esc(mins(d.late_minutes).toLocaleString('ar-EG')) + ' د</td>' +
      '<td>' + esc(mins(d.early_leave_minutes).toLocaleString('ar-EG')) + ' د</td>' +
      '<td>' + esc(d.missing_punch ? 'نعم' : 'لا') + '</td>' +
    '</tr>').join('');
    const body = '<div style="font-size:11px;margin-bottom:12px"><b>ملخص الحضور:</b> أيام عمل ' + esc(num(attendance.worked_days).toLocaleString('ar-EG')) + ' · تأخير ' + esc(num(attendance.late_minutes).toLocaleString('ar-EG')) + ' دقيقة · خروج مبكر ' + esc(num(attendance.early_leave_minutes).toLocaleString('ar-EG')) + ' دقيقة</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr style="background:#eef8f6"><th>اليوم</th><th>الحالة</th><th>الساعات</th><th>تأخير</th><th>خروج مبكر</th><th>بصمة مفقودة</th></tr></thead><tbody>' + tableRows + '</tbody></table>';
    pages.push(shell('تفاصيل الحضور ' + (pageIndex + 1).toLocaleString('ar-EG'), body, preview));
  });

  const leaveRows = data.annual_leave.balances.map((b) => '<div style="border:1px solid #d6e3e2;border-radius:10px;padding:10px"><b>' + esc(b.year) + '</b><br/>' + (b.configured ? 'المتبقي ' + esc(num(b.balance).toLocaleString('ar-EG')) + ' يوم · المستخدم ' + esc(num(b.used).toLocaleString('ar-EG')) + ' يوم · المحجوز ' + esc(num(b.reserved).toLocaleString('ar-EG')) + ' يوم' : 'الرصيد غير مهيأ') + '</div>').join('');
  const overtimeRows = data.overtime.cases.map((o) => '<tr><td>' + esc(o.date) + '</td><td>' + esc(durationHours(o.overtime_hours)) + '</td><td>' + esc(o.status) + '</td><td>' + esc(o.status === 'approved' ? money(o.overtime_amount) : '-') + '</td></tr>').join('');
  const missingRows = data.missing_punch.incidents.map((m) => '<tr><td>' + esc(m.date) + '</td><td>' + esc(m.missing_type) + '</td><td>' + esc(m.occurrence_no) + '</td><td>' + esc(m.deduction_applied ? money(m.penalty_amount) : 'لم يخصم') + '</td></tr>').join('');
  const opsBody = '<h2 style="font-size:14px;color:#087e79">رصيد الإجازة السنوية</h2><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">' + leaveRows + '</div>' +
    '<h2 style="font-size:14px;color:#087e79;margin-top:16px">الأوفر تايم</h2><div style="font-size:10px;margin-bottom:6px">معتمد ' + esc(durationHours(overtime.approved_hours)) + ' · معلق ' + esc(durationHours(overtime.pending_hours)) + ' · مرفوض ' + esc(durationHours(overtime.rejected_hours)) + '</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr><th>التاريخ</th><th>المدة</th><th>الحالة</th><th>القيمة</th></tr></thead><tbody>' + overtimeRows + '</tbody></table>' +
    '<h2 style="font-size:14px;color:#087e79;margin-top:16px">البصمات المفقودة</h2><table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr><th>التاريخ</th><th>النوع</th><th>المرة</th><th>الأثر المالي</th></tr></thead><tbody>' + missingRows + '</tbody></table>';
  pages.push(shell('الإجازات والأوفر تايم والبصمات', opsBody, preview));

  const kpi = data.kpi;
  const employeeSales = kpi.employee_sales_kpi;
  const kpiBody = '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">' +
    '<div style="border:1px solid #d6e3e2;border-radius:10px;padding:12px"><h2 style="font-size:14px;color:#087e79">أداء الموظف</h2>' +
      row('صافي النقاط', num(kpi.staff_performance.final_points).toLocaleString('ar-EG')) +
      row('نسبة التقدم', num(kpi.staff_performance.progress_pct).toLocaleString('ar-EG') + '%') +
      row('حافز الأداء', money(kpi.staff_performance.final_incentive_egp)) +
      row('مبيعات الموظف', money(employeeSales.sales_total)) +
      row('فواتير الموظف', num(employeeSales.invoices_count).toLocaleString('ar-EG')) +
      row('متوسط فاتورة الموظف', money(employeeSales.avg_invoice)) +
    '</div>' +
    '<div style="border:1px solid #d6e3e2;border-radius:10px;padding:12px"><h2 style="font-size:14px;color:#087e79">أداء الفرع</h2>' +
      row('التارجت', money(kpi.branch_target.target_amount)) +
      row('المبيعات', money(kpi.branch_target.sales_total)) +
      row('تحقيق التارجت', num(kpi.branch_target.achievement_percent).toLocaleString('ar-EG') + '%') +
      row('عدد الفواتير', num(kpi.branch_target.invoices_count).toLocaleString('ar-EG')) +
      row('متوسط الفاتورة', money(kpi.branch_kpis.avg_invoice)) +
      row('عدد العملاء', num(kpi.branch_kpis.unique_customers).toLocaleString('ar-EG')) +
    '</div></div>' +
    '<div style="margin-top:16px;border:1px solid #d6e3e2;border-radius:10px;padding:12px;font-size:10px;color:#687c83">KPIs سياق للشفافية ولا تغير الراتب مباشرة. التأثير المالي يدخل فقط من Incentive Truth المعتمدة.</div>';
  pages.push(shell('الأداء وKPIs', kpiBody, preview));

  return pages;
}

export async function buildEmployeePayrollStatementPdf(staffId: string, monthCycle: string) {
  const data = await getEmployeePayrollStatementV1(staffId, monthCycle);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-12000px;top:0;width:794px;background:#fff';
  host.dir = 'rtl';
  const pages = buildPages(data);
  host.innerHTML = pages.join('');
  host.querySelectorAll('table').forEach((table) => {
    (table as HTMLElement).style.borderCollapse = 'collapse';
    table.querySelectorAll('th,td').forEach((cell) => {
      (cell as HTMLElement).style.padding = '7px';
      (cell as HTMLElement).style.borderBottom = '1px solid #e4e9ea';
      (cell as HTMLElement).style.textAlign = 'right';
    });
  });
  document.body.appendChild(host);
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    const pdf = new jsPDF('p', 'mm', 'a4');
    const elements = Array.from(host.querySelectorAll('.statement-page')) as HTMLElement[];
    for (let index = 0; index < elements.length; index += 1) {
      const canvas = await html2canvas(elements[index], { scale: 2, backgroundColor: '#fff', logging: false });
      const png = canvas.toDataURL('image/png');
      if (index > 0) pdf.addPage();
      pdf.addImage(png, 'PNG', 0, 0, 210, 297);
    }
    return {
      pdf,
      fileName: (data.financial.frozen ? 'كشف-راتب' : 'معاينة-كشف-راتب') + '-' + data.cycle.month_cycle + '-' + data.staff.id + '.pdf',
      statement: data,
    };
  } finally {
    host.remove();
  }
}