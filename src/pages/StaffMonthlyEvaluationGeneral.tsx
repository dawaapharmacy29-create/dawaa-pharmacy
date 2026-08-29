import { useEffect, useMemo, useState } from 'react';
import {
  Award, CheckCircle2, ChevronDown, Loader2, Save, Search, Send, ShieldAlert, Star, UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { createStaffNotification } from '@/lib/staffNotificationService';
import { readAttendanceRange } from '@/lib/readModels/attendanceReadModel';
import {
  evaluationProfileForRole,
  type StaffEvaluationSectionV3,
} from '@/lib/evaluations/staffEvaluationProfilesV3';
import { canonicalStaffRole, isManagerRole } from '@/lib/staff/staffRoleCapabilities';
import {
  getStaffPointsDashboardV3,
  type StaffPointsDashboardV3,
} from '@/lib/staff/staffPointsDashboardService';
import {
  currentEvaluationCycleLabel,
  previousEvaluationCycleLabel,
  evaluationCycleRangeFromLabel,
  evaluationCycleQueryBounds,
} from '@/lib/evaluations/monthlyEvaluationCycle';
import {
  CRITICAL_GATE_CAPS,
  CRITICAL_GATE_POINT_PENALTY,
  resolveIncentiveTier,
  applyIncentiveGates,
  type CriticalGateType,
} from '@/lib/evaluations/incentiveTiers';
import { createEmployeeTransaction } from '@/services/employeeTransactionService';
import { Panel, SectionTitle, KpiCard, MiniBox, EmptyState } from '@/components/dashboard/DashboardPrimitives';

type StaffRow = {
  id: string;
  name: string;
  role?: string | null;
  job_title?: string | null;
  branch?: string | null;
  status?: string | null;
  user_id?: string | null;
};

type EvaluationRow = Record<string, unknown>;

type Metrics = {
  review_count: number;
  review_average: number;
  completed_followups: number;
  followup_count: number;
  conversation_positive_points: number;
  conversation_negative_points: number;
  attendance_days: number;
  present_days: number;
  engine_version: number;
};

const EMPTY_METRICS: Metrics = {
  review_count: 0,
  review_average: 0,
  completed_followups: 0,
  followup_count: 0,
  conversation_positive_points: 0,
  conversation_negative_points: 0,
  attendance_days: 0,
  present_days: 0,
  engine_version: 3,
};

const METRIC_LABELS: Record<keyof Omit<Metrics, 'engine_version'>, string> = {
  review_count: 'عدد مراجعات المحادثات',
  review_average: 'متوسط تقييم المحادثات',
  completed_followups: 'متابعات مكتملة',
  followup_count: 'إجمالي المتابعات',
  conversation_positive_points: 'نقاط إيجابية من المحادثات',
  conversation_negative_points: 'نقاط سلبية من المحادثات',
  attendance_days: 'أيام مسجّلة في الحضور',
  present_days: 'أيام حضور فعلي',
};

function safeNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function gradeFor(score: number) {
  if (score >= 90) return 'ممتاز';
  if (score >= 80) return 'جيد جدًا';
  if (score >= 70) return 'جيد';
  if (score >= 60) return 'مقبول';
  return 'يحتاج خطة تحسين';
}

function starMeaning(score: number) {
  return ['', 'ضعيف جدًا', 'يحتاج تحسين', 'مقبول', 'جيد جدًا', 'ممتاز'][score] || 'لم يتم التقييم';
}

function sectionPoints(item: StaffEvaluationSectionV3) {
  return Math.round(((item.score / 5) * item.weight) * 10) / 10;
}

function normalizeSavedSections(
  saved: unknown,
  fallback: StaffEvaluationSectionV3[]
): StaffEvaluationSectionV3[] {
  if (!Array.isArray(saved) || !saved.length) return fallback;
  const byKey = new Map(fallback.map((item) => [item.key, item]));
  return saved.map((raw) => {
    const row = raw as Record<string, unknown>;
    const key = String(row.key || '');
    return {
      key,
      title: String(row.title || ''),
      description: String(row.description || ''),
      weight: safeNumber(row.weight),
      score: safeNumber(row.score),
      notes: String(row.notes || ''),
      rubric: byKey.get(key)?.rubric,
    };
  });
}

export default function StaffMonthlyEvaluation() {
  const { user } = useAuth();
  const actorRole = canonicalStaffRole(user?.role);
  const managerMode = isManagerRole(user?.role);
  const ownBranch = normalizeBranchName(user?.branch || '');
  const globalScope = ['branches_manager', 'executive', 'admin'].includes(actorRole);

  const [branch, setBranch] = useState(globalScope ? 'فرع الشامي' : ownBranch);
  const [cycleLabel, setCycleLabel] = useState(() => currentEvaluationCycleLabel());
  const cycleRange = useMemo(() => evaluationCycleRangeFromLabel(cycleLabel), [cycleLabel]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sections, setSections] = useState<StaffEvaluationSectionV3[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [pointsTruth, setPointsTruth] = useState<StaffPointsDashboardV3 | null>(null);
  const [activeGates, setActiveGates] = useState<CriticalGateType[]>([]);
  const [savedActiveGates, setSavedActiveGates] = useState<CriticalGateType[]>([]);
  const [strengthsText, setStrengthsText] = useState('');
  const [developmentText, setDevelopmentText] = useState('');
  const [managerNotes, setManagerNotes] = useState('');
  const [status, setStatus] = useState('draft');
  const [evaluationId, setEvaluationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => staff.find((item) => item.id === selectedId) || null,
    [selectedId, staff]
  );
  const profile = useMemo(
    () => evaluationProfileForRole(selected?.job_title || selected?.role),
    [selected?.job_title, selected?.role]
  );
  const isEditingSelf = Boolean(
    selected && (selected.id === user?.staffId || selected.id === user?.id)
  );
  const canEdit = managerMode && !isEditingSelf;
  const overallScore = useMemo(
    () => Math.round(sections.reduce((sum, item) => sum + (item.score / 5) * item.weight, 0) * 10) / 10,
    [sections]
  );
  const grade = gradeFor(overallScore);

  const tierPreview = useMemo(() => {
    const tier = resolveIncentiveTier(overallScore);
    const payoutPercent = applyIncentiveGates(tier.payoutPercent, activeGates);
    const maxEgp = pointsTruth?.max_incentive_egp ?? null;
    const previewEgp = maxEgp == null ? null : Math.round((maxEgp * payoutPercent) / 100);
    return { tier, payoutPercent, previewEgp, gated: payoutPercent < tier.payoutPercent };
  }, [overallScore, activeGates, pointsTruth?.max_incentive_egp]);

  useEffect(() => {
    const loadStaff = async () => {
      if (!user?.id) return;
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('list_staff_for_monthly_evaluation_safe', {
          p_actor_id: user.id,
          p_branch: globalScope ? branch : null,
        });
        if (error) throw error;
        const rows = (data || []) as StaffRow[];
        setStaff(rows);
        const own = rows.find((row) => row.id === user?.staffId || row.id === user?.id || row.name === user?.name);
        if (!managerMode && own) setSelectedId(own.id);
        else if (!selectedId && rows[0]) setSelectedId(rows[0].id);
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : 'تعذر تحميل الموظفين');
      } finally {
        setLoading(false);
      }
    };
    void loadStaff();
  }, [branch, globalScope, managerMode, selectedId, user]);

  useEffect(() => {
    if (!selectedId || !user?.id || !selected) return;
    const loadEvaluation = async () => {
      setLoading(true);
      try {
        const { startDate, endDateExclusive } = evaluationCycleQueryBounds(cycleLabel);
        const cycleKeyDate = `${cycleLabel}-01`;
        const [savedResult, reviewResult, followupResult, attendanceResult, pointsResult] = await Promise.all([
          supabase.rpc('get_staff_monthly_evaluation_safe', {
            p_actor_id: user.id,
            p_staff_id: selectedId,
            p_month: cycleKeyDate,
          }),
          supabase
            .from('conversation_sales_reviews')
            .select('total_score,final_score,doctor_points_impact,point_impact,created_at')
            .eq('staff_id', selectedId)
            .gte('created_at', startDate)
            .lt('created_at', endDateExclusive)
            .limit(500),
          supabase
            .from('daily_followups')
            .select('status,followup_status,completed_at,created_at,assigned_staff_id,requested_by_staff_id')
            .or(`assigned_staff_id.eq.${selectedId},requested_by_staff_id.eq.${selectedId}`)
            .gte('created_at', startDate)
            .lt('created_at', endDateExclusive)
            .limit(1000),
          readAttendanceRange({ staffId: selectedId, startDate, endDateExclusive, limit: 100 }),
          getStaffPointsDashboardV3(selectedId, cycleLabel).catch(() => null),
        ]);

        if (savedResult.error) throw savedResult.error;
        if (attendanceResult.status === 'unavailable') throw new Error(attendanceResult.error);

        const reviewRows = reviewResult.data || [];
        const followupRows = followupResult.data || [];
        const attendanceRows = attendanceResult.rows;
        const reviewAverage = reviewRows.length
          ? reviewRows.reduce((sum: number, row: Record<string, unknown>) => sum + safeNumber(row.final_score || row.total_score), 0) / reviewRows.length
          : 0;
        const completedFollowups = followupRows.filter((row: Record<string, unknown>) =>
          row.completed_at || /completed|مكتمل|تم/.test(String(row.status || row.followup_status || ''))
        ).length;
        const impacts = reviewRows.map((row: Record<string, unknown>) => safeNumber(row.doctor_points_impact ?? row.point_impact));
        const positive = impacts.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
        const negative = impacts.filter((value) => value < 0).reduce((sum, value) => sum + Math.abs(value), 0);
        const presentDays = attendanceRows.filter((row: Record<string, unknown>) => /present|حاضر|late|متأخر/i.test(String(row.status || ''))).length;

        setMetrics({
          review_count: reviewRows.length,
          review_average: Math.round(reviewAverage * 10) / 10,
          completed_followups: completedFollowups,
          followup_count: followupRows.length,
          conversation_positive_points: positive,
          conversation_negative_points: negative,
          attendance_days: attendanceRows.length,
          present_days: presentDays,
          engine_version: 3,
        });
        setPointsTruth(pointsResult);

        const saved = savedResult.data as EvaluationRow | null;
        const freshSections = evaluationProfileForRole(selected.job_title || selected.role).sections;
        if (saved) {
          setEvaluationId(String(saved.id || ''));
          setSections(normalizeSavedSections(saved.sections, freshSections));
          setStrengthsText(Array.isArray(saved.strengths) ? saved.strengths.map(String).join('\n') : '');
          setDevelopmentText(Array.isArray(saved.development_points) ? saved.development_points.map(String).join('\n') : '');
          setManagerNotes(String(saved.manager_notes || ''));
          setStatus(String(saved.status || 'draft'));
          const snapshot = saved.metrics_snapshot as Record<string, unknown> | null;
          const savedGates = snapshot && Array.isArray(snapshot.active_critical_gates) ? (snapshot.active_critical_gates as string[]) : [];
          const validSavedGates = savedGates.filter((gate): gate is CriticalGateType => gate in CRITICAL_GATE_CAPS);
          setActiveGates(validSavedGates);
          setSavedActiveGates(validSavedGates);
        } else {
          setEvaluationId(null);
          setSections(freshSections);
          setStrengthsText('');
          setDevelopmentText('');
          setManagerNotes('');
          setStatus('draft');
          setActiveGates([]);
          setSavedActiveGates([]);
        }
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : 'تعذر تحميل التقييم');
      } finally {
        setLoading(false);
      }
    };
    void loadEvaluation();
  }, [cycleLabel, selected, selectedId, user?.id]);

  function updateSection(key: string, patch: Partial<StaffEvaluationSectionV3>) {
    setSections((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  function toggleGate(gate: CriticalGateType) {
    setActiveGates((current) => current.includes(gate) ? current.filter((item) => item !== gate) : [...current, gate]);
  }

  async function save(nextStatus = status) {
    if (!selected || !user?.id) return;
    if (isEditingSelf) {
      toast.error('لا يمكنك اعتماد أو تعديل تقييمك الشهري لنفسك.');
      return;
    }
    if (managerMode && sections.some((item) => item.score === 0)) {
      toast.error('يجب تقييم كل المحاور قبل الاعتماد');
      return;
    }

    setSaving(true);
    try {
      const strengths = strengthsText.split('\n').map((item) => item.trim()).filter(Boolean);
      const developmentPoints = developmentText.split('\n').map((item) => item.trim()).filter(Boolean);
      const payload = {
        staff_id: selected.id,
        staff_name: selected.name,
        staff_role: selected.job_title || selected.role,
        branch: selected.branch || branch,
        evaluation_month: `${cycleLabel}-01`,
        evaluator_id: user.id,
        evaluator_name: user.name || 'المدير',
        evaluator_role: user.role || null,
        sections,
        metrics_snapshot: {
          ...metrics,
          evaluation_engine_version: 3,
          canonical_role: profile.role,
          evaluation_cycle_label: cycleLabel,
          active_critical_gates: activeGates,
          points_truth: pointsTruth ? {
            month_cycle: pointsTruth.month_cycle,
            starting_points: pointsTruth.starting_points,
            final_points: pointsTruth.final_points,
            reward_points: pointsTruth.reward_points,
            deduction_points: pointsTruth.deduction_points,
            profile_configured: pointsTruth.profile_configured,
            final_incentive_egp: pointsTruth.final_incentive_egp,
          } : null,
        },
        strengths,
        development_points: developmentPoints,
        manager_notes: managerNotes,
        overall_score: overallScore,
        grade,
        // V3 principle: evaluation quality never creates a second monetary truth.
        suggested_incentive: null,
        approved_incentive: null,
        points_delta: 0,
        status: nextStatus,
        sent_at: nextStatus === 'sent' ? new Date().toISOString() : null,
      };

      const { data, error } = await supabase.rpc('save_staff_monthly_evaluation_safe', {
        p_actor_id: user.id,
        p_payload: payload,
      });
      if (error) throw error;
      setEvaluationId(String(data || evaluationId || ''));
      setStatus(nextStatus);

      // مخالفات حرجة جديدة (لسه متسجلتش في المرة اللي فاتت) بتاخد خصم نقاط حقيقي
      // في الـLedger المركزي، مش مجرد علامة بصرية. لا نكرر الخصم لمخالفة كانت
      // مفعّلة أصلاً من قبل عند نفس التقييم.
      const newlyActivatedGates = activeGates.filter((gate) => !savedActiveGates.includes(gate));
      if (newlyActivatedGates.length) {
        for (const gate of newlyActivatedGates) {
          const gateInfo = CRITICAL_GATE_CAPS[gate];
          const penaltyPoints = CRITICAL_GATE_POINT_PENALTY[gate];
          await createEmployeeTransaction({
            staff_id: selected.id,
            type: 'penalty',
            points_delta: -penaltyPoints,
            reason: `مخالفة حرجة في التقييم الشهري: ${gateInfo.label}`,
            description: `دورة ${cycleRange.displayLabel}. سقف الحافز المرتبط بهذه المخالفة: ${gateInfo.capPercent}%.`,
            source: 'monthly_evaluation_critical_gate',
            source_id: String(data || evaluationId || ''),
            created_by: user.id,
            month_cycle: cycleLabel,
            branch: selected.branch || branch,
            status: 'active',
          });
        }
        setSavedActiveGates(activeGates);
        toast.success(`تم تسجيل خصم نقاط فعلي لـ${newlyActivatedGates.length} مخالفة حرجة في حساب الموظف.`);
      }

      if (nextStatus === 'sent') {
        await createStaffNotification({
          recipientStaffId: selected.id,
          title: 'تم إرسال تقييمك الشهري',
          message: `تقييم دورة ${cycleRange.displayLabel}: ${overallScore}/100 - ${grade}. الحافز المالي يُحسب من نظام النقاط المركزي.`,
          type: 'staff_monthly_evaluation',
          entityType: 'staff_monthly_evaluation',
          entityId: String(data || evaluationId || ''),
          actionUrl: '/staff-dashboard',
        }).catch(() => null);
      }
      toast.success(nextStatus === 'sent' ? 'تم إرسال التقييم للموظف' : 'تم حفظ التقييم');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'فشل حفظ التقييم');
    } finally {
      setSaving(false);
    }
  }

  const filteredStaff = staff.filter((item) => item.name.includes(search));
  const canonicalIncentive = pointsTruth?.final_incentive_egp;

  return (
    <div className="min-h-screen space-y-4 p-4" dir="rtl" style={{ background: 'var(--dawaa-theme-bg)' }}>
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
              <UserCheck style={{ color: 'var(--dawaa-theme-primary-strong)' }} /> التقييم الشهري للموظفين
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>
              تقييم جودة وتطوير حسب مسار الوظيفة. الدرجة من 100 مستقلة عن مبلغ الحافز؛ المبلغ النهائي يأتي فقط من Points Truth + Compensation Profile.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
              <button
                type="button"
                onClick={() => setCycleLabel(previousEvaluationCycleLabel(currentEvaluationCycleLabel()))}
                className="px-3 py-2 text-xs font-black"
                style={cycleLabel === previousEvaluationCycleLabel(currentEvaluationCycleLabel())
                  ? { background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' }
                  : { color: 'var(--dawaa-theme-muted)' }}
              >
                الدورة السابقة
              </button>
              <button
                type="button"
                onClick={() => setCycleLabel(currentEvaluationCycleLabel())}
                className="px-3 py-2 text-xs font-black"
                style={cycleLabel === currentEvaluationCycleLabel()
                  ? { background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' }
                  : { color: 'var(--dawaa-theme-muted)' }}
              >
                الدورة الحالية
              </button>
            </div>
            {globalScope ? (
              <select value={branch} onChange={(event) => setBranch(event.target.value)} className="rounded-2xl border px-3 py-2 text-sm font-black" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }}>
                <option>فرع الشامي</option><option>فرع شكري</option>
              </select>
            ) : null}
          </div>
        </div>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black" style={{ borderColor: 'var(--dawaa-theme-accent-border)', background: 'var(--dawaa-theme-accent-soft)', color: 'var(--dawaa-theme-primary-strong)' }}>
          فترة الدورة: {cycleRange.displayLabel}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-3xl border p-4 xl:sticky xl:top-4 xl:h-fit" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}>
          <button
            type="button"
            onClick={() => setSidebarOpen((value) => !value)}
            className="flex w-full items-center justify-between gap-2 text-sm font-black xl:hidden"
            style={{ color: 'var(--dawaa-theme-heading)' }}
          >
            <span>اختيار الموظف {selected ? `— ${selected.name}` : ''}</span>
            <ChevronDown className={sidebarOpen ? 'rotate-180 transition-transform' : 'transition-transform'} size={16} />
          </button>
          <div className={`${sidebarOpen ? 'block' : 'hidden'} xl:block`}>
            <div className="relative mt-3 xl:mt-0">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--dawaa-theme-muted)' }} size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="بحث باسم الموظف"
                className="w-full rounded-2xl border py-2.5 pr-10 pl-3 text-sm font-bold"
                style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }}
              />
            </div>
            <div className="mt-3 max-h-[70vh] space-y-2 overflow-y-auto">
              {filteredStaff.map((item) => (
                <button
                  key={item.id}
                  onClick={() => { setSelectedId(item.id); setSidebarOpen(false); }}
                  className="w-full rounded-2xl border p-3 text-right"
                  style={selectedId === item.id
                    ? { borderColor: 'var(--dawaa-theme-accent-border)', background: 'var(--dawaa-theme-accent-soft)' }
                    : { borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}
                >
                  <div className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{item.name}</div>
                  <div className="mt-1 text-xs" style={{ color: 'var(--dawaa-theme-muted)' }}>{item.job_title || item.role} · {item.branch}</div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="space-y-4">
          {loading ? (
            <Panel className="p-10 text-center"><Loader2 className="mx-auto animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /> <span style={{ color: 'var(--dawaa-theme-muted)' }}>جاري التحميل...</span></Panel>
          ) : selected ? (
            <>
              <Panel className="p-4" style={{ background: 'var(--dawaa-theme-accent-soft)', borderColor: 'var(--dawaa-theme-accent-border)' }}>
                <div className="font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>{profile.label}: {profile.mission}</div>
                <div className="mt-2 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>المحاور التالية خاصة بالدور: {selected.job_title || selected.role || 'غير محدد'}.</div>
              </Panel>

              <section className="grid gap-3 md:grid-cols-4">
                <KpiCard title="نتيجة التقييم" value={`${overallScore}/100`} subtitle={grade} icon={<Star size={20} />} tone={overallScore >= 80 ? 'green' : overallScore >= 60 ? 'amber' : 'red'} />
                <KpiCard title="النقاط الحالية" value={pointsTruth ? `${pointsTruth.final_points} / ${pointsTruth.target_points}` : '—'} subtitle="دورة الحافز الحالية" icon={<Award size={20} />} tone="cyan" />
                <KpiCard title="فئة الحافز المتوقعة" value={`${tierPreview.payoutPercent}%`} subtitle={`${tierPreview.tier.label} — تقديري وليس فورمولة الصرف الفعلية`} icon={<ShieldAlert size={20} />} tone={tierPreview.gated ? 'red' : 'purple'} />
                <KpiCard title="حافز الأداء المركزي" value={canonicalIncentive == null ? 'غير محدد' : `${canonicalIncentive.toLocaleString('ar-EG')} جنيه`} subtitle="القيمة الفعلية من نظام النقاط — مش من درجة هذا التقييم" icon={<CheckCircle2 size={20} />} tone="green" />
              </section>

              {!pointsTruth?.profile_configured ? (
                <Panel className="p-4" style={{ background: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' }}>
                  <p className="text-sm font-bold" style={{ color: 'var(--dawaa-status-warning-text)' }}>
                    لا يوجد Compensation Profile مالي مكتمل لهذا الموظف؛ لذلك لا يتم توليد أو اقتراح مبلغ مالي من التقييم الشهري.
                  </p>
                </Panel>
              ) : null}

              <Panel className="p-4">
                <SectionTitle
                  title="مخالفات حرجة تحدّ من الحافز"
                  subtitle="تفعيل أي مخالفة هنا يسجّل خصم نقاط حقيقي في حساب الموظف عند الحفظ، مستقل عن درجة التقييم"
                  icon={<ShieldAlert size={18} />}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  {(Object.entries(CRITICAL_GATE_CAPS) as [CriticalGateType, typeof CRITICAL_GATE_CAPS[CriticalGateType]][]).map(([key, gate]) => {
                    const active = activeGates.includes(key);
                    const alreadySaved = savedActiveGates.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={!canEdit || alreadySaved}
                        onClick={() => toggleGate(key)}
                        className="flex items-center justify-between gap-2 rounded-xl border p-3 text-right text-xs font-black disabled:cursor-default"
                        style={active
                          ? { borderColor: 'var(--dawaa-status-danger-border)', background: 'var(--dawaa-status-danger-bg)', color: 'var(--dawaa-status-danger-text)' }
                          : { borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }}
                      >
                        <span>{gate.label}{alreadySaved ? ' — مسجّلة بالفعل' : ''}</span>
                        <span>خصم {CRITICAL_GATE_POINT_PENALTY[key]} نقطة</span>
                      </button>
                    );
                  })}
                </div>
                {tierPreview.gated ? (
                  <p className="mt-3 text-xs font-bold" style={{ color: 'var(--dawaa-status-danger-text)' }}>
                    تقدير نسبة الحافز محدود عند {tierPreview.payoutPercent}% بسبب مخالفة مفعّلة، بدل {tierPreview.tier.payoutPercent}% اللي كانت هتستحقها الدرجة لوحدها. الأثر الفعلي على المرتب يظهر في نظام النقاط بعد الحفظ.
                  </p>
                ) : null}
              </Panel>

              <Panel className="p-4">
                <SectionTitle title="بيانات تشغيلية مساعدة للتقييم" icon={<Search size={18} />} />
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {(Object.keys(METRIC_LABELS) as (keyof typeof METRIC_LABELS)[]).map((key) => (
                    <MiniBox key={key} label={METRIC_LABELS[key]} value={String(metrics[key])} tone="cyan" />
                  ))}
                </div>
              </Panel>

              <Panel className="p-4" style={{ background: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' }}>
                <h2 className="font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>قاعدة الفصل بين التقييم والحافز</h2>
                <p className="mt-2 text-sm leading-7" style={{ color: 'var(--dawaa-theme-text)' }}>
                  التقييم الشهري يقيس جودة العمل ويحدد نقاط القوة وخطة التحسين. لا يحسب مبلغًا مستقلًا ولا يستطيع تجاوز محرك النقاط. المكافآت والخصومات التشغيلية تدخل الـLedger من أحداثها الأصلية، والحافز بالجنيه يخرج من Compensation Profile والمصدر المركزي فقط.
                </p>
              </Panel>

              <section className="space-y-3">
                {sections.map((item) => {
                  const earned = sectionPoints(item);
                  return (
                    <Panel key={item.key} className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="max-w-3xl">
                          <h3 className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                            {item.title} <span className="text-xs" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>الوزن: {item.weight}</span>
                          </h3>
                          <p className="mt-1 text-xs leading-6" style={{ color: 'var(--dawaa-theme-muted)' }}>{item.description}</p>
                        </div>
                        <div className="min-w-[230px]">
                          <div className="flex justify-end gap-1">
                            {[1, 2, 3, 4, 5].map((score) => (
                              <button type="button" aria-label={`اختيار ${score} نجوم`} disabled={!canEdit} key={score} onClick={() => updateSection(item.key, { score })} className="rounded-lg p-1 transition disabled:cursor-default">
                                <Star className={score <= item.score ? 'fill-current' : ''} style={{ color: score <= item.score ? 'var(--dawaa-status-warning-text)' : 'var(--dawaa-theme-border)' }} size={27} />
                              </button>
                            ))}
                          </div>
                          <div className="mt-2 rounded-xl border px-3 py-2 text-center text-sm font-black" style={{ borderColor: 'var(--dawaa-theme-accent-border)', background: 'var(--dawaa-theme-accent-soft)', color: 'var(--dawaa-theme-primary-strong)' }}>
                            {item.score ? `${item.score} نجوم — ${starMeaning(item.score)} — ${earned} من ${item.weight}` : `لم يتم التقييم — 0 من ${item.weight}`}
                          </div>
                        </div>
                      </div>
                      {item.rubric ? (
                        <div className="mt-3 rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)' }}>
                          <p className="mb-2 text-[11px] font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>معيار الدرجة على هذا المحور:</p>
                          <ul className="space-y-1 text-xs" style={{ color: 'var(--dawaa-theme-text)' }}>
                            {item.rubric.map((line, index) => (
                              <li key={index} className={item.score === index + 1 ? 'font-black' : ''} style={item.score === index + 1 ? { color: 'var(--dawaa-theme-primary-strong)' } : undefined}>
                                {index + 1} نجوم — {line}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <textarea
                        disabled={!canEdit}
                        value={item.notes}
                        onChange={(event) => updateSection(item.key, { notes: event.target.value })}
                        rows={2}
                        placeholder="ملاحظة واضحة على هذا المحور"
                        className="mt-3 w-full rounded-xl border p-2.5 text-sm disabled:opacity-70"
                        style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }}
                      />
                    </Panel>
                  );
                })}
              </section>

              <section className="grid gap-3 lg:grid-cols-3">
                <Panel className="p-4">
                  <h3 className="font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>نقاط القوة</h3>
                  <textarea disabled={!canEdit} rows={6} value={strengthsText} onChange={(event) => setStrengthsText(event.target.value)} placeholder="كل نقطة في سطر" className="mt-3 w-full rounded-xl border p-2.5 text-sm disabled:opacity-70" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }} />
                </Panel>
                <Panel className="p-4">
                  <h3 className="font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>خطة التطوير</h3>
                  <textarea disabled={!canEdit} rows={6} value={developmentText} onChange={(event) => setDevelopmentText(event.target.value)} placeholder="كل خطوة تطوير في سطر" className="mt-3 w-full rounded-xl border p-2.5 text-sm disabled:opacity-70" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }} />
                </Panel>
                <Panel className="p-4">
                  <h3 className="font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>ملاحظات المدير</h3>
                  <textarea disabled={!canEdit} rows={6} value={managerNotes} onChange={(event) => setManagerNotes(event.target.value)} className="mt-3 w-full rounded-xl border p-2.5 text-sm disabled:opacity-70" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }} />
                </Panel>
              </section>

              <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>
                  <CheckCircle2 style={{ color: 'var(--dawaa-theme-primary-strong)' }} size={18} /> الحالة: {status} · المحرك: V3
                </div>
                {canEdit ? (
                  <div className="flex gap-2">
                    <button type="button" disabled={saving} onClick={() => void save('draft')} className="btn-secondary inline-flex items-center gap-2"><Save size={16} /> حفظ</button>
                    <button type="button" disabled={saving} onClick={() => void save('sent')} className="btn-primary inline-flex items-center gap-2">{saving ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} إرسال للموظف</button>
                  </div>
                ) : null}
              </Panel>
            </>
          ) : (
            <EmptyState label="اختر موظفًا لعرض تقييمه." />
          )}
        </main>
      </div>
    </div>
  );
}
