import { getEmployeePayrollStatementV1, type EmployeePayrollStatementV1 } from './payrollStatementService';
import { getEvaluationApproval } from '@/lib/evaluationLab/cycleApproval';
import { EARNED_POOL } from '@/lib/evaluationLab/earnedIncentive';

// Employee payroll statement PDF — two A4 pages (owner decision 2026-11-24):
//   1) the salary and the month day by day (attendance calendar);
//   2) the evaluation, the rank, how the incentive was computed and what to improve.
// Drawn as HTML in the app's Cairo font, rendered with html2canvas and saved as compressed JPEG pages.

type EvaluationApproval = Awaited<ReturnType<typeof getEvaluationApproval>> | null;
type Day = EmployeePayrollStatementV1['attendance']['days'][number];

const C = {
  ink: '#0f2a33', muted: '#6b7f86', faint: '#9aabb1', line: '#e3eaec', soft: '#f5f8f9',
  teal: '#0b8c86', tealDark: '#07605c', tealSoft: '#e7f5f3',
  red: '#c0444b', redSoft: '#fdeeee', amber: '#b7790c', amberSoft: '#fff5e0', blue: '#3b6fb6', blueSoft: '#eaf1fb',
  grey: '#8b9a9f', greySoft: '#f0f3f4',
};
const FONT = "Cairo, Tajawal, 'Segoe UI', Tahoma, sans-serif";

const esc = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const num = (value: unknown) => { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; };
const ar = (value: unknown, digits = 0) => num(value).toLocaleString('ar-EG', { maximumFractionDigits: digits });
/** «٣٬٦٧٨٫٧٧ ج» — no «.٠٠» on round amounts. */
const money = (value: unknown) => {
  const n = num(value);
  return n.toLocaleString('ar-EG', { minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2, maximumFractionDigits: 2 }) + ' ج';
};
const pct = (value: unknown) => ar(num(value) * 100) + '٪';
/** «١٣٥ س ٥٢ د». */
const hm = (hours: unknown) => {
  const total = Math.max(0, Math.round(num(hours) * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return ar(m) + ' د';
  return ar(h) + ' س' + (m ? ' ' + ar(m) + ' د' : '');
};
const clock = (value?: string | null) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' });
};
const longDate = (value: string, withYear = false) => {
  const d = new Date(value + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
};
const cairoDateTime = (value?: string | null) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
};
const monthTitle = (monthCycle: string) => {
  const [y, m] = monthCycle.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 15)).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const shortFingerprint = (value?: string | null) => value ? String(value).slice(0, 12) + '…' : '-';

const LABELS: Record<string, string> = {
  approved: 'معتمد', active: 'فعال', pending: 'معلق', pending_review: 'تحت المراجعة', rejected: 'مرفوض', cancelled: 'ملغي', paid: 'مدفوع',
  reward: 'مكافأة', bonus: 'مكافأة', deduction: 'خصم', penalty: 'جزاء', points: 'نقاط', adjustment: 'تسوية',
};
const label = (value?: string | null) => LABELS[String(value || '')] || String(value || '');

/** One attendance day: the colour family, a short tag and whether it counts as a worked day. */
function dayLook(d: Day) {
  const r = String(d.resolution_status || '');
  const pending = d.status === 'pending_review';
  const late = Math.round(num(d.late_minutes));
  const early = Math.round(num(d.early_leave_minutes));
  if (/absence/.test(r)) return { tone: 'red', tag: pending ? 'غياب · مراجعة' : 'غياب' };
  if (/time_off|annual_leave|unpaid_leave/.test(r)) return { tone: 'blue', tag: /unpaid/.test(r) ? 'إجازة بدون أجر' : 'إجازة / إذن' };
  if (r === 'off_day') return { tone: 'grey', tag: 'راحة' };
  if (r === 'employment_ended' || r === 'no_schedule' || r === 'flexible_no_activity') return { tone: 'grey', tag: r === 'employment_ended' ? '—' : 'بدون شيفت' };
  if (d.missing_punch || /missing/.test(r)) return { tone: 'amber', tag: 'بصمة ناقصة' };
  if (pending || /needs_event_review|invalid/.test(r)) return { tone: 'amber', tag: 'تحت المراجعة' };
  if (late > 0) return { tone: 'amber', tag: 'تأخير ' + ar(late) + 'د' };
  if (early > 0) return { tone: 'amber', tag: 'خروج بدري ' + ar(early) + 'د' };
  if (r === 'worked_on_off') return { tone: 'teal', tag: 'شغل يوم راحة' };
  return { tone: 'teal', tag: 'في الميعاد' };
}
const TONES: Record<string, { bg: string; fg: string; bar: string }> = {
  teal: { bg: '#ffffff', fg: C.teal, bar: C.teal },
  amber: { bg: '#fffaf0', fg: C.amber, bar: '#e3a72f' },
  red: { bg: C.redSoft, fg: C.red, bar: C.red },
  blue: { bg: C.blueSoft, fg: C.blue, bar: C.blue },
  grey: { bg: C.greySoft, fg: C.grey, bar: '#c9d3d6' },
};

