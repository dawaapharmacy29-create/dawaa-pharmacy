import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Award,
  BellRing,
  CheckSquare,
  HeadphonesIcon,
  RefreshCw,
  ShieldAlert,
  Star,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { getStaffCycleIncentive, type StaffCycleIncentive } from '@/lib/staffIncentiveService';
import { getCurrentCycle } from '@/lib/pharmacy-cycle';
import { getPerformanceLevel } from '@/lib/points';
import { formatDateTime, percent } from '@/lib/utils';
import StaffOperatingPolicy from '@/components/incentives/StaffOperatingPolicy';

type ActionNotification = {
  id: string;
  title?: string | null;
  message?: string | null;
  type?: string | null;
  priority?: string | null;
  status?: string | null;
  requires_action?: boolean | null;
  created_at?: string | null;
  route?: string | null;
  target_route?: string | null;
  target_type?: string | null;
  target_id?: string | null;
};

type ActionSummary = {
  unread_notifications: number;
  urgent_actions: number;
  open_tasks: number;
  open_followups: number;
  latest_notifications: ActionNotification[];
};

const EMPTY_ACTIONS: ActionSummary = {
  unread_notifications: 0,
  urgent_actions: 0,
  open_tasks: 0,
  open_followups: 0,
  latest_notifications: [],
};

function MiniMetric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof BellRing;
  label: string;
  value: number;
  tone: 'teal' | 'red' | 'amber' | 'blue';
}) {
  const colors = {
    teal: 'text-teal-400 bg-teal-500/10',
    red: 'text-red-400 bg-red-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
    blue: 'text-blue-400 bg-blue-500/10',
  };
  return (
    <div className="stat-card text-center">
      <div className={`mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-2xl ${colors[tone]}`}>
        <Icon size={20} />
      </div>
      <div className="num text-2xl font-bold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
    </div>
  );
}

function notificationRoute(row: ActionNotification) {
  const explicit = String(row.route || row.target_route || '').trim();
  if (explicit.startsWith('/')) return explicit;
  const id = String(row.target_id || '').trim();
  const type = String(row.type || row.target_type || '').toLowerCase();
  if (/followup|متابعة/.test(type)) return id ? `/customer-service?followupId=${encodeURIComponent(id)}` : '/customer-service';
  if (/review|تقييم/.test(type)) return id ? `/reviews?id=${encodeURIComponent(id)}` : '/reviews';
  if (/task|مهمة/.test(type)) return '/employee-operating-system';
  return '/operations-center';
}

