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
import { getCurrentCycle } from '@/lib/pharmacy-cycle';
import { formatDateTime } from '@/lib/utils';
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
  actions_warning?: string | null;
};

type RecentPointEvent = {
  id: string;
  source_id?: string | null;
  source?: string | null;
  reason?: string | null;
  signed_points: number;
  status?: string | null;
  created_at?: string | null;
};

type CleaningRating = {
  rated_days: number;
  five_star_days: number;
  avg_stars: number;
  avg_score_pct: number;
  total_star_points: number;
  performance_band: string;
};

type PointsSnapshot = {
  staff_id: string;
  staff_name: string;
  staff_role: string;
  branch: string;
  month_cycle: string;
  starting_points: number;
  reward_points: number;
  deduction_points: number;
  final_points: number;
  target_points: number;
  point_rate_egp: number | null;
  points_incentive_egp: number | null;
  competition_bonus_egp: number;
  final_incentive_egp: number | null;
  progress_pct: number;
  pending_reward_points: number;
  pending_deduction_points: number;
  profile_configured: boolean;
  cleaning_rating?: CleaningRating | null;
};

type EmployeeWorkspace = {
  engine_version: number;
  points: PointsSnapshot;
  actions: ActionSummary;
  recent_point_events: RecentPointEvent[];
  generated_at?: string;
};

const EMPTY_ACTIONS: ActionSummary = {
  unread_notifications: 0,
  urgent_actions: 0,
  open_tasks: 0,
  open_followups: 0,
  latest_notifications: [],
};

