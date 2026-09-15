import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bike, Clock3, Stethoscope, Users2 } from 'lucide-react';
import { cachedRpc } from '@/lib/attendance/cachedRpc';
import { cn } from '@/lib/utils';

type RoleGroupRate = {
  branch: string;
  role_group: 'دليفري' | 'دكاترة وصيادلة' | 'باقي الفريق';
  staff_count: number;
  evaluated_days: number;
  on_time_days: number;
  late_days: number;
  very_late_days: number;
  early_leave_days: number;
  permission_days: number;
  absence_days: number;
  late_rate_pct: number;
  permission_rate_pct: number;
};

const GROUP_ORDER: RoleGroupRate['role_group'][] = ['دكاترة وصيادلة', 'دليفري', 'باقي الفريق'];

const GROUP_META: Record<RoleGroupRate['role_group'], { icon: typeof Bike; color: string }> = {
  'دليفري': { icon: Bike, color: 'text-[var(--dawaa-status-info-text)] bg-[var(--dawaa-status-info-bg)] border-[var(--dawaa-status-info-border)]' },
  'دكاترة وصيادلة': { icon: Stethoscope, color: 'text-[var(--dawaa-status-success-text)] bg-[var(--dawaa-status-success-bg)] border-[var(--dawaa-status-success-border)]' },
  'باقي الفريق': { icon: Users2, color: 'text-[var(--dawaa-theme-muted)] bg-[var(--dawaa-theme-surface-2)] border-[var(--dawaa-theme-border)]' },
};

function rateBarColor(pct: number, kind: 'late' | 'permission') {
  if (kind === 'late') {
    if (pct >= 20) return 'bg-[var(--dawaa-status-danger-text)]';
    if (pct >= 8) return 'bg-[var(--dawaa-status-warning-text)]';
    return 'bg-[var(--dawaa-status-success-text)]';
  }
  if (pct >= 15) return 'bg-[var(--dawaa-status-warning-text)]';
  return 'bg-[var(--dawaa-status-info-text)]';
}

function RateBar({ pct, kind }: { pct: number; kind: 'late' | 'permission' }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--dawaa-theme-surface-2)]">
      <div className={cn('h-full rounded-full transition-all', rateBarColor(pct, kind))} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function GroupCard({ row }: { row: RoleGroupRate }) {
  const meta = GROUP_META[row.role_group];
  const Icon = meta.icon;
  return (
    <div className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg border', meta.color)}><Icon size={14} /></span>
          <span className="text-xs font-black text-[var(--dawaa-theme-heading)]">{row.role_group}</span>
        </div>
        <span className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{row.staff_count.toLocaleString('ar-EG')} موظف</span>
      </div>
      <div className="mt-3 space-y-2">
        <div>
          <div className="flex items-center justify-between text-[11px] font-bold"><span className="text-[var(--dawaa-theme-muted)]">معدل التأخير</span><span className="font-black text-[var(--dawaa-theme-heading)]">{row.late_rate_pct}%</span></div>
          <RateBar pct={row.late_rate_pct} kind="late" />
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] font-bold"><span className="text-[var(--dawaa-theme-muted)]">معدل الإذن/الإجازة المعتمدة</span><span className="font-black text-[var(--dawaa-theme-heading)]">{row.permission_rate_pct}%</span></div>
          <RateBar pct={row.permission_rate_pct} kind="permission" />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
        <span>متأخر: {row.late_days}</span>
        <span>متأخر جدًا: {row.very_late_days}</span>
        <span>خروج مبكر: {row.early_leave_days}</span>
        <span>غياب: {row.absence_days}</span>
      </div>
    </div>
  );
}

export default function BranchRoleRatesPanel() {
  const [rows, setRows] = useState<RoleGroupRate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: rpcError } = await cachedRpc<RoleGroupRate[]>('attendance_branch_role_group_rates_v1', {}, 60);
        if (rpcError) throw rpcError;
        if (!cancelled) setRows((data || []) as RoleGroupRate[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'تعذر تحميل معدلات الفروع');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const byBranch = useMemo(() => {
    const map = new Map<string, RoleGroupRate[]>();
    for (const row of rows) {
      const list = map.get(row.branch) || [];
      list.push(row);
      map.set(row.branch, list);
    }
    for (const [, list] of map) list.sort((a, b) => GROUP_ORDER.indexOf(a.role_group) - GROUP_ORDER.indexOf(b.role_group));
    return map;
  }, [rows]);

  if (loading) return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 text-xs font-bold text-[var(--dawaa-theme-muted)]">جارٍ حساب معدلات التأخير والإذونات... (آخر 30 يوم)</div>;
  if (error) return <div className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-danger-text)]"><AlertTriangle size={13} className="inline ml-1" /> {error}</div>;
  if (!byBranch.size) return null;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {Array.from(byBranch.entries()).map(([branch, list]) => (
        <div key={branch} className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Clock3 size={16} className="text-[var(--dawaa-theme-primary-strong)]" />
            <h3 className="font-black text-[var(--dawaa-theme-heading)]">معدل التأخير والإذونات — {branch}</h3>
            <span className="mr-auto text-[10px] font-bold text-[var(--dawaa-theme-muted)]">آخر 30 يوم</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {list.map((row) => <GroupCard key={`${row.branch}-${row.role_group}`} row={row} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
