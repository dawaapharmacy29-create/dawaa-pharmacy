import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, ShieldCheck, TimerReset } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type ClosureSession = {
  staff_id: string;
  staff_name: string;
  role: string | null;
  branch: string | null;
  closure_status: 'closed_system' | 'closed_manager' | 'review_required' | 'sync_pending' | 'in_progress' | 'ready_for_resolution';
  confidence_score: number;
  attendance_status: string;
  first_check_in: string | null;
  last_check_out: string | null;
  late_minutes: number;
  early_leave_minutes: number;
  duplicate_events: number;
  corrected_type_events: number;
  review_events: number;
  reasons: string[];
};

type ClosurePayload = {
  total: number;
  closed_total: number;
  closed_system: number;
  closed_manager: number;
  review_required: number;
  sync_pending: number;
  in_progress: number;
  ready_for_resolution: number;
  avg_confidence: number;
  can_close_day: boolean;
  sessions: ClosureSession[];
};

const META: Record<ClosureSession['closure_status'], { label: string; cls: string }> = {
  closed_system: { label: 'مغلق تلقائيًا', cls: 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' },
  closed_manager: { label: 'مغلق إداريًا', cls: 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]' },
  review_required: { label: 'يحتاج مراجعة', cls: 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]' },
  sync_pending: { label: 'انتظار مزامنة', cls: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]' },
  in_progress: { label: 'الشيفت مستمر', cls: 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]' },
  ready_for_resolution: { label: 'جاهز للتسوية', cls: 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]' },
};

function formatTime(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' });
}

export default function AttendanceDailyClosurePanel({
  date,
  branch,
  onOpenResolution,
}: {
  date: string;
  branch: string;
  onOpenResolution: () => void;
}) {
  const [data, setData] = useState<ClosurePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: payload, error: rpcError } = await supabase.rpc('attendance_daily_closure_v1', {
        p_date: date,
        p_branch: branch === 'الكل' ? null : branch,
      });
      if (rpcError) throw rpcError;
      setData(payload as ClosurePayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل إغلاق الحضور اليومي');
    } finally {
      setLoading(false);
    }
  }, [branch, date]);

  useEffect(() => { void load(); }, [load]);

  const attention = useMemo(
    () => (data?.sessions || []).filter((x) => ['review_required', 'sync_pending', 'ready_for_resolution'].includes(x.closure_status)).slice(0, 8),
    [data],
  );

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]">
            <ShieldCheck size={18} />
            إغلاق الحضور اليومي
          </div>
          <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
            مصدر واحد يوضح الحالات المقفولة، المعلقة، والمحتاجة مراجعة قبل أي أثر مالي.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className={cn(
              'rounded-full border px-3 py-1 text-xs font-black',
              data.can_close_day
                ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]'
                : 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]',
            )}>
              {data.can_close_day ? 'اليوم جاهز للإغلاق' : 'اليوم غير مكتمل'}
            </span>
          )}
          <button onClick={() => void load()} className="btn-secondary px-2 py-1.5 text-xs">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-danger-text)]">⚠️ {error}</div>}

      {data && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="إجمالي" value={data.total} icon={Clock3} />
            <Metric label="مغلق" value={data.closed_total} icon={CheckCircle2} />
            <Metric label="مراجعة" value={data.review_required} icon={AlertTriangle} />
            <Metric label="مزامنة" value={data.sync_pending} icon={TimerReset} />
            <Metric label="جاهز للتسوية" value={data.ready_for_resolution} icon={ShieldCheck} />
            <Metric label="ثقة اليوم" value={Math.round(Number(data.avg_confidence || 0)) + '%'} icon={ShieldCheck} />
          </div>

          {!!attention.length && (
            <div className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-black text-[var(--dawaa-theme-heading)]">الحالات التي تمنع الإغلاق</div>
                <button onClick={onOpenResolution} className="btn-primary px-3 py-1 text-xs">فتح التسوية والالتزام</button>
              </div>
              <div className="space-y-1.5">
                {attention.map((row) => {
                  const meta = META[row.closure_status];
                  return (
                    <div key={row.staff_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--dawaa-theme-border)] dawaa-surface p-2">
                      <div>
                        <span className="font-black text-[var(--dawaa-theme-heading)]">{row.staff_name}</span>
                        <span className="mr-2 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{row.branch || '-'} · ثقة {row.confidence_score}% · {formatTime(row.first_check_in)} ← {formatTime(row.last_check_out)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(row.reasons || []).slice(0, 2).map((reason) => <span key={reason} className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-0.5 text-[10px] font-bold">{reason}</span>)}
                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black', meta.cls)}>{meta.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Clock3 }) {
  return (
    <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-3">
      <div className="flex items-center gap-1 text-[11px] font-bold text-[var(--dawaa-theme-muted)]"><Icon size={13} /> {label}</div>
      <div className="mt-1 text-xl font-black text-[var(--dawaa-theme-heading)]">{value}</div>
    </div>
  );
}