// ---------- building blocks ----------
const h2 = (title: string, aside = '') =>
  '<div style="display:flex;align-items:baseline;justify-content:space-between;margin:0 0 7px">' +
    '<div style="font-size:13px;font-weight:800;color:' + C.ink + '"><span style="display:inline-block;width:4px;height:13px;border-radius:2px;background:' + C.teal + ';margin-left:7px;vertical-align:-1px"></span>' + esc(title) + '</div>' +
    (aside ? '<div style="font-size:9px;color:' + C.muted + '">' + aside + '</div>' : '') +
  '</div>';
const box = (inner: string, extra = '') => '<div style="border:1px solid ' + C.line + ';border-radius:14px;padding:12px 14px;background:#fff;' + extra + '">' + inner + '</div>';
const row = (name: string, value: string, opts: { hint?: string; strong?: boolean; color?: string } = {}) =>
  '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:5px 0;border-bottom:1px dashed ' + C.line + '">' +
    '<div style="font-size:10.5px;color:' + C.ink + ';font-weight:' + (opts.strong ? 800 : 500) + '">' + esc(name) + (opts.hint ? '<div style="font-size:8.5px;color:' + C.muted + ';font-weight:400">' + esc(opts.hint) + '</div>' : '') + '</div>' +
    '<div style="font-size:' + (opts.strong ? 12.5 : 11) + 'px;font-weight:' + (opts.strong ? 900 : 700) + ';color:' + (opts.color || C.ink) + ';white-space:nowrap">' + esc(value) + '</div>' +
  '</div>';
const stat = (name: string, value: string, hint = '', color: string = C.ink) =>
  '<div style="padding:2px 10px;border-left:1px solid ' + C.line + '">' +
    '<div style="font-size:8.5px;color:' + C.muted + '">' + esc(name) + '</div>' +
    '<div style="font-size:16px;font-weight:900;color:' + color + ';line-height:1.35">' + esc(value) + '</div>' +
    (hint ? '<div style="font-size:8px;color:' + C.faint + '">' + esc(hint) + '</div>' : '') +
  '</div>';
const chip = (text: string, fg: string, bg: string) =>
  '<span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:9px;font-weight:700;color:' + fg + ';background:' + bg + '">' + esc(text) + '</span>';
