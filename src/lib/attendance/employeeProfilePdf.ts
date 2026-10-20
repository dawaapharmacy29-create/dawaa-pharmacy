import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { formatEmployeeProfileClock as formatTime } from './profileTime';
import { paginateEmployeeProfileBitmap } from './pdfPageLayout';

export type EmployeeProfilePdfInput = {
  staffName: string;
  role: string | null;
  branch: string | null;
  weeklySchedule: { day_name: string; shift_date: string | null; is_off: boolean; shift_start: string | null; shift_end: string | null }[];
  rates: {
    late_rate_pct: number; permission_rate_pct: number; late_days: number; very_late_days: number;
    early_leave_days: number; permission_days: number; absence_days: number; pending_review_days: number; evaluated_days: number;
  };
  recentDays: {
    attendance_date: string; resolution_status: string; first_in: string | null; last_out: string | null;
    late_minutes: number; payroll_eligible_hours: number | null;
  }[];
  processedEvidence?: {
    accepted_punches: number; accepted_days: number; complete_pair_days: number;
    summary_covered_days: number; missing_summary_days: number; coverage_complete: boolean;
    manual_review_punches: number;
    recent_days: { shift_date: string; accepted_punches: number; first_in: string | null;
      last_out: string | null; punch_branches: string[]; has_summary: boolean }[];
  };
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const STATUS_LABEL: Record<string, string> = {
  on_time: 'في الموعد', late: 'متأخر', very_late: 'متأخر جدًا', absence_review: 'غياب',
  missing_checkin: 'دخول ناقص', missing_checkout: 'خروج ناقص', off_day: 'إجازة', worked_on_off: 'حضور في إجازة',
  approved_time_off: 'إذن معتمد', early_leave_review: 'خروج مبكر', shift_in_progress: 'جارٍ الآن', no_schedule: 'بدون جدول',
};

export async function buildEmployeeAttendanceProfilePdf(input: EmployeeProfilePdfInput) {
  const scheduleRows = input.weeklySchedule
    .map((s) => `<div style="border:1px solid #d1d5db;border-radius:8px;padding:8px;text-align:center;font-size:11px">
        <div style="font-weight:800;color:#111827">${escapeHtml(s.day_name)}${s.shift_date ? ` (${escapeHtml(s.shift_date)})` : ''}</div>
        <div style="color:#374151">${s.is_off ? 'إجازة' : `${escapeHtml(formatTime(s.shift_start))} ← ${escapeHtml(formatTime(s.shift_end))}`}</div>
      </div>`)
    .join('');

  const recentRows = input.recentDays
    .slice(0, 30)
    .map((d) => `<tr>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;font-size:11px">${escapeHtml(d.attendance_date)}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;font-size:11px">${escapeHtml(formatTime(d.first_in))} ← ${escapeHtml(formatTime(d.last_out))}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;font-size:11px;font-weight:700">${d.payroll_eligible_hours != null ? escapeHtml(d.payroll_eligible_hours) + ' س' : '-'}</td>
        <td style="padding:6px;border-bottom:1px solid #e5e7eb;font-size:11px;font-weight:700">${escapeHtml(STATUS_LABEL[d.resolution_status] || d.resolution_status)}</td>
      </tr>`)
    .join('');

  const coverageMissing = !input.processedEvidence?.coverage_complete;
  const rawRows = (input.processedEvidence?.recent_days || [])
    .map((day) => `<tr>
      <td style="padding:6px;border-bottom:1px solid #e5e7eb;font-size:11px">${escapeHtml(day.shift_date)}</td>
      <td style="padding:6px;border-bottom:1px solid #e5e7eb;font-size:11px">${escapeHtml(formatTime(day.first_in))} ← ${escapeHtml(formatTime(day.last_out))}</td>
      <td style="padding:6px;border-bottom:1px solid #e5e7eb;font-size:11px">${escapeHtml(day.accepted_punches)} مقبولة${!day.has_summary && day.accepted_punches > 0 ? ' · بدون ملخص' : ''}</td>
      <td style="padding:6px;border-bottom:1px solid #e5e7eb;font-size:11px">${escapeHtml(day.punch_branches?.join('، ') || '-')}</td>
    </tr>`).join('');
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-9999px';
  host.style.top = '0';
  host.dir = 'rtl';
  host.innerHTML = `
    <div style="width:780px;padding:24px;background:#ffffff;font-family:Tahoma,Arial,sans-serif;color:#111827;direction:rtl">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #111827;padding-bottom:10px;margin-bottom:16px">
        <div>
          <div style="font-size:18px;font-weight:800">${escapeHtml(input.staffName)}</div>
          <div style="font-size:12px;color:#6b7280">${escapeHtml(input.role || '-')} — ${escapeHtml(input.branch || '-')}</div>
        </div>
        <div style="font-size:11px;color:#6b7280">تاريخ التقرير: ${escapeHtml(new Date().toLocaleDateString('ar-EG'))}</div>
      </div>

      ${coverageMissing && (input.processedEvidence?.accepted_punches || 0) > 0
        ? `<div style="padding:10px;margin-bottom:12px;border:1px solid #eab308;font-size:12px;font-weight:700">
        توجد ${escapeHtml(input.processedEvidence?.accepted_punches)} بصمة مقبولة عبر
        ${escapeHtml(input.processedEvidence?.accepted_days)} يوم.
        ${escapeHtml(input.processedEvidence?.missing_summary_days ?? 0)} يوم بصمات مقبولة لا يقابله ملخص حضور.
        لذلك معدلات الفترة غير مكتملة. البصمة ليست اعتماد ساعات للمرتب أو دليلاً على تأخير صفر.</div>` : ''}
      <div style="font-weight:800;margin-bottom:8px">معدلات آخر 30 يوم (من ملخص الحضور فقط)</div>
      <div style="display:flex;gap:8px;margin-bottom:18px">
        <div style="flex:1;border:1px solid #d1d5db;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:16px;font-weight:800">${coverageMissing ? 'غير متاح' : input.rates.late_rate_pct + '%'}</div>
          <div style="font-size:10px;color:#6b7280">معدل التأخير (${input.rates.late_days + input.rates.very_late_days} يوم)</div>
        </div>
        <div style="flex:1;border:1px solid #d1d5db;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:16px;font-weight:800">${coverageMissing ? 'غير متاح' : input.rates.permission_rate_pct + '%'}</div>
          <div style="font-size:10px;color:#6b7280">معدل الإذن/الإجازة (${input.rates.permission_days} يوم)</div>
        </div>
        <div style="flex:1;border:1px solid #d1d5db;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:16px;font-weight:800">${coverageMissing ? '—' : input.rates.absence_days}</div>
          <div style="font-size:10px;color:#6b7280">أيام غياب</div>
        </div>
        <div style="flex:1;border:1px solid #d1d5db;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:16px;font-weight:800">${coverageMissing ? '—' : input.rates.pending_review_days}</div>
          <div style="font-size:10px;color:#6b7280">قيد المراجعة</div>
        </div>
      </div>

      <div style="font-weight:800;margin-bottom:8px">الشيفت الأسبوعي</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:18px">${scheduleRows || '<div style="font-size:11px;color:#6b7280">لا يوجد جدول شيفت مسجل.</div>'}</div>

      <div style="font-weight:800;margin-bottom:8px">آخر الأيام</div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="text-align:right;padding:6px;border-bottom:2px solid #111827;font-size:11px">التاريخ</th>
          <th style="text-align:right;padding:6px;border-bottom:2px solid #111827;font-size:11px">دخول ← خروج</th>
          <th style="text-align:right;padding:6px;border-bottom:2px solid #111827;font-size:11px">الساعات</th>
          <th style="text-align:right;padding:6px;border-bottom:2px solid #111827;font-size:11px">الحالة</th>
        </tr></thead>
        <tbody>${recentRows || '<tr><td colspan="4" style="padding:10px;font-size:11px;color:#6b7280">لا يوجد ملخص حضور لهذه الفترة؛ راجع سجل البصمات أدناه.</td></tr>'}</tbody>
      </table>

      <div style="font-weight:800;margin-top:18px;margin-bottom:8px">سجل البصمات المُعالجة (دليل غير مالي)</div>
      <div style="font-size:11px;color:#374151;margin-bottom:8px">
        ${escapeHtml(input.processedEvidence?.accepted_punches ?? 0)} بصمة مقبولة عبر
        ${escapeHtml(input.processedEvidence?.accepted_days ?? 0)} يوم،
        منها ${escapeHtml(input.processedEvidence?.complete_pair_days ?? 0)} يوم بدخول وخروج،
        و${escapeHtml(input.processedEvidence?.summary_covered_days ?? 0)} يوم له ملخص حضور،
        و${escapeHtml(input.processedEvidence?.missing_summary_days ?? 0)} يوم بدون ملخص،
        و${escapeHtml(input.processedEvidence?.manual_review_punches ?? 0)} بصمة تحت الفحص.
        لا تُعتمد الساعات للمرتب من هذا السجل وحده.
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="text-align:right;padding:6px;border-bottom:2px solid #111827;font-size:11px">يوم الشيفت</th>
          <th style="text-align:right;padding:6px;border-bottom:2px solid #111827;font-size:11px">دخول ← خروج</th>
          <th style="text-align:right;padding:6px;border-bottom:2px solid #111827;font-size:11px">حالة الجهاز</th>
          <th style="text-align:right;padding:6px;border-bottom:2px solid #111827;font-size:11px">فرع البصمة</th>
        </tr></thead>
        <tbody>${rawRows || '<tr><td colspan="4" style="padding:10px;font-size:11px;color:#6b7280">لا توجد بصمات معالجة.</td></tr>'}</tbody>
      </table>
      <div style="margin-top:22px;font-size:10px;color:#6b7280;text-align:center">تم إنشاء التقرير من نظام Dawaa Pharmacy — بروفايل حضور الموظف</div>
    </div>`;
  document.body.appendChild(host);

  try {
    const canvas = await html2canvas(host.firstElementChild as HTMLElement, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageSlices = paginateEmployeeProfileBitmap(canvas.width, canvas.height);
    for (let i = 0; i < pageSlices.length; i++) {
      const slice = pageSlices[i];
      if (i > 0) pdf.addPage();
      if (pageSlices.length === 1) {
        // Slight overrun: scale proportionally into a single page, no blank page 2.
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG',
          slice.leftMm, 10, slice.widthMm, slice.heightMm);
      } else {
        // Do not repeat the complete bitmap at a negative Y on each page:
        // slice and include exactly the visible source rows for this page.
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = slice.heightPx;
        const ctx = pageCanvas.getContext('2d');
        if (!ctx) throw new Error('تعذر تجهيز صفحات PDF');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(canvas, 0, slice.topPx, canvas.width, slice.heightPx,
          0, 0, canvas.width, slice.heightPx);
        pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG',
          slice.leftMm, 10, slice.widthMm, slice.heightMm);
      }
    }
    const safeName = String(input.staffName || 'employee').replace(/[\\/:*?"<>|]/g, '-');
    const fileName = `بروفايل-حضور-${safeName}.pdf`;
    return { pdf, fileName };
  } finally {
    host.remove();
  }
}
