import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, RefreshCw, Settings2, ShieldCheck, TimerReset, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import {
  getPayrollCycleFinalizationOverview,
  type PayrollCycleFinalizationOverview,
} from '@/lib/hr/workforceService';

export default function PayrollCycleReadinessOverview({
  monthCycle,
  branch,
  onOpenStaffCompensation,
}: {
  monthCycle: string;
  branch?: string | null;
  onOpenStaffCompensation?: (staffId: string) => void;
}) {
  const [data, setData] = useState<PayrollCycleFinalizationOverview | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!monthCycle) return;
    setLoading(true);
    try {
      setData(await getPayrollCycleFinalizationOverview({
        monthCycle,
        branch: branch || null,
        limit: 100,
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل جاهزية دورة الرواتب');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [branch, monthCycle]);

  useEffect(() => { void load(); }, [load]);

  const blockerAction = (code: string) => {
    if (code === 'cycle_open') return { label: 'الدورة ما زالت مفتوحة', href: null, kind: 'time' as const };
    if (code === 'overtime_pending') return { label: 'راجع الأوفر تايم', href: '/attendance-report?tab=overtime', kind: 'overtime' as const };
    if (code === 'attendance_pending') return { label: 'افتح صندوق المراجعة', href: '/attendance-report?tab=resolution', kind: 'attendance' as const };
    if (code === 'attendance_eligibility') return { label: 'راجع جاهزية الحضور', href: '/attendance-report?tab=resolution', kind: 'attendance' as const };
    if (code === 'financial_drift') return { label: 'راجع اختلاف Attendance Truth', href: '/hr-data-quality', kind: 'drift' as const };
    if (code === 'policy_validation') return { label: 'راجع سياسة الحضور', href: '/hr-data-quality', kind: 'drift' as const };
    if (code === 'schedule_not_ready' || code === 'schedule_gap') return { label: 'راجع الجداول والمناوبات', href: '/hr-schedules', kind: 'schedule' as const };
    if (code === 'no_hourly_rate_configured' || code === 'compensation_not_ready') {
      return { label: 'أكمل ملف التعويضات', href: null, kind: 'compensation' as const };
    }
    return { label: 'راجع سبب الحجب', href: '/hr-data-quality', kind: 'other' as const };
  };

  const blockerGroups = data.top_blockers.map((item) => ({
    ...item,
    action: blockerAction(item.code),
  }));

  if (!data) {
    return (
      <section className="rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="font-black text-[var(--dawaa-theme-heading)]">جاهزية إقفال دورة الرواتب</div>
          <button onClick={() => void load()} className="btn-secondary !px-2">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]">
            <ShieldCheck size={18} /> Cycle Finalization Readiness
          </div>
          <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
            دورة {data.month_cycle}{data.branch ? ` · ${data.branch}` : ' · كل الفروع المتاحة لحسابك'} — قراءة فقط، بدون Finalize أو دفع.
          </div>
        </div>
        <button onClick={() => void load()} className="btn-secondary">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Summary label="نطاق الرواتب" value={data.scope_staff_count ?? data.staff_count} />
        <Summary label="Profiles مهيأة" value={data.configured_staff_count ?? data.staff_count} good={(data.unconfigured_staff_count ?? 0) === 0} />
        <Summary label="تحتاج مراجعة إعداد" value={data.unconfigured_priority_count ?? 0} warn={(data.unconfigured_priority_count ?? 0) > 0} />
        <Summary label="جاهز للإقفال" value={data.ready_count} good />
        <Summary label="Blocked" value={data.blocked_count} warn={data.blocked_count > 0} />
      </div>

      {!!data.configuration_queue?.length && (
        <div className="mt-3 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3">
          <div className="text-xs font-black text-[var(--dawaa-theme-heading)]">Configuration Queue — ملفات التعويضات غير المهيأة</div>
          <p className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
            عدم وجود Profile ليس خصمًا ولا خطأ تلقائيًا. الأولوية للحالات التي لديها نشاط حوافز أو تاريخ Payroll.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.configuration_queue.slice(0, 20).map((row) => (
              <button
                type="button"
                key={row.staff_id}
                onClick={() => onOpenStaffCompensation?.(row.staff_id)}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold transition ${row.priority_review
                  ? 'border-[var(--dawaa-status-warning-border)] text-[var(--dawaa-status-warning-text)]'
                  : 'border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]'}`}
                title={row.priority_review ? 'فتح ملف التعويضات' : 'عرض الموظف'}
              >
                <UserCog size={11} />
                {row.staff_name} · {row.role || '-'}{row.priority_review ? ' · يحتاج إعداد' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {!!blockerGroups.length && (
        <div className="mt-3 rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3">
          <div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-status-warning-text)]">
            <AlertTriangle size={14} /> خطة إغلاق الـBlockers قبل الـFinalization
          </div>
          <p className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
            الأسباب مرتبة من نفس Payroll Gate؛ افتح مكان الحل بدل البحث داخل النظام يدويًا.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {blockerGroups.slice(0, 9).map((item) => {
              const Icon = item.action.kind === 'time'
                ? CalendarClock
                : item.action.kind === 'overtime'
                  ? TimerReset
                  : item.action.kind === 'compensation'
                    ? UserCog
                    : item.action.kind === 'schedule'
                      ? Settings2
                      : AlertTriangle;
              return (
                <div key={item.code} className="rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-theme-surface)] p-3">
                  <div className="flex items-start gap-2">
                    <Icon size={15} className="mt-0.5 shrink-0 text-[var(--dawaa-status-warning-text)]" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-black text-[var(--dawaa-theme-heading)]">{item.label}</div>
                      <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
                        {item.affected_staff.toLocaleString('ar-EG')} موظف متأثر
                      </div>
                    </div>
                  </div>
                  {item.action.href ? (
                    <a href={item.action.href} className="mt-2 inline-flex items-center gap-1 text-[10px] font-black text-[var(--dawaa-status-info-text)]">
                      {item.action.label} <ChevronLeft size={11} />
                    </a>
                  ) : (
                    <div className="mt-2 text-[10px] font-black text-[var(--dawaa-status-warning-text)]">{item.action.label}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-3 max-h-72 overflow-y-auto rounded-2xl border border-[var(--dawaa-theme-border)]">
        <table className="w-full min-w-[980px] text-right text-xs">
          <thead className="sticky top-0 bg-[var(--dawaa-theme-surface-2)]">
            <tr>
              <th className="p-2">الموظف</th>
              <th className="p-2">الفرع</th>
              <th className="p-2">الحالة</th>
              <th className="p-2">سبب عدم الجاهزية</th>
              <th className="p-2">Warnings</th>
              <th className="p-2">V2/V3</th>
              <th className="p-2">الإجراء</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.staff_id} className="border-t border-[var(--dawaa-theme-border)]">
                <td className="p-2 font-black text-[var(--dawaa-theme-heading)]">{row.staff_name}</td>
                <td className="p-2 text-[var(--dawaa-theme-muted)]">{row.branch || '-'}</td>
                <td className="p-2">
                  <span className={row.ready
                    ? 'inline-flex items-center gap-1 font-black text-[var(--dawaa-status-success-text)]'
                    : 'inline-flex items-center gap-1 font-black text-[var(--dawaa-status-warning-text)]'}>
                    {row.ready ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                    {row.ready ? 'Ready' : 'Blocked'}
                  </span>
                </td>
                <td className="p-2">
                  {row.blockers.length ? (
                    <div className="flex max-w-[360px] flex-wrap gap-1">
                      {row.blockers.slice(0, 4).map((blocker) => (
                        <span key={blocker.code} className="rounded-lg border border-[var(--dawaa-status-warning-border)] px-2 py-1 text-[10px] font-bold text-[var(--dawaa-status-warning-text)]">
                          {blocker.label}{blocker.count != null ? ` · ${blocker.count.toLocaleString('ar-EG')}` : ''}{blocker.hours != null ? ` · ${blocker.hours.toLocaleString('ar-EG')} س` : ''}
                        </span>
                      ))}
                      {row.blockers.length > 4 && (
                        <span className="px-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">+{row.blockers.length - 4}</span>
                      )}
                    </div>
                  ) : <span className="text-[var(--dawaa-status-success-text)]">لا يوجد</span>}
                </td>
                <td className="p-2">{row.warning_count.toLocaleString('ar-EG')}</td>
                <td className="p-2">{row.policy_validation.effective_status_changes.toLocaleString('ar-EG')}</td>
                <td className="p-2">
                  {!row.ready && (() => {
                    const primary = row.blockers[0];
                    if (!primary) return null;
                    const action = blockerAction(primary.code);
                    if (action.kind === 'compensation') {
                      return (
                        <button
                          type="button"
                          onClick={() => onOpenStaffCompensation?.(row.staff_id)}
                          className="inline-flex items-center gap-1 text-[10px] font-black text-[var(--dawaa-status-info-text)]"
                        >
                          {action.label} <ChevronLeft size={11} />
                        </button>
                      );
                    }
                    if (action.href) {
                      return (
                        <a href={action.href} className="inline-flex items-center gap-1 text-[10px] font-black text-[var(--dawaa-status-info-text)]">
                          {action.label} <ChevronLeft size={11} />
                        </a>
                      );
                    }
                    return <span className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{action.label}</span>;
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Summary({
  label,
  value,
  warn = false,
  good = false,
}: {
  label: string;
  value: number;
  warn?: boolean;
  good?: boolean;
}) {
  const cls = warn
    ? 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]'
    : good
      ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]'
      : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)]';

  return (
    <div className={`rounded-2xl border p-3 ${cls}`}>
      <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">{label}</div>
      <div className="mt-1 text-2xl font-black text-[var(--dawaa-theme-heading)]">{value.toLocaleString('ar-EG')}</div>
    </div>
  );
}