function table(rows: string[][], headers: string[], widths: string[]) {
  return '<table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:9.5px">' +
    '<colgroup>' + widths.map((w) => '<col style="width:' + w + '"/>').join('') + '</colgroup>' +
    '<thead><tr>' + headers.map((h) => '<th style="text-align:right;padding:5px 6px;font-size:8.5px;font-weight:700;color:' + C.muted + ';border-bottom:1px solid ' + C.line + '">' + esc(h) + '</th>').join('') + '</tr></thead>' +
    '<tbody>' + rows.map((cells) => '<tr>' + cells.map((cell) => '<td style="padding:5px 6px;border-bottom:1px solid ' + C.soft + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + cell + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
}

function pageShell(data: EmployeePayrollStatementV1, title: string, body: string, preview: boolean, pageNo: string, status: string) {
  const watermark = preview
    ? '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:.035;font-size:70px;font-weight:900;transform:rotate(-28deg);color:' + C.ink + '">معاينة - غير نهائي</div>'
    : '';
  return '<section class="statement-page" style="position:relative;width:794px;height:1123px;box-sizing:border-box;padding:0 0 40px;background:#fff;color:' + C.ink + ';font-family:' + FONT + ';direction:rtl;overflow:hidden">' +
    watermark +
    '<header style="background:linear-gradient(135deg,' + C.tealDark + ',' + C.teal + ');color:#fff;padding:20px 32px 18px;display:flex;align-items:center;justify-content:space-between;gap:16px">' +
      '<div>' +
        '<div style="font-size:10px;opacity:.85;font-weight:600">' + esc(title) + '</div>' +
        '<div style="font-size:22px;font-weight:900;line-height:1.3">' + esc(data.staff.name) + '</div>' +
        '<div style="font-size:10px;opacity:.9;margin-top:2px">' + esc(data.staff.branch || '') + ' · كشف مرتب ' + esc(monthTitle(data.cycle.month_cycle)) + ' · من ' + esc(longDate(data.cycle.start)) + ' لـ ' + esc(longDate(data.cycle.end, true)) + '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<div style="text-align:left"><div style="font-size:12px;font-weight:800">صيدليات دواء</div><div style="margin-top:5px;display:inline-block;padding:3px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.55);font-size:9.5px;font-weight:700;line-height:1.6">' + esc(status) + '</div></div>' +
        '<div style="width:56px;height:56px;border-radius:14px;background:#fff;overflow:hidden;display:flex;align-items:center;justify-content:center"><img src="/dawaa-logo-full.jpeg" alt="صيدليات دواء" style="width:56px;height:76px;object-fit:contain;transform:translateY(-6px)"/></div>' +
      '</div>' +
    '</header>' +
    '<div class="statement-fit" style="padding:16px 32px 0">' + body + '</div>' +
    '<footer style="position:absolute;bottom:14px;right:32px;left:32px;border-top:1px solid ' + C.line + ';padding-top:6px;font-size:8px;color:' + C.faint + ';display:flex;justify-content:space-between"><span>صيدليات دواء · كشف المرتب الشهري</span><span>' + esc(pageNo) + '</span></footer>' +
  '</section>';
}

// ---------- page 1: salary and the month day by day ----------
function salaryPage(data: EmployeePayrollStatementV1, preview: boolean, status: string) {
  const f = data.financial;
  const e = f.earnings;
  const a = f.adjustments;
  const engine = data.payroll_engine;
  const attendance = data.attendance.summary;
  const overtime = data.overtime.summary;
  const days = data.attendance.days;
  const earnings = num(e.base_salary) + num(e.automated_incentives_total) + num(e.list_incentive) + num(e.approved_overtime) + num(e.manual_other_incentives);
  const looks = days.map(dayLook);
  const count = (tone: string, re?: RegExp) => looks.filter((l) => l.tone === tone && (!re || re.test(l.tag))).length;
  const worked = days.filter((d) => d.first_in).length;
  const scheduled = days.length - count('grey');

  const audit = f.frozen
    ? '<div style="font-size:8px;color:' + C.muted + ';margin:-6px 0 10px">مرجع الاعتماد: ' + esc(data.finalization.snapshot_id || '-') + ' · Fingerprint ' + esc(shortFingerprint(data.finalization.snapshot_fingerprint || f.snapshot_fingerprint)) + ' · ' + esc(cairoDateTime(data.finalization.finalized_at || f.finalized_at)) + '</div>'
    : '';

  // The equation: every term the net is made of, in one line.
  const term = (name: string, value: number, sign: string, color: string = C.ink) =>
    '<div style="text-align:center;min-width:0"><div style="font-size:8.5px;color:' + C.muted + ';white-space:nowrap">' + esc(name) + '</div><div style="font-size:12.5px;font-weight:800;color:' + color + ';white-space:nowrap">' + esc(sign + money(value)) + '</div></div>';
  const op = (s: string) => '<div style="font-size:15px;color:' + C.faint + ';font-weight:700;padding:0 2px">' + s + '</div>';
  const terms: string[] = [term('الأساسي', num(e.base_salary), '')];
  if (num(e.automated_incentives_total)) terms.push(op('+'), term('حافز الأداء', num(e.automated_incentives_total), '', C.teal));
  if (num(e.list_incentive)) terms.push(op('+'), term('حافز اللستة', num(e.list_incentive), '', C.teal));
  if (num(e.approved_overtime)) terms.push(op('+'), term('أوفر تايم', num(e.approved_overtime), '', C.teal));
  if (num(e.manual_other_incentives)) terms.push(op('+'), term('حوافز يدوية', num(e.manual_other_incentives), '', C.teal));
  if (num(a.deductions_total)) terms.push(op('−'), term('الخصومات', num(a.deductions_total), '', C.red));
  if (num(a.manual_adjustment)) terms.push(op(num(a.manual_adjustment) > 0 ? '+' : '−'), term('تسوية', Math.abs(num(a.manual_adjustment)), '', C.ink));

  const hero =
    '<div style="display:flex;gap:12px;margin-bottom:14px">' +
      '<div style="flex:0 0 205px;border-radius:16px;background:' + C.tealSoft + ';padding:14px 16px">' +
        '<div style="font-size:10px;color:' + C.tealDark + ';font-weight:700">صافي المرتب</div>' +
        '<div style="font-size:30px;font-weight:900;color:' + C.tealDark + ';line-height:1.25">' + esc(money(f.display_net_salary)) + '</div>' +
        '<div style="font-size:8.5px;color:' + C.muted + '">' + (f.frozen ? 'نهائي ومعتمد' : 'محسوب لحد النهارده') + '</div>' +
      '</div>' +
      '<div style="flex:1;min-width:0;border:1px solid ' + C.line + ';border-radius:16px;padding:12px 14px;display:flex;flex-direction:column;justify-content:center">' +
        '<div style="font-size:9px;color:' + C.muted + ';margin-bottom:6px">المرتب اتحسب كده</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:4px;flex-wrap:nowrap">' + terms.join('') + op('=') + term('الصافي', num(f.display_net_salary), '', C.tealDark) + '</div>' +
      '</div>' +
    '</div>';

  const deductionRows = [
    ['عجز / إكسبير', a.expiry_shortage_deduction], ['خصم عام على الفرع', a.branch_general_deduction],
    ['خصم فردي', a.individual_deduction], ['خصومات أخرى', a.other_deduction],
  ].filter(([, v]) => num(v) !== 0);
  const ledger = (f.manual_ledger?.entries || []).map((raw) => raw as Record<string, unknown>);
  const details =
    '<div style="display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:12px;margin-bottom:14px">' +
      box(h2('المستحقات', esc(money(earnings))) +
        row('الأساسي', money(e.base_salary), { hint: hm(engine.base_payable_hours) + ' × ' + money(engine.true_hourly_rate) + ' للساعة' }) +
        row('حافز الأداء والتقييم', money(e.automated_incentives_total), { hint: 'تفصيله في الصفحة التانية' }) +
        row('حافز اللستة', money(e.list_incentive)) +
        row('أوفر تايم معتمد', money(e.approved_overtime), { hint: num(overtime.approved_hours) ? hm(overtime.approved_hours) : '' }) +
        (num(e.manual_other_incentives) ? row('حوافز يدوية', money(e.manual_other_incentives)) : '')) +
      box(h2('الخصومات والتسويات', esc(money(a.deductions_total))) +
        (deductionRows.length ? deductionRows.map(([n, v]) => row(String(n), money(v), { color: C.red })).join('') : '<div style="font-size:10px;color:' + C.muted + ';padding:6px 0">مفيش خصومات على الشهر ده.</div>') +
        (num(a.manual_adjustment) ? row('تسوية يدوية', money(a.manual_adjustment)) : '') +
        (ledger.length ? '<div style="margin-top:6px;font-size:9px;font-weight:700;color:' + C.ink + '">التسويات المالية اليدوية</div>' +
          ledger.slice(0, 4).map((l) => row(String(l.reason || l.category || '-'), money(l.signed_amount))).join('') : '')) +
    '</div>' + audit;

  const stats =
    '<div style="display:flex;border:1px solid ' + C.line + ';border-radius:14px;padding:10px 4px;margin-bottom:12px">' +
      stat('أيام الحضور', ar(worked), 'من ' + ar(scheduled) + ' يوم شغل') +
      stat('الساعات الفعلية', hm(engine.actual_worked_hours)) +
      stat('ساعات الأساسي المحتسبة', hm(engine.base_payable_hours)) +
      stat('التأخير', ar(attendance.late_minutes) + ' د', 'خروج بدري ' + ar(attendance.early_leave_minutes) + ' د', num(attendance.late_minutes) ? C.amber : C.ink) +
      stat('غياب', ar(count('red')), '', count('red') ? C.red : C.ink) +
      stat('بصمة ناقصة', ar(count('amber', /بصمة/)), num(data.missing_punch.summary.deduction_amount) ? 'خصم ' + money(data.missing_punch.summary.deduction_amount) : 'بدون خصم', count('amber', /بصمة/) ? C.amber : C.ink) +
      stat('إجازات', ar(count('blue'))) +
    '</div>';

  // Attendance calendar: weeks start on Saturday.
  const WEEK = ['السبت', 'الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة'];
  const firstCol = days.length ? (new Date(days[0].date + 'T12:00:00Z').getUTCDay() + 1) % 7 : 0;
  const cells: string[] = Array.from({ length: firstCol }, () => '<div></div>');
  days.forEach((d, i) => {
    const look = looks[i];
    const tone = TONES[look.tone];
    const inOut = d.first_in ? clock(d.first_in) + ' ← ' + (clock(d.last_out) || '؟') : '';
    const hours = num(d.payroll_eligible_hours ?? d.candidate_hours);
    cells.push(
      '<div style="border:1px solid ' + C.line + ';border-top:3px solid ' + tone.bar + ';border-radius:8px;background:' + tone.bg + ';padding:4px 6px;height:58px;box-sizing:border-box;overflow:hidden">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:12px">' + ar(Number(d.date.slice(8, 10))) + '</b>' + (hours ? '<b style="font-size:10px;color:' + C.ink + '">' + esc(hm(hours)) + '</b>' : '') + '</div>' +
        '<div style="font-size:7.5px;color:' + C.muted + ';white-space:nowrap;height:11px">' + esc(inOut) + '</div>' +
        '<div style="font-size:8px;font-weight:700;color:' + tone.fg + ';white-space:nowrap">' + esc(look.tag) + '</div>' +
      '</div>');
  });
  const legend = [['teal', 'في الميعاد'], ['amber', 'تأخير / بصمة ناقصة / مراجعة'], ['red', 'غياب'], ['blue', 'إجازة / إذن'], ['grey', 'راحة']]
    .map(([t, n]) => '<span style="margin-left:12px"><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:' + TONES[t].bar + ';vertical-align:-1px;margin-left:4px"></span>' + esc(n) + '</span>').join('');
  const calendar = box(
    h2('الحضور يوم بيوم', 'الدخول / الخروج والساعات المحتسبة لكل يوم') +
    '<div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px">' +
      WEEK.map((w) => '<div style="text-align:center;font-size:8.5px;font-weight:700;color:' + C.muted + '">' + w + '</div>').join('') +
      cells.join('') +
    '</div>' +
    '<div style="font-size:8.5px;color:' + C.muted + ';margin-top:8px">' + legend + '</div>', 'margin-bottom:12px');

  const timeOff = data.time_off.requests.map((r) =>
    esc(r.label || r.kind) + ' ' + esc(longDate(r.start_date)) + (r.end_date && r.end_date !== r.start_date ? ' – ' + esc(longDate(r.end_date)) : '') +
    ' <span style="color:' + C.muted + '">(' + esc(r.duration_minutes ? ar(r.duration_minutes) + ' د' : 'يوم كامل') + '، ' + esc(label(r.status)) + ')</span>');
  const pending = [
    num(engine.pending_review_days) > 0 ? ar(engine.pending_review_days) + ' يوم حضور تحت المراجعة' : '',
    num(overtime.pending_cases) > 0 ? ar(overtime.pending_cases) + ' حالة أوفر تايم مستنية قرار (' + hm(overtime.pending_hours) + ')' : '',
    num(data.transactions.summary.pending_rows) > 0 ? ar(data.transactions.summary.pending_rows) + ' حركة معلقة' : '',
  ].filter(Boolean);
  const bottom =
    '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px">' +
      box(h2('الإجازات والأذونات خلال الدورة') + '<div style="font-size:9.5px;line-height:1.8">' + (timeOff.length ? timeOff.join('<br/>') : '<span style="color:' + C.muted + '">مفيش طلبات إجازة أو إذن.</span>') + '</div>') +
      box(h2('لسه مستني مراجعة') + '<div style="font-size:9.5px;line-height:1.8">' + (pending.length ? pending.map((p) => '• ' + esc(p)).join('<br/>') : '<span style="color:' + C.teal + '">كل أيام الشهر متراجعة.</span>') + '</div>' +
        '<div style="font-size:8px;color:' + C.faint + ';margin-top:4px">المعلق مش داخل الصافي لحد ما يتعتمد.</div>') +
    '</div>';

  return pageShell(data, 'كشف المرتب · المرتب والحضور', hero + details + stats + calendar + bottom, preview, 'صفحة ١ من ٢', status);
}

// ---------- page 2: evaluation, rank, incentive, advice ----------
function incentivePage(data: EmployeePayrollStatementV1, evaluation: EvaluationApproval, extra: string, preview: boolean, status: string) {
  const f = data.financial;
  const e = f.earnings;
  const approval = evaluation?.approved ? evaluation.approval : null;
  const listItems = evaluation?.list_items || [];
  const kpi = data.kpi;
  const days = data.attendance.days;
  const looks = days.map(dayLook);
  const advice: Array<{ kind: string; text: string }> = [];
  let top = '';
  let calc = '';

  if (approval) {
    const score = num(approval.score);
    const star = approval.star as { points?: number; rank?: number | null; gap?: number | null } | null;
    const scoreColor = score >= 85 ? C.teal : score >= 60 ? C.amber : C.red;
    const rankCard = (name: string, value: string, hint: string) =>
      '<div style="border:1px solid ' + C.line + ';border-radius:14px;padding:10px 12px;text-align:center"><div style="font-size:9px;color:' + C.muted + '">' + esc(name) + '</div><div style="font-size:20px;font-weight:900;line-height:1.4">' + value + '</div><div style="font-size:8.5px;color:' + C.faint + '">' + esc(hint) + '</div></div>';
    top =
      '<div style="display:grid;grid-template-columns:1.35fr 1fr 1fr 1fr;gap:10px;margin-bottom:14px">' +
        '<div style="border-radius:16px;background:' + C.tealSoft + ';padding:12px 14px">' +
          '<div style="font-size:10px;color:' + C.tealDark + ';font-weight:700">التقييم الشهري</div>' +
          '<div style="display:flex;align-items:baseline;gap:6px"><span style="font-size:34px;font-weight:900;color:' + scoreColor + ';line-height:1.2">' + ar(score) + '</span><span style="font-size:12px;color:' + C.muted + '">من ١٠٠</span></div>' +
          '<div style="height:7px;border-radius:7px;background:#fff;overflow:hidden;margin:4px 0"><div style="height:100%;width:' + Math.min(100, Math.max(0, score)) + '%;background:' + scoreColor + '"></div></div>' +
          '<div style="font-size:9px">' + chip(approval.tier_label || '', C.tealDark, '#fff') + ' <span style="color:' + C.muted + '">شريحة ' + ar(approval.tier_percent) + '٪ من الحافز</span></div>' +
        '</div>' +
        rankCard('ترتيبك في الفرع', approval.rank_in_branch ? ar(approval.rank_in_branch) + ' <span style="font-size:11px;color:' + C.muted + '">من ' + ar(approval.rank_in_branch_of) + '</span>' : '—', approval.branch || '') +
        rankCard('ترتيبك في الصيدليات', approval.rank_overall ? ar(approval.rank_overall) + ' <span style="font-size:11px;color:' + C.muted + '">من ' + ar(approval.rank_overall_of) + '</span>' : '—', 'كل الدكاترة') +
        rankCard('نجم الفرع', num(approval.star_egp) > 0 ? '<span style="color:' + C.amber + '">فائز بالنجم</span>' : star?.rank ? 'المركز ' + ar(star.rank) : '—',
          star?.points !== undefined ? ar(star.points) + ' نقطة' + (star.gap ? ' · ناقص ' + ar(star.gap) : '') : 'خارج السباق') +
      '</div>';

    const axes = (approval.axes || []).filter((x) => num(x.weight) > 0);
    const bars = axes.map((x) => {
      const s = x.score === null || x.score === undefined ? null : Math.max(0, Math.min(100, num(x.score)));
      const color = s === null ? '#c9d3d6' : s >= 85 ? C.teal : s >= 60 ? '#e3a72f' : C.red;
      return '<div style="display:grid;grid-template-columns:150px minmax(0,1fr) 62px;gap:10px;align-items:center;padding:5px 0">' +
        '<div style="font-size:10px;font-weight:600">' + esc(x.label) + ' <span style="font-size:8.5px;color:' + C.faint + '">وزن ' + ar(x.weight) + '٪</span></div>' +
        '<div style="height:10px;border-radius:10px;background:' + C.soft + ';overflow:hidden"><div style="height:100%;width:' + (s ?? 0) + '%;background:' + color + ';border-radius:10px"></div></div>' +
        '<div style="font-size:10.5px;font-weight:800;text-align:left;color:' + (s === null ? C.faint : C.ink) + '">' + (s === null ? 'ماتقاسش' : ar(s) + ' / ١٠٠') + '</div></div>';
    }).join('');
    top += box(h2('درجتك في كل بند', 'نسخة التقييم ' + esc(approval.model_version)) + (bars || '<div style="font-size:10px;color:' + C.muted + '">مفيش بنود متقاسة.</div>'), 'margin-bottom:14px');

    const hoursFactor = approval.hours_factor === null ? 1 : num(approval.hours_factor);
    const total = num(approval.performance_egp) + num(approval.bonus_egp) + num(approval.star_egp) + num(e.list_incentive);
    calc = box(h2('إزاي اتحسب حافزك', esc(money(total))) +
      row('وعاء الحافز الشهري', money(EARNED_POOL)) +
      row('× شريحة درجتك', ar(approval.tier_percent) + '٪', { hint: approval.tier_label || '' }) +
      row('× معامل تارجت الفرع', pct(approval.branch_factor), { hint: 'الفرع حقق ' + ar(approval.branch_achievement) + '٪ من التارجت' }) +
      row('× معامل الساعات', pct(hoursFactor), { hint: 'ساعاتك مقارنة بالشهر الكامل' }) +
      (num(approval.absence_cut) > 0 ? row('− خصم الغياب', pct(approval.absence_cut), { hint: ar(approval.absence_days) + ' يوم من غير إذن', color: C.red }) : '') +
      row('= حافز الأداء', money(approval.performance_egp), { strong: true, color: C.tealDark }) +
      row('+ بونص تارجت الفرع', money(approval.bonus_egp)) +
      row('+ جايزة نجم الفرع', money(approval.star_egp)) +
      row('+ حافز اللستة', money(e.list_incentive)) +
      row('إجمالي حوافزك', money(total), { strong: true, color: C.tealDark }));
    advice.push(...((approval.recommendations || []) as Array<{ kind: string; text: string }>));
  } else {
    const perf = kpi.staff_performance;
    const sales = kpi.employee_sales_kpi;
    top =
      '<div style="border-radius:12px;background:' + C.amberSoft + ';color:' + C.amber + ';padding:9px 12px;font-size:10px;font-weight:700;margin-bottom:12px">مفيش تقييم شهري معتمد للدورة دي، فالحافز محسوب بالنقاط والبنود الآلية.</div>' +
      '<div style="display:flex;border:1px solid ' + C.line + ';border-radius:14px;padding:10px 4px;margin-bottom:14px">' +
        stat('صافي النقاط', ar(perf.final_points), 'مكافآت ' + ar(perf.reward_points) + ' · خصم ' + ar(perf.deduction_points)) +
        stat('مبيعاتك', money(sales.sales_total)) +
        stat('فواتيرك', ar(sales.invoices_count), 'متوسط ' + money(sales.avg_invoice)) +
        stat('تارجت الفرع', ar(kpi.branch_target.achievement_percent) + '٪', money(kpi.branch_target.sales_total)) +
      '</div>';
    const followups = num(e.followup_bonus_included_in_automated_total) + num(e.customer_request_bonus_included_in_automated_total);
    calc = box(h2('إزاي اتحسب حافزك', esc(money(num(e.automated_incentives_total) + num(e.list_incentive)))) +
      row('حافز الأداء (النقاط)', money(e.performance_incentive_included_in_automated_total)) +
      row('حافز التارجت', money(e.target_bonus_included_in_automated_total)) +
      row('متابعات وطلبات العملاء', money(followups)) +
      row('نجم الفرع', money(e.branch_star_bonus_included_in_automated_total)) +
      row('حافز اللستة', money(e.list_incentive)) +
      row('إجمالي حوافزك', money(num(e.automated_incentives_total) + num(e.list_incentive)), { strong: true, color: C.tealDark }));
  }

  const listBox = box(h2('أصناف اللستة', listItems.length ? ar(listItems.length) + ' صنف' : '') +
    (listItems.length
      ? table(listItems.slice(0, 9).map((i) => [esc(i.product_name), ar(i.quantity, 1), '<b>' + esc(money(i.incentive_total)) + '</b>']), ['الصنف', 'الكمية', 'الحافز'], ['60%', '15%', '25%']) +
        (listItems.length > 9 ? '<div style="font-size:8.5px;color:' + C.muted + ';margin-top:4px">و' + ar(listItems.length - 9) + ' صنف تاني</div>' : '')
      : '<div style="font-size:10px;color:' + C.muted + ';padding:4px 0">مفيش أصناف لستة اتباعت باسمك في الدورة دي.</div>'));

  const tx = data.transactions.items.filter((t) => t.employee_visible !== false && (num(t.amount) || num(t.points)));
  const txBox = box(h2('الحوافز والخصومات والنقاط', tx.length ? ar(tx.length) + ' حركة' : '') +
    (tx.length
      ? table(tx.slice(0, 7).map((t) => [
          esc(t.date ? longDate(String(t.date).slice(0, 10)) : '-'),
          esc(t.title || label(t.type || t.source) || 'حركة'),
          esc(label(t.status)),
          num(t.amount) ? '<b style="color:' + (num(t.amount) < 0 ? C.red : C.ink) + '">' + esc(money(t.amount)) + '</b>' : '<span style="color:' + C.faint + '">—</span>',
          num(t.points) ? '<b>' + esc(ar(t.points)) + '</b>' : '<span style="color:' + C.faint + '">—</span>',
        ]), ['التاريخ', 'البند', 'الحالة', 'المبلغ', 'النقاط'], ['17%', '38%', '15%', '17%', '13%']) +
        (tx.length > 7 ? '<div style="font-size:8.5px;color:' + C.muted + ';margin-top:4px">و' + ar(tx.length - 7) + ' حركة تانية في صفحة المرتبات</div>' : '')
      : '<div style="font-size:10px;color:' + C.muted + ';padding:4px 0">مفيش حركات على الشهر ده.</div>'), 'margin-bottom:14px');

  const late = num(data.attendance.summary.late_minutes);
  const missing = looks.filter((l) => /بصمة/.test(l.tag)).length;
  const absent = looks.filter((l) => l.tone === 'red').length;
  if (late >= 30) advice.push({ kind: 'note', text: 'اتأخرت ' + ar(late) + ' دقيقة الشهر ده. الالتزام بالميعاد بيحمي حافزك ومرتبك.' });
  if (missing > 0) advice.push({ kind: 'note', text: 'عندك ' + ar(missing) + ' يوم ببصمة ناقصة. بصّم دخول وخروج كل يوم.' });
  if (absent > 0) advice.push({ kind: 'note', text: 'غبت ' + ar(absent) + ' يوم. أي غياب من غير إذن معتمد بيخصم من الحافز.' });
  if (!advice.length) advice.push({ kind: 'strength', text: 'شهر منضبط، كمّل على نفس المستوى.' });
  const KIND: Record<string, { color: string; bg: string; mark: string }> = {
    strength: { color: C.teal, bg: C.tealSoft, mark: 'ممتاز' },
    improve: { color: C.amber, bg: C.amberSoft, mark: 'حسّن' },
    note: { color: C.blue, bg: C.blueSoft, mark: 'خلي بالك' },
  };
  const adviceBox = box(h2('توصيات الشهر الجاي') +
    '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:7px">' +
    advice.slice(0, 6).map((item) => {
      const k = KIND[item.kind] || KIND.note;
      return '<div style="display:flex;gap:8px;align-items:flex-start;background:' + k.bg + ';border-radius:10px;padding:8px 10px">' +
        '<div style="flex:0 0 auto;padding:0 7px;border-radius:999px;background:' + k.color + ';color:#fff;font-size:8.5px;font-weight:800;line-height:17px;white-space:nowrap">' + k.mark + '</div>' +
        '<div style="font-size:9.5px;line-height:1.65;color:' + C.ink + '">' + esc(item.text) + '</div></div>';
    }).join('') + '</div>');

  const signed = approval ? '<div style="font-size:8px;color:' + C.faint + ';margin-top:8px">اعتمد التقييم: ' + esc(approval.approved_by_name || '-') + ' · ' + esc(cairoDateTime(approval.approved_at)) + '</div>' : '';
  const body = top +
    '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin-bottom:14px">' + calc + listBox + '</div>' +
    (extra ? '<div style="margin-bottom:14px">' + extra + '</div>' : '') +
    txBox + adviceBox + signed;
  return pageShell(data, 'كشف المرتب · التقييم والحوافز', body, preview, 'صفحة ٢ من ٢', status);
}

function buildPages(data: EmployeePayrollStatementV1, evaluation: EvaluationApproval, page2Extra = '') {
  const preview = !data.financial.frozen;
  const status = data.financial.frozen ? 'نهائي ومعتمد' : data.finalization.ready ? 'جاهز للاعتماد' : 'معاينة';
  return [salaryPage(data, preview, status), incentivePage(data, evaluation, page2Extra, preview, status)];
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
  document.body.appendChild(host);

  try {
    // The app's Cairo font must be loaded before the pages are drawn, or html2canvas falls back to a system font.
    if (document.fonts?.load) {
      await Promise.all(['400', '600', '700', '800', '900'].map((w) => document.fonts.load(w + ' 12px Cairo').catch(() => undefined)));
      await document.fonts.ready;
    }
    await Promise.all(Array.from(host.querySelectorAll('img')).map((img) => (img.decode ? img.decode().catch(() => undefined) : Promise.resolve())));

    // Two pages, always: a long month shrinks its page instead of spilling onto a third one.
    host.querySelectorAll('.statement-page').forEach((page) => {
      const fit = page.querySelector('.statement-fit') as HTMLElement | null;
      if (!fit) return;
      const room = 1123 - 40 - fit.offsetTop;
      const needed = fit.scrollHeight;
      if (needed > room) {
        const k = Math.max(0.7, room / needed);
        fit.style.transform = 'scale(' + k + ')';
        fit.style.transformOrigin = 'top right';
        fit.style.width = (100 / k) + '%';
      }
    });

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    // JPEG + compression: PNG pages at 2x were ~10 MB each (an 8-page statement came out at 85 MB).
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
    const elements = Array.from(host.querySelectorAll('.statement-page')) as HTMLElement[];
    for (let index = 0; index < elements.length; index += 1) {
      const canvas = await html2canvas(elements[index], { scale: 2, backgroundColor: '#fff', logging: false, useCORS: true });
      if (index > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
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