export default function StaffDashboard() {
  const { user } = useAuth();
  const cycle = getCurrentCycle();
  const requestIdRef = useRef(0);
  const [incentive, setIncentive] = useState<StaffCycleIncentive | null>(null);
  const [actions, setActions] = useState<ActionSummary>(EMPTY_ACTIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    const staffId = String(user.staffId || user.id || '').trim();
    try {
      const [incentiveResult, actionResult] = await Promise.all([
        getStaffCycleIncentive({
          staffId,
          staffName: user.name,
          branch: user.branch,
          cycleStart: cycle.start.toISOString().slice(0, 10),
          cycleEnd: cycle.end.toISOString().slice(0, 10),
        }),
        supabase.rpc('get_staff_dashboard_actions_v1', {
          p_staff_id: staffId,
          p_user_id: String(user.id || ''),
          p_staff_name: String(user.name || ''),
          p_role: String(user.role || ''),
          p_branch: String(user.branch || ''),
        }),
      ]);

      if (requestId !== requestIdRef.current) return;
      if (actionResult.error) throw actionResult.error;
      setIncentive(incentiveResult);
      setActions({ ...EMPTY_ACTIONS, ...((actionResult.data || {}) as ActionSummary) });
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setError(cause instanceof Error ? cause.message : 'تعذر تحميل لوحة الموظف.');
      setIncentive(null);
      setActions(EMPTY_ACTIONS);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [cycle.end, cycle.start, user]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  if (!user) return null;

  if (loading && !incentive) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => <div key={i} className="stat-card h-24 animate-pulse bg-white/5" />)}
      </div>
    );
  }

  if (error || !incentive) {
    return (
      <div className="stat-card space-y-4 text-center" dir="rtl">
        <div className="font-bold text-red-300">{error || 'تعذر تحميل بيانات الموظف'}</div>
        <button type="button" onClick={() => void load()} className="btn-secondary inline-flex items-center gap-2">
          <RefreshCw size={16} /> إعادة المحاولة
        </button>
      </div>
    );
  }

  const currentPoints = incentive.finalPoints;
  const maxPoints = incentive.startingPoints;
  const pointsPercent = percent(currentPoints, maxPoints);
  const performanceLevel = getPerformanceLevel(currentPoints);
  const pointsColor = pointsPercent >= 90 ? 'text-teal-400' : pointsPercent >= 70 ? 'text-amber-400' : 'text-red-400';
  const barColor = pointsPercent >= 90
    ? 'bg-gradient-to-r from-teal-500 to-teal-400'
    : pointsPercent >= 70
      ? 'bg-gradient-to-r from-amber-500 to-amber-400'
      : 'bg-gradient-to-r from-red-500 to-red-400';

  return (
    <div className="space-y-5 animate-fade-in" dir="rtl">
      <div className="flex justify-end">
        <button type="button" onClick={() => void load()} className="btn-secondary inline-flex items-center gap-2" disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-teal-500/20 bg-gradient-to-r from-teal-500/10 to-teal-600/5 p-5 md:flex-row md:items-center">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-teal-500/20 text-2xl font-bold text-teal-400">
          {String(user.name || 'م')[0]}
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">{user.name || 'الموظف'}</h1>
          <div className="mt-0.5 text-sm text-slate-400">{user.role || ''}{user.branch ? ` — ${user.branch}` : ''}</div>
          <div className="mt-1 text-xs text-teal-300">الدورة الحالية: {cycle.label}</div>
        </div>
        <div className="text-center md:text-left">
          <div className={`num text-4xl font-bold ${pointsColor}`}>{currentPoints}</div>
          <div className="mt-0.5 text-xs text-slate-400">نقطة / {maxPoints}</div>
          <div className="mt-1 text-xs text-slate-300">{performanceLevel}</div>
        </div>
      </div>

      <StaffOperatingPolicy />

      <div className="stat-card">
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-slate-400">تقدم النقاط في الدورة الحالية</span>
          <span className="num font-medium text-white">{currentPoints} / {maxPoints}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-800">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, Math.max(0, pointsPercent))}%` }} />
        </div>
      </div>

      <section>
        <h2 className="section-title mb-3">أداء الدورة الحالية</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MiniMetric icon={Star} label="الحافز المتوقع (ج.م)" value={Math.round(incentive.incentiveValue)} tone="teal" />
          <MiniMetric icon={TrendingUp} label="نقاط مكافآت" value={incentive.approvedRewardPoints} tone="teal" />
          <MiniMetric icon={TrendingDown} label="نقاط خصومات" value={incentive.approvedDeductionPoints} tone="red" />
          <MiniMetric icon={Award} label="عمليات معتمدة" value={incentive.rewardTransactions.length + incentive.deductionTransactions.length} tone="blue" />
        </div>
      </section>

      <section>
        <h2 className="section-title mb-3">مطلوب منك الآن</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MiniMetric icon={BellRing} label="إشعارات غير مقروءة" value={Number(actions.unread_notifications || 0)} tone="teal" />
          <MiniMetric icon={ShieldAlert} label="إجراءات عاجلة" value={Number(actions.urgent_actions || 0)} tone="red" />
          <MiniMetric icon={CheckSquare} label="مهام مفتوحة" value={Number(actions.open_tasks || 0)} tone="amber" />
          <MiniMetric icon={HeadphonesIcon} label="متابعات عملاء" value={Number(actions.open_followups || 0)} tone="blue" />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="stat-card">
          <h3 className="mb-3 font-bold text-white">آخر الإشعارات الخاصة بك</h3>
          <div className="space-y-2">
            {(actions.latest_notifications || []).map((item) => (
              <Link key={item.id} to={notificationRoute(item)} className="block rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-teal-400/30 hover:bg-teal-500/5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">{item.title || 'إشعار'}</span>
                  <span className="text-xs text-slate-500">{item.created_at ? formatDateTime(item.created_at) : ''}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{item.message || '—'}</p>
              </Link>
            ))}
            {!actions.latest_notifications?.length && <div className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">لا توجد إشعارات تخصك حاليًا</div>}
          </div>
        </div>

        <div className="stat-card">
          <h3 className="mb-3 font-bold text-white">آخر تغييرات النقاط</h3>
          <div className="space-y-2">
            {[...incentive.rewardTransactions, ...incentive.deductionTransactions]
              .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
              .slice(0, 8)
              .map((row) => (
                <div key={String(row.id || `${row.source_id}-${row.created_at}`)} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-white">{row.shortReason || row.reason || 'تعديل نقاط'}</span>
                    <span className={row.normalizedDelta >= 0 ? 'font-black text-teal-300' : 'font-black text-red-300'}>{row.normalizedDelta >= 0 ? '+' : ''}{row.normalizedDelta}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{row.created_at ? formatDateTime(row.created_at) : ''}</div>
                </div>
              ))}
            {!incentive.rewardTransactions.length && !incentive.deductionTransactions.length && <div className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">لا توجد تغييرات نقاط معتمدة في الدورة الحالية</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
