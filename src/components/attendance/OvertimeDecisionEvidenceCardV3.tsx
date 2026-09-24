import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeDollarSign,
  Clock3,
  ReceiptText,
  ShieldCheck,
  Users2,
} from 'lucide-react';
import {
  getOvertimeDecisionEvidenceV3,
  type OvertimeDecisionEvidenceV3,
  type OvertimeEvidenceRoleGroupV3,
} from '@/lib/attendance/attendanceBreakdownService';

const roleLabel: Record<OvertimeEvidenceRoleGroupV3, string> = {
  doctor: 'الدكاترة',
  delivery: 'الدليفري',
  assistant: 'المساعدين',
  other: 'نفس الفئة الوظيفية',
};

function cairoTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('ar-EG', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function money(value?: number | null) {
  if (value == null) return 'غير متاح';
  return `${Number(value).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
}

function invoices(value?: number | null) {
  if (value == null) return 'غير متاح';
  return `${Number(value).toLocaleString('ar-EG')} فاتورة`;
}

function minutesBetween(later?: string | null, earlier?: string | null) {
  if (!later || !earlier) return 0;
  const laterDate = new Date(later);
  const earlierDate = new Date(earlier);
  if (Number.isNaN(laterDate.getTime()) || Number.isNaN(earlierDate.getTime())) return 0;
  return Math.max(0, Math.round((laterDate.getTime() - earlierDate.getTime()) / 60000));
}

function durationLabelFromMinutes(total?: number | null) {
  const minutes = Math.max(0, Math.round(Number(total || 0)));
  if (minutes < 60) return `${minutes.toLocaleString('ar-EG')} دقيقة`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest
    ? `${hours.toLocaleString('ar-EG')}:${String(rest).padStart(2, '0')} ساعة`
    : `${hours.toLocaleString('ar-EG')} ساعة`;
}

function TimeBox({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3">
      <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">{label}</div>
      <div className="mt-1 text-base font-black text-[var(--dawaa-theme-heading)]">{value}</div>
      {hint ? <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{hint}</div> : null}
    </div>
  );
}

function Metric({
  label,
  count,
  value,
  hint,
}: {
  label: string;
  count: number | null | undefined;
  value: number | null | undefined;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3">
      <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">{label}</div>
      <div className="mt-1 text-sm font-black text-[var(--dawaa-theme-heading)]">
        {invoices(count)} · {money(value)}
      </div>
      {hint && <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{hint}</div>}
    </div>
  );
}

export default function OvertimeDecisionEvidenceCardV3({ overtimeId }: { overtimeId: string }) {
  const [data, setData] = useState<OvertimeDecisionEvidenceV3 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getOvertimeDecisionEvidenceV3(overtimeId)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'تعذر تحميل تفاصيل القرار');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [overtimeId]);

  const otherPeople = useMemo(
    () => (data?.staffing?.people || []).filter((person) => !person.is_current_employee),
    [data]
  );

  if (loading) {
    return (
      <div className="mt-3 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-4 text-xs font-bold text-[var(--dawaa-theme-muted)]">
        جاري تجميع تفاصيل الأوفر تايم من الحضور والمبيعات...
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-4 text-xs font-bold text-[var(--dawaa-status-danger-text)]">
        {error}
      </div>
    );
  }

  if (!data?.evidence_available) {
    return (
      <div className="mt-3 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-4">
        <div className="flex items-center gap-2 text-sm font-black text-[var(--dawaa-status-warning-text)]">
          <AlertTriangle size={16} /> تفاصيل الاستحقاق غير مكتملة
        </div>
        <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
          {data?.warnings?.join(' · ') || data?.reason || 'لا توجد بيانات كافية.'}
        </div>
      </div>
    );
  }

  const attendance = data.attendance_truth!;
  const staffing = data.staffing!;
  const sales = data.sales!;
  const category = roleLabel[data.role_group] || 'نفس الفئة الوظيفية';
  const earlyArrivalMinutes = attendance.first_in
    ? minutesBetween(attendance.scheduled_start_at, attendance.first_in)
    : 0;
  const postShiftMinutes = minutesBetween(attendance.last_out, attendance.scheduled_end_at);
  const candidateMinutes = Math.round(Number(attendance.overtime_candidate_hours || 0) * 60);

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-[var(--dawaa-theme-heading)]">
            <ShieldCheck size={17} /> Overtime Decision Evidence V3
          </div>
          <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
            راجع موعد الشيفت مقابل الدخول والخروج الفعلي قبل اتخاذ قرار الاعتماد.
          </div>
        </div>
        <div className="rounded-full border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-3 py-1.5 text-xs font-black">
          المدة المرشحة بعد التسوية: {durationLabelFromMinutes(candidateMinutes)}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <TimeBox
          label="الشيفت الأصلي"
          value={`${cairoTime(attendance.scheduled_start_at)} → ${cairoTime(attendance.scheduled_end_at)}`}
          hint="الموعد المعتمد في الجدول"
        />
        <TimeBox
          label="الدخول الفعلي"
          value={cairoTime(attendance.first_in)}
          hint={earlyArrivalMinutes > 0 ? `قبل بداية الشيفت بـ ${durationLabelFromMinutes(earlyArrivalMinutes)}` : 'لا يوجد دخول مبكر'}
        />
        <TimeBox
          label="الخروج الفعلي"
          value={cairoTime(attendance.last_out)}
          hint={postShiftMinutes > 0 ? `بعد نهاية الشيفت بـ ${durationLabelFromMinutes(postShiftMinutes)}` : 'لا يوجد خروج بعد الموعد'}
        />
        <TimeBox
          label="وقت قبل الشيفت"
          value={durationLabelFromMinutes(earlyArrivalMinutes)}
          hint="للمراجعة عند وجود دخول مبكر"
        />
        <TimeBox
          label="وقت بعد الشيفت"
          value={durationLabelFromMinutes(postShiftMinutes)}
          hint="الوقت الفعلي بعد نهاية الجدول"
        />
        <TimeBox
          label="المؤهل الحالي للأوفر تايم"
          value={durationLabelFromMinutes(candidateMinutes)}
          hint={attendance.late_minutes > 0 ? `بعد تسوية تأخير ${attendance.late_minutes.toLocaleString('ar-EG')} دقيقة` : 'بعد مقارنة العمل الفعلي بساعات الجدول'}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3">
          <div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-heading)]">
            <Users2 size={15} /> التغطية في الفرع أثناء الفترة الإضافية
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{category} الآخرين الموجودون</div>
              <div className="mt-1 text-2xl font-black">{staffing.same_role_others_present_any.toLocaleString('ar-EG')}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">غطوا الفترة بالكامل</div>
              <div className="mt-1 text-2xl font-black">{staffing.same_role_others_cover_full_window.toLocaleString('ar-EG')}</div>
            </div>
          </div>
          {!!otherPeople.length && (
            <div className="mt-3 space-y-1.5">
              {otherPeople.slice(0, 8).map((person) => (
                <div key={person.staff_id} className="flex items-center justify-between rounded-lg bg-[var(--dawaa-theme-surface-2)] px-2 py-1.5 text-[10px] font-bold">
                  <span>{person.name}</span>
                  <span className="text-[var(--dawaa-theme-muted)]">
                    {person.overlap_minutes.toLocaleString('ar-EG')} دقيقة
                    {person.covers_full_window ? ' · كامل الفترة' : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 lg:col-span-2">
          <div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-heading)]">
            <ReceiptText size={15} /> حركة الفواتير والمبيعات
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Metric
              label={`الفرع أثناء الأوفر تايم · ${cairoTime(sales.branch_overtime.start_at)} → ${cairoTime(sales.branch_overtime.end_at)}`}
              count={sales.branch_overtime.invoice_count}
              value={sales.branch_overtime.invoice_value}
              hint="كل فواتير الفرع في نفس الفترة الفعلية."
            />
            <Metric
              label="الموظف خلال الشيفت الأصلي"
              count={sales.employee_shift.invoice_count}
              value={sales.employee_shift.invoice_value}
              hint={
                sales.employee_attribution_available
                  ? data.role_group === 'delivery'
                    ? 'من الفواتير المرتبطة باسم الدليفري.'
                    : 'من الفواتير المرتبطة بالدكتور.'
                  : 'لا يوجد Attribution فردي موثوق لهذا الدور.'
              }
            />
            <Metric
              label={`الموظف في آخر ساعة طبيعية · ${cairoTime(sales.employee_last_hour.start_at)} → ${cairoTime(sales.employee_last_hour.end_at)}`}
              count={sales.employee_last_hour.invoice_count}
              value={sales.employee_last_hour.invoice_value}
            />
            <Metric
              label={`الموظف أثناء الفترة الإضافية · ${cairoTime(sales.employee_overtime.start_at)} → ${cairoTime(sales.employee_overtime.end_at)}`}
              count={sales.employee_overtime.invoice_count}
              value={sales.employee_overtime.invoice_value}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 text-xs">
          <div className="flex items-center gap-2 font-black"><Clock3 size={14} /> التأخير أول الشيفت</div>
          <div className="mt-1 font-bold text-[var(--dawaa-theme-muted)]">{attendance.late_minutes.toLocaleString('ar-EG')} دقيقة</div>
        </div>
        <div className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 text-xs">
          <div className="flex items-center gap-2 font-black"><BadgeDollarSign size={14} /> طريقة ربط مبيعات الموظف</div>
          <div className="mt-1 font-bold text-[var(--dawaa-theme-muted)]">
            {sales.employee_attribution_method === 'seller'
              ? 'البائع / staff_id'
              : sales.employee_attribution_method === 'delivery_staff'
                ? 'delivery_staff'
                : 'غير مطبق لهذا الدور'}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3 text-xs">
          <div className="flex items-center gap-2 font-black"><ReceiptText size={14} /> توقيت الفاتورة</div>
          <div className="mt-1 font-bold text-[var(--dawaa-theme-muted)]">{sales.timestamp_source}</div>
        </div>
      </div>

      {!!data.warnings?.length && (
        <div className="rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-[11px] font-bold text-[var(--dawaa-status-warning-text)]">
          {data.warnings.join(' · ')}
        </div>
      )}

      <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
        {data.decision_note}
      </div>
    </div>
  );
}
