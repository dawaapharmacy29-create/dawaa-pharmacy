import { buildEmployeePayrollStatementPdf as buildLegacyEmployeePayrollStatementPdf } from './employeePayrollStatementPdfLegacy';

const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value: unknown) => num(value).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';

function get(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  return (obj as Record<string, unknown>)[key];
}

function esc(value: unknown) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function card(label: string, value: string, hint = '') {
  return '<div style="border:1px solid #d9e4e5;border-radius:12px;padding:11px;background:#f9fbfb">' +
    '<div style="font-size:9px;color:#6b7b84">' + esc(label) + '</div>' +
    '<div style="font-size:17px;font-weight:900;margin-top:4px">' + esc(value) + '</div>' +
    (hint ? '<div style="font-size:8px;color:#6b7b84;margin-top:3px;line-height:1.5">' + esc(hint) + '</div>' : '') +
  '</div>';
}

function deliveryPageHtml(statement: Awaited<ReturnType<typeof buildLegacyEmployeePayrollStatementPdf>>['statement']) {
  const financial = statement.financial;
  const breakdown = financial.delivery_breakdown || {};
  const preview = (breakdown.preview || statement.delivery_preview || {}) as Record<string, unknown>;
  const classification = (breakdown.classification || statement.delivery_classification || {}) as Record<string, unknown>;
  const classInfo = (get(classification, 'classification') || {}) as Record<string, unknown>;
  const rates = (get(preview, 'rates') || get(classification, 'rates') || {}) as Record<string, unknown>;
  const activity = (breakdown.activity || get(preview, 'delivery_activity') || {}) as Record<string, unknown>;
  const attendance = (get(classification, 'attendance') || {}) as Record<string, unknown>;
  const discipline = (get(classification, 'discipline') || {}) as Record<string, unknown>;
  const evidence = (get(preview, 'delivery_attendance_evidence') || {}) as Record<string, unknown>;
  const blockers = statement.finalization?.blockers || [];
  const evalPct = get(rates, 'monthly_evaluation_multiplier_pct');
  const className = String(get(classInfo, 'display_name') || get(classInfo, 'discipline_band_ar') || 'غير نهائي');
  const tenure = String(get(classInfo, 'tenure_band_ar') || '-');

  const blockerRows = blockers.slice(0, 8).map((item) => {
    const row = item as Record<string, unknown>;
    return '<div style="padding:5px 0;border-bottom:1px solid #f0e1b8">• ' + esc(row.label || row.code || 'مراجعة مطلوبة') + '</div>';
  }).join('');

  return '<section class="delivery-statement-page" style="width:794px;min-height:1123px;box-sizing:border-box;padding:30px 34px 46px;background:#fff;color:#102235;font-family:Tahoma,Arial,sans-serif;direction:rtl">' +
    '<header style="display:flex;justify-content:space-between;gap:18px;border-bottom:3px solid #0b8c86;padding-bottom:10px;margin-bottom:16px">' +
      '<div><div style="font-size:20px;font-weight:900">تفاصيل راتب الدليفري</div><div style="font-size:9px;color:#687983;margin-top:3px">' + esc(statement.staff.name) + ' · ' + esc(statement.cycle.start) + ' → ' + esc(statement.cycle.end) + '</div></div>' +
      '<div style="font-size:9px;color:#687983;text-align:left"><b style="font-size:11px;color:#102235">صيدليات دواء</b><br/>Delivery Payroll V3</div>' +
    '</header>' +
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">' +
      card('التصنيف', className, 'الفئة: ' + tenure) +
      card('أيام الحضور', num(get(attendance, 'attended_days')).toLocaleString('ar-EG'), 'المطلوب: ' + num(get(attendance, 'minimum_attended_days')).toLocaleString('ar-EG')) +
      card('دقائق الانضباط', num(get(discipline, 'classification_minutes')).toLocaleString('ar-EG') + ' د', 'ملتزم ' + num(get(discipline, 'committed_credit_minutes')).toLocaleString('ar-EG') + ' · عادي ' + num(get(discipline, 'regular_credit_minutes')).toLocaleString('ar-EG')) +
      card('التقييم الشهري', evalPct == null ? 'غير معتمد' : num(evalPct).toLocaleString('ar-EG') + '%', 'السقف ' + money(get(rates, 'monthly_incentive_cap'))) +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">' +
      card('سعر الساعة', money(get(rates, 'hourly_rate'))) + card('سعر الأوردر', money(get(rates, 'order_rate'))) + card('سعر المشوار', money(get(rates, 'trip_rate'))) +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">' +
      card('الأوردرات المحتسبة', num(get(activity, 'orders_counted')).toLocaleString('ar-EG'), 'إجمالي ' + num(get(activity, 'orders_total')).toLocaleString('ar-EG') + ' · معلق ' + num(get(activity, 'orders_pending')).toLocaleString('ar-EG')) +
      card('المشاوير المعتمدة', num(get(activity, 'trips_approved')).toLocaleString('ar-EG'), 'إجمالي ' + num(get(activity, 'trips_total')).toLocaleString('ar-EG') + ' · معلق ' + num(get(activity, 'trips_pending')).toLocaleString('ar-EG')) +
      card('وحدات المشاوير', num(get(activity, 'trip_weighted_units')).toLocaleString('ar-EG')) +
      card('Attendance Evidence', num(get(evidence, 'app_attendance_days')).toLocaleString('ar-EG') + ' يوم', 'Payroll canonical: ' + num(get(evidence, 'payroll_worked_days')).toLocaleString('ar-EG')) +
    '</div>' +
    '<div style="border:1px solid #b8ded9;background:#eff9f7;border-radius:14px;padding:13px;margin-bottom:14px">' +
      '<div style="font-size:12px;font-weight:900;color:#087f7a;margin-bottom:8px">المكونات المالية للدليفري — بدون Double Counting</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px 20px;font-size:10px;line-height:1.8">' +
        '<div>أساس الساعات: <b>' + esc(money(breakdown.base_salary)) + '</b></div>' +
        '<div>Overtime: <b>' + esc(money(breakdown.approved_overtime)) + '</b></div>' +
        '<div>الأوردرات: <b>' + esc(money(breakdown.order_pay)) + '</b></div>' +
        '<div>المشاوير: <b>' + esc(money(breakdown.trip_pay)) + '</b></div>' +
        '<div>الحافز الشهري: <b>' + esc(money(breakdown.monthly_incentive)) + '</b></div>' +
        '<div>الحافز الربع سنوي: <b>' + esc(money(breakdown.quarterly_incentive)) + '</b></div>' +
        '<div>الإجمالي التشغيلي + الحوافز: <b>' + esc(money(breakdown.operational_and_incentive_total)) + '</b></div>' +
        '<div>صافي الكشف: <b>' + esc(money(financial.display_net_salary)) + '</b></div>' +
      '</div>' +
    '</div>' +
    (blockerRows ? '<div style="border:1px solid #efca78;background:#fff9ec;border-radius:12px;padding:11px;font-size:9px;line-height:1.7"><b style="color:#8b5d00">موانع الإقفال الحالية:</b>' + blockerRows + '</div>' : '<div style="border:1px solid #b8ded9;background:#eff9f7;border-radius:12px;padding:11px;font-size:9px"><b style="color:#087f7a">لا توجد موانع إقفال حالية.</b></div>') +
    '<div style="margin-top:14px;font-size:8px;color:#687983;line-height:1.6">قاعدة المصدر: Payroll attendance هو المصدر المالي للحضور. تطبيق الدليفري يرسل النشاط المعتمد وAttendance Evidence فقط، ولا يحدد أسعار الراتب.</div>' +
  '</section>';
}

export async function buildEmployeePayrollStatementPdf(
  staffId: string,
  monthCycle: string,
  options: { requireFinalized?: boolean } = {}
) {
  const result = await buildLegacyEmployeePayrollStatementPdf(staffId, monthCycle, options);
  if (!result.statement.delivery_mode) return result;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-12000px;top:0;width:794px;background:#fff';
  host.dir = 'rtl';
  host.innerHTML = deliveryPageHtml(result.statement);
  document.body.appendChild(host);

  try {
    const [{ default: html2canvas }] = await Promise.all([import('html2canvas')]);
    const element = host.querySelector('.delivery-statement-page') as HTMLElement | null;
    if (element) {
      const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#fff', logging: false, useCORS: true });
      result.pdf.addPage();
      result.pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297);
    }
    return result;
  } finally {
    host.remove();
  }
}
