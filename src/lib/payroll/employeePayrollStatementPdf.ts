import { getEmployeePayrollStatementV1, type EmployeePayrollStatementV1 } from './payrollStatementService';

const esc = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const num = (value: unknown) => { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; };
const money = (value: unknown) => num(value).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';
const mins = (value: unknown) => Math.max(0, Math.round(num(value)));
const durationHours = (value: unknown) => {
  const total = Math.max(0, Math.round(num(value) * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return m.toLocaleString('ar-EG') + ' دقيقة';
  return m ? h.toLocaleString('ar-EG') + ':' + String(m).padStart(2, '0') + ' ساعة' : h.toLocaleString('ar-EG') + ' ساعة';
};
const weekday = (value: string) => {
  const d = new Date(value + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ar-EG', { weekday: 'long', timeZone: 'Africa/Cairo' }).format(d);
};
const cairoTime = (value?: string | null) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' });
};
const STATUS_LABELS: Record<string, string> = {
  approved: 'معتمد',
  pending: 'معلق',
  pending_review: 'يحتاج مراجعة',
  rejected: 'مرفوض',
  active: 'فعال',
  cancelled: 'ملغي',
  paid: 'مدفوع',
  off_day: 'يوم راحة',
  approved_time_off: 'إجازة/إذن معتمد',
  absence_review: 'غياب',
  worked_on_off: 'عمل يوم راحة',
};
const statusLabel = (value?: string | null) => STATUS_LABELS[String(value || '')] || String(value || '-');

function pageShell(title: string, subtitle: string, body: string, preview: boolean, pageCode: string) {
  const watermark = preview
    ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:.045;font-size:62px;font-weight:900;transform:rotate(-28deg);color:#102235">معاينة - غير نهائي</div>'
    : '';
  return '<section class="statement-page" style="position:relative;width:794px;min-height:1123px;box-sizing:border-box;padding:30px 34px 46px;background:#fff;color:#102235;font-family:Tahoma,Arial,sans-serif;direction:rtl;overflow:hidden">' +
    watermark +
    '<header style="display:flex;align-items:center;justify-content:space-between;gap:18px;border-bottom:3px solid #0b8c86;padding-bottom:10px;margin-bottom:15px">' +
      '<div><div style="font-size:20px;font-weight:900">' + esc(title) + '</div><div style="margin-top:3px;font-size:9px;color:#687983">' + esc(subtitle) + '</div></div>' +
      '<div style="display:flex;align-items:center;gap:8px"><div style="text-align:left;font-size:8px;color:#677983"><b style="display:block;font-size:10px;color:#102235">صيدليات دواء</b>كل اللي تحتاجه وأكثر</div><div style="width:68px;height:58px;overflow:hidden;border-radius:10px;background:#fff"><img src="/dawaa-logo-full.jpeg" alt="صيدليات دواء" style="width:68px;height:92px;object-fit:contain;transform:translateY(-8px)"/></div></div>' +
    '</header>' +
    body +
    '<footer style="position:absolute;bottom:18px;right:34px;left:34px;border-top:1px solid #dce6e7;padding-top:7px;font-size:8px;color:#72818a;display:flex;justify-content:space-between;gap:10px"><span>صيدليات دواء - Payroll Statement V1</span><span>' + esc(pageCode) + '</span></footer>' +
  '</section>';
}

function card(label: string, value: string, hint = '', tone: 'normal' | 'success' | 'danger' = 'normal') {
  const palette = tone === 'success'
    ? 'border-color:#b9ded9;background:#eff9f7'
    : tone === 'danger'
      ? 'border-color:#efc6c9;background:#fff5f5'
      : 'border-color:#d9e4e5;background:#f9fbfb';
  return '<div style="border:1px solid;border-radius:12px;padding:11px;' + palette + '"><div style="font-size:9px;color:#6b7b84">' + esc(label) + '</div><div style="font-size:17px;font-weight:900;margin-top:4px">' + esc(value) + '</div>' + (hint ? '<div style="font-size:8px;color:#6b7b84;margin-top:3px;line-height:1.5">' + esc(hint) + '</div>' : '') + '</div>';
}

function line(label: string, value: string, emphasis = false) {
  return '<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #e8eeee;font-size:10px"><span>' + esc(label) + '</span><b style="' + (emphasis ? 'font-size:12px;color:#087f7a' : '') + '">' + esc(value) + '</b></div>';
}

function table(rows: string, headers: string[]) {
  return '<table style="width:100%;border-collapse:collapse;font-size:8.5px"><thead><tr style="background:#eef8f7;color:#26494b">' +
    headers.map((h) => '<th style="padding:7px;text-align:right;font-weight:900">' + esc(h) + '</th>').join('') +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function buildPages(data: EmployeePayrollStatementV1) {
  const financial = data.financial;
  const engine = data.payroll_engine;
  const overtime = data.overtime.summary;
  const attendance = data.attendance.summary;
  const preview = !financial.frozen;
  const pages: string[] = [];

  const earningsTotal =
    num(financial.earnings.base_salary) +
    num(financial.earnings.automated_incentives_total) +
    num(financial.earnings.list_incentive) +
    num(financial.earnings.approved_overtime) +
    num(financial.earnings.manual_other_incentives);

  const identity =
    '<div style="display:flex;justify-content:space-between;gap:16px;margin-bottom:14px;font-size:10px;line-height:1.8">' +
      '<div><b>الموظف:</b> ' + esc(data.staff.name) + '<br/><b>الفرع:</b> ' + esc(data.staff.branch || '-') + '</div>' +
      '<div><b>الدورة:</b> ' + esc(data.cycle.start) + ' - ' + esc(data.cycle.end) + '<br/><b>حالة الكشف:</b> ' + esc(financial.frozen ? 'مجمد/نهائي' : data.finalization.ready ? 'جاهز للإقفال' : 'قيد المراجعة') + '</div>' +
    '</div>';

  const netHero =
    '<div style="display:grid;grid-template-columns:1.3fr .7fr;gap:10px;margin-bottom:14px">' +
      '<div style="border:1px solid #b8ded9;background:#eff9f7;border-radius:16px;padding:16px"><div style="font-size:9px;color:#52706f">صافي الراتب الحالي</div><div style="font-size:28px;font-weight:900;color:#087f7a;margin-top:4px">' + esc(money(financial.display_net_salary)) + '</div><div style="font-size:8px;color:#607577;margin-top:4px">المستحقات ' + esc(money(earningsTotal)) + ' - الخصومات ' + esc(money(financial.adjustments.deductions_total)) + ' + تسوية ' + esc(money(financial.adjustments.manual_adjustment)) + '</div></div>' +
      '<div style="border:1px solid #d9e4e5;border-radius:16px;padding:13px;background:#fff"><div style="font-size:9px;color:#6c7a83">المعادلة الأساسية</div><div style="font-size:13px;font-weight:900;margin-top:7px">' + esc(durationHours(engine.base_payable_hours)) + '</div><div style="font-size:9px;color:#6c7a83;margin-top:3px">× ' + esc(money(engine.true_hourly_rate)) + '</div><div style="border-top:1px solid #e8eeee;margin-top:8px;padding-top:7px;font-size:11px;font-weight:900;color:#087f7a">' + esc(money(financial.earnings.base_salary)) + '</div></div>' +
    '</div>';

  const overviewCards =
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">' +
      card('ساعات أساسي', durationHours(engine.base_payable_hours), 'Attendance Truth المعتمد') +
      card('Overtime معتمد', durationHours(overtime.approved_hours), money(financial.earnings.approved_overtime), 'success') +
      card('الحوافز الآلية', money(financial.earnings.automated_incentives_total), 'الأداء + التارجت + البنود الآلية') +
      card('البصمات المفقودة', num(data.missing_punch.summary.incidents).toLocaleString('ar-EG'), 'خصم فعلي ' + money(data.missing_punch.summary.deduction_amount), num(data.missing_punch.summary.deduction_amount) > 0 ? 'danger' : 'normal') +
    '</div>';

  const earnings =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      '<div style="border:1px solid #d9e4e5;border-radius:12px;padding:12px"><div style="font-size:12px;font-weight:900;color:#087f7a;margin-bottom:5px">المستحقات</div>' +
        line('الراتب الأساسي', money(financial.earnings.base_salary)) +
        line('الحوافز الآلية', money(financial.earnings.automated_incentives_total)) +
        line('حافز اللستة', money(financial.earnings.list_incentive)) +
        line('Overtime معتمد', money(financial.earnings.approved_overtime)) +
        line('حوافز يدوية أخرى', money(financial.earnings.manual_other_incentives)) +
        line('إجمالي المستحقات', money(earningsTotal), true) +
      '</div>' +
      '<div style="border:1px solid #d9e4e5;border-radius:12px;padding:12px"><div style="font-size:12px;font-weight:900;color:#a04449;margin-bottom:5px">الخصومات والتسويات</div>' +
        line('عجز / إكسبير', money(financial.adjustments.expiry_shortage_deduction)) +
        line('خصم عام فرع', money(financial.adjustments.branch_general_deduction)) +
        line('خصم فردي', money(financial.adjustments.individual_deduction)) +
        line('خصومات أخرى', money(financial.adjustments.other_deduction)) +
        line('تسوية يدوية (+/-)', money(financial.adjustments.manual_adjustment)) +
        line('إجمالي الخصومات', money(financial.adjustments.deductions_total), true) +
      '</div>' +
    '</div>';

  const attentionItems = [
    num(engine.pending_review_days) > 0 ? num(engine.pending_review_days).toLocaleString('ar-EG') + ' يوم حضور يحتاج مراجعة' : '',
    num(overtime.pending_cases) > 0 ? num(overtime.pending_cases).toLocaleString('ar-EG') + ' حالة Overtime معلقة (' + durationHours(overtime.pending_hours) + ')' : '',
    num(data.transactions.summary.pending_rows) > 0 ? num(data.transactions.summary.pending_rows).toLocaleString('ar-EG') + ' حركة معلقة' : '',
    data.finalization.blockers.length ? data.finalization.blockers.length.toLocaleString('ar-EG') + ' مانع إقفال' : '',
  ].filter(Boolean);

  const attention = attentionItems.length
    ? '<div style="margin-top:14px;border:1px solid #efca78;background:#fff9ec;border-radius:11px;padding:10px;font-size:9px;line-height:1.7"><b style="color:#8b5d00">قبل الإقفال النهائي:</b> ' + esc(attentionItems.join(' · ')) + '</div>'
    : '<div style="margin-top:14px;border:1px solid #b8ded9;background:#eff9f7;border-radius:11px;padding:10px;font-size:9px"><b style="color:#087f7a">لا توجد عناصر معلقة حرجة في البيانات الحالية.</b></div>';

  const rules =
    '<div style="margin-top:10px;font-size:8px;color:#6b7a82;line-height:1.6">الأساسي = ساعات الحضور المعتمدة بحد أقصى ساعات الجدول × سعر الساعة. الـOvertime المعتمد منفصل. الحافز الشهري لا يُجمع مرتين؛ هو داخل إجمالي الحوافز الآلية. البنود Pending أو Rejected تظهر للشفافية ولا تدخل الصافي.</div>';

  pages.push(pageShell('كشف الراتب والشفافية الشهرية', 'ملخص تنفيذي يوضح كيف تم تكوين صافي الراتب', identity + netHero + overviewCards + earnings + attention + rules, preview, 'ملخص مالي'));

  const attendanceRows = data.attendance.days;
  const attendanceChunks: typeof attendanceRows[] = [];
  for (let i = 0; i < attendanceRows.length; i += 11) attendanceChunks.push(attendanceRows.slice(i, i + 11));

  attendanceChunks.forEach((chunk, pageIndex) => {
    const rows = chunk.map((d) => {
      const shift = d.scheduled_start_at && d.scheduled_end_at ? cairoTime(d.scheduled_start_at) + ' - ' + cairoTime(d.scheduled_end_at) : '-';
      const actual = cairoTime(d.first_in) + ' / ' + cairoTime(d.last_out);
      const notes = [
        statusLabel(d.resolution_status || d.status),
        d.late_minutes ? 'تأخير ' + mins(d.late_minutes).toLocaleString('ar-EG') + 'د' : '',
        d.early_leave_minutes ? 'خروج مبكر ' + mins(d.early_leave_minutes).toLocaleString('ar-EG') + 'د' : '',
        d.missing_punch ? 'بصمة مفقودة' : '',
      ].filter(Boolean).join(' · ');
      return '<tr><td>' + esc(weekday(d.date)) + '<br/><span style="font-size:7.5px;color:#72818a">' + esc(d.date) + '</span></td><td>' + esc(shift) + '</td><td>' + esc(actual) + '</td><td><b>' + esc(durationHours(d.payroll_eligible_hours ?? d.candidate_hours)) + '</b></td><td>' + esc(notes || '-') + '</td></tr>';
    }).join('');

    const summary =
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:12px">' +
        card('أيام العمل', num(attendance.worked_days).toLocaleString('ar-EG')) +
        card('إجازات/أذونات', num(attendance.approved_time_off_days).toLocaleString('ar-EG')) +
        card('إجمالي التأخير', mins(attendance.late_minutes).toLocaleString('ar-EG') + ' دقيقة') +
        card('الخروج المبكر', mins(attendance.early_leave_minutes).toLocaleString('ar-EG') + ' دقيقة') +
      '</div>';

    pages.push(pageShell('تفاصيل الحضور', 'الشيفت الأصلي مقابل الدخول والخروج والساعات المحتسبة', summary + table(rows, ['اليوم', 'الشيفت', 'الدخول / الخروج', 'المحتسب', 'الحالة / الملاحظة']), preview, 'الحضور ' + (pageIndex + 1).toLocaleString('ar-EG') + '/' + attendanceChunks.length.toLocaleString('ar-EG')));
  });

  const annualLeave = data.annual_leave.balances.map((b) =>
    '<div style="border:1px solid #d9e4e5;border-radius:11px;padding:10px;background:#f9fbfb"><b>' + esc(b.year) + '</b>' +
    (b.configured
      ? '<div style="font-size:9px;margin-top:5px">المتبقي <b>' + esc(num(b.balance).toLocaleString('ar-EG')) + '</b> يوم · المستخدم <b>' + esc(num(b.used).toLocaleString('ar-EG')) + '</b> · المحجوز <b>' + esc(num(b.reserved).toLocaleString('ar-EG')) + '</b></div>'
      : '<div style="font-size:9px;margin-top:5px;color:#956800">الرصيد غير مهيأ</div>') +
    '</div>'
  ).join('');

  const timeOffRows = data.time_off.requests.map((r) =>
    '<tr><td>' + esc(r.label || r.kind) + '</td><td>' + esc(r.start_date + (r.end_date !== r.start_date ? ' - ' + r.end_date : '')) + '</td><td>' + esc(r.duration_minutes ? mins(r.duration_minutes).toLocaleString('ar-EG') + ' دقيقة' : 'يوم كامل') + '</td><td>' + esc(statusLabel(r.status)) + '</td><td>' + esc(r.decision_note || r.reason || '-') + '</td></tr>'
  ).join('');

  const missingRows = data.missing_punch.incidents.map((m) =>
    '<tr><td>' + esc(m.date) + '</td><td>' + esc(m.missing_type) + '</td><td>' + esc(m.occurrence_no) + ' / سماح ' + esc(m.allowance_limit) + '</td><td>' + esc(m.deduction_applied ? money(m.penalty_amount) : 'لا يوجد خصم مالي') + '</td><td>' + esc(m.reason || '-') + '</td></tr>'
  ).join('');

  const leaveBody =
    '<h2 style="font-size:12px;color:#087f7a;margin:0 0 8px">رصيد الإجازة السنوية</h2><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:14px">' + annualLeave + '</div>' +
    '<h2 style="font-size:12px;color:#087f7a;margin:0 0 8px">الإجازات والأذونات خلال الدورة</h2>' +
    (timeOffRows ? table(timeOffRows, ['النوع', 'التاريخ', 'المدة', 'الحالة', 'الملاحظة']) : '<div style="font-size:9px;color:#6b7a82">لا توجد طلبات إجازة أو إذن خلال هذه الدورة.</div>') +
    '<h2 style="font-size:12px;color:#087f7a;margin:15px 0 8px">البصمات المفقودة</h2>' +
    (missingRows ? table(missingRows, ['التاريخ', 'النوع', 'الواقعة', 'الأثر المالي', 'السبب']) : '<div style="font-size:9px;color:#6b7a82">لا توجد بصمات مفقودة مسجلة.</div>');

  pages.push(pageShell('الإجازات والأذونات والبصمات', 'الرصيد والقرارات والأثر المالي الفعلي', leaveBody, preview, 'الإجازات والبصمات'));

  const overtimeRows = data.overtime.cases.map((o) =>
    '<tr><td>' + esc(weekday(o.date)) + '<br/><span style="font-size:7.5px;color:#72818a">' + esc(o.date) + '</span></td><td>' + esc(o.branch || '-') + '</td><td>' + esc(durationHours(o.overtime_hours)) + '</td><td>' + esc(statusLabel(o.status)) + '</td><td>' + esc(o.status === 'approved' ? money(o.overtime_amount) : '-') + '</td><td>' + esc(o.decision_note || '-') + '</td></tr>'
  ).join('');

  const overtimeBody =
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:12px">' +
      card('إجمالي المرشح', durationHours(overtime.detected_hours)) +
      card('معتمد', durationHours(overtime.approved_hours), money(overtime.approved_amount), 'success') +
      card('معلق', durationHours(overtime.pending_hours), 'لا يدخل الراتب قبل الاعتماد') +
      card('مرفوض', durationHours(overtime.rejected_hours), 'للمعلومة فقط') +
    '</div>' +
    (overtimeRows ? table(overtimeRows, ['اليوم', 'الفرع', 'المدة', 'الحالة', 'القيمة', 'سبب القرار']) : '<div style="font-size:9px;color:#6b7a82">لا توجد حالات Overtime في هذه الدورة.</div>');

  pages.push(pageShell('تفاصيل الأوفر تايم', 'ما تم اعتماده وما بقي معلقًا أو تم رفضه', overtimeBody, preview, 'Overtime'));

  const manualLedgerEntries = data.financial.manual_ledger?.entries || [];
  if (manualLedgerEntries.length) {
    const manualRows = manualLedgerEntries.map((raw) => {
      const e = raw as Record<string, unknown>;
      const signed = num(e.signed_amount);
      return '<tr><td>' + esc(e.created_at ? new Date(String(e.created_at)).toLocaleDateString('ar-EG') : '-') + '</td><td>' +
        esc(String(e.entry_kind || '-')) + '</td><td>' + esc(String(e.category || '-')) + '</td><td><b>' +
        esc((signed > 0 ? '+' : '') + money(signed)) + '</b></td><td>' + esc(String(e.reason || '-')) +
        '</td><td>' + esc(String(e.created_by_name || '-')) + '</td></tr>';
    }).join('');

    const manualBody =
      '<div style="font-size:9px;color:#6b7a82;margin-bottom:10px">كل حركة يدوية محفوظة كسطر immutable؛ التصحيح يتم بعكس الحركة وليس بتعديل التاريخ.</div>' +
      table(manualRows, ['التاريخ', 'النوع', 'الفئة', 'القيمة', 'السبب', 'سجلها']);

    pages.push(pageShell('التسويات المالية اليدوية', 'سجل Manual Ledger داخل نفس دورة الراتب', manualBody, preview, 'Manual Ledger'));
  }

  const visibleTransactions = data.transactions.items.filter((t) => t.employee_visible !== false);
  const transactionChunks: typeof visibleTransactions[] = [];
  for (let i = 0; i < visibleTransactions.length; i += 14) transactionChunks.push(visibleTransactions.slice(i, i + 14));
  if (!transactionChunks.length) transactionChunks.push([]);

  transactionChunks.forEach((chunk, index) => {
    const rows = chunk.map((t) =>
      '<tr><td>' + esc(t.date || '-') + '</td><td><b>' + esc(t.title || t.type || t.source || 'حركة') + '</b><br/><span style="font-size:7.5px;color:#72818a">' + esc(t.reason || '-') + '</span></td><td>' + esc(statusLabel(t.status)) + '</td><td>' + esc(num(t.amount) ? money(t.amount) : '-') + '</td><td>' + esc(num(t.points) ? num(t.points).toLocaleString('ar-EG') : '-') + '</td></tr>'
    ).join('');

    const totals =
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:12px">' +
        card('حركات معتمدة/فعالة', num(data.transactions.summary.active_or_approved_rows).toLocaleString('ar-EG')) +
        card('حركات معلقة', num(data.transactions.summary.pending_rows).toLocaleString('ar-EG')) +
        card('مبالغ معتمدة/فعالة', money(data.transactions.summary.active_or_approved_amount)) +
        card('نقاط معتمدة/فعالة', num(data.transactions.summary.active_or_approved_points).toLocaleString('ar-EG')) +
      '</div>';

    const body = totals +
      (rows ? table(rows, ['التاريخ', 'البند والسبب', 'الحالة', 'المبلغ', 'النقاط']) : '<div style="font-size:9px;color:#6b7a82">لا توجد حركات ظاهرة للموظف في هذه الدورة.</div>') +
      '<div style="margin-top:10px;font-size:8px;color:#6b7a82;line-height:1.6">النقاط لا تُعامل كخصم أو إضافة مالية إلا إذا نتج عنها مبلغ مالي معتمد. الحركات المعلقة تظهر للشفافية لكنها لا تدخل الصافي.</div>';

    pages.push(pageShell('الحوافز والخصومات والنقاط', 'سجل البنود الظاهرة للموظف وموقفها المالي', body, preview, 'الحركات ' + (index + 1).toLocaleString('ar-EG') + '/' + transactionChunks.length.toLocaleString('ar-EG')));
  });

  const kpi = data.kpi;
  const employeeSales = kpi.employee_sales_kpi;
  const branchBreakdown = employeeSales.branch_breakdown?.map((b) =>
    '<tr><td>' + esc(b.branch) + '</td><td>' + esc(money(b.sales_total)) + '</td><td>' + esc(num(b.invoices_count).toLocaleString('ar-EG')) + '</td><td>' + esc(money(b.avg_invoice)) + '</td></tr>'
  ).join('') || '';

  const kpiBody =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      '<div style="border:1px solid #d9e4e5;border-radius:12px;padding:12px"><div style="font-size:12px;font-weight:900;color:#087f7a;margin-bottom:6px">أداء الموظف</div>' +
        line('نقاط المكافآت', num(kpi.staff_performance.reward_points).toLocaleString('ar-EG')) +
        line('نقاط الخصم', num(kpi.staff_performance.deduction_points).toLocaleString('ar-EG')) +
        line('صافي النقاط', num(kpi.staff_performance.final_points).toLocaleString('ar-EG')) +
        line('نسبة التقدم', num(kpi.staff_performance.progress_pct).toLocaleString('ar-EG') + '%') +
        line('مبيعات الموظف', money(employeeSales.sales_total)) +
        line('عدد الفواتير', num(employeeSales.invoices_count).toLocaleString('ar-EG')) +
        line('متوسط الفاتورة', money(employeeSales.avg_invoice)) +
        line('الحافز النهائي', money(kpi.staff_performance.final_incentive_egp), true) +
      '</div>' +
      '<div style="border:1px solid #d9e4e5;border-radius:12px;padding:12px"><div style="font-size:12px;font-weight:900;color:#087f7a;margin-bottom:6px">أداء الفرع</div>' +
        line('التارجت', money(kpi.branch_target.target_amount)) +
        line('المبيعات', money(kpi.branch_target.sales_total)) +
        line('تحقيق التارجت', num(kpi.branch_target.achievement_percent).toLocaleString('ar-EG') + '%') +
        line('عدد الفواتير', num(kpi.branch_target.invoices_count).toLocaleString('ar-EG')) +
        line('متوسط الفاتورة', money(kpi.branch_kpis.avg_invoice)) +
        line('عدد العملاء', num(kpi.branch_kpis.unique_customers).toLocaleString('ar-EG')) +
      '</div>' +
    '</div>' +
    (branchBreakdown ? '<h2 style="font-size:12px;color:#087f7a;margin:15px 0 8px">مبيعات الموظف حسب الفرع</h2>' + table(branchBreakdown, ['الفرع', 'المبيعات', 'الفواتير', 'متوسط الفاتورة']) : '') +
    '<div style="margin-top:13px;border:1px solid #b8ded9;background:#eff9f7;border-radius:11px;padding:10px;font-size:8.5px;line-height:1.6"><b style="color:#087f7a">قاعدة الشفافية:</b> مؤشرات الأداء سياق للموظف والإدارة. لا تغير الراتب مباشرة؛ التأثير المالي يدخل فقط من Incentive Truth أو بند مالي معتمد.</div>';

  pages.push(pageShell('الأداء وKPIs', 'أداء الموظف والفرع خلال نفس دورة الراتب', kpiBody, preview, 'KPIs'));

  return pages;
}

export async function buildEmployeePayrollStatementPdf(staffId: string, monthCycle: string) {
  const data = await getEmployeePayrollStatementV1(staffId, monthCycle);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-12000px;top:0;width:794px;background:#fff';
  host.dir = 'rtl';
  host.innerHTML = buildPages(data).join('');
  host.querySelectorAll('table').forEach((tableElement) => {
    (tableElement as HTMLElement).style.borderCollapse = 'collapse';
    tableElement.querySelectorAll('td').forEach((cell) => {
      (cell as HTMLElement).style.padding = '7px';
      (cell as HTMLElement).style.borderBottom = '1px solid #e5ecec';
      (cell as HTMLElement).style.textAlign = 'right';
      (cell as HTMLElement).style.verticalAlign = 'top';
    });
  });
  document.body.appendChild(host);

  try {
    await Promise.all(
      Array.from(host.querySelectorAll('img')).map((img) =>
        img.decode ? img.decode().catch(() => undefined) : Promise.resolve()
      )
    );

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    const pdf = new jsPDF('p', 'mm', 'a4');
    const elements = Array.from(host.querySelectorAll('.statement-page')) as HTMLElement[];

    for (let index = 0; index < elements.length; index += 1) {
      const canvas = await html2canvas(elements[index], { scale: 2, backgroundColor: '#fff', logging: false, useCORS: true });
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
