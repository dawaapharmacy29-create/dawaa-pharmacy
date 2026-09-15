import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

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
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatTime(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' });
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

      <div style="font-weight:800;margin-bottom:8px">معدلات آخر 30 يوم</div>
      <div style="display:flex;gap:8px;margin-bottom:18px">
        <div style="flex:1;border:1px solid #d1d5db;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:16px;font-weight:800">${input.rates.late_rate_pct}%</div>
          <div style="font-size:10px;color:#6b7280">معدل التأخير (${input.rates.late_days + input.rates.very_late_days} يوم)</div>
        </div>
        <div style="flex:1;border:1px solid #d1d5db;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:16px;font-weight:800">${input.rates.permission_rate_pct}%</div>
          <div style="font-size:10px;color:#6b7280">معدل الإذن/الإجازة (${input.rates.permission_days} يوم)</div>
        </div>
        <div style="flex:1;border:1px solid #d1d5db;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:16px;font-weight:800">${input.rates.absence_days}</div>
          <div style="font-size:10px;color:#6b7280">أيام غياب</div>
        </div>
        <div style="flex:1;border:1px solid #d1d5db;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:16px;font-weight:800">${input.rates.pending_review_days}</div>
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
        <tbody>${recentRows || '<tr><td colspan="4" style="padding:10px;font-size:11px;color:#6b7280">لا توجد بيانات حضور.</td></tr>'}</tbody>
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
    const pageWidth = 190;
    const pageHeight = 277;
    const imgHeight = (canvas.height * pageWidth) / canvas.width;
    const imgData = canvas.toDataURL('image/png', 1);
    let heightLeft = imgHeight;
    let position = 10;
    pdf.addImage(imgData, 'PNG', 10, position, pageWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = 10 - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 10, position, pageWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    const safeName = String(input.staffName || 'employee').replace(/[\\/:*?"<>|]/g, '-');
    const fileName = `بروفايل-حضور-${safeName}.pdf`;
    return { pdf, fileName };
  } finally {
    host.remove();
  }
}
