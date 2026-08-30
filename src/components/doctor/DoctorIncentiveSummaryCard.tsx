import { useEffect, useState } from 'react';
import { AlertTriangle, MessageCircle, Package, ShieldCheck, Trophy, UserRound, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type PillarRow = { pillar_key: string; points: number; has_competition_win: boolean };

type DoctorIncentiveDashboard = {
  engine_version: number;
  staff_name: string;
  tier_key: string | null;
  final_points: number;
  target_points: number;
  point_rate_egp: number | null;
  points_incentive_egp: number | null;
  reward_points: number;
  deduction_points: number;
  competition_bonus_egp: number;
  target_bonus_egp: number;
  followup_bonus_egp: number;
  request_bonus_egp: number;
  star_bonus_egp: number;
  total_expected_egp: number | null;
  progress_pct: number;
  pending_reward_points: number;
  pending_deduction_points: number;
  profile_configured: boolean;
  pillars: PillarRow[];
  error?: string;
};

const PILLAR_META: Record<string, { label: string; icon: typeof MessageCircle }> = {
  محادثات: { label: 'المحادثات', icon: MessageCircle },
  متابعات: { label: 'طلبات المتابعة', icon: UserRound },
  'طلبات العملاء': { label: 'طلبات العملاء', icon: Package },
  الرواكد: { label: 'الرواكد', icon: Package },
  الالتزام: { label: 'الالتزام', icon: ShieldCheck },
};

function progressColor(progressPct: number) {
  if (progressPct >= 80) return 'var(--dawaa-status-success-text)';
  if (progressPct >= 40) return 'var(--dawaa-status-warning-text)';
  return 'var(--dawaa-status-danger-text)';
}

export default function DoctorIncentiveSummaryCard({
  staffId,
  onNavigate,
}: {
  staffId: string;
  onNavigate?: () => void;
}) {
  const [data, setData] = useState<DoctorIncentiveDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!staffId) {
      setLoading(false);
      setData(null);
      setError('حساب الدكتور غير مربوط بسجل موظف معتمد، لذلك لا يمكن حساب الحافز حاليًا.');
      return;
    }

    setLoading(true);
    setError('');
    void supabase.rpc('get_doctor_incentive_dashboard_v3', { p_doctor_id: staffId }).then((result) => {
      if (cancelled) return;
      if (result.error) {
        setData(null);
        setError(`تعذر تحميل إجمالي الحافز: ${result.error.message}`);
        setLoading(false);
        return;
      }
      const payload = (result.data || null) as DoctorIncentiveDashboard | null;
      if (!payload || payload.error) {
        setData(null);
        setError(payload?.error || 'تعذر حساب الحافز حاليًا.');
        setLoading(false);
        return;
      }
      setData({
        ...payload,
        final_points: Number(payload.final_points || 0),
        target_points: Number(payload.target_points || 0),
        point_rate_egp: payload.point_rate_egp == null ? null : Number(payload.point_rate_egp),
        points_incentive_egp: payload.points_incentive_egp == null ? null : Number(payload.points_incentive_egp),
        reward_points: Number(payload.reward_points || 0),
        deduction_points: Number(payload.deduction_points || 0),
        competition_bonus_egp: Number(payload.competition_bonus_egp || 0),
        target_bonus_egp: Number(payload.target_bonus_egp || 0),
        followup_bonus_egp: Number(payload.followup_bonus_egp || 0),
        request_bonus_egp: Number(payload.request_bonus_egp || 0),
        star_bonus_egp: Number(payload.star_bonus_egp || 0),
        total_expected_egp: payload.total_expected_egp == null ? null : Number(payload.total_expected_egp),
        progress_pct: Number(payload.progress_pct || 0),
        pending_reward_points: Number(payload.pending_reward_points || 0),
        pending_deduction_points: Number(payload.pending_deduction_points || 0),
        pillars: Array.isArray(payload.pillars) ? payload.pillars : [],
      });
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [staffId]);

  if (loading) {
    return (
      <div className="dawaa-card dawaa-card--soft p-5">
        <div className="dawaa-surface-soft h-24 animate-pulse rounded-2xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="dawaa-card w-full p-5 text-right">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="dawaa-icon-tile h-9 w-9"><Wallet size={18} /></div>
            <span className="dawaa-title">حافزك المتوقع هذا الشهر</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <span className="dawaa-title text-4xl">—</span>
          <span className="dawaa-title mb-1 text-lg">جنيه</span>
        </div>
        <div className="dawaa-alert dawaa-alert--warning mt-3 p-3 text-sm font-bold">
          <AlertTriangle size={17} />
          <span>{error || 'تعذر حساب الحافز حاليًا. راجع ربط الموظف وفئة الحافز.'}</span>
        </div>
      </div>
    );
  }

  const progressPct = Math.min(100, Math.round(data.progress_pct));
  const totalExpected = data.total_expected_egp;
  const pillars = data.pillars || [];
  // لو مفيش أي نشاط حقيقي مسجّل لسه هذه الدورة (لا مكافآت ولا خصومات)،
  // النظام بيدّي الرصيد الافتراضي الكامل (100%) لأن كل دكتور بيبدأ الدورة
  // برصيد كامل ويخسر منه بس مع الأخطاء — مش لأن أداء حقيقي اتسجّل. عرض
  // الرقم ده كـ"متوقع" في اللحظة دي بيدي انطباع غلط، فبنوضح الحالة الحقيقية.
  const noRealActivityYet = data.reward_points === 0 && data.deduction_points === 0;

  return (
    <button
      type="button"
      onClick={onNavigate}
      className="dawaa-card dawaa-card--interactive w-full p-5 text-right"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="dawaa-icon-tile h-9 w-9"><Wallet size={18} /></div>
          <span className="dawaa-title">إجمالي حافزك المتوقع هذا الشهر</span>
        </div>
        <span className="dawaa-caption text-xs font-bold">اضغط لمزيد من التفاصيل ←</span>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <span className="dawaa-title text-4xl">{totalExpected == null ? '—' : totalExpected.toLocaleString('ar-EG')}</span>
        <span className="dawaa-title mb-1 text-lg">جنيه</span>
        {data.point_rate_egp != null ? (
          <span className="dawaa-caption mb-1.5 text-xs font-bold">(نقطتك = {data.point_rate_egp} ج)</span>
        ) : null}
      </div>

      {!data.profile_configured ? (
        <div className="dawaa-alert dawaa-alert--warning mt-3 p-2.5 text-xs font-bold">
          <AlertTriangle size={15} />
          <span>النقاط محسوبة، لكن بروفايل التعويض غير مكتمل لذلك لا يتم عرض مبلغ مالي افتراضي.</span>
        </div>
      ) : null}

      {noRealActivityYet ? (
        <div className="dawaa-alert dawaa-alert--info mt-3 p-2.5 text-xs font-bold">
          <AlertTriangle size={15} />
          <span>لسه بداية الدورة ومفيش نشاط مسجّل عليك حتى الآن، فالحافز يبدأ من صفر. هيزيد تلقائيًا أول ما تبدأ تسجّل محادثات وطلبات ومتابعات حقيقية.</span>
        </div>
      ) : null}

      <div className="dawaa-surface-soft mt-3 h-2.5 w-full overflow-hidden rounded-full">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${progressPct}%`, background: progressColor(progressPct) }}
        />
      </div>
      <p className="dawaa-caption mt-1.5 text-xs font-bold">
        {data.final_points} من {data.target_points} نقطة ({progressPct}%)
        {data.points_incentive_egp != null ? ` — حافز الأداء = ${data.points_incentive_egp.toLocaleString('ar-EG')} ج` : ''}
      </p>

      {data.pending_reward_points > 0 || data.pending_deduction_points > 0 ? (
        <p className="dawaa-caption mt-1 text-[11px] font-bold">
          قيد الاعتماد: +{data.pending_reward_points} / -{data.pending_deduction_points} نقطة
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="dawaa-card dawaa-card--soft p-2 text-center">
          <p className="dawaa-title text-sm">{data.target_bonus_egp.toLocaleString('ar-EG')} ج</p>
          <p className="dawaa-caption text-[9px] font-bold">حافز التارجت</p>
        </div>
        <div className="dawaa-card dawaa-card--soft p-2 text-center">
          <p className="dawaa-title text-sm">{data.followup_bonus_egp.toLocaleString('ar-EG')} ج</p>
          <p className="dawaa-caption text-[9px] font-bold">حافز المتابعات</p>
        </div>
        <div className="dawaa-card dawaa-card--soft p-2 text-center">
          <p className="dawaa-title text-sm">{data.request_bonus_egp.toLocaleString('ar-EG')} ج</p>
          <p className="dawaa-caption text-[9px] font-bold">حافز طلبات العملاء</p>
        </div>
        <div className="dawaa-card dawaa-card--soft p-2 text-center">
          <p className="dawaa-title text-sm">{(data.star_bonus_egp + data.competition_bonus_egp).toLocaleString('ar-EG')} ج</p>
          <p className="dawaa-caption text-[9px] font-bold">نجمة ومسابقات</p>
        </div>
      </div>

      {(data.star_bonus_egp > 0 || data.competition_bonus_egp > 0) ? (
        <div className="dawaa-alert dawaa-alert--warning mt-3 p-2.5 text-xs font-black">
          <Trophy size={16} />
          <span>عندك مكافأة تميز إضافية هذا الشهر 🎉</span>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {pillars.map((pillar) => {
          const meta = PILLAR_META[pillar.pillar_key] || { label: pillar.pillar_key, icon: AlertTriangle };
          const Icon = meta.icon;
          return (
            <div key={pillar.pillar_key} className="dawaa-card dawaa-card--soft p-2 text-center">
              <Icon size={14} className="dawaa-muted mx-auto" />
              <p className="dawaa-title mt-1 text-sm">{Number(pillar.points || 0)}</p>
              <p className="dawaa-caption text-[9px] font-bold leading-tight">{meta.label}</p>
              {pillar.has_competition_win ? (
                <span className="dawaa-badge dawaa-badge--warning mt-2 text-[9px]">فائز</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </button>
  );
}
