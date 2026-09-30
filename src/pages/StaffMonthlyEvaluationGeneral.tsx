import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, ChevronDown, FileDown, Loader2, Save, Search, Send, Star, UserCheck,
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
import { createStaffNotification } from '@/lib/staffNotificationService';
import { Panel, MiniBox, EmptyState } from '@/components/dashboard/DashboardPrimitives';
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

const POINT_SOURCE_LABELS: Record<string, string> = {
  conversation_evaluation: 'تقييم المحادثات',
  invoice_quality_vs_branch_baseline: 'جودة الفواتير مقارنة بالفرع',
  target_achievement_settlement: 'تسوية تحقيق التارجت',
};

function pointSourceLabel(source: string) {
  return POINT_SOURCE_LABELS[source] || 'مصدر نقاط آخر';
}

function formatSignedPoints(points: number) {
  return `${points > 0 ? '+' : ''}${points}`;
}

function isConversationSectionKey(sectionKey: string) {
  return ['conversations', 'conversation', 'customer', 'customers', 'team_quality', 'customer_outcomes'].includes(sectionKey.toLowerCase());
}

function sectionEvidenceFor(
  sectionKey: string,
  metrics: Metrics,
  health: EmployeeMonthlyEvidence['health'],
  pointsTruth: StaffPointsDashboardV3 | null,
  coaching: EmployeeMonthlyEvidence['coaching'] | null
) {
  const key = sectionKey.toLowerCase();
  const attendanceKeys = ['discipline', 'attendance', 'shift_discipline'];
  const conversationKeys = ['conversations', 'conversation', 'customer', 'customers', 'team_quality', 'customer_outcomes'];
  const followupKeys = ['followups_requests', 'followups', 'followups_sla', 'customer_requests', 'requests'];

  if (attendanceKeys.includes(key)) {
    if (health.attendance !== 'available') {
      return {
        status: 'unavailable' as const,
        summary: 'مصدر الحضور غير متاح حاليًا',
        details: ['لا تستخدم الصفر كدليل على الأداء لأن مصدر الحضور غير متاح.'],
      };
    }
    const attendance = coaching?.attendance;
    return {
      status: 'available' as const,
      summary: attendance?.approvedEvents
        ? `${attendance.approvedEvents} قرار حضور معتمد · ${attendance.lateCases + attendance.veryLateCases} تأخير · ${attendance.absenceCases} غياب`
        : metrics.attendance_days
          ? `${metrics.present_days} يوم حضور فعلي من ${metrics.attendance_days} يوم مسجل`
          : 'لا توجد أيام حضور مسجلة في المصدر لهذه الدورة',
      details: [
        `أيام الحضور الفعلي: ${metrics.present_days}`,
        `إجمالي الأيام المسجلة: ${metrics.attendance_days}`,
        attendance?.approvedEvents ? `قرارات الحضور المعتمدة: ${attendance.approvedEvents}` : '',
        attendance && attendance.lateCases + attendance.veryLateCases > 0
          ? `التأخير المعتمد: ${attendance.lateCases + attendance.veryLateCases} حالة · ${attendance.lateMinutes} دقيقة`
          : '',
        attendance?.earlyLeaveCases
          ? `الخروج المبكر المعتمد: ${attendance.earlyLeaveCases} حالة · ${attendance.earlyLeaveMinutes} دقيقة`
          : '',
        attendance?.absenceCases ? `الغياب المؤكد: ${attendance.absenceCases} حالة` : '',
        attendance?.approvedTimeOffCases ? `إجازات/أذونات معتمدة: ${attendance.approvedTimeOffCases}` : '',
        'المصدر: Attendance Resolution / Impact Ledger المعتمد.',
      ].filter(Boolean),
    };
  }

  if (conversationKeys.includes(key)) {
    if (health.reviews !== 'available') {
      return {
        status: 'unavailable' as const,
        summary: 'مصدر مراجعات المحادثات غير متاح حاليًا',
        details: ['لا تستخدم متوسط 0 كدليل لأن مصدر المحادثات غير متاح.'],
      };
    }
    const conversation = coaching?.conversation;
    return {
      status: 'available' as const,
      summary: metrics.review_count
        ? `${metrics.review_count} محادثة مراجعة · متوسط ${metrics.review_average}/100`
        : 'لا توجد مراجعات محادثات مسجلة لهذه الدورة',
      details: [
        `عدد المراجعات: ${metrics.review_count}`,
        `متوسط التقييم: ${metrics.review_average}/100`,
        `نقاط إيجابية من المحادثات: +${metrics.conversation_positive_points}`,
        `نقاط سلبية من المحادثات: -${metrics.conversation_negative_points}`,
        conversation && !conversation.sampleSufficient
          ? `العينة الحالية ${conversation.reviewCount} فقط؛ نحتاج ${conversation.minSamples} مراجعات على الأقل قبل استنتاج نقاط قوة أو ضعف.`
          : '',
        conversation?.strengths.length
          ? `أقوى الأبعاد: ${conversation.strengths.map((item) => `${item.label} ${item.average}/10`).join('، ')}`
          : '',
        conversation?.weaknesses.length
          ? `أضعف الأبعاد: ${conversation.weaknesses.map((item) => `${item.label} ${item.average}/10`).join('، ')}`
          : '',
      ].filter(Boolean),
    };
  }

  if (key === 'dispensing') {
    if (health.reviews !== 'available') {
      return {
        status: 'unavailable' as const,
        summary: 'مصدر مراجعات الإرشاد الدوائي غير متاح حاليًا',
        details: ['لا تستخدم غياب البيانات كدليل على دقة الصرف أو عدمها.'],
      };
    }

    const conversation = coaching?.conversation;
    const consultation = conversation?.dimensions.find((item) => item.key === 'consultation_quality');
    const dosage = conversation?.dimensions.find((item) => item.key === 'dosage_explanation');
    const alternatives = conversation?.dimensions.find((item) => item.key === 'alternative_handling');
    const medicalErrors = conversation?.flags.medicalErrors || 0;
    const badAlternativeCases = conversation?.flags.badAlternativeCases || 0;
    const guidanceSamples = Math.max(
      consultation?.samples || 0,
      dosage?.samples || 0,
      alternatives?.samples || 0
    );

    const guidanceSummary = [
      dosage ? `شرح الجرعة ${dosage.average}/10` : '',
      consultation ? `الاستشارة ${consultation.average}/10` : '',
      alternatives ? `البدائل ${alternatives.average}/10` : '',
    ].filter(Boolean).join(' · ');

    return {
      status: medicalErrors > 0 ? 'available' as const : guidanceSamples >= 3 ? 'available' as const : 'manual' as const,
      summary: medicalErrors > 0
        ? `${medicalErrors} خطأ طبي موثق في مراجعات الدورة · يحتاج مراجعة مباشرة`
        : guidanceSummary
          ? guidanceSummary
          : 'لا توجد عينة كافية من الإرشاد الدوائي للحكم الآلي',
      details: [
        medicalErrors > 0 ? `أخطاء طبية موثقة في مراجعات المحادثات: ${medicalErrors}` : 'لا يوجد خطأ طبي موثق في مراجعات المحادثات المتاحة.',
        badAlternativeCases > 0 ? `حالات بديل غير مناسب موثقة: ${badAlternativeCases}` : '',
        consultation ? `جودة الاستشارة: ${consultation.average}/10 من ${consultation.samples} مراجعة` : '',
        dosage ? `شرح الجرعة والاستخدام: ${dosage.average}/10 من ${dosage.samples} مراجعة` : '',
        alternatives ? `التعامل مع البدائل: ${alternatives.average}/10 من ${alternatives.samples} مراجعة` : '',
        guidanceSamples > 0 && guidanceSamples < 3
          ? `العينة الحالية للإرشاد الدوائي أقل من 3 مراجعات؛ لا تكفي لحكم شهري قوي.`
          : '',
        'هذه البيانات تقيس الإرشاد والاستشارة داخل المحادثات.',
        'صحة الصنف والتركيز والكمية في الصرف الفعلي لا تُستنتج من المحادثات وحدها؛ تحتاج واقعة صرف موثقة عند وجود خطأ.',
      ].filter(Boolean),
    };
  }

  if (followupKeys.includes(key)) {
    if (health.followups !== 'available') {
      return {
        status: 'unavailable' as const,
        summary: 'مصدر المتابعات غير متاح حاليًا',
        details: ['لا تستخدم قيمة صفر كدليل لأن مصدر المتابعات غير متاح.'],
      };
    }
    const followups = coaching?.followups;
    return {
      status: 'available' as const,
      summary: followups?.total
        ? `${followups.completed}/${followups.total} مكتملة · ${followups.completionPct}%`
        : 'لا توجد متابعات مسجلة لهذه الدورة',
      details: [
        `المتابعات المكتملة: ${metrics.completed_followups}`,
        `إجمالي المتابعات: ${metrics.followup_count}`,
        followups?.open ? `متابعات غير مكتملة: ${followups.open}` : '',
        followups?.total ? `التوثيق الواضح: ${followups.documented}/${followups.total} (${followups.documentedPct}%)` : '',
        followups?.purchaseAfterFollowup ? `شراء بعد المتابعة: ${followups.purchaseAfterFollowup} حالة` : '',
        followups?.needsNextFollowup ? `تحتاج متابعة لاحقة: ${followups.needsNextFollowup} حالة` : '',
      ].filter(Boolean),
    };
  }

  if (key === 'inventory') {
    const inventory = coaching?.inventory;
    if (!inventory || inventory.sourceStatus === 'unavailable') {
      return {
        status: 'manual' as const,
        summary: 'لا يوجد دليل آلي موثوق للمخزون والرواكد في هذه الدورة',
        details: [
          'استخدم واقعة موثقة من الجرد أو الرواكد أو النواقص بدل الانطباع العام.',
          ...(inventory?.notes || []),
        ],
      };
    }

    const weekly = inventory.weekly;
    const stagnant = inventory.stagnant;
    const summaryParts = [
      weekly.measuredWeeks > 0
        ? `الجرد: ${weekly.completedWeeks} أسبوع مكتمل من ${weekly.measuredWeeks} قابل للقياس`
        : '',
      stagnant.assignedItems > 0
        ? `الرواكد: ${stagnant.movedQuantity} وحدة مصروفة من ${stagnant.assignedItems} صنف مسند`
        : '',
    ].filter(Boolean);

    return {
      status: inventory.sourceStatus === 'available' ? 'available' as const : 'manual' as const,
      summary: summaryParts.join(' · ') || 'لا توجد مسؤوليات مخزون أو رواكد قابلة للقياس لهذه الدورة',
      details: [
        weekly.totalItems > 0 ? `أصناف الجرد: ${weekly.countedItems}/${weekly.totalItems} تم عدّها` : '',
        weekly.behindWeeks > 0 ? `أسابيع متأخرة عن الخطة: ${weekly.behindWeeks}` : '',
        weekly.aheadWeeks > 0 ? `أسابيع سابقة للخطة: ${weekly.aheadWeeks}` : '',
        weekly.discrepancyItems > 0 ? `فروق جرد مكتشفة: ${weekly.discrepancyItems}` : '',
        weekly.unresolvedDiscrepancies > 0 ? `فروق جرد غير محلولة: ${weekly.unresolvedDiscrepancies}` : '',
        weekly.reviewedDiscrepancies > 0 ? `فروق تمت مراجعتها: ${weekly.reviewedDiscrepancies}` : '',
        weekly.notMeasurableWeeks > 0
          ? `أسابيع غير قابلة للقياس بسبب عدم اكتمال الخطة/القائمة: ${weekly.notMeasurableWeeks} — لا تُحسب تقصيرًا على الموظف.`
          : '',
        stagnant.assignedItems > 0 ? `أصناف رواكد مسندة للموظف: ${stagnant.assignedItems}` : '',
        stagnant.movementRecords > 0 ? `حركات صرف راكد خلال الدورة: ${stagnant.movementRecords} · الكمية ${stagnant.movedQuantity}` : '',
        stagnant.configuredTargets > 0
          ? `أهداف رواكد مهيأة: ${stagnant.achievedTargets}/${stagnant.configuredTargets}${stagnant.targetAchievementPct !== null ? ` (${stagnant.targetAchievementPct}%)` : ''}`
          : '',
        ...inventory.notes,
        'المصدر: Inventory Weekly Progress + سجلات صرف الرواكد المرتبطة بالموظف نفسه.',
        'راكد الفرع غير المسند لهذا الموظف لا يُستخدم ضده في التقييم.',
      ].filter(Boolean),
    };
  }

  if (key === 'sales_quality') {
    const invoiceSource = pointsTruth?.source_breakdown?.find((source) => source.source === 'invoice_quality_vs_branch_baseline');
    return invoiceSource
      ? {
          status: 'available' as const,
          summary: `${invoiceSource.events} حدث جودة فاتورة · ${formatSignedPoints(invoiceSource.points)} نقطة`,
          details: [
            `عدد أحداث جودة الفاتورة: ${invoiceSource.events}`,
            `صافي النقاط: ${formatSignedPoints(invoiceSource.points)}`,
            'المصدر: Points Truth.',
          ],
        }
      : {
          status: 'manual' as const,
          summary: 'لا يوجد ملخص آلي مباشر لجودة الفاتورة في Points Truth لهذه الدورة',
          details: ['استخدم واقعة فاتورة موثقة أو مراجعة تشغيلية واضحة عند التقييم.'],
        };
  }

  return {
    status: 'manual' as const,
    summary: 'لا يوجد قياس آلي مباشر لهذا المحور في مصادر V5 الحالية',
    details: ['قيّم هذا المحور من واقعة موثقة أو ملاحظة تشغيلية واضحة، وليس من الانطباع العام فقط.'],
  };
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
  const [staffStatusFilter, setStaffStatusFilter] = useState<'all' | 'not_started' | 'draft' | 'approved' | 'needs_reapproval'>('all');
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
  const [coaching, setCoaching] = useState<EmployeeMonthlyEvidence['coaching'] | null>(null);
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
  const evaluationComplete = sections.length > 0 && sections.every((item) => item.score > 0);
  const grade = evaluationNotStarted ? 'لسه ما اتقيّمش' : evaluationComplete ? gradeFor(overallScore) : 'غير مكتمل';
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
  const effectiveEvaluationMultiplierPct = evaluationComplete
    ? Math.min(overallScore, activeGateCapPercent)
    : null;

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
          supabase.rpc('get_staff_monthly_evaluation_v5', {
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
        setCoaching(evidenceResult.coaching);
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
    if (nextStatus === 'sent' && sections.some((item) => item.score >= 4) && !strengthsText.trim()) {
      toast.error('اكتب نقطة قوة واحدة على الأقل تعكس الأداء القوي قبل الاعتماد.');
      return;
    }
    if (nextStatus === 'sent' && sections.some((item) => item.score > 0 && item.score <= 3) && !developmentText.trim()) {
      toast.error('اكتب خطة تطوير واضحة للمحاور التي تحتاج تحسين قبل الاعتماد.');
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
          coaching_snapshot: coaching,
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
        try {
          await createStaffNotification({
            recipientStaffId: selected.id,
            type: 'monthly_evaluation_ready',
            title: 'تم اعتماد تقييمك الشهري',
            message: `تم اعتماد تقييم دورة ${cycleRange.displayLabel} بدرجة ${Number(saveResult.overall_score ?? overallScore)}/100. يمكنك مراجعة التفاصيل من صفحة التقييم الشهري.`,
            priority: 'normal',
            entityType: 'staff_monthly_evaluation',
            entityId: savedEvaluationId || undefined,
            actionUrl: '/staff-monthly-evaluation',
            metadata: {
              cycleLabel,
              overallScore: Number(saveResult.overall_score ?? overallScore),
              grade: String(saveResult.grade || grade),
              evaluatorName: user.name || 'المدير',
              hasStrengths: strengths.length > 0,
              hasDevelopmentPlan: developmentPoints.length > 0,
            },
            stateKey: serverSentAt || String(saveResult.action || 'approved'),
          });
        } catch {
          toast.warning('تم اعتماد التقييم، لكن تعذر إنشاء إشعار الموظف. التقييم نفسه محفوظ ومعتمد.');
        }
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

  const filteredStaff = staff.filter((item) => {
    const matchesSearch = item.name.includes(search);
    const matchesStatus = staffStatusFilter === 'all'
      || (staffStatusFilter === 'not_started' && (!item.evaluation_status || item.evaluation_status === 'not_started'))
      || (staffStatusFilter === 'draft' && item.evaluation_status === 'draft')
      || (staffStatusFilter === 'approved' && ['sent', 'approved'].includes(String(item.evaluation_status || '')))
      || (staffStatusFilter === 'needs_reapproval' && item.evaluation_status === 'needs_reapproval');
    return matchesSearch && matchesStatus;
  });
  const completedSections = sections.filter((item) => item.score > 0).length;
  const weakSectionsMissingNotes = sections.filter((item) => item.score > 0 && item.score <= 2 && !item.notes.trim());
  const criticalGateMissingReason = activeGates.length > 0 && !managerNotes.trim();
  const hasStrongPerformance = sections.some((item) => item.score >= 4);
  const hasDevelopmentNeed = sections.some((item) => item.score > 0 && item.score <= 3);
  const feedbackMissingStrength = evaluationComplete && hasStrongPerformance && !strengthsText.trim();
  const feedbackMissingDevelopment = evaluationComplete && hasDevelopmentNeed && !developmentText.trim();
  const approvalBlockers = [
    !cycleClosed ? 'الدورة لم تُقفل بعد' : '',
    !evidenceReady ? 'مصدر أو أكثر من أدلة الدورة غير متاح' : '',
    completedSections !== sections.length ? `باقي ${Math.max(0, sections.length - completedSections)} محور بدون تقييم` : '',
    weakSectionsMissingNotes.length ? `${weakSectionsMissingNotes.length} محور بدرجة ضعيفة يحتاج سبب مكتوب` : '',
    feedbackMissingStrength ? 'يوجد أداء قوي لكن نقاط القوة لم تُكتب بعد' : '',
    feedbackMissingDevelopment ? 'يوجد محور يحتاج تطوير لكن خطة التطوير لم تُكتب بعد' : '',
    criticalGateMissingReason ? 'المخالفة الحرجة تحتاج سببًا مكتوبًا في ملاحظات المدير' : '',
  ].filter(Boolean);
  const approvalReady =
    cycleClosed
    && evidenceReady
    && sections.length > 0
    && completedSections === sections.length
    && weakSectionsMissingNotes.length === 0
    && !feedbackMissingStrength
    && !feedbackMissingDevelopment
    && !criticalGateMissingReason;
  const ratedSections = sections.filter((item) => item.score > 0);
  const ratedWeight = ratedSections.reduce((sum, item) => sum + item.weight, 0);
  const ratedEarnedPoints = Math.round(ratedSections.reduce((sum, item) => sum + sectionPoints(item), 0) * 10) / 10;
  const strongestSections = evaluationComplete
    ? [...ratedSections]
        .filter((item) => item.score >= 4)
        .sort((a, b) => b.score - a.score || b.weight - a.weight)
        .slice(0, 3)
    : [];
  const developmentSections = evaluationComplete
    ? [...ratedSections]
        .filter((item) => item.score <= 3)
        .sort((a, b) => a.score - b.score || b.weight - a.weight)
        .slice(0, 3)
    : [];

  const incompleteActionLabel = !cycleClosed
    ? 'راجع حالة الدورة'
    : !evidenceReady
      ? 'راجع مصادر البيانات'
      : completedSections !== sections.length || weakSectionsMissingNotes.length
        ? 'أكمل التقييم'
        : feedbackMissingStrength || feedbackMissingDevelopment || criticalGateMissingReason
          ? 'أكمل الخلاصة'
          : 'راجع التقييم';

  function continueIncompleteEvaluation() {
    if (!cycleClosed || !evidenceReady) {
      setActiveStep(1);
      return;
    }
    if (completedSections !== sections.length || weakSectionsMissingNotes.length) {
      const targetKey = weakSectionsMissingNotes[0]?.key || sections.find((item) => item.score === 0)?.key;
      setActiveStep(2);
      if (targetKey && typeof window !== 'undefined') {
        window.setTimeout(() => {
          document.getElementById(`evaluation-section-${targetKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 60);
      }
      return;
    }
    if (feedbackMissingStrength || feedbackMissingDevelopment || criticalGateMissingReason) {
      setActiveStep(4);
      return;
    }
    setActiveStep(5);
  }

  // الرقم المالي المعروض يأتي فقط من الحقيقة المالية على الخادم أو من كشف مقفول.
  // لا نحسب مبلغًا نهائيًا داخل صفحة التقييم.
  const canonicalIncentive = settledStatement
    ? Number(settledStatement.incentive_amount)
    : pointsTruth?.final_incentive_egp == null
      ? null
      : Number(pointsTruth.final_incentive_egp);

  return (
    <div className="min-h-screen space-y-4 p-4" dir="rtl" style={{ background: 'var(--dawaa-theme-bg)' }}>
      <Panel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--dawaa-theme-accent-soft)', color: 'var(--dawaa-theme-primary-strong)' }}>
              <UserCheck size={20} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                التقييم الشهري
              </h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                <span>{cycleRange.displayLabel}</span>
                <span>·</span>
                <span>{branch}</span>
                {selected ? (
                  <>
                    <span>·</span>
                    <span>{selected.name}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full border px-3 py-1 text-xs font-black"
              style={cycleClosed
                ? { borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-status-success-bg)', color: 'var(--dawaa-status-success-text)' }
                : { borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)', color: 'var(--dawaa-status-warning-text)' }}
            >
              {cycleClosed ? 'دورة مكتملة' : 'دورة جارية'}
            </span>

            <div className="flex overflow-hidden rounded-xl border" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
              <button
                type="button"
                onClick={() => setCycleLabel(latestClosedCycleLabel)}
                className="px-3 py-2 text-[11px] font-black"
                style={cycleLabel === latestClosedCycleLabel
                  ? { background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' }
                  : { color: 'var(--dawaa-theme-muted)' }}
              >
                المكتملة
              </button>
              <button
                type="button"
                onClick={() => setCycleLabel(activeCycleLabel)}
                className="px-3 py-2 text-[11px] font-black"
                style={cycleLabel === activeCycleLabel
                  ? { background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' }
                  : { color: 'var(--dawaa-theme-muted)' }}
              >
                الجارية
              </button>
            </div>

            {globalScope ? (
              <select
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                className="rounded-xl border px-3 py-2 text-xs font-black"
                style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }}
              >
                <option>فرع الشامي</option>
                <option>فرع شكري</option>
              </select>
            ) : null}
          </div>
        </div>

        {!cycleClosed || requiresPostCycleReapproval ? (
          <div
            className="mt-3 rounded-xl border px-3 py-2 text-xs font-bold"
            style={{ borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)', color: 'var(--dawaa-status-warning-text)' }}
          >
            {!cycleClosed
              ? 'الدورة ما زالت جارية: الحفظ كمسودة متاح، والاعتماد النهائي بعد يوم 25.'
              : 'هذا التقييم يحتاج إعادة اعتماد بعد اكتمال الدورة.'}
          </div>
        ) : null}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-3xl border p-3 xl:sticky xl:top-4 xl:h-fit" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}>
          <button
            type="button"
            onClick={() => setSidebarOpen((value) => !value)}
            className="flex w-full items-center justify-between gap-2 text-sm font-black xl:hidden"
            style={{ color: 'var(--dawaa-theme-heading)' }}
          >
            <span>{selected ? selected.name : 'اختيار الموظف'}</span>
            <ChevronDown className={sidebarOpen ? 'rotate-180 transition-transform' : 'transition-transform'} size={16} />
          </button>

          <div className={`${sidebarOpen ? 'block' : 'hidden'} xl:block`}>
            <div className="mb-2 hidden items-center justify-between xl:flex">
              <div className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>الموظفون</div>
              <div className="text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{filteredStaff.length} موظف</div>
            </div>

            <div className="relative mt-3 xl:mt-0">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--dawaa-theme-muted)' }} size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث بالاسم"
                className="w-full rounded-xl border py-2 pr-9 pl-3 text-sm font-bold"
                style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }}
              />
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {([
                ['all', 'الكل'],
                ['not_started', 'لم يبدأ'],
                ['draft', 'مسودة'],
                ['approved', 'معتمد'],
                ['needs_reapproval', 'إعادة اعتماد'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStaffStatusFilter(value)}
                  className="shrink-0 rounded-lg border px-2 py-1 text-[10px] font-black"
                  style={staffStatusFilter === value
                    ? { borderColor: 'var(--dawaa-theme-accent-border)', background: 'var(--dawaa-theme-accent-soft)', color: 'var(--dawaa-theme-primary-strong)' }
                    : { borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-2 max-h-[72vh] space-y-1.5 overflow-y-auto">
              {filteredStaff.map((item) => {
                const statusLabel = item.evaluation_status === 'needs_reapproval'
                  ? 'إعادة اعتماد'
                  : ['sent', 'approved'].includes(String(item.evaluation_status || ''))
                    ? 'معتمد'
                    : item.evaluation_status === 'draft'
                      ? 'مسودة'
                      : 'لم يبدأ';
                const statusColor = item.evaluation_status === 'needs_reapproval'
                  ? 'var(--dawaa-status-danger-text)'
                  : ['sent', 'approved'].includes(String(item.evaluation_status || ''))
                    ? 'var(--dawaa-status-success-text)'
                    : item.evaluation_status === 'draft'
                      ? 'var(--dawaa-status-warning-text)'
                      : 'var(--dawaa-theme-muted)';

                return (
                  <button
                    key={item.id}
                    onClick={() => { setSelectedId(item.id); setSidebarOpen(false); }}
                    className="w-full rounded-xl border px-3 py-2.5 text-right transition"
                    style={selectedId === item.id
                      ? { borderColor: 'var(--dawaa-theme-accent-border)', background: 'var(--dawaa-theme-accent-soft)' }
                      : { borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusColor }} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{item.name}</div>
                        <div className="mt-0.5 truncate text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                          {item.role}
                          {item.evaluation_score != null ? ` · ${item.evaluation_score}/100` : ''}
                        </div>
                      </div>
                      <span className="shrink-0 text-[10px] font-black" style={{ color: statusColor }}>{statusLabel}</span>
                    </div>
                  </button>
                );
              })}
              {!filteredStaff.length ? (
                <div className="rounded-xl border border-dashed p-4 text-center text-xs font-bold" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }}>
                  لا يوجد موظف مطابق للبحث.
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        <main className="space-y-4">
          {loading ? (
            <Panel className="p-10 text-center"><Loader2 className="mx-auto animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /> <span style={{ color: 'var(--dawaa-theme-muted)' }}>جاري التحميل...</span></Panel>
          ) : selected ? (
            <>
              <div
                className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold"
                style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-muted)' }}
              >
                <span className="font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>
                  {selected.job_title || selected.role || 'غير محدد'}
                </span>
                <span>·</span>
                <span>{profile.label}</span>
                <span className="hidden md:inline">· {profile.mission}</span>
              </div>

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
              />

              {activeStep === 1 ? (
                <>
                  <Panel className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>جاهزية بيانات الدورة</div>
                        <div className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                          {evidenceReady ? 'كل مصادر التقييم الأساسية متاحة.' : 'يوجد مصدر ناقص ويجب مراجعته قبل الاعتماد.'}
                        </div>
                      </div>
                      <span
                        className="rounded-full border px-3 py-1 text-xs font-black"
                        style={evidenceReady
                          ? { borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-status-success-bg)', color: 'var(--dawaa-status-success-text)' }
                          : { borderColor: 'var(--dawaa-status-danger-border)', background: 'var(--dawaa-status-danger-bg)', color: 'var(--dawaa-status-danger-text)' }}
                      >
                        {evidenceReady ? 'جاهزة' : 'تحتاج مراجعة'}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <MiniBox
                        label="النقاط الفعلية"
                        value={settledStatement ? `${settledStatement.points_closing} نقطة` : pointsTruth ? `${pointsTruth.final_points} نقطة` : '—'}
                        tone="cyan"
                      />
                      <MiniBox
                        label="هدف النقاط المسجل"
                        value={pointsTruth?.target_points ? `${pointsTruth.target_points} نقطة` : 'غير محدد'}
                        tone="amber"
                      />
                      <MiniBox
                        label="حافز الأداء المركزي"
                        value={canonicalIncentive == null ? 'غير محدد' : `${canonicalIncentive.toLocaleString('ar-EG')} جنيه`}
                        tone={canonicalIncentive == null ? 'amber' : 'green'}
                      />
                    </div>
                  </Panel>

                  {!settledStatement && pointsTruth && cycleLabel !== currentEvaluationCycleLabel() ? (
                    <Panel className="p-3" style={{ background: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' }}>
                      <p className="text-xs font-bold" style={{ color: 'var(--dawaa-status-warning-text)' }}>
                        الدورة انتهت، لكن كشف الحافز المالي لم يُعتمد نهائيًا بعد؛ المبلغ المعروض قراءة حية من Points Truth.
                      </p>
                    </Panel>
                  ) : null}

                  {!pointsTruth?.profile_configured ? (
                    <Panel className="p-3" style={{ background: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' }}>
                      <p className="text-xs font-bold" style={{ color: 'var(--dawaa-status-warning-text)' }}>
                        الملف المالي غير مكتمل، لذلك لا نعرض مبلغًا ماليًا غير موثوق.
                      </p>
                    </Panel>
                  ) : null}
                </>
              ) : null}

              {activeStep === 3 ? (
                <Panel className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>المخالفات الحرجة</div>
                      <div className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                        فعّل فقط المخالفة المؤكدة لأنها تؤثر مباشرة على سقف الحافز.
                      </div>
                    </div>
                    <span
                      className="rounded-full border px-3 py-1 text-xs font-black"
                      style={isGatedByCriticalViolation
                        ? { borderColor: 'var(--dawaa-status-danger-border)', background: 'var(--dawaa-status-danger-bg)', color: 'var(--dawaa-status-danger-text)' }
                        : { borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-status-success-bg)', color: 'var(--dawaa-status-success-text)' }}
                    >
                      {isGatedByCriticalViolation ? `${activeGates.length} مفعلة` : 'لا توجد مخالفة'}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {(Object.entries(CRITICAL_GATE_CAPS) as [CriticalGateType, typeof CRITICAL_GATE_CAPS[CriticalGateType]][]).map(([key, gate]) => {
                      const active = activeGates.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => toggleGate(key)}
                          className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-right text-xs font-black disabled:cursor-default"
                          style={active
                            ? { borderColor: 'var(--dawaa-status-danger-border)', background: 'var(--dawaa-status-danger-bg)', color: 'var(--dawaa-status-danger-text)' }
                            : { borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }}
                        >
                          <span>{gate.label}</span>
                          <span>{active ? (gate.blocksFully ? 'إيقاف الحافز' : `سقف ${gate.capPercent}%`) : 'غير مفعلة'}</span>
                        </button>
                      );
                    })}
                  </div>

                  {isGatedByCriticalViolation ? (
                    <div className="mt-3 rounded-xl border px-3 py-2 text-xs font-black" style={{ borderColor: 'var(--dawaa-status-danger-border)', background: 'var(--dawaa-status-danger-bg)', color: 'var(--dawaa-status-danger-text)' }}>
                      {effectiveEvaluationMultiplierPct == null
                        ? 'السقف الفعلي يظهر بعد اكتمال كل محاور التقييم.'
                        : `السقف الفعلي للحافز: ${effectiveEvaluationMultiplierPct}%`}
                    </div>
                  ) : null}
                </Panel>
              ) : null}

              {activeStep === 1 ? (
                <Panel className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>مصادر التقييم</div>
                      <div className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                        راجع فقط إن المصادر الأساسية جاهزة قبل بدء التقييم.
                      </div>
                    </div>
                    <span className="text-xs font-black" style={{ color: evidenceReady ? 'var(--dawaa-status-success-text)' : 'var(--dawaa-status-danger-text)' }}>
                      {evidenceReady ? '3/3 جاهزة' : 'يوجد مصدر ناقص'}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {([
                      ['المحادثات', evidenceHealth.reviews],
                      ['المتابعات', evidenceHealth.followups],
                      ['الحضور', evidenceHealth.attendance],
                    ] as const).map(([label, sourceStatus]) => {
                      const available = sourceStatus === 'available';
                      return (
                        <div
                          key={label}
                          className="flex items-center justify-between rounded-xl border px-3 py-2.5"
                          style={available
                            ? { borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-status-success-bg)' }
                            : { borderColor: 'var(--dawaa-status-danger-border)', background: 'var(--dawaa-status-danger-bg)' }}
                        >
                          <span className="text-xs font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{label}</span>
                          <span className="text-[11px] font-black" style={{ color: available ? 'var(--dawaa-status-success-text)' : 'var(--dawaa-status-danger-text)' }}>
                            {available ? 'جاهز' : 'غير متاح'}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {!evidenceReady && Object.keys(evidenceErrors).length ? (
                    <div className="mt-3 rounded-xl border p-2.5 text-xs font-bold" style={{ borderColor: 'var(--dawaa-status-danger-border)', background: 'var(--dawaa-status-danger-bg)', color: 'var(--dawaa-status-danger-text)' }}>
                      الاعتماد النهائي متوقف حتى يعود المصدر الناقص.
                    </div>
                  ) : null}
                </Panel>
              ) : null}

              {activeStep === 3 ? (
                <Panel className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>ملخص النقاط</div>
                      <div className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                        الزيادات والخصومات المسجلة فعليًا خلال الدورة.
                      </div>
                    </div>
                    <span className="text-xs font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>
                      {pointsTruth ? `${pointsTruth.final_points} نقطة` : '—'}
                    </span>
                  </div>

                  {pointsTruth?.source_breakdown?.length ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {pointsTruth.source_breakdown.map((source) => (
                        <details
                          key={source.source}
                          className="rounded-xl border p-3"
                          style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}
                        >
                          <summary className="cursor-pointer list-none">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                                {pointSourceLabel(source.source)}
                              </span>
                              <span className="text-sm font-black" style={{ color: source.points < 0 ? 'var(--dawaa-status-warning-text)' : 'var(--dawaa-theme-primary-strong)' }}>
                                {formatSignedPoints(source.points)} نقطة
                              </span>
                            </div>
                            <div className="mt-1 text-[10px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                              {source.events} حدث · عرض التفاصيل
                            </div>
                          </summary>
                          <div className="mt-2 space-y-1 border-t pt-2 text-[11px] font-bold" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }}>
                            <div>عدد الأحداث: {source.events}</div>
                            <div>صافي النقاط: {formatSignedPoints(source.points)}</div>
                            <div>المصدر التقني: <code>{source.source}</code></div>
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                      لا توجد حركات نقاط مسجلة لهذه الدورة.
                    </div>
                  )}
                </Panel>
              ) : null}

              {activeStep === 2 ? (
                <section className="space-y-2">
                  {sections.map((item) => {
                    const earned = sectionPoints(item);
                    const selectedRubric = item.score > 0 && item.rubric ? item.rubric[item.score - 1] : null;
                    const weakNeedsNote = item.score > 0 && item.score <= 2 && !item.notes.trim();
                    const sectionEvidence = sectionEvidenceFor(item.key, metrics, evidenceHealth, pointsTruth, coaching);
                    const conversationEvidence = isConversationSectionKey(item.key) ? coaching?.conversation : null;

                    return (
                      <Panel id={`evaluation-section-${item.key}`} key={item.key} className="p-3">
                        <div className="flex flex-wrap items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{item.title}</h3>
                              <span className="text-[10px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>{item.weight} نقطة</span>
                            </div>
                            <p className="mt-1 text-[11px] leading-5" style={{ color: 'var(--dawaa-theme-muted)' }}>{item.description}</p>
                            <details
                              className="mt-2 rounded-lg border px-2.5 py-2"
                              style={{
                                borderColor: sectionEvidence.status === 'unavailable'
                                  ? 'var(--dawaa-status-danger-border)'
                                  : 'var(--dawaa-theme-border)',
                                background: sectionEvidence.status === 'unavailable'
                                  ? 'var(--dawaa-status-danger-bg)'
                                  : 'var(--dawaa-theme-soft)',
                              }}
                            >
                              <summary
                                className="cursor-pointer text-[11px] font-black"
                                style={{ color: sectionEvidence.status === 'unavailable' ? 'var(--dawaa-status-danger-text)' : 'var(--dawaa-theme-text)' }}
                              >
                                الدليل المتاح: {sectionEvidence.summary}
                                <span className="ms-1" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>· عرض الدليل</span>
                              </summary>
                              <div className="mt-2 space-y-1 text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                                {sectionEvidence.details.map((detail) => <div key={detail}>• {detail}</div>)}
                                <div>• الدليل الآلي مساعد للقرار وليس درجة تلقائية.</div>
                                {conversationEvidence?.examples.length ? (
                                  <div className="mt-2 border-t pt-2" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                                    <div className="mb-1 font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>أمثلة موثقة تحتاج مراجعة</div>
                                    <div className="space-y-1.5">
                                      {conversationEvidence.examples.map((example) => (
                                        <a
                                          key={example.id}
                                          href={`/reviews?section=history&id=${encodeURIComponent(example.id)}`}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="block rounded-md border px-2 py-1.5 transition hover:opacity-90"
                                          style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }}
                                        >
                                          <span className="font-black">{example.date || 'بدون تاريخ'} · {example.score}/100</span>
                                          {example.negativeReason ? <span> · {example.negativeReason}</span> : null}
                                          <span className="ms-1" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>فتح التقييم ↗</span>
                                        </a>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </details>
                          </div>

                          <div className="shrink-0">
                            <div className="flex gap-0.5">
                              {[1, 2, 3, 4, 5].map((score) => (
                                <button
                                  type="button"
                                  aria-label={`اختيار ${score} نجوم`}
                                  disabled={!canEdit}
                                  key={score}
                                  onClick={() => updateSection(item.key, { score })}
                                  className="rounded-md p-0.5 transition disabled:cursor-default"
                                >
                                  <Star
                                    className={score <= item.score ? 'fill-current' : ''}
                                    style={{ color: score <= item.score ? 'var(--dawaa-status-warning-text)' : 'var(--dawaa-theme-border)' }}
                                    size={22}
                                  />
                                </button>
                              ))}
                            </div>
                            <div className="mt-1 text-left text-[10px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>
                              {item.score ? `${earned}/${item.weight}` : 'بدون تقييم'}
                            </div>
                          </div>
                        </div>

                        {item.score ? (
                          <div
                            className="mt-2 rounded-lg border px-2.5 py-2 text-xs font-bold"
                            style={{
                              borderColor: weakNeedsNote ? 'var(--dawaa-status-danger-border)' : 'var(--dawaa-theme-border)',
                              background: weakNeedsNote ? 'var(--dawaa-status-danger-bg)' : 'var(--dawaa-theme-soft)',
                              color: weakNeedsNote ? 'var(--dawaa-status-danger-text)' : 'var(--dawaa-theme-text)',
                            }}
                          >
                            <span className="font-black">{item.score}/5 — {starMeaning(item.score)}</span>
                            {selectedRubric ? <span> · {selectedRubric}</span> : null}
                          </div>
                        ) : null}

                        <textarea
                          disabled={!canEdit}
                          value={item.notes}
                          onChange={(event) => updateSection(item.key, { notes: event.target.value })}
                          rows={1}
                          placeholder={item.score > 0 && item.score <= 2 ? 'مطلوب سبب واضح للدرجة الضعيفة' : 'ملاحظة اختيارية'}
                          className="mt-2 w-full rounded-lg border px-2.5 py-2 text-xs disabled:opacity-70"
                          style={{
                            borderColor: weakNeedsNote ? 'var(--dawaa-status-danger-border)' : 'var(--dawaa-theme-border)',
                            background: weakNeedsNote ? 'var(--dawaa-status-danger-bg)' : 'var(--dawaa-theme-surface)',
                            color: 'var(--dawaa-theme-text)',
                          }}
                        />
                      </Panel>
                    );
                  })}
                </section>
              ) : null}

              {activeStep === 4 ? (
                <Panel className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>الخلاصة والتطوير</div>
                      <div className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                        {evaluationComplete
                          ? 'استخدم الاقتراحات الجاهزة ثم عدّل النص باختصار.'
                          : 'أكمل كل محاور التقييم أولًا حتى لا تُبنى الخلاصة على جزء من البيانات.'}
                      </div>
                    </div>
                  </div>

                  {!evaluationComplete ? (
                    <div className="mt-3 rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)', color: 'var(--dawaa-status-warning-text)' }}>
                      الخلاصة الآلية مؤجلة حتى اكتمال {sections.length} محاور. يمكنك كتابة ملاحظة يدوية، لكن اقتراحات القوة والتطوير لن تظهر قبل اكتمال التقييم.
                    </div>
                  ) : null}

                  {coaching?.conversation.reviewCount ? (
                    <div className="mt-3 rounded-2xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)' }}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>Coaching مبني على أدلة المحادثات</div>
                          <div className="mt-1 text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                            {coaching.conversation.reviewCount} مراجعة في نفس الدورة · الحد الأدنى للاستنتاج {coaching.conversation.minSamples}
                          </div>
                        </div>
                        <span
                          className="rounded-full border px-2.5 py-1 text-[10px] font-black"
                          style={coaching.conversation.sampleSufficient
                            ? { borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)' }
                            : { borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)' }}
                        >
                          {coaching.conversation.sampleSufficient ? 'عينة كافية' : 'عينة غير كافية للحكم'}
                        </span>
                      </div>

                      {coaching.conversation.sampleSufficient ? (
                        <div className="mt-3 grid gap-2 lg:grid-cols-2">
                          <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-theme-surface)' }}>
                            <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>المميزات المثبتة</div>
                            <div className="mt-1 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>
                              {coaching.conversation.drafts.strength || 'لا توجد نقطة قوة متكررة كفاية لإضافتها تلقائيًا.'}
                            </div>
                            {coaching.conversation.drafts.strength ? (
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => setStrengthsText((current) => appendUniqueLine(current, coaching.conversation.drafts.strength))}
                                className="mt-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-black disabled:cursor-default"
                                style={{ borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)' }}
                              >
                                إضافة لنقاط القوة
                              </button>
                            ) : null}
                          </div>

                          <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-theme-surface)' }}>
                            <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>أولوية التطوير</div>
                            <div className="mt-1 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>
                              {coaching.conversation.drafts.development || 'لا توجد نقطة ضعف متكررة كفاية لإضافتها تلقائيًا.'}
                            </div>
                            {coaching.conversation.drafts.development ? (
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => setDevelopmentText((current) => appendUniqueLine(current, coaching.conversation.drafts.development))}
                                className="mt-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-black disabled:cursor-default"
                                style={{ borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)' }}
                              >
                                إضافة لخطة التطوير
                              </button>
                            ) : null}
                          </div>

                          {coaching.conversation.drafts.actionPlan ? (
                            <div className="rounded-xl border p-3 lg:col-span-2" style={{ borderColor: 'var(--dawaa-status-info-border)', background: 'var(--dawaa-theme-surface)' }}>
                              <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-status-info-text)' }}>خطة عمل قابلة للقياس</div>
                              <div className="mt-1 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>
                                {coaching.conversation.drafts.actionPlan}
                                {coaching.conversation.drafts.measurement ? ` ${coaching.conversation.drafts.measurement}` : ''}
                              </div>
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => setDevelopmentText((current) => appendUniqueLine(
                                  appendUniqueLine(current, coaching.conversation.drafts.actionPlan),
                                  coaching.conversation.drafts.measurement
                                ))}
                                className="mt-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-black disabled:cursor-default"
                                style={{ borderColor: 'var(--dawaa-status-info-border)', color: 'var(--dawaa-status-info-text)' }}
                              >
                                إضافة الخطة ومقياس التحسن
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="mt-3 rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)' }}>
                          لن نستنتج مميزات أو عيوب من {coaching.conversation.reviewCount} مراجعة فقط. يمكن للمدير قراءة الحالات، لكن لا تُستخدم كحكم شهري قوي.
                        </div>
                      )}
                    </div>
                  ) : null}

                  {(coaching?.attendance.approvedEvents || coaching?.followups.total) ? (
                    <div className="mt-3 grid gap-2 lg:grid-cols-2">
                      {coaching?.attendance.approvedEvents ? (
                        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}>
                          <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>Coaching الحضور المعتمد</div>
                          <div className="mt-2 space-y-1.5 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>
                            {coaching.attendance.drafts.strength ? <div style={{ color: 'var(--dawaa-status-success-text)' }}>{coaching.attendance.drafts.strength}</div> : null}
                            {coaching.attendance.drafts.development ? <div style={{ color: 'var(--dawaa-status-warning-text)' }}>{coaching.attendance.drafts.development}</div> : null}
                            {coaching.attendance.drafts.actionPlan ? <div>{coaching.attendance.drafts.actionPlan}</div> : null}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {coaching.attendance.drafts.strength ? (
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => setStrengthsText((current) => appendUniqueLine(current, coaching.attendance.drafts.strength))}
                                className="rounded-lg border px-2 py-1 text-[10px] font-black disabled:cursor-default"
                                style={{ borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)' }}
                              >
                                إضافة القوة
                              </button>
                            ) : null}
                            {coaching.attendance.drafts.development || coaching.attendance.drafts.actionPlan ? (
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => setDevelopmentText((current) => appendUniqueLine(
                                  appendUniqueLine(current, coaching.attendance.drafts.development),
                                  coaching.attendance.drafts.actionPlan
                                ))}
                                className="rounded-lg border px-2 py-1 text-[10px] font-black disabled:cursor-default"
                                style={{ borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)' }}
                              >
                                إضافة التطوير
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {coaching?.followups.total ? (
                        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}>
                          <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>Coaching المتابعات</div>
                          <div className="mt-1 text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                            {coaching.followups.completed}/{coaching.followups.total} مكتملة · توثيق {coaching.followups.documentedPct}%
                          </div>
                          <div className="mt-2 space-y-1.5 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>
                            {coaching.followups.drafts.strength ? <div style={{ color: 'var(--dawaa-status-success-text)' }}>{coaching.followups.drafts.strength}</div> : null}
                            {coaching.followups.drafts.development ? <div style={{ color: 'var(--dawaa-status-warning-text)' }}>{coaching.followups.drafts.development}</div> : null}
                            {coaching.followups.drafts.actionPlan ? <div>{coaching.followups.drafts.actionPlan}</div> : null}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {coaching.followups.drafts.strength ? (
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => setStrengthsText((current) => appendUniqueLine(current, coaching.followups.drafts.strength))}
                                className="rounded-lg border px-2 py-1 text-[10px] font-black disabled:cursor-default"
                                style={{ borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)' }}
                              >
                                إضافة القوة
                              </button>
                            ) : null}
                            {coaching.followups.drafts.development || coaching.followups.drafts.actionPlan ? (
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => setDevelopmentText((current) => appendUniqueLine(
                                  appendUniqueLine(current, coaching.followups.drafts.development),
                                  coaching.followups.drafts.actionPlan
                                ))}
                                className="rounded-lg border px-2 py-1 text-[10px] font-black disabled:cursor-default"
                                style={{ borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)' }}
                              >
                                إضافة التطوير
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {coaching?.inventory && (coaching.inventory.weekly.measuredWeeks > 0 || coaching.inventory.stagnant.assignedItems > 0 || coaching.inventory.weekly.notMeasurableWeeks > 0) ? (
                    <div className="mt-3 rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>Coaching المخزون والرواكد</div>
                          <div className="mt-1 text-[10px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                            يعتمد فقط على المسؤوليات المسندة للموظف وسجلات الجرد/الصرف الفعلية.
                          </div>
                        </div>
                        <span
                          className="rounded-full border px-2 py-1 text-[10px] font-black"
                          style={coaching.inventory.sourceStatus === 'available'
                            ? { borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)' }
                            : { borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)' }}
                        >
                          {coaching.inventory.sourceStatus === 'available' ? 'دليل متاح' : 'دليل جزئي'}
                        </span>
                      </div>

                      <div className="mt-2 space-y-1.5 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>
                        {coaching.inventory.drafts.strength ? <div style={{ color: 'var(--dawaa-status-success-text)' }}>{coaching.inventory.drafts.strength}</div> : null}
                        {coaching.inventory.drafts.development ? <div style={{ color: 'var(--dawaa-status-warning-text)' }}>{coaching.inventory.drafts.development}</div> : null}
                        {coaching.inventory.drafts.actionPlan ? <div>{coaching.inventory.drafts.actionPlan}</div> : null}
                        {coaching.inventory.notes.map((note) => <div key={note} style={{ color: 'var(--dawaa-theme-muted)' }}>• {note}</div>)}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {coaching.inventory.drafts.strength ? (
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => setStrengthsText((current) => appendUniqueLine(current, coaching.inventory.drafts.strength))}
                            className="rounded-lg border px-2 py-1 text-[10px] font-black disabled:cursor-default"
                            style={{ borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)' }}
                          >
                            إضافة القوة
                          </button>
                        ) : null}
                        {coaching.inventory.drafts.development || coaching.inventory.drafts.actionPlan ? (
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => setDevelopmentText((current) => appendUniqueLine(
                              appendUniqueLine(current, coaching.inventory.drafts.development),
                              coaching.inventory.drafts.actionPlan
                            ))}
                            className="rounded-lg border px-2 py-1 text-[10px] font-black disabled:cursor-default"
                            style={{ borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)' }}
                          >
                            إضافة التطوير
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div>
                      <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>اقتراحات نقاط القوة</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {strongestSections.length ? strongestSections.map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            disabled={!canEdit}
                            onClick={() => setStrengthsText((current) => appendUniqueLine(current, item.title))}
                            className="rounded-lg border px-2.5 py-1.5 text-[11px] font-black disabled:cursor-default"
                            style={{ borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)', background: 'var(--dawaa-theme-surface)' }}
                          >
                            + {item.title}
                          </button>
                        )) : <span className="text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>لا توجد اقتراحات بعد.</span>}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>اقتراحات التطوير</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {developmentSections.length ? developmentSections.map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            disabled={!canEdit}
                            onClick={() => setDevelopmentText((current) => appendUniqueLine(current, item.title))}
                            className="rounded-lg border px-2.5 py-1.5 text-[11px] font-black disabled:cursor-default"
                            style={{ borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)', background: 'var(--dawaa-theme-surface)' }}
                          >
                            + {item.title}
                          </button>
                        )) : <span className="text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>لا توجد اقتراحات بعد.</span>}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-3">
                    <label className="block">
                      <span className="text-xs font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>نقاط القوة</span>
                      <textarea
                        disabled={!canEdit}
                        rows={4}
                        value={strengthsText}
                        onChange={(event) => setStrengthsText(event.target.value)}
                        placeholder="أهم نقاط القوة"
                        className="mt-2 w-full rounded-xl border p-2.5 text-sm disabled:opacity-70"
                        style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }}
                      />
                    </label>

                    <label className="block">
                      <span className="text-xs font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>خطة التطوير</span>
                      <textarea
                        disabled={!canEdit}
                        rows={4}
                        value={developmentText}
                        onChange={(event) => setDevelopmentText(event.target.value)}
                        placeholder="خطوات تطوير محددة"
                        className="mt-2 w-full rounded-xl border p-2.5 text-sm disabled:opacity-70"
                        style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }}
                      />
                    </label>

                    <label className="block">
                      <span className="text-xs font-black" style={{ color: criticalGateMissingReason ? 'var(--dawaa-status-danger-text)' : 'var(--dawaa-theme-primary-strong)' }}>
                        ملاحظات المدير
                      </span>
                      <textarea
                        disabled={!canEdit}
                        rows={4}
                        value={managerNotes}
                        onChange={(event) => setManagerNotes(event.target.value)}
                        placeholder={activeGates.length ? 'مطلوب سبب واضح للمخالفة الحرجة' : 'ملاحظة ختامية مختصرة'}
                        className="mt-2 w-full rounded-xl border p-2.5 text-sm disabled:opacity-70"
                        style={{
                          borderColor: criticalGateMissingReason ? 'var(--dawaa-status-danger-border)' : 'var(--dawaa-theme-border)',
                          background: criticalGateMissingReason ? 'var(--dawaa-status-danger-bg)' : 'var(--dawaa-theme-surface)',
                          color: 'var(--dawaa-theme-text)',
                        }}
                      />
                      {criticalGateMissingReason ? (
                        <span className="mt-1 block text-[11px] font-black" style={{ color: 'var(--dawaa-status-danger-text)' }}>
                          سبب المخالفة مطلوب قبل الاعتماد.
                        </span>
                      ) : null}
                    </label>
                  </div>
                </Panel>
              ) : null}

              {activeStep === 5 ? (
                <section className="space-y-3">
                  <Panel className="p-4" style={approvalReady
                    ? { background: 'var(--dawaa-status-success-bg)', borderColor: 'var(--dawaa-status-success-border)' }
                    : { background: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-black" style={{ color: approvalReady ? 'var(--dawaa-status-success-text)' : 'var(--dawaa-status-warning-text)' }}>
                          {approvalReady ? 'جاهز للاعتماد' : 'غير جاهز للاعتماد'}
                        </h3>
                        <div className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                          {requiresPostCycleReapproval ? 'اعتماد سابق يحتاج مراجعة بعد إقفال الدورة' : status === 'sent' ? 'التقييم معتمد ومُرسل' : 'التقييم ما زال مسودة'}
                        </div>
                      </div>
                      <span
                        className="rounded-full border px-3 py-1 text-xs font-black"
                        style={approvalReady
                          ? { borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-status-success-text)' }
                          : { borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-status-warning-text)' }}
                      >
                        {approvalReady ? 'جاهز' : `${approvalBlockers.length} ملاحظة`}
                      </span>
                    </div>

                    {approvalBlockers.length ? (
                      <div className="mt-3 rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }}>
                        {approvalBlockers.map((item) => <div key={item}>• {item}</div>)}
                      </div>
                    ) : null}

                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <MiniBox
                        label="الدرجة"
                        value={evaluationComplete ? `${overallScore}/100` : `غير مكتمل · ${completedSections}/${sections.length}`}
                        tone={evaluationComplete ? (overallScore >= 80 ? 'green' : overallScore >= 60 ? 'amber' : 'red') : 'amber'}
                      />
                      <MiniBox label="مخالفات حرجة" value={activeGates.length ? String(activeGates.length) : '0'} tone={activeGates.length ? 'red' : 'green'} />
                      <MiniBox label="الحافز المركزي" value={canonicalIncentive == null ? 'غير محدد' : `${canonicalIncentive.toLocaleString('ar-EG')} ج`} tone={canonicalIncentive == null ? 'amber' : 'green'} />
                    </div>

                    {!evaluationComplete && ratedSections.length ? (
                      <div className="mt-2 rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: 'var(--dawaa-status-info-border)', background: 'var(--dawaa-status-info-bg)', color: 'var(--dawaa-status-info-text)' }}>
                        المحاور المقيمة حاليًا: {ratedEarnedPoints}/{ratedWeight} نقطة. لن تظهر درجة نهائية من 100 قبل اكتمال كل المحاور.
                      </div>
                    ) : null}

                    {evaluationComplete ? (
                      <div className="mt-3 rounded-2xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>معاينة ما سيصل للموظف</div>
                            <div className="mt-1 text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                              راجع الرسالة قبل الاعتماد؛ المطلوب أن يعرف الموظف مميزاته وما يحتاج تطويره وما الخطوة التالية.
                            </div>
                          </div>
                          <span
                            className="rounded-full border px-2.5 py-1 text-[10px] font-black"
                            style={!feedbackMissingStrength && !feedbackMissingDevelopment
                              ? { borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)' }
                              : { borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)' }}
                          >
                            {!feedbackMissingStrength && !feedbackMissingDevelopment ? 'الرسالة مكتملة' : 'الرسالة تحتاج استكمال'}
                          </span>
                        </div>

                        <div className="mt-3 grid gap-2 lg:grid-cols-2">
                          <div
                            className="rounded-xl border p-3"
                            style={{
                              borderColor: feedbackMissingStrength ? 'var(--dawaa-status-warning-border)' : 'var(--dawaa-status-success-border)',
                              background: 'var(--dawaa-theme-soft)',
                            }}
                          >
                            <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>نقاط القوة</div>
                            <div className="mt-1 whitespace-pre-wrap text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>
                              {strengthsText.trim() || 'لم تُكتب نقاط قوة بعد.'}
                            </div>
                          </div>

                          <div
                            className="rounded-xl border p-3"
                            style={{
                              borderColor: feedbackMissingDevelopment ? 'var(--dawaa-status-warning-border)' : 'var(--dawaa-theme-border)',
                              background: 'var(--dawaa-theme-soft)',
                            }}
                          >
                            <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>خطة التطوير</div>
                            <div className="mt-1 whitespace-pre-wrap text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>
                              {developmentText.trim() || 'لا توجد خطة تطوير مكتوبة بعد.'}
                            </div>
                          </div>
                        </div>

                        {managerNotes.trim() ? (
                          <div className="mt-2 rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)' }}>
                            <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>ملاحظة المدير</div>
                            <div className="mt-1 whitespace-pre-wrap text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>{managerNotes}</div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {canEdit ? (
                      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                        <button type="button" disabled={exportingPdf || !evaluationComplete} onClick={() => void handleExportPdf()} className="btn-secondary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-45">
                          {exportingPdf ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
                          {evaluationComplete ? 'PDF' : 'PDF بعد اكتمال التقييم'}
                        </button>
                        {!['sent', 'approved'].includes(status) ? (
                          <button type="button" disabled={saving} onClick={() => void save('draft')} className="btn-secondary inline-flex items-center gap-2">
                            <Save size={16} /> حفظ مسودة
                          </button>
                        ) : null}
                        {!approvalReady ? (
                          <button type="button" disabled={saving} onClick={continueIncompleteEvaluation} className="btn-primary inline-flex items-center gap-2">
                            <Send size={16} /> {incompleteActionLabel}
                          </button>
                        ) : null}
                        <button type="button" disabled={saving || !approvalReady} onClick={() => void save('sent')} className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-45">
                          {saving ? <Loader2 size={16} className="animate-spin" /> : <UserCheck size={16} />}
                          {requiresPostCycleReapproval ? 'إعادة اعتماد' : previouslySent ? 'تحديث الاعتماد' : 'اعتماد وإرسال'}
                        </button>
                      </div>
                    ) : null}
                  </Panel>

                  {user?.id && selected ? (
                    <details className="rounded-2xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}>
                      <summary className="cursor-pointer text-xs font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                        سجل المراجعة والاعتمادات
                      </summary>
                      <div className="mt-3">
                        <MonthlyEvaluationAuditTrailV5
                          actorId={user.id}
                          staffId={selected.id}
                          cycleLabel={cycleLabel}
                          refreshKey={auditRefreshKey}
                        />
                      </div>
                    </details>
                  ) : null}
                </section>
              ) : null}
              <Panel className="flex items-center justify-between gap-3 p-3">
                <button
                  type="button"
                  disabled={activeStep === 1}
                  onClick={() => setActiveStep((Math.max(1, activeStep - 1)) as MonthlyEvaluationStep)}
                  className="btn-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {activeStep === 2 ? 'السابق: البيانات'
                    : activeStep === 3 ? 'السابق: التقييم'
                      : activeStep === 4 ? 'السابق: النقاط'
                        : activeStep === 5 ? 'السابق: الخلاصة'
                          : 'السابق'}
                </button>
                {activeStep < 5 ? (
                  <button
                    type="button"
                    onClick={() => setActiveStep((Math.min(5, activeStep + 1)) as MonthlyEvaluationStep)}
                    className="btn-primary"
                  >
                    {activeStep === 1 ? 'التالي: التقييم'
                      : activeStep === 2 ? 'التالي: النقاط'
                        : activeStep === 3 ? 'التالي: الخلاصة'
                          : 'التالي: الاعتماد'}
                  </button>
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
