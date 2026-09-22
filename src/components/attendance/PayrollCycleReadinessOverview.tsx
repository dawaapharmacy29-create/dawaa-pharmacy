import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  getPayrollCycleFinalizationOverview,
  type PayrollCycleFinalizationOverview,
} from '@/lib/hr/workforceService';

export default function PayrollCycleReadinessOverview({
  monthCycle,
  branch,
}: {
  monthCycle: string;
  branch?: string | null;
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

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Summary label="إجمالي الموظفين" value={data.staff_count} />
        <Summary label="جاهز" value={data.ready_count} good />
        <Summary label="Blocked" value={data.blocked_count} warn={data.blocked_count > 0} />
      </div>

      {!!data.top_blockers.length && (
        <div className="mt-3 rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3">
          <div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-status-warning-text)]">
            <AlertTriangle size={14} /> أكثر أسباب الحجب
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.top_blockers.slice(0, 8).map((item) => (
              <span key={item.code} className="rounded-full border border-[var(--dawaa-status-warning-border)] px-2 py-1 text-[10px] font-bold text-[var(--dawaa-status-warning-text)]">
                {item.label} · {item.affected_staff.toLocaleString('ar-EG')}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 max-h-72 overflow-y-auto rounded-2xl border border-[var(--dawaa-theme-border)]">
        <table className="w-full min-w-[720px] text-right text-xs">
          <thead className="sticky top-0 bg-[var(--dawaa-theme-surface-2)]">
            <tr>
              <th className="p-2">الموظف</th>
              <th className="p-2">الفرع</th>
              <th className="p-2">الحالة</th>
              <th className="p-2">Blockers</th>
              <th className="p-2">Warnings</th>
              <th className="p-2">V2/V3</th>
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
                <td className="p-2">{row.blocker_count.toLocaleString('ar-EG')}</td>
                <td className="p-2">{row.warning_count.toLocaleString('ar-EG')}</td>
                <td className="p-2">{row.policy_validation.effective_status_changes.toLocaleString('ar-EG')}</td>
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
