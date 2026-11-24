import { getEmployeePayrollStatementV1, type EmployeePayrollStatementV1 } from './payrollStatementService';
import { getEvaluationApproval } from '@/lib/evaluationLab/cycleApproval';
import { EARNED_POOL } from '@/lib/evaluationLab/earnedIncentive';

const esc = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const num = (value: unknown) => { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; };
const money = (value: unknown) => num(value).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';
const mins = (value: unknown) => Math.max(0, Math.round(num(value)));
const durationHours = (value: unknown) => {
  const total = Math.max(0, Math.round(num(value) * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return m.toLocaleString('ar-EG') + ' دقيقة';
  // Minutes in the same Arabic digits as the hours: mixing Latin minutes with Arabic hours made the RTL text
  // read «52:135» instead of «135:52».
  return m
    ? h.toLocaleString('ar-EG') + ':' + m.toLocaleString('ar-EG', { minimumIntegerDigits: 2 }) + ' ساعة'
    : h.toLocaleString('ar-EG') + ' ساعة';
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
const cairoDateTime = (value?: string | null) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ar-EG', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};
const shortFingerprint = (value?: string | null) => value ? String(value).slice(0, 12) + '…' : '-';
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
  return '<section class="statement-page" style="position:relative;width:794px;height:1123px;box-sizing:border-box;padding:30px 34px 46px;background:#fff;color:#102235;font-family:Tahoma,Arial,sans-serif;direction:rtl;overflow:hidden">' +
    watermark +
    '<header style="display:flex;align-items:center;justify-content:space-between;gap:18px;border-bottom:3px solid #0b8c86;padding-bottom:10px;margin-bottom:15px">' +
      '<div><div style="font-size:20px;font-weight:900">' + esc(title) + '</div><div style="margin-top:3px;font-size:9px;color:#687983">' + esc(subtitle) + '</div></div>' +
      '<div style="display:flex;align-items:center;gap:8px"><div style="text-align:left;font-size:8px;color:#677983"><b style="display:block;font-size:10px;color:#102235">صيدليات دواء</b>كل اللي تحتاجه وأكثر</div><div style="width:68px;height:58px;overflow:hidden;border-radius:10px;background:#fff"><img src="/dawaa-logo-full.jpeg" alt="صيدليات دواء" style="width:68px;height:92px;object-fit:contain;transform:translateY(-8px)"/></div></div>' +
    '</header>' +
    '<div class="statement-fit">' + body + '</div>' +
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

type EvaluationApproval = Awaited<ReturnType<typeof getEvaluationApproval>> | null;

const pct = (value: unknown) => Math.round(num(value) * 100).toLocaleString('ar-EG') + '٪';
const ar = (value: unknown) => Math.round(num(value)).toLocaleString('ar-EG');

function section(title: string, body: string, color = '#087f7a') {
  return '<div style="border:1px solid #d9e4e5;border-radius:12px;padding:10px 11px;margin-bottom:9px"><div style="font-size:11px;font-weight:900;color:' + color + ';margin-bottom:5px">' + esc(title) + '</div>' + body + '</div>';
}

function tiles(items: Array<[string, string, string?]>, columns: number) {
  return '<div style="display:grid;grid-template-columns:repeat(' + columns + ',1fr);gap:6px;margin-bottom:9px">' +
    items.map(([label, value, hint]) => '<div style="border:1px solid #d9e4e5;background:#f9fbfb;border-radius:10px;padding:7px 8px"><div style="font-size:8px;color:#6b7b84">' + esc(label) + '</div><div style="font-size:13px;font-weight:900;margin-top:2px">' + esc(value) + '</div>' + (hint ? '<div style="font-size:7px;color:#6b7b84;margin-top:1px">' + esc(hint) + '</div>' : '') + '</div>').join('') +
  '</div>';
}

/** Owner decision 2026-11-24: the statement is two pages — 1) days, attendance and salary; 2) rank, incentives and advice. */
function buildPages(data: EmployeePayrollStatementV1, evaluation: EvaluationApproval, page2Extra = '') {
  const financial = data.financial;
  const engine = data.payroll_engine;
  const overtime = data.overtime.summary;
  const attendance = data.attendance.summary;
  const preview = !financial.frozen;
  const statementStatus = financial.frozen ? 'نهائي مجمد' : data.finalization.ready ? 'جاهز للمراجعة النهائية' : 'معاينة قيد المراجعة';
  const earningsTotal = num(financial.earnings.base_salary) + num(financial.earnings.automated_incentives_total) +
    num(financial.earnings.list_incentive) + num(financial.earnings.approved_overtime) + num(financial.earnings.manual_other_incentives);
  const days = data.attendance.days;
  const statusOf = (d: (typeof days)[number]) => String(d.resolution_status || d.status || '');
  const worked = days.filter((d) => d.first_in).length;
  const absent = days.filter((d) => /absence/.test(statusOf(d))).length;
  const leave = days.filter((d) => /time_off/.test(statusOf(d))).length;
  const missing = days.filter((d) => d.missing_punch).length;

  // ---------- Page 1: identity, salary, attendance ----------
  const identity =
    '<div style="display:flex;justify-content:space-between;gap:16px;margin-bottom:8px;font-size:10px;line-height:1.7">' +
      '<div><b>الموظف:</b> ' + esc(data.staff.name) + ' · <b>الفرع:</b> ' + esc(data.staff.branch || '-') + '</div>' +
      '<div><b>الدورة:</b> ' + esc(data.cycle.start) + ' ← ' + esc(data.cycle.end) + ' · <b>الحالة:</b> ' + esc(statementStatus) + '</div>' +
    '</div>' +
    (financial.frozen ? '<div style="margin-bottom:8px;font-size:7.5px;color:#5f7079">مرجع الاعتماد: ' + esc(data.finalization.snapshot_id || '-') + ' · Fingerprint ' + esc(shortFingerprint(data.finalization.snapshot_fingerprint || financial.snapshot_fingerprint)) + ' · ' + esc(cairoDateTime(data.finalization.finalized_at || financial.finalized_at)) + '</div>' : '');

  const net =
    '<div style="display:grid;grid-template-columns:1.25fr .75fr;gap:9px;margin-bottom:9px">' +
      '<div style="border:1px solid #b8ded9;background:#eff9f7;border-radius:14px;padding:12px"><div style="font-size:9px;color:#52706f">صافي الراتب</div><div style="font-size:26px;font-weight:900;color:#087f7a;margin-top:2px">' + esc(money(financial.display_net_salary)) + '</div><div style="font-size:8px;color:#607577;margin-top:3px">المستحقات ' + esc(money(earningsTotal)) + ' − الخصومات ' + esc(money(financial.adjustments.deductions_total)) + ' ± تسوية ' + esc(money(financial.adjustments.manual_adjustment)) + '</div></div>' +
      '<div style="border:1px solid #d9e4e5;border-radius:14px;padding:11px"><div style="font-size:9px;color:#6c7a83">الأساسي</div><div style="font-size:12px;font-weight:900;margin-top:4px">' + esc(durationHours(engine.base_payable_hours)) + ' × ' + esc(money(engine.true_hourly_rate)) + '</div><div style="border-top:1px solid #e8eeee;margin-top:6px;padding-top:5px;font-size:12px;font-weight:900;color:#087f7a">' + esc(money(financial.earnings.base_salary)) + '</div></div>' +
    '</div>';

  const salaryLines =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:9px">' +
      '<div style="border:1px solid #d9e4e5;border-radius:12px;padding:8px 11px"><div style="font-size:11px;font-weight:900;color:#087f7a">المستحقات</div>' +
        line('الراتب الأساسي', money(financial.earnings.base_salary)) +
        line('حافز الأداء والتقييم (تفصيله ص ٢)', money(financial.earnings.automated_incentives_total)) +
        line('حافز اللستة', money(financial.earnings.list_incentive)) +
        line('أوفر تايم معتمد', money(financial.earnings.approved_overtime)) +
        line('حوافز يدوية', money(financial.earnings.manual_other_incentives)) +
        line('الإجمالي', money(earningsTotal), true) +
      '</div>' +
      '<div style="border:1px solid #d9e4e5;border-radius:12px;padding:8px 11px"><div style="font-size:11px;font-weight:900;color:#a04449">الخصومات والتسويات</div>' +
        line('عجز / إكسبير', money(financial.adjustments.expiry_shortage_deduction)) +
        line('خصم عام فرع', money(financial.adjustments.branch_general_deduction)) +
        line('خصم فردي', money(financial.adjustments.individual_deduction)) +
        line('خصومات أخرى', money(financial.adjustments.other_deduction)) +
        line('تسوية يدوية (±)', money(financial.adjustments.manual_adjustment)) +
        line('إجمالي الخصومات', money(financial.adjustments.deductions_total), true) +
      '</div>' +
    '</div>';

  const attendanceTiles = tiles([
    ['أيام حضور', ar(worked), 'من ' + ar(days.length) + ' يوم'],
    ['الساعات الفعلية', durationHours(engine.actual_worked_hours)],
    ['ساعات الأساسي المحتسبة', durationHours(engine.base_payable_hours)],
    ['إجازات / أذونات', ar(Math.max(leave, num(attendance.approved_time_off_days)))],
    ['غياب', ar(absent)],
    ['تأخير', ar(attendance.late_minutes) + ' د', 'خروج بدري ' + ar(attendance.early_leave_minutes) + ' د'],
    ['بصمة ناقصة', ar(Math.max(missing, num(data.missing_punch.summary.incidents))), num(data.missing_punch.summary.deduction_amount) ? 'خصم ' + money(data.missing_punch.summary.deduction_amount) : 'بدون خصم'],
    ['أوفر تايم', durationHours(overtime.approved_hours), num(overtime.pending_cases) ? 'معلق ' + ar(overtime.pending_cases) + ' حالة' : 'معتمد'],
  ], 4);

  const shortHours = (value: unknown) => durationHours(value).replace(' ساعة', 'س').replace(' دقيقة', 'د');
  const dayRow = (d: (typeof days)[number]) => {
    const status = statusOf(d);
    const notes = [
      statusLabel(status),
      d.late_minutes ? 'تأخير ' + ar(d.late_minutes) + 'د' : '',
      d.early_leave_minutes ? 'بدري ' + ar(d.early_leave_minutes) + 'د' : '',
      d.missing_punch ? 'بصمة ناقصة' : '',
    ].filter(Boolean).join(' · ');
    const tone = /absence/.test(status) ? 'background:#fff3f3' : d.late_minutes || d.missing_punch ? 'background:#fffaf0' : /off_day|time_off/.test(status) ? 'background:#f5f8f9' : '';
    return '<tr style="' + tone + '"><td style="white-space:nowrap">' + esc(weekday(d.date)) + ' ' + esc(d.date.slice(8, 10) + '/' + d.date.slice(5, 7)) + '</td><td style="white-space:nowrap">' + esc(cairoTime(d.first_in)) + ' - ' + esc(cairoTime(d.last_out)) + '</td><td><b>' + esc(shortHours(d.payroll_eligible_hours ?? d.candidate_hours)) + '</b></td><td>' + esc(notes || '-') + '</td></tr>';
  };
  const half = Math.ceil(days.length / 2);
  const dayTable = (list: typeof days) => '<table class="days" style="width:100%;border-collapse:collapse;font-size:7.5px"><thead><tr style="background:#eef8f7;color:#26494b"><th>اليوم</th><th>الدخول / الخروج</th><th>المحتسب</th><th>الحالة</th></tr></thead><tbody>' + list.map(dayRow).join('') + '</tbody></table>';
  const daysBlock = section('أيام الدورة يوم بيوم', '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' + dayTable(days.slice(0, half)) + dayTable(days.slice(half)) + '</div>');

  const timeOff = data.time_off.requests.map((r) => esc(r.label || r.kind) + ' ' + esc(r.start_date.slice(8, 10) + '/' + r.start_date.slice(5, 7)) +
    (r.end_date && r.end_date !== r.start_date ? '←' + esc(r.end_date.slice(8, 10) + '/' + r.end_date.slice(5, 7)) : '') +
    ' (' + esc(r.duration_minutes ? ar(r.duration_minutes) + ' د' : 'يوم كامل') + ' · ' + esc(statusLabel(r.status)) + ')');
  const timeOffBlock = section('الإجازات والأذونات خلال الدورة', '<div style="font-size:8.5px;line-height:1.7">' + (timeOff.length ? timeOff.join(' · ') : 'لا توجد طلبات إجازة أو إذن.') + '</div>');

  const attention = [
    num(engine.pending_review_days) > 0 ? ar(engine.pending_review_days) + ' يوم حضور تحت المراجعة' : '',
    num(overtime.pending_cases) > 0 ? ar(overtime.pending_cases) + ' حالة أوفر تايم معلقة (' + durationHours(overtime.pending_hours) + ')' : '',
    num(data.transactions.summary.pending_rows) > 0 ? ar(data.transactions.summary.pending_rows) + ' حركة معلقة' : '',
    data.finalization.blockers.length ? ar(data.finalization.blockers.length) + ' مانع إقفال' : '',
  ].filter(Boolean);
  const attentionBlock = attention.length
    ? '<div style="border:1px solid #efca78;background:#fff9ec;border-radius:10px;padding:7px 10px;font-size:8.5px"><b style="color:#8b5d00">قبل الإقفال:</b> ' + esc(attention.join(' · ')) + '</div>'
    : '';

  const page1 = pageShell('كشف الراتب — الأيام والحضور والمرتب', 'كل يوم في الدورة وإزاي اتحسب منه المرتب', identity + net + salaryLines + attendanceTiles + daysBlock + timeOffBlock + attentionBlock, preview, 'صفحة ١ من ٢');

  // ---------- Page 2: rank, incentives, advice ----------
  const approval = evaluation?.approved ? evaluation.approval : null;
  const listItems = evaluation?.list_items || [];
  const kpi = data.kpi;
  let evaluationBody = '';
  const advice: Array<{ kind: string; text: string }> = [];

  if (approval) {
    const axes = (approval.axes || []).filter((axis) => num(axis.weight) > 0);
    const bars = axes.map((axis) => {
      const score = axis.score === null || axis.score === undefined ? null : Math.max(0, Math.min(100, num(axis.score)));
      const color = score === null ? '#c5d0d3' : score >= 85 ? '#0b8c86' : score >= 60 ? '#d39a1c' : '#c4525a';
      return '<div style="display:grid;grid-template-columns:170px 1fr 58px;gap:8px;align-items:center;font-size:9px;margin:5px 0"><span>' + esc(axis.label) + ' <span style="color:#7b8a91">(' + ar(axis.weight) + '٪)</span></span>' +
        '<div style="height:9px;border-radius:9px;background:#edf2f3;overflow:hidden"><div style="height:100%;width:' + (score ?? 0) + '%;background:' + color + '"></div></div>' +
        '<b style="text-align:left">' + (score === null ? 'لم يُقس' : ar(score) + ' / ١٠٠') + '</b></div>';
    }).join('');
    const rankText = approval.rank_in_branch ? ar(approval.rank_in_branch) + ' من ' + ar(approval.rank_in_branch_of) : '—';
    const overallText = approval.rank_overall ? ar(approval.rank_overall) + ' من ' + ar(approval.rank_overall_of) : '—';
    const star = approval.star as { points?: number; rank?: number | null; gap?: number | null } | null;
    const box = (label: string, value: string, hint: string, style = 'border-color:#d9e4e5') =>
      '<div style="border:1px solid;' + style + ';border-radius:12px;padding:10px;text-align:center"><div style="font-size:8.5px;color:#6b7b84">' + esc(label) + '</div><div style="font-size:21px;font-weight:900;margin-top:2px">' + esc(value) + '</div><div style="font-size:8px">' + esc(hint) + '</div></div>';
    evaluationBody =
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:9px">' +
        box('درجة التقييم', ar(approval.score) + ' / ١٠٠', approval.tier_label || '', 'border-color:#b8ded9;background:#eff9f7;color:#087f7a') +
        box('ترتيبك في الفرع', rankText, approval.branch || '') +
        box('ترتيبك على الصيدليات', overallText, 'كل الدكاترة') +
        box('نجم الفرع', num(approval.star_egp) > 0 ? 'فائز ' + ar(approval.star_egp) + ' ج' : star?.rank ? 'المركز ' + ar(star.rank) : '—',
          star?.points !== undefined ? ar(star.points) + ' نقطة' + (star.gap ? ' · ناقص ' + ar(star.gap) : '') : '', 'border-color:#f0d58a;background:#fffaf0') +
      '</div>' +
      section('بنود التقييم (' + approval.model_version + ')', bars || '<div style="font-size:9px">لا توجد بنود مقاسة.</div>');
    const hoursFactor = approval.hours_factor === null ? 1 : num(approval.hours_factor);
    const calc =
      line('وعاء الحافز', money(EARNED_POOL)) +
      line('× شريحة الدرجة (' + (approval.tier_label || '') + ')', ar(approval.tier_percent) + '٪') +
      line('× معامل تارجت الفرع (تحقيق ' + ar(approval.branch_achievement) + '٪)', pct(approval.branch_factor)) +
      line('× معامل الساعات', pct(hoursFactor)) +
      (num(approval.absence_cut) > 0 ? line('− خصم الغياب (' + ar(approval.absence_days) + ' يوم)', pct(approval.absence_cut)) : '') +
      line('= حافز الأداء', money(approval.performance_egp), true) +
      line('+ بونص تارجت الفرع', money(approval.bonus_egp)) +
      line('+ نجم الفرع', money(approval.star_egp)) +
      line('+ حافز اللستة', money(financial.earnings.list_incentive)) +
      line('إجمالي الحوافز', money(num(approval.performance_egp) + num(approval.bonus_egp) + num(approval.star_egp) + num(financial.earnings.list_incentive)), true);
    const listTable = listItems.length
      ? table(listItems.slice(0, 12).map((item) => '<tr><td>' + esc(item.product_name) + '</td><td>' + ar(item.quantity) + '</td><td>' + esc(money(item.incentive_total)) + '</td></tr>').join(''), ['صنف اللستة', 'الكمية', 'الحافز']) +
        (listItems.length > 12 ? '<div style="font-size:7.5px;color:#6b7a82;margin-top:3px">+ ' + ar(listItems.length - 12) + ' صنف تاني</div>' : '')
      : '<div style="font-size:9px;color:#6b7a82">مفيش أصناف لستة اتباعت باسمك في الدورة.</div>';
    evaluationBody += '<div style="display:grid;grid-template-columns:1.05fr .95fr;gap:9px">' + section('حساب الحافز', calc) + section('أصناف اللستة', listTable) + '</div>';
    advice.push(...((approval.recommendations || []) as Array<{ kind: string; text: string }>));
  } else {
    const perf = kpi.staff_performance;
    const sales = kpi.employee_sales_kpi;
    evaluationBody =
      '<div style="border:1px solid #efca78;background:#fff9ec;border-radius:10px;padding:8px 10px;font-size:9px;margin-bottom:9px">مفيش تقييم شهري معتمد للدورة دي؛ الحافز محسوب بالنقاط والبنود الآلية.</div>' +
      tiles([
        ['صافي النقاط', ar(perf.final_points), 'مكافآت ' + ar(perf.reward_points) + ' · خصم ' + ar(perf.deduction_points)],
        ['مبيعاتك', money(sales.sales_total)],
        ['فواتيرك', ar(sales.invoices_count), 'متوسط ' + money(sales.avg_invoice)],
        ['تارجت الفرع', ar(kpi.branch_target.achievement_percent) + '٪', money(kpi.branch_target.sales_total)],
      ], 4) +
      section('حساب الحافز',
        line('حافز الأداء', money(financial.earnings.performance_incentive_included_in_automated_total)) +
        line('حافز التارجت', money(financial.earnings.target_bonus_included_in_automated_total)) +
        line('متابعات وطلبات العملاء', money(num(financial.earnings.followup_bonus_included_in_automated_total) + num(financial.earnings.customer_request_bonus_included_in_automated_total))) +
        line('نجم الفرع', money(financial.earnings.branch_star_bonus_included_in_automated_total)) +
        line('حافز اللستة', money(financial.earnings.list_incentive)) +
        line('إجمالي الحوافز', money(num(financial.earnings.automated_incentives_total) + num(financial.earnings.list_incentive)), true));
  }

  const visible = data.transactions.items.filter((t) => t.employee_visible !== false && (num(t.amount) || num(t.points)));
  const txRows = visible.slice(0, 10).map((t) => '<tr><td>' + esc(t.date || '-') + '</td><td>' + esc(t.title || t.type || t.source || 'حركة') + '</td><td>' + esc(statusLabel(t.status)) + '</td><td>' + esc(num(t.amount) ? money(t.amount) : '-') + '</td><td>' + esc(num(t.points) ? ar(t.points) : '-') + '</td></tr>').join('');
  const txBlock = section('الحوافز والخصومات والنقاط', (txRows ? table(txRows, ['التاريخ', 'البند', 'الحالة', 'المبلغ', 'النقاط']) : '<div style="font-size:9px;color:#6b7a82">لا توجد حركات ظاهرة في الدورة.</div>') +
    (visible.length > 10 ? '<div style="font-size:7.5px;color:#6b7a82;margin-top:3px">+ ' + ar(visible.length - 10) + ' حركة تانية في صفحة المرتبات</div>' : '') +
    '<div style="font-size:7.5px;color:#6b7a82;margin-top:3px">المعلق والمرفوض للمعلومة بس ومش داخل الصافي.</div>');
  const ledger = (financial.manual_ledger?.entries || []).map((raw) => { const e = raw as Record<string, unknown>; return '<tr><td>' + esc(String(e.category || e.entry_kind || '-')) + '</td><td><b>' + esc(money(e.signed_amount)) + '</b></td><td>' + esc(String(e.reason || '-')) + '</td></tr>'; }).join('');
  const ledgerBlock = ledger ? section('التسويات المالية اليدوية', table(ledger, ['البند', 'القيمة', 'السبب'])) : '';

  // Attendance advice applies to everyone.
  if (num(attendance.late_minutes) >= 30) advice.push({ kind: 'note', text: 'التأخير الشهر ده ' + ar(attendance.late_minutes) + ' دقيقة؛ الالتزام بالميعاد بيحمي الحافز والمرتب.' });
  if (missing > 0) advice.push({ kind: 'note', text: 'عندك ' + ar(missing) + ' يوم ببصمة ناقصة؛ بصّم دخول وخروج كل يوم.' });
  if (absent > 0) advice.push({ kind: 'note', text: 'الغياب ' + ar(absent) + ' يوم؛ أي غياب من غير إذن معتمد بيخصم من الحافز.' });
  if (!advice.length) advice.push({ kind: 'strength', text: 'شغل منضبط الشهر ده، كمّل على نفس المستوى.' });
  const color = (kind: string) => kind === 'strength' ? '#087f7a' : kind === 'improve' ? '#b06a00' : '#5f7079';
  const mark = (kind: string) => kind === 'strength' ? '✔' : kind === 'improve' ? '▲' : '•';
  const adviceBlock = section('توصيات الشهر الجاي', advice.slice(0, 8).map((item) =>
    '<div style="font-size:9.5px;line-height:1.7;padding:3px 0;border-bottom:1px solid #f0f3f3"><b style="color:' + color(item.kind) + '">' + mark(item.kind) + '</b> ' + esc(item.text) + '</div>').join(''));

  const approvedBy = approval ? '<div style="font-size:7.5px;color:#6b7a82;margin-top:4px">اعتمد التقييم: ' + esc(approval.approved_by_name || '-') + ' · ' + esc(cairoDateTime(approval.approved_at)) + '</div>' : '';
  const page2 = pageShell('الترتيب والحوافز والتوصيات', 'تقييمك الشهري وإزاي اتحسب حافزك', evaluationBody + page2Extra + txBlock + ledgerBlock + adviceBlock + approvedBy, preview, 'صفحة ٢ من ٢');
  return [page1, page2];
}

export async function buildEmployeePayrollStatementPdf(
  staffId: string,
  monthCycle: string,
  options: { requireFinalized?: boolean; page2Extra?: (statement: EmployeePayrollStatementV1) => string } = {}
) {
  const [data, evaluation] = await Promise.all([
    getEmployeePayrollStatementV1(staffId, monthCycle),
    // The statement still prints without the evaluation (none approved yet, or not allowed to read it).
    getEvaluationApproval(staffId, monthCycle).catch(() => null),
  ]);
  if (options.requireFinalized && (data.statement_mode !== 'finalized_snapshot_v2' || data.financial.frozen !== true)) {
    throw new Error('finalized_payroll_statement_not_frozen');
  }
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-12000px;top:0;width:794px;background:#fff';
  host.dir = 'rtl';
  host.innerHTML = buildPages(data, evaluation, options.page2Extra ? options.page2Extra(data) : '').join('');
  host.querySelectorAll('table').forEach((tableElement) => {
    (tableElement as HTMLElement).style.borderCollapse = 'collapse';
    tableElement.querySelectorAll('td').forEach((cell) => {
      (cell as HTMLElement).style.padding = tableElement.classList.contains('days') ? '2.5px 4px' : '5px 6px';
      (cell as HTMLElement).style.borderBottom = '1px solid #e5ecec';
      (cell as HTMLElement).style.textAlign = 'right';
      (cell as HTMLElement).style.verticalAlign = 'top';
    });
  });
  host.querySelectorAll('table.days th').forEach((cell) => { (cell as HTMLElement).style.padding = '3px 4px'; (cell as HTMLElement).style.textAlign = 'right'; });
  document.body.appendChild(host);

  // Two pages, always: a long month shrinks its page instead of spilling onto a third one.
  host.querySelectorAll('.statement-page').forEach((page) => {
    const fit = page.querySelector('.statement-fit') as HTMLElement | null;
    if (!fit) return;
    const room = 1123 - 46 - fit.offsetTop;
    const needed = fit.scrollHeight;
    if (needed > room) {
      const k = Math.max(0.6, room / needed);
      fit.style.transform = 'scale(' + k + ')';
      fit.style.transformOrigin = 'top right';
      fit.style.width = (100 / k) + '%';
    }
  });

  try {
    await Promise.all(
      Array.from(host.querySelectorAll('img')).map((img) =>
        img.decode ? img.decode().catch(() => undefined) : Promise.resolve()
      )
    );

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    // JPEG + compression: PNG pages at 2x were ~10 MB each (an 8-page statement came out at 85 MB).
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
    const elements = Array.from(host.querySelectorAll('.statement-page')) as HTMLElement[];

    for (let index = 0; index < elements.length; index += 1) {
      const canvas = await html2canvas(elements[index], { scale: 2, backgroundColor: '#fff', logging: false, useCORS: true });
      const jpeg = canvas.toDataURL('image/jpeg', 0.9);
      if (index > 0) pdf.addPage();
      pdf.addImage(jpeg, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
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