function numeric(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeWorkspace(raw: Record<string, unknown>): EmployeeWorkspace {
  const pointsRaw = (raw.points || {}) as Record<string, unknown>;
  const actionsRaw = (raw.actions || {}) as Record<string, unknown>;
  const cleaningRaw = pointsRaw.cleaning_rating && typeof pointsRaw.cleaning_rating === 'object'
    ? (pointsRaw.cleaning_rating as Record<string, unknown>)
    : null;
  return {
    engine_version: numeric(raw.engine_version),
    points: {
      staff_id: String(pointsRaw.staff_id || ''),
      staff_name: String(pointsRaw.staff_name || ''),
      staff_role: String(pointsRaw.staff_role || ''),
      branch: String(pointsRaw.branch || ''),
      month_cycle: String(pointsRaw.month_cycle || ''),
      starting_points: numeric(pointsRaw.starting_points),
      reward_points: numeric(pointsRaw.reward_points),
      deduction_points: numeric(pointsRaw.deduction_points),
      final_points: numeric(pointsRaw.final_points),
      target_points: numeric(pointsRaw.target_points),
      point_rate_egp: pointsRaw.point_rate_egp == null ? null : numeric(pointsRaw.point_rate_egp),
      points_incentive_egp: pointsRaw.points_incentive_egp == null ? null : numeric(pointsRaw.points_incentive_egp),
      competition_bonus_egp: numeric(pointsRaw.competition_bonus_egp),
      final_incentive_egp: pointsRaw.final_incentive_egp == null ? null : numeric(pointsRaw.final_incentive_egp),
      progress_pct: numeric(pointsRaw.progress_pct),
      pending_reward_points: numeric(pointsRaw.pending_reward_points),
      pending_deduction_points: numeric(pointsRaw.pending_deduction_points),
      profile_configured: Boolean(pointsRaw.profile_configured),
      cleaning_rating: cleaningRaw ? {
        rated_days: numeric(cleaningRaw.rated_days),
        five_star_days: numeric(cleaningRaw.five_star_days),
        avg_stars: numeric(cleaningRaw.avg_stars),
        avg_score_pct: numeric(cleaningRaw.avg_score_pct),
        total_star_points: numeric(cleaningRaw.total_star_points),
        performance_band: String(cleaningRaw.performance_band || '—'),
      } : null,
    },
    actions: {
      ...EMPTY_ACTIONS,
      unread_notifications: numeric(actionsRaw.unread_notifications),
      urgent_actions: numeric(actionsRaw.urgent_actions),
      open_tasks: numeric(actionsRaw.open_tasks),
      open_followups: numeric(actionsRaw.open_followups),
      latest_notifications: Array.isArray(actionsRaw.latest_notifications)
        ? actionsRaw.latest_notifications as ActionNotification[]
        : [],
      actions_warning: actionsRaw.actions_warning ? String(actionsRaw.actions_warning) : null,
    },
    recent_point_events: Array.isArray(raw.recent_point_events)
      ? (raw.recent_point_events as Record<string, unknown>[]).map((row) => ({
          id: String(row.id || ''),
          source_id: row.source_id ? String(row.source_id) : null,
          source: row.source ? String(row.source) : null,
          reason: row.reason ? String(row.reason) : null,
          signed_points: numeric(row.signed_points),
          status: row.status ? String(row.status) : null,
          created_at: row.created_at ? String(row.created_at) : null,
        }))
      : [],
    generated_at: raw.generated_at ? String(raw.generated_at) : undefined,
  };
}

function performanceBand(progressPct: number) {
  if (progressPct >= 100) return 'استثنائي';
  if (progressPct >= 90) return 'ممتاز';
  if (progressPct >= 80) return 'جيد جدًا';
  if (progressPct >= 70) return 'جيد';
  return 'يحتاج تحسين';
}

function MiniMetric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof BellRing;
  label: string;
  value: number | string;
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
  const [workspace, setWorkspace] = useState<EmployeeWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    const staffId = String(user.staffId || user.id || '').trim();

    try {
      const { data, error: rpcError } = await supabase.rpc('get_employee_workspace_dashboard_v3', {
        p_staff_id: staffId,
        p_user_id: String(user.id || ''),
        p_staff_name: String(user.name || ''),
        p_role: String(user.role || ''),
        p_branch: String(user.branch || ''),
        p_month_cycle: null,
      });
      if (rpcError) throw rpcError;
      if (requestId !== requestIdRef.current) return;
      const raw = (data || null) as Record<string, unknown> | null;
      if (!raw || raw.error) throw new Error(String(raw?.error || 'تعذر تحميل لوحة الموظف الموحدة.'));
      setWorkspace(normalizeWorkspace(raw));
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setError(cause instanceof Error ? cause.message : 'تعذر تحميل لوحة الموظف.');
      setWorkspace(null);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  if (!user) return null;

  if (loading && !workspace) {
    return <div className="space-y-4">{[1, 2, 3].map((i) => <div key={i} className="stat-card h-24 animate-pulse bg-white/5" />)}</div>;
  }

  if (error || !workspace) {
    return (
      <div className="stat-card space-y-4 text-center" dir="rtl">
        <div className="font-bold text-red-300">{error || 'تعذر تحميل بيانات الموظف'}</div>
        <button type="button" onClick={() => void load()} className="btn-secondary inline-flex items-center gap-2">
          <RefreshCw size={16} /> إعادة المحاولة
        </button>
      </div>
    );
  }

  const { points, actions, recent_point_events: recentEvents } = workspace;
  const currentPoints = points.final_points;
  const maxPoints = points.target_points || points.starting_points || 1;
  const pointsPercent = Math.max(0, points.progress_pct || (currentPoints / maxPoints) * 100);
  const performanceLevel = performanceBand(pointsPercent);
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
          {String(points.staff_name || user.name || 'م')[0]}
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">{points.staff_name || user.name || 'الموظف'}</h1>
          <div className="mt-0.5 text-sm text-slate-400">{points.staff_role || user.role || ''}{points.branch ? ` — ${points.branch}` : ''}</div>
          <div className="mt-1 text-xs text-teal-300">الدورة الحالية: {cycle.label}</div>
        </div>
        <div className="text-center md:text-left">
          <div className={`num text-4xl font-bold ${pointsColor}`}>{currentPoints}</div>
          <div className="mt-0.5 text-xs text-slate-400">نقطة / {maxPoints}</div>
          <div className="mt-1 text-xs text-slate-300">{performanceLevel}</div>
        </div>
      </div>

      <StaffOperatingPolicy />

      {!points.profile_configured ? (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm font-bold text-amber-200">
          النقاط محسوبة من المصدر الموحد، لكن بروفايل الحافز المالي غير مضبوط؛ لذلك لا يتم عرض مبلغ افتراضي غير معتمد.
        </div>
      ) : null}

      <div className="stat-card">
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-slate-400">تقدم النقاط في الدورة الحالية</span>
          <span className="num font-medium text-white">{currentPoints} / {maxPoints}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-800">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, pointsPercent)}%` }} />
        </div>
        {(points.pending_reward_points > 0 || points.pending_deduction_points > 0) ? (
          <div className="mt-2 text-xs text-amber-300">
            تحت المراجعة: +{points.pending_reward_points} مكافآت / -{points.pending_deduction_points} خصومات.
          </div>
        ) : null}
      </div>

      <section>
        <h2 className="section-title mb-3">أداء الدورة الحالية</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MiniMetric icon={Star} label="الحافز المتوقع (ج.م)" value={points.final_incentive_egp == null ? '—' : Math.round(points.final_incentive_egp)} tone="teal" />
          <MiniMetric icon={TrendingUp} label="نقاط مكافآت" value={points.reward_points} tone="teal" />
          <MiniMetric icon={TrendingDown} label="نقاط خصومات" value={points.deduction_points} tone="red" />
          <MiniMetric icon={Award} label="آخر حركات معتمدة" value={recentEvents.length} tone="blue" />
        </div>
      </section>

      {points.cleaning_rating ? (
        <section className="stat-card">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-bold text-white">تقييم النظافة اليومي المتراكم</h2>
            <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-sm font-black text-amber-200">
              ⭐ {points.cleaning_rating.avg_stars.toFixed(2)} / 5
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniMetric icon={Star} label="متوسط الدرجة" value={`${Math.round(points.cleaning_rating.avg_score_pct)}%`} tone="teal" />
            <MiniMetric icon={Award} label="أيام 5 نجوم" value={points.cleaning_rating.five_star_days} tone="amber" />
            <MiniMetric icon={CheckSquare} label="أيام تم تقييمها" value={points.cleaning_rating.rated_days} tone="blue" />
            <MiniMetric icon={TrendingUp} label="نقاط النجوم" value={points.cleaning_rating.total_star_points} tone="teal" />
          </div>
          <div className="mt-3 text-sm font-bold text-slate-300">المستوى: {points.cleaning_rating.performance_band}</div>
        </section>
      ) : null}

      <section>
        <h2 className="section-title mb-3">مطلوب منك الآن</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MiniMetric icon={BellRing} label="إشعارات غير مقروءة" value={actions.unread_notifications} tone="teal" />
          <MiniMetric icon={ShieldAlert} label="إجراءات عاجلة" value={actions.urgent_actions} tone="red" />
          <MiniMetric icon={CheckSquare} label="مهام مفتوحة" value={actions.open_tasks} tone="amber" />
          <MiniMetric icon={HeadphonesIcon} label="متابعات عملاء" value={actions.open_followups} tone="blue" />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="stat-card">
          <h3 className="mb-3 font-bold text-white">آخر الإشعارات الخاصة بك</h3>
          <div className="space-y-2">
            {actions.latest_notifications.map((item) => (
              <Link key={item.id} to={notificationRoute(item)} className="block rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-teal-400/30 hover:bg-teal-500/5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">{item.title || 'إشعار'}</span>
                  <span className="text-xs text-slate-500">{item.created_at ? formatDateTime(item.created_at) : ''}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{item.message || '—'}</p>
              </Link>
            ))}
            {!actions.latest_notifications.length && <div className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">لا توجد إشعارات تخصك حاليًا</div>}
          </div>
        </div>

        <div className="stat-card">
          <h3 className="mb-3 font-bold text-white">آخر تغييرات النقاط</h3>
          <div className="space-y-2">
            {recentEvents.map((row) => (
              <div key={row.id || `${row.source_id}-${row.created_at}`} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-white">{row.reason || 'تعديل نقاط'}</span>
                  <span className={row.signed_points >= 0 ? 'font-black text-teal-300' : 'font-black text-red-300'}>{row.signed_points >= 0 ? '+' : ''}{row.signed_points}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">{row.created_at ? formatDateTime(row.created_at) : ''}</div>
              </div>
            ))}
            {!recentEvents.length && <div className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">لا توجد تغييرات نقاط معتمدة في الدورة الحالية</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
