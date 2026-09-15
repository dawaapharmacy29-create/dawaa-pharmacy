import { useEffect, useState } from 'react';
import { X, Calendar, TrendingUp, Clock3 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type Profile = {
  staff: { id: string; name: string; role: string | null; branch: string | null; active: boolean };
  weekly_schedule: { day_name: string; shift_date: string | null; is_off: boolean; shift_start: string | null; shift_end: string | null }[];
  rates: {
    evaluated_days: number; on_time_days: number; late_days: number; very_late_days: number;
    early_leave_days: number; permission_days: number; absence_days: number; pending_review_days: number;
    late_rate_pct: number; permission_rate_pct: number;
  };
  recent_days: {
    attendance_date: string; status: string; resolution_status: string; first_in: string | null;
    last_out: string | null; late_minutes: number; early_leave_minutes: number; payroll_eligible_hours: number | null;
  }[];
};

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

export default function EmployeeProfileDrawer({ staffId, onClose }: { staffId: string; onClose: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('attendance_employee_profile_v1', { p_staff_id: staffId, p_days: 30 });
        if (rpcError) throw rpcError;
        if (!cancelled) setProfile(data as Profile);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات الموظف');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [staffId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose} dir="rtl">
      <div className="h-full w-full max-w-lg overflow-y-auto dawaa-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-[var(--dawaa-theme-heading)]">{loading ? 'جارٍ التحميل...' : profile?.staff.name || 'بروفايل الموظف'}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-[var(--dawaa-theme-surface-2)]"><X size={18} /></button>
        </div>

        {error && <div className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</div>}
        {loading && <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--dawaa-theme-surface-2)]" />)}</div>}

        {profile && !loading && <div className="space-y-5">
          <div className="flex flex-wrap gap-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">
            <span className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-1">{profile.staff.role || '-'}</span>
            <span className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-1">{profile.staff.branch || '-'}</span>
            {!profile.staff.active && <span className="rounded-full border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-2 py-1 text-[var(--dawaa-status-danger-text)]">غير نشط</span>}
          </div>

          <section>
            <div className="mb-2 flex items-center gap-1.5 font-black text-[var(--dawaa-theme-heading)]"><TrendingUp size={16} /> معدلات آخر 30 يوم</div>
            <div className="grid grid-cols-3 gap-2">
              <RateBox label="تأخير" value={`${profile.rates.late_rate_pct}%`} sub={`${profile.rates.late_days + profile.rates.very_late_days} يوم`} />
              <RateBox label="إذن/إجازة" value={`${profile.rates.permission_rate_pct}%`} sub={`${profile.rates.permission_days} يوم`} />
              <RateBox label="مراجعة معلقة" value={String(profile.rates.pending_review_days)} sub="يوم" />
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-1.5 font-black text-[var(--dawaa-theme-heading)]"><Calendar size={16} /> الشيفت الأسبوعي</div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {profile.weekly_schedule.filter((s) => s.day_name).map((s, i) => <div key={i} className={cn('rounded-lg border p-2 text-center text-[11px] font-bold', s.is_off ? 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]' : 'border-[var(--dawaa-theme-border)] dawaa-surface-soft')}>
                <div className="font-black text-[var(--dawaa-theme-heading)]">{s.day_name}{s.shift_date && <span className="mr-1 font-bold text-[var(--dawaa-status-info-text)]">(استثناء {s.shift_date})</span>}</div>
                <div>{s.is_off ? 'إجازة' : `${formatTime(s.shift_start)} ← ${formatTime(s.shift_end)}`}</div>
              </div>)}
              {!profile.weekly_schedule.length && <div className="col-span-full text-xs font-bold text-[var(--dawaa-theme-muted)]">لا يوجد جدول شيفت مسجل.</div>}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-1.5 font-black text-[var(--dawaa-theme-heading)]"><Clock3 size={16} /> آخر الأيام</div>
            <div className="space-y-1.5">
              {profile.recent_days.slice(0, 15).map((d) => <div key={d.attendance_date} className="flex items-center justify-between gap-1 rounded-lg border border-[var(--dawaa-theme-border)] p-2 text-xs">
                <span className="font-bold text-[var(--dawaa-theme-muted)]">{d.attendance_date}</span>
                <span className="font-bold">{formatTime(d.first_in)} ← {formatTime(d.last_out)}</span>
                <span className="font-black text-[var(--dawaa-theme-heading)]">{d.payroll_eligible_hours != null ? `${d.payroll_eligible_hours} س` : '-'}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-black', d.resolution_status === 'late' || d.resolution_status === 'very_late' ? 'text-[var(--dawaa-status-warning-text)]' : d.resolution_status === 'absence_review' ? 'text-[var(--dawaa-status-danger-text)]' : 'text-[var(--dawaa-status-success-text)]')}>{STATUS_LABEL[d.resolution_status] || d.resolution_status}</span>
              </div>)}
              {!profile.recent_days.length && <div className="text-xs font-bold text-[var(--dawaa-theme-muted)]">لا توجد بيانات حضور مسجلة.</div>}
            </div>
          </section>
        </div>}
      </div>
    </div>
  );
}

function RateBox({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-2.5 text-center">
    <div className="text-lg font-black text-[var(--dawaa-theme-heading)]">{value}</div>
    <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{label}</div>
    <div className="text-[9px] text-[var(--dawaa-theme-muted)]">{sub}</div>
  </div>;
}
