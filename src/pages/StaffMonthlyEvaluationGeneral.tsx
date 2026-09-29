import { useEffect, useMemo, useState } from 'react';
import {
  Award, CheckCircle2, ChevronDown, FileDown, Loader2, Save, Search, Send, ShieldAlert, Star, UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
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
  loadEmployeeMonthlyEvidence,
  type EmployeeMonthlyEvidence,
} from '@/lib/staff/employeeMonthlyEvidenceService';
import {
  currentEvaluationCycleLabel,
  evaluationCycleRangeFromLabel,
  evaluationCycleDateKeys,
  isEvaluationCycleClosed,
  latestClosedEvaluationCycleLabel,
} from '@/lib/evaluations/monthlyEvaluationCycle';
import {
  CRITICAL_GATE_CAPS,
  type CriticalGateType,
} from '@/lib/evaluations/incentiveTiers';
import { buildStaffMonthlyEvaluationPdf } from '@/lib/evaluations/staffMonthlyEvaluationPdf';
import { Panel, SectionTitle, KpiCard, MiniBox, EmptyState } from '@/components/dashboard/DashboardPrimitives';
import MonthlyEvaluationWorkflowV5, { type MonthlyEvaluationStep } from '@/components/evaluations/MonthlyEvaluationWorkflowV5';
import MonthlyEvaluationAuditTrailV5 from '@/components/evaluations/MonthlyEvaluationAuditTrailV5';

type StaffRow = {
  id: string;
  name: string;
  role?: string | null;
  job_title?: string | null;
  branch?: string | null;
  status?: string | null;
  user_id?: string | null;
  evaluation_status?: 'not_started' | 'draft' | 'sent' | 'approved' | 'needs_reapproval' | string | null;
  evaluation_score?: number | null;
  sent_at?: string | null;
  evidence_ready?: boolean | null;
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

function safeNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function appendUniqueLine(current: string, line: string) {
  const normalized = line.trim();
  if (!normalized) return current;
  const lines = current.split('\n').map((item) => item.trim()).filter(Boolean);
  if (lines.includes(normalized)) return current;
  return [...lines, normalized].join('\n');
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
  const [cycleLabel, setCycleLabel] = useState(() => latestClosedEvaluationCycleLabel());
  const cycleRange = useMemo(() => evaluationCycleRangeFromLabel(cycleLabel), [cycleLabel]);
  const cycleClosed = useMemo(() => isEvaluationCycleClosed(cycleLabel), [cycleLabel]);
  const activeCycleLabel = currentEvaluationCycleLabel();
  const latestClosedCycleLabel = latestClosedEvaluationCycleLabel();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeStep, setActiveStep] = useState<MonthlyEvaluationStep>(1);
  const [auditRefreshKey, setAuditRefreshKey] = useState(0);
  const [sections, setSections] = useState<StaffEvaluationSectionV3[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [evidenceReady, setEvidenceReady] = useState(false);
  const [evidenceHealth, setEvidenceHealth] = useState<EmployeeMonthlyEvidence['health']>({
    reviews: 'unavailable',
    followups: 'unavailable',
    attendance: 'unavailable',
  });
  const [evidenceErrors, setEvidenceErrors] = useState<Record<string, string>>({});
  const [pointsTruth, setPointsTruth] = useState<StaffPointsDashboardV3 | null>(null);
  const [settledStatement, setSettledStatement] = useState<{ points_closing: number; incentive_amount: number } | null>(null);
  const [activeGates, setActiveGates] = useState<CriticalGateType[]>([]);
  const [strengthsText, setStrengthsText] = useState('');
  const [developmentText, setDevelopmentText] = useState('');
  const [managerNotes, setManagerNotes] = useState('');
  const [status, setStatus] = useState('draft');
  const [previouslySent, setPreviouslySent] = useState(false);
  const [sentAtIso, setSentAtIso] = useState('');
  const [evaluationId, setEvaluationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

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
  const evaluationNotStarted = sections.length > 0 && sections.every((item) => item.score === 0);
  const grade = evaluationNotStarted ? 'لسه ما اتقيّمش' : gradeFor(overallScore);
  const requiresPostCycleReapproval = Boolean(
    ['sent', 'approved'].includes(status)
      && sentAtIso
      && new Date(sentAtIso).getTime() <= cycleRange.end.getTime()
  );

  // ملحوظة مهمة: مفيش "فئة شرائح تقديرية" هنا عمدًا — نظام الشرائح
  // (resolveIncentiveTier) خاص بحافز المديرين الأسبوعي، مش بحافز الدكاترة.
  // حافز الدكاترة الحقيقي الوحيد هو نظام النقاط (Points Truth) المعروض في
  // كارت "حافز الأداء المركزي" تحت. عرض رقم تقديري من فورمولة تانية جنب
  // الرقم الحقيقي بيدّي انطباع غلط بوجود تضارب/عدم اتساق، فاتشال بالكامل
  // بدل ما نحاول نوضحه بالتسمية بس.
  const isGatedByCriticalViolation = activeGates.length > 0;
  const activeGateCapPercent = activeGates.length
    ? Math.min(...activeGates.map((gate) => CRITICAL_GATE_CAPS[gate].capPercent))
    : 100;
  const effectiveEvaluationMultiplierPct = Math.min(overallScore, activeGateCapPercent);

  useEffect(() => {
    const loadStaff = async () => {
      if (!user?.id) return;
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('list_staff_for_monthly_evaluation_v5', {
          p_actor_id: user.id,
          p_branch: globalScope ? branch : null,
          p_month: `${cycleLabel}-01`,
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
  }, [branch, cycleLabel, globalScope, managerMode, selectedId, user?.id, user?.name, user?.staffId]);

  useEffect(() => {
    setActiveStep(1);
  }, [cycleLabel, selectedId]);

  useEffect(() => {
    if (!selectedId || !user?.id || !selected) return;
    const loadEvaluation = async () => {
      setLoading(true);
      try {
        const { startDate, endDate, endDateExclusive } = evaluationCycleDateKeys(cycleLabel);
        const cycleKeyDate = `${cycleLabel}-01`;
        const [savedResult, evidenceResult, pointsResult, statementResult] = await Promise.all([
          supabase.rpc('get_staff_monthly_evaluation_safe', {
            p_actor_id: user.id,
            p_staff_id: selectedId,
            p_month: cycleKeyDate,
          }),
          loadEmployeeMonthlyEvidence({ staffId: selectedId, startDate, endDateExclusive }),
          getStaffPointsDashboardV3(selectedId, cycleLabel).catch(() => null),
          // Historical closed statements remain the frozen source if one exists.
          supabase
            .from('employee_monthly_statements')
            .select('points_closing,incentive_amount')
            .eq('staff_id', selectedId)
            .eq('cycle_start', startDate)
            .eq('cycle_end', endDate)
            .maybeSingle(),
        ]);

        if (savedResult.error) throw savedResult.error;

        setMetrics(evidenceResult.metrics);
        setEvidenceReady(evidenceResult.ready);
        setEvidenceHealth(evidenceResult.health);
        setEvidenceErrors(evidenceResult.errors);
        setPointsTruth(pointsResult);
        setSettledStatement(statementResult.data || null);

        const saved = savedResult.data as EvaluationRow | null;
        const freshSections = evaluationProfileForRole(selected.job_title || selected.role).sections;
        if (saved) {
          setEvaluationId(String(saved.id || ''));
          setSections(normalizeSavedSections(saved.sections, freshSections));
          setStrengthsText(Array.isArray(saved.strengths) ? saved.strengths.map(String).join('\n') : '');
          setDevelopmentText(Array.isArray(saved.development_points) ? saved.development_points.map(String).join('\n') : '');
          setManagerNotes(String(saved.manager_notes || ''));
          const savedStatus = String(saved.status || 'draft');
          const savedSentAt = String(saved.sent_at || '');
          setStatus(savedStatus);
          setSentAtIso(savedSentAt);
          setPreviouslySent(
            ['sent', 'approved'].includes(savedStatus)
              && Boolean(savedSentAt)
              && new Date(savedSentAt).getTime() > cycleRange.end.getTime()
          );
          const snapshot = saved.metrics_snapshot as Record<string, unknown> | null;
          const savedGates = snapshot && Array.isArray(snapshot.active_critical_gates) ? (snapshot.active_critical_gates as string[]) : [];
          const validSavedGates = savedGates.filter((gate): gate is CriticalGateType => gate in CRITICAL_GATE_CAPS);
          setActiveGates(validSavedGates);
        } else {
          setEvaluationId(null);
          setSections(freshSections);
          setStrengthsText('');
          setDevelopmentText('');
          setManagerNotes('');
          setStatus('draft');
          setSentAtIso('');
          setPreviouslySent(false);
          setActiveGates([]);
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

  async function handleExportPdf() {
    if (!selected) return;
    setExportingPdf(true);
    try {
      const { pdf, fileName } = await buildStaffMonthlyEvaluationPdf({
        staffName: selected.name,
        staffRole: selected.job_title || selected.role || profile.label,
        branch: selected.branch || branch,
        cycleDisplayLabel: cycleRange.displayLabel,
        evaluatorName: user?.name || 'المدير',
        overallScore,
        grade,
        sections,
        strengths: strengthsText.split('\n').map((item) => item.trim()).filter(Boolean),
        developmentPoints: developmentText.split('\n').map((item) => item.trim()).filter(Boolean),
        managerNotes,
        pointsFinal: pointsTruth?.final_points ?? null,
        pointsTarget: pointsTruth?.target_points ?? null,
        incentiveEgp: canonicalIncentive ?? null,
      });
      pdf.save(fileName);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'تعذر إنشاء ملف PDF');
    } finally {
      setExportingPdf(false);
    }
  }

  async function save(nextStatus = status) {
    if (!selected || !user?.id) return;
    if (isEditingSelf) {
      toast.error('لا يمكنك اعتماد أو تعديل تقييمك الشهري لنفسك.');
      return;
    }
    if (nextStatus === 'sent' && !evidenceReady) {
      const missing = [
        evidenceHealth.reviews === 'unavailable' ? 'مراجعات المحادثات' : '',
        evidenceHealth.followups === 'unavailable' ? 'المتابعات' : '',
        evidenceHealth.attendance === 'unavailable' ? 'الحضور' : '',
      ].filter(Boolean).join('، ');
      toast.error(`لا يمكن الاعتماد النهائي لأن مصادر الأدلة غير مكتملة: ${missing || 'مصدر غير متاح'}.`);
      return;
    }
    if (nextStatus === 'sent' && !cycleClosed) {
      toast.error(`الدورة ما زالت جارية حتى ${cycleRange.displayLabel.split('–')[1]?.trim() || 'يوم 25'}. يمكنك حفظ مسودة فقط ثم الاعتماد بعد إقفال الدورة.`);
      return;
    }
    if (nextStatus === 'sent' && managerMode && sections.some((item) => item.score === 0)) {
      toast.error('يجب تقييم كل المحاور قبل الاعتماد النهائي');
      return;
    }
    if (nextStatus === 'sent' && sections.some((item) => item.score > 0 && item.score <= 2 && !item.notes.trim())) {
      toast.error('أي محور بدرجة 1 أو 2 نجمة يحتاج سببًا مكتوبًا قبل الاعتماد.');
      return;
    }
    if (nextStatus === 'sent' && activeGates.length > 0 && !managerNotes.trim()) {
      toast.error('المخالفة الحرجة تحتاج ملاحظة مدير توضح سبب القرار قبل الاعتماد.');
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
          evaluation_engine_version: 5,
          evidence_ready: evidenceReady,
          evidence_health: evidenceHealth,
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

      const { data, error } = await supabase.rpc('save_staff_monthly_evaluation_v5', {
        p_actor_id: user.id,
        p_payload: payload,
      });
      if (error) throw error;
      const saveResult = (data || {}) as Record<string, unknown>;
      const savedEvaluationId = String(saveResult.evaluation_id || evaluationId || '');
      setEvaluationId(savedEvaluationId);
      setStatus(nextStatus);
      setAuditRefreshKey((value) => value + 1);

      const serverSentAt = String(saveResult.sent_at || '');
      if (nextStatus === 'sent') {
        setPreviouslySent(true);
        setSentAtIso(serverSentAt || new Date().toISOString());
        const refreshedPoints = await getStaffPointsDashboardV3(selected.id, cycleLabel).catch(() => null);
        if (refreshedPoints) setPointsTruth(refreshedPoints);
        toast.success(`تم اعتماد التقييم على الخادم بنسبة أثر ${Number(saveResult.multiplier_pct ?? effectiveEvaluationMultiplierPct)}%.`);
      }

      setStaff((current) => current.map((item) => item.id === selected.id
        ? {
            ...item,
            evaluation_status: nextStatus === 'sent' ? 'sent' : 'draft',
            evaluation_score: Number(saveResult.overall_score ?? overallScore),
            sent_at: nextStatus === 'sent' ? (serverSentAt || new Date().toISOString()) : item.sent_at,
            evidence_ready: evidenceReady,
          }
        : item));

      toast.success(nextStatus === 'sent' ? 'تم الاعتماد والإرسال للموظف' : 'تم حفظ المسودة');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'فشل حفظ التقييم');
    } finally {
      setSaving(false);
    }
  }

  const filteredStaff = staff.filter((item) => item.name.includes(search));
  const completedSections = sections.filter((item) => item.score > 0).length;
  const weakSectionsMissingNotes = sections.filter((item) => item.score > 0 && item.score <= 2 && !item.notes.trim());
  const criticalGateMissingReason = activeGates.length > 0 && !managerNotes.trim();
  const staffSummary = {
    total: staff.length,
    notStarted: staff.filter((item) => !item.evaluation_status || item.evaluation_status === 'not_started').length,
    draft: staff.filter((item) => item.evaluation_status === 'draft').length,
    approved: staff.filter((item) => ['sent', 'approved'].includes(String(item.evaluation_status || ''))).length,
    needsReapproval: staff.filter((item) => item.evaluation_status === 'needs_reapproval').length,
  };
  const approvalBlockers = [
    !cycleClosed ? 'الدورة لم تُقفل بعد' : '',
    !evidenceReady ? 'مصدر أو أكثر من أدلة الدورة غير متاح' : '',
    completedSections !== sections.length ? `باقي ${Math.max(0, sections.length - completedSections)} محور بدون تقييم` : '',
    weakSectionsMissingNotes.length ? `${weakSectionsMissingNotes.length} محور بدرجة ضعيفة يحتاج سبب مكتوب` : '',
    criticalGateMissingReason ? 'المخالفة الحرجة تحتاج سببًا مكتوبًا في ملاحظات المدير' : '',
  ].filter(Boolean);
  const approvalReady =
    cycleClosed
    && evidenceReady
    && sections.length > 0
    && completedSections === sections.length
    && weakSectionsMissingNotes.length === 0
    && !criticalGateMissingReason;
  const ratedSections = sections.filter((item) => item.score > 0);
  const strongestSections = [...ratedSections]
    .filter((item) => item.score >= 4)
    .sort((a, b) => b.score - a.score || b.weight - a.weight)
    .slice(0, 3);
  const developmentSections = [...ratedSections]
    .filter((item) => item.score <= 3)
    .sort((a, b) => a.score - b.score || b.weight - a.weight)
    .slice(0, 3);

  // الرقم المالي المعروض يأتي فقط من الحقيقة المالية على الخادم أو من كشف مقفول.
  // لا نحسب مبلغًا نهائيًا داخل صفحة التقييم.
  const canonicalIncentive = settledStatement
    ? Number(settledStatement.incentive_amount)
    : pointsTruth?.final_incentive_egp == null
      ? null
      : Number(pointsTruth.final_incentive_egp);

  return (
    <div className="min-h-screen space-y-4 p-4" dir="rtl" style={{ background: 'var(--dawaa-theme-bg)' }}>
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
              <UserCheck style={{ color: 'var(--dawaa-theme-primary-strong)' }} /> التقييم الشهري للموظفين
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>
              رحلة شهرية واضحة من مراجعة البيانات إلى الاعتماد. الدرجة، الأدلة، المخالفات، والنقاط تُعرض من مصادرها بدون خلط، والمبلغ المالي النهائي يُقرأ فقط من المصدر المركزي للحوافز.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
              <button
                type="button"
                onClick={() => setCycleLabel(latestClosedCycleLabel)}
                className="px-3 py-2 text-xs font-black"
                style={cycleLabel === latestClosedCycleLabel
                  ? { background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' }
                  : { color: 'var(--dawaa-theme-muted)' }}
              >
                آخر دورة مكتملة
              </button>
              <button
                type="button"
                onClick={() => setCycleLabel(activeCycleLabel)}
                className="px-3 py-2 text-xs font-black"
                style={cycleLabel === activeCycleLabel
                  ? { background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' }
                  : { color: 'var(--dawaa-theme-muted)' }}
              >
                الدورة الجارية
              </button>
            </div>
            {globalScope ? (
              <select value={branch} onChange={(event) => setBranch(event.target.value)} className="rounded-2xl border px-3 py-2 text-sm font-black" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }}>
                <option>فرع الشامي</option><option>فرع شكري</option>
              </select>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black" style={{ borderColor: 'var(--dawaa-theme-accent-border)', background: 'var(--dawaa-theme-accent-soft)', color: 'var(--dawaa-theme-primary-strong)' }}>
            فترة الدورة: {cycleRange.displayLabel}
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black" style={{ borderColor: cycleClosed ? 'var(--dawaa-status-success-border)' : 'var(--dawaa-status-warning-border)', background: cycleClosed ? 'var(--dawaa-status-success-bg)' : 'var(--dawaa-status-warning-bg)', color: cycleClosed ? 'var(--dawaa-status-success-text)' : 'var(--dawaa-status-warning-text)' }}>
            {cycleClosed ? 'الدورة مكتملة — متاحة للاعتماد' : 'الدورة جارية — مسودة فقط'}
          </div>
        </div>
        {!cycleClosed ? (
          <div className="mt-3 rounded-2xl border p-3 text-sm font-bold" style={{ borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)', color: 'var(--dawaa-status-warning-text)' }}>
            البيانات ما زالت تتغير حتى نهاية يوم 25. يمكنك متابعة الأداء وحفظ التقييم كمسودة، لكن الاعتماد النهائي يفتح بعد إقفال الدورة.
          </div>
        ) : requiresPostCycleReapproval ? (
          <div className="mt-3 rounded-2xl border p-3 text-sm font-bold" style={{ borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)', color: 'var(--dawaa-status-warning-text)' }}>
            هذا التقييم أُرسل قبل اكتمال الدورة. راجعه الآن بعد الإقفال ثم اضغط «إعادة اعتماد الدورة» حتى يتزامن أثره المالي مع البيانات المكتملة.
          </div>
        ) : null}
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
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{item.name}</div>
                    <span
                      className="rounded-full border px-2 py-0.5 text-[10px] font-black"
                      style={item.evaluation_status === 'needs_reapproval'
                        ? { borderColor: 'var(--dawaa-status-danger-border)', background: 'var(--dawaa-status-danger-bg)', color: 'var(--dawaa-status-danger-text)' }
                        : ['sent', 'approved'].includes(String(item.evaluation_status || ''))
                          ? { borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-status-success-bg)', color: 'var(--dawaa-status-success-text)' }
                          : item.evaluation_status === 'draft'
                            ? { borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)', color: 'var(--dawaa-status-warning-text)' }
                            : { borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }}
                    >
                      {item.evaluation_status === 'needs_reapproval'
                        ? 'إعادة اعتماد'
                        : ['sent', 'approved'].includes(String(item.evaluation_status || ''))
                          ? 'معتمد'
                          : item.evaluation_status === 'draft'
                            ? 'مسودة'
                            : 'لم يبدأ'}
                    </span>
                  </div>
                  <div className="mt-1 text-xs" style={{ color: 'var(--dawaa-theme-muted)' }}>
                    {item.role} · {item.branch}
                    {item.evaluation_score != null ? ` · ${item.evaluation_score}/100` : ''}
                  </div>
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

              <MonthlyEvaluationWorkflowV5
                activeStep={activeStep}
                onStepChange={setActiveStep}
                evidenceReady={evidenceReady}
                cycleClosed={cycleClosed}
                completedSections={completedSections}
                totalSections={sections.length}
                hasCriticalGate={isGatedByCriticalViolation}
                approvalReady={approvalReady}
                status={status}
                requiresPostCycleReapproval={requiresPostCycleReapproval}
                summary={staffSummary}
              />

              {activeStep === 1 ? (
                <>
              <section className="grid gap-3 md:grid-cols-3">
                <KpiCard title="نتيجة التقييم" value={evaluationNotStarted ? '—' : `${overallScore}/100`} subtitle={grade} icon={<Star size={20} />} tone={evaluationNotStarted ? 'cyan' : overallScore >= 80 ? 'green' : overallScore >= 60 ? 'amber' : 'red'} />
                <KpiCard
                  title="النقاط الحالية"
                  value={settledStatement ? `${settledStatement.points_closing}` : pointsTruth ? `${pointsTruth.final_points} / ${pointsTruth.target_points}` : '—'}
                  subtitle={settledStatement ? 'من كشف الحوافز المقفول لهذه الدورة' : 'دورة الحافز الحالية (تقدير حي)'}
                  icon={<Award size={20} />}
                  tone="cyan"
                />
                <KpiCard
                  title="حافز الأداء المركزي"
                  value={canonicalIncentive == null ? 'غير محدد' : `${canonicalIncentive.toLocaleString('ar-EG')} جنيه`}
                  subtitle={
                    settledStatement
                      ? 'رقم رسمي من كشف مقفول — دورة سابقة'
                      : previouslySent
                        ? 'الرقم الحالي من المصدر المالي المركزي بعد آخر اعتماد'
                        : 'الرقم الحالي من المصدر المالي المركزي؛ المسودة لا تغيّره قبل الاعتماد'
                  }
                  icon={<CheckCircle2 size={20} />}
                  tone="green"
                />
              </section>

              {!settledStatement && pointsTruth && cycleLabel !== currentEvaluationCycleLabel() ? (
                <Panel className="p-3" style={{ background: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' }}>
                  <p className="text-xs font-bold" style={{ color: 'var(--dawaa-status-warning-text)' }}>
                    الدورة دي لسه من غير كشف حوافز مقفول — الرقم المعروض تقدير حي بمعدل النقطة الحالي، ومش بالضرورة نفس المعدل اللي كان فعليًا وقت الدورة دي لو اتغيّر بعدها.
                  </p>
                </Panel>
              ) : null}

              {!pointsTruth?.profile_configured ? (
                <Panel className="p-4" style={{ background: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' }}>
                  <p className="text-sm font-bold" style={{ color: 'var(--dawaa-status-warning-text)' }}>
                    الملف المالي لهذا الموظف غير مكتمل؛ التقييم يظل متاحًا لكن لا تعرض الصفحة مبلغًا ماليًا غير موثوق.
                  </p>
                </Panel>
              ) : null}
                </>
              ) : null}

              {activeStep === 3 ? (
                <>
              <Panel className="p-4">
                <SectionTitle
                  title="مخالفات حرجة تحدّ من الحافز"
                  subtitle="الـCritical Gate لا يخصم نقاطًا ثابتة؛ بل يضع سقفًا مباشرًا ودقيقًا على نسبة حافز الأداء"
                  icon={<ShieldAlert size={18} />}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  {(Object.entries(CRITICAL_GATE_CAPS) as [CriticalGateType, typeof CRITICAL_GATE_CAPS[CriticalGateType]][]).map(([key, gate]) => {
                    const active = activeGates.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={!canEdit}
                        onClick={() => toggleGate(key)}
                        className="flex items-center justify-between gap-2 rounded-xl border p-3 text-right text-xs font-black disabled:cursor-default"
                        style={active
                          ? { borderColor: 'var(--dawaa-status-danger-border)', background: 'var(--dawaa-status-danger-bg)', color: 'var(--dawaa-status-danger-text)' }
                          : { borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }}
                      >
                        <span>{gate.label}</span>
                        <span>{gate.blocksFully ? 'إيقاف حافز الأداء' : `سقف ${gate.capPercent}%`}</span>
                      </button>
                    );
                  })}
                </div>
                {isGatedByCriticalViolation ? (
                  <p className="mt-3 text-xs font-bold" style={{ color: 'var(--dawaa-status-danger-text)' }}>
                    نسبة التقييم = {overallScore}%، وسقف المخالفة = {activeGateCapPercent}%، لذلك النسبة المالية الفعلية لهذه الدورة = {effectiveEvaluationMultiplierPct}%.
                  </p>
                ) : null}
              </Panel>
                </>
              ) : null}

              {activeStep === 1 ? (
              <Panel className="p-4">
                <SectionTitle
                  title="أدلة الدورة"
                  subtitle={evidenceReady ? 'المحادثات والمتابعات والحضور متاحة' : 'مصدر واحد أو أكثر غير متاح — الاعتماد النهائي متوقف'}
                  icon={<Search size={18} />}
                />
                <div className="mb-3 flex flex-wrap gap-2 text-xs font-black">
                  {([
                    ['المحادثات', evidenceHealth.reviews],
                    ['المتابعات', evidenceHealth.followups],
                    ['الحضور', evidenceHealth.attendance],
                  ] as const).map(([label, sourceStatus]) => (
                    <span
                      key={label}
                      className="rounded-full border px-3 py-1"
                      style={sourceStatus === 'available'
                        ? { borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-status-success-bg)', color: 'var(--dawaa-status-success-text)' }
                        : { borderColor: 'var(--dawaa-status-danger-border)', background: 'var(--dawaa-status-danger-bg)', color: 'var(--dawaa-status-danger-text)' }}
                    >
                      {label}: {sourceStatus === 'available' ? 'جاهز' : 'غير متاح'}
                    </span>
                  ))}
                </div>
                {!evidenceReady && Object.keys(evidenceErrors).length ? (
                  <div className="mb-3 rounded-xl border p-2 text-xs font-bold" style={{ borderColor: 'var(--dawaa-status-danger-border)', background: 'var(--dawaa-status-danger-bg)', color: 'var(--dawaa-status-danger-text)' }}>
                    لا تعتمد التقييم قبل عودة مصادر الأدلة. التفاصيل محفوظة للمراجعة الفنية ولا يتم تحويلها إلى أصفار حقيقية.
                  </div>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {(Object.keys(METRIC_LABELS) as (keyof typeof METRIC_LABELS)[]).map((key) => (
                    <MiniBox key={key} label={METRIC_LABELS[key]} value={String(metrics[key])} tone="cyan" />
                  ))}
                </div>
              </Panel>
              ) : null}

              {activeStep === 3 ? (
                <>
              <Panel className="p-4" style={{ background: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' }}>
                <h2 className="font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>الأثر المالي للتقييم</h2>
                <p className="mt-2 text-sm leading-7" style={{ color: 'var(--dawaa-theme-text)' }}>
                  الصفحة لا تحسب قيمة نهائية بنفسها. عند الاعتماد، الخادم يثبت درجة التقييم وسقف أي مخالفة حرجة ثم يحدّث معامل الحافز؛ وبعدها نعيد قراءة المبلغ من المصدر المالي المركزي. كده الرقم الظاهر هنا والرواتب يعتمدوا على نفس الحقيقة.
                </p>
              </Panel>

              <Panel className="p-4">
                <SectionTitle
                  title="تفصيل مصادر النقاط"
                  subtitle="مصدر كل زيادة أو خصم في الدورة كما هو مسجل في دفتر النقاط المركزي"
                  icon={<Award size={18} />}
                />
                {pointsTruth?.source_breakdown?.length ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {pointsTruth.source_breakdown.map((source) => (
                      <MiniBox
                        key={source.source}
                        label={source.source}
                        value={`${source.points > 0 ? '+' : ''}${source.points} نقطة · ${source.events} حدث`}
                        tone={source.points < 0 ? 'amber' : 'cyan'}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>لا توجد حركات نقاط مسجلة لهذه الدورة.</div>
                )}
              </Panel>
                </>
              ) : null}

              {activeStep === 2 ? (
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
                        placeholder={item.score > 0 && item.score <= 2 ? 'مطلوب: اكتب السبب أو الواقعة التي تبرر الدرجة الضعيفة' : 'ملاحظة واضحة على هذا المحور'}
                        className="mt-3 w-full rounded-xl border p-2.5 text-sm disabled:opacity-70"
                        style={{
                          borderColor: item.score > 0 && item.score <= 2 && !item.notes.trim() ? 'var(--dawaa-status-danger-border)' : 'var(--dawaa-theme-border)',
                          background: item.score > 0 && item.score <= 2 && !item.notes.trim() ? 'var(--dawaa-status-danger-bg)' : 'var(--dawaa-theme-surface)',
                          color: 'var(--dawaa-theme-text)',
                        }}
                      />
                      {item.score > 0 && item.score <= 2 && !item.notes.trim() ? (
                        <p className="mt-2 text-xs font-black" style={{ color: 'var(--dawaa-status-danger-text)' }}>
                          الدرجة 1–2 نجمة لازم يكون لها سبب مكتوب قبل الاعتماد النهائي.
                        </p>
                      ) : null}
                    </Panel>
                  );
                })}
              </section>
              ) : null}

              {activeStep === 4 ? (
                <>
                  <Panel className="p-4">
                    <SectionTitle
                      title="الخلاصة من درجات المحاور"
                      subtitle="اقتراحات مبنية على درجات هذا التقييم فقط؛ المدير يقرر ما يضيفه للتقرير."
                      icon={<Star size={18} />}
                    />
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-status-success-bg)' }}>
                        <div className="text-xs font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>أقوى المحاور</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {strongestSections.length ? strongestSections.map((item) => (
                            <button
                              key={item.key}
                              type="button"
                              disabled={!canEdit}
                              onClick={() => setStrengthsText((current) => appendUniqueLine(current, item.title))}
                              className="rounded-xl border px-3 py-2 text-xs font-black disabled:cursor-default"
                              style={{ borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)', background: 'var(--dawaa-theme-surface)' }}
                            >
                              + {item.title} · {item.score}/5
                            </button>
                          )) : <span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>لا يوجد محور 4–5 نجوم حتى الآن.</span>}
                        </div>
                      </div>
                      <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)' }}>
                        <div className="text-xs font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>محاور التطوير</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {developmentSections.length ? developmentSections.map((item) => (
                            <button
                              key={item.key}
                              type="button"
                              disabled={!canEdit}
                              onClick={() => setDevelopmentText((current) => appendUniqueLine(current, item.title))}
                              className="rounded-xl border px-3 py-2 text-xs font-black disabled:cursor-default"
                              style={{ borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)', background: 'var(--dawaa-theme-surface)' }}
                            >
                              + {item.title} · {item.score}/5
                            </button>
                          )) : <span className="text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>لا يوجد محور 1–3 نجوم حتى الآن.</span>}
                        </div>
                      </div>
                    </div>
                  </Panel>
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
                  <textarea
                      disabled={!canEdit}
                      rows={6}
                      value={managerNotes}
                      onChange={(event) => setManagerNotes(event.target.value)}
                      placeholder={activeGates.length ? 'مطلوب: وضّح سبب المخالفة الحرجة والواقعة المرتبطة بها' : 'ملاحظات ختامية مختصرة وقابلة للتنفيذ'}
                      className="mt-3 w-full rounded-xl border p-2.5 text-sm disabled:opacity-70"
                      style={{
                        borderColor: criticalGateMissingReason ? 'var(--dawaa-status-danger-border)' : 'var(--dawaa-theme-border)',
                        background: criticalGateMissingReason ? 'var(--dawaa-status-danger-bg)' : 'var(--dawaa-theme-surface)',
                        color: 'var(--dawaa-theme-text)',
                      }}
                    />
                    {criticalGateMissingReason ? (
                      <p className="mt-2 text-xs font-black" style={{ color: 'var(--dawaa-status-danger-text)' }}>
                        لا يمكن اعتماد مخالفة حرجة بدون سبب واضح في ملاحظات المدير.
                      </p>
                    ) : null}
                </Panel>
              </section>
                </>
              ) : null}

              {activeStep === 5 ? (
                <>
                  <Panel className="p-4" style={approvalReady
                    ? { background: 'var(--dawaa-status-success-bg)', borderColor: 'var(--dawaa-status-success-border)' }
                    : { background: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' }}>
                    <h3 className="font-black" style={{ color: approvalReady ? 'var(--dawaa-status-success-text)' : 'var(--dawaa-status-warning-text)' }}>
                      {approvalReady ? 'جاهز للمراجعة النهائية' : 'الاعتماد غير جاهز بعد'}
                    </h3>
                    <div className="mt-2 text-sm font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>
                      {approvalBlockers.length
                        ? approvalBlockers.map((item) => <div key={item}>• {item}</div>)
                        : <div>كل مصادر الأدلة متاحة، وكل المحاور تم تقييمها، والدورة مقفولة.</div>}
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <MiniBox label="الدرجة النهائية" value={evaluationNotStarted ? '—' : `${overallScore}/100`} tone={overallScore >= 80 ? 'green' : overallScore >= 60 ? 'amber' : 'red'} />
                      <MiniBox label="حالة الأدلة" value={evidenceReady ? 'مكتملة' : 'ناقصة'} tone={evidenceReady ? 'green' : 'red'} />
                      <MiniBox label="المخالفات الحرجة" value={activeGates.length ? String(activeGates.length) : '0'} tone={activeGates.length ? 'red' : 'green'} />
                      <MiniBox label="نسبة الأثر" value={`${effectiveEvaluationMultiplierPct}%`} tone={isGatedByCriticalViolation ? 'amber' : 'cyan'} />
                    </div>
                    {canonicalIncentive != null ? (
                      <div className="mt-3 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                        الحافز المعروض حاليًا من المصدر المالي المركزي: {canonicalIncentive.toLocaleString('ar-EG')} جنيه. الاعتماد لا يعيد حسابه داخل الصفحة.
                      </div>
                    ) : null}
                  </Panel>

                  {user?.id && selected ? (
                    <MonthlyEvaluationAuditTrailV5
                      actorId={user.id}
                      staffId={selected.id}
                      cycleLabel={cycleLabel}
                      refreshKey={auditRefreshKey}
                    />
                  ) : null}

              <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>
                  <CheckCircle2 style={{ color: 'var(--dawaa-theme-primary-strong)' }} size={18} /> الحالة: {requiresPostCycleReapproval ? 'اعتماد مبكر — يحتاج إعادة اعتماد' : status === 'sent' ? 'معتمد ومُرسل' : 'مسودة'} · المحرك: V5
                </div>
                {canEdit ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={exportingPdf} onClick={() => void handleExportPdf()} className="btn-secondary inline-flex items-center gap-2">{exportingPdf ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />} تصدير PDF</button>
                    {!['sent', 'approved'].includes(status) ? (
                      <button type="button" disabled={saving} onClick={() => void save('draft')} className="btn-secondary inline-flex items-center gap-2"><Save size={16} /> حفظ مسودة</button>
                    ) : null}
                    <button type="button" disabled={saving || !approvalReady} onClick={() => void save('sent')} className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {!cycleClosed ? 'الاعتماد بعد إقفال الدورة' : !evidenceReady ? 'الأدلة غير مكتملة' : completedSections !== sections.length ? 'أكمل كل المحاور' : requiresPostCycleReapproval ? 'إعادة اعتماد الدورة' : previouslySent ? 'تحديث واعتماد' : 'اعتماد وإرسال'}</button>
                  </div>
                ) : null}
              </Panel>
                </>
              ) : null}
            </>
          ) : (
            <EmptyState label="اختر موظفًا لعرض تقييمه." />
          )}
        </main>
      </div>
    </div>
  );
}
