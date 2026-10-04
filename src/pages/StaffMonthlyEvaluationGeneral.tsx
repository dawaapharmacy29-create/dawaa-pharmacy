import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, ChevronDown, Clock3, FileDown, Loader2, Save, Search, Send, Star, UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import {
  evaluationProfileForRole,
  type StaffEvaluationSectionV3,
} from '@/lib/evaluations/staffEvaluationProfilesV3';
import { canonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';
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
import { hasStrongDispensingEvidence } from '@/lib/evaluations/monthlyDispensingEvidence';
import { hasStrongSalesQualityEvidence } from '@/lib/evaluations/monthlySalesQualityEvidence';
import { hasStrongFollowupEvidence } from '@/lib/evaluations/monthlyFollowupEvidence';
import { hasStrongInventoryEvidence } from '@/lib/evaluations/monthlyInventoryEvidence';
import { hasStrongDevelopmentEvidence } from '@/lib/evaluations/monthlyDevelopmentEvidence';
import { hasStrongAttendanceEvidence } from '@/lib/evaluations/monthlyAttendanceEvidence';
import { hasStrongConversationEvidence } from '@/lib/evaluations/monthlyConversationEvidence';
import { isMonthlyEvaluationDevelopmentEligible } from '@/lib/evaluations/monthlyEvaluationDevelopmentEligibility';
import {
  hasEvidenceSupportedStrongPerformance,
  isMonthlyEvaluationStrengthEligible,
} from '@/lib/evaluations/monthlyEvaluationStrengthEligibility';
import { createStaffNotification } from '@/lib/staffNotificationService';
import { Panel, MiniBox, EmptyState } from '@/components/dashboard/DashboardPrimitives';
import MonthlyEvaluationWorkflowV5, { type MonthlyEvaluationStep } from '@/components/evaluations/MonthlyEvaluationWorkflowV5';
import MonthlyEvaluationAuditTrailV5 from '@/components/evaluations/MonthlyEvaluationAuditTrailV5';
import EvaluationDecisionHeaderV1 from '@/components/evaluations/EvaluationDecisionHeaderV1';
import EvaluationAxisCardV1 from '@/components/evaluations/EvaluationAxisCardV1';
import FinalEvaluationReviewV1 from '@/components/evaluations/FinalEvaluationReviewV1';
import EmployeeEvaluationHeaderV1 from '@/components/evaluations/EmployeeEvaluationHeaderV1';
import { loadEmployeeEvaluationHeader, type EvaluationHeaderSummary } from '@/lib/evaluations/employeeEvaluationHeaderService';

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
  evaluation_acknowledged_at?: string | null;
  evaluation_commented_at?: string | null;
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
  invoice_quality_vs_branch_baseline: 'أداء قيمة وتركيب الفاتورة مقابل خط الأساس',
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

const ATTENDANCE_EVENT_LABELS: Record<string, string> = {
  attendance_late: 'تأخير',
  attendance_very_late: 'تأخير كبير',
  attendance_early_leave_confirmed: 'خروج مبكر',
  attendance_absence_confirmed: 'غياب مؤكد',
  attendance_approved_time_off: 'إجازة/إذن مصنف في السجل',
  attendance_off_day: 'يوم راحة',
  attendance_worked_on_off_confirmed: 'عمل في يوم راحة',
  attendance_manual_resolution: 'قرار حضور يدوي',
};

function formatAttendanceDate(value: string) {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}` : value;
}

function formatAttendanceTime(value: string) {
  if (!value) return '';
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return value;
  return new Intl.DateTimeFormat('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Cairo',
  }).format(instant);
}

function attendanceCaseLine(item: NonNullable<EmployeeMonthlyEvidence['coaching']>['attendance']['cases'][number]) {
  const label = ATTENDANCE_EVENT_LABELS[item.eventType] || 'حالة حضور';
  const minutes = item.eventType === 'attendance_early_leave_confirmed'
    ? item.earlyLeaveMinutes
    : item.eventType === 'attendance_late' || item.eventType === 'attendance_very_late'
      ? item.lateMinutes
      : 0;
  const schedule = item.scheduledStartAt || item.scheduledEndAt
    ? `الجدول ${formatAttendanceTime(item.scheduledStartAt) || '—'} → ${formatAttendanceTime(item.scheduledEndAt) || '—'}`
    : '';
  const actual = item.firstIn || item.lastOut
    ? `البصمة ${formatAttendanceTime(item.firstIn) || '—'} → ${formatAttendanceTime(item.lastOut) || '—'}`
    : '';
  const parts = [
    `${formatAttendanceDate(item.date)}${item.dayName ? ` (${item.dayName})` : ''} — ${label}`,
    minutes > 0 ? `${minutes} دقيقة` : '',
    schedule,
    actual,
    item.reviewRequired ? 'تحتاج/احتاجت مراجعة' : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function sectionEvidenceFor(
  sectionKey: string,
  role: unknown,
  metrics: Metrics,
  health: EmployeeMonthlyEvidence['health'],
  pointsTruth: StaffPointsDashboardV3 | null,
  coaching: EmployeeMonthlyEvidence['coaching'] | null
) {
  const key = sectionKey.toLowerCase();
  const canonicalRole = canonicalStaffRole(role);
  const personalEvidenceRoles = new Set(['doctor','assistant','inventory_assistant','cleaning','delivery','customer_service','purchasing']);
  const leadershipRoles = new Set(['branch_manager','branches_manager','shift_supervisor','customer_service_manager','executive','admin']);
  if (leadershipRoles.has(canonicalRole) && !['shift_discipline','development'].includes(key)) {
    return {
      status: 'insufficient' as const,
      summary: 'هذا محور قيادي ويحتاج Evidence على مستوى الفريق/الفرع وليس بيانات الموظف الشخصية',
      details: [
        'لا تُستخدم محادثات المدير الشخصية أو أرقام حضوره كبديل عن نتيجة الفريق أو الفرع.',
        'يبقى المحور مقفولًا حتى ربط مصدر قيادي canonical مناسب لنفس الدورة والنطاق.',
      ],
    };
  }
  const attendanceKeys = ['discipline', 'attendance', 'shift_discipline'];
  const conversationKeys = ['conversations', 'conversation', 'customer', 'customers', 'team_quality', 'customer_outcomes'];
  const followupKeys = ['followups_requests', 'followups', 'followups_sla', 'customer_requests', 'requests'];

  if (attendanceKeys.includes(key) && (personalEvidenceRoles.has(canonicalRole) || canonicalRole === 'shift_supervisor')) {
    if (health.attendance !== 'available') {
      return {
        status: 'unavailable' as const,
        summary: 'مصدر الحضور غير متاح حاليًا',
        details: ['لا تستخدم الصفر كدليل على الأداء لأن مصدر الحضور غير متاح.'],
      };
    }
    const attendance = coaching?.attendance;
    return {
      status: 'manual' as const,
      summary: attendance?.resolvedDays
        ? `سجل الحضور: ${attendance.resolvedDays} يومًا له تصنيف · ${attendance.lateCases + attendance.veryLateCases} تأخير · ${attendance.absenceCases} غياب`
        : metrics.attendance_days
          ? `بيانات حضور يومية متاحة لـ ${metrics.attendance_days} يوم`
          : 'لا توجد أيام حضور مسجلة في المصدر لهذه الدورة',
      details: [
        `أيام لها حضور/بصمة في المصدر اليومي: ${metrics.present_days}`,
        `إجمالي الأيام التي لها بيانات في مصدر الحضور اليومي: ${metrics.attendance_days}`,
        attendance?.resolvedDays ? `أيام لها تصنيف في سجل الحضور: ${attendance.resolvedDays}` : '',
        attendance?.activeLedgerEvents ? `إجمالي تصنيفات الحضور النشطة: ${attendance.activeLedgerEvents}` : '',
        attendance?.duplicateResolutionDays
          ? `تنبيه مراجعة: ${attendance.duplicateResolutionDays} يوم عليه أكثر من تصنيف نشط؛ لا يُحسب كأنه يومان في التقييم.`
          : '',
        attendance?.onTimeDays ? `أيام مصنفة في الموعد: ${attendance.onTimeDays}` : '',
        attendance && attendance.lateCases + attendance.veryLateCases > 0
          ? `التأخير المسجل في سجل الحضور: ${attendance.lateCases + attendance.veryLateCases} حالة · ${attendance.lateMinutes} دقيقة`
          : '',
        attendance?.earlyLeaveCases
          ? `الخروج المبكر المؤكد: ${attendance.earlyLeaveCases} حالة · ${attendance.earlyLeaveMinutes} دقيقة`
          : '',
        attendance?.absenceCases ? `الغياب المؤكد: ${attendance.absenceCases} حالة` : '',
        attendance?.approvedTimeOffCases ? `إجازات/أذونات مصنفة كمعتمدة: ${attendance.approvedTimeOffCases}` : '',
        attendance?.offDayCases ? `أيام راحة مصنفة: ${attendance.offDayCases}` : '',
        attendance?.workedOnOffCases ? `عمل مؤكد في يوم راحة: ${attendance.workedOnOffCases} حالة` : '',
        ...(attendance?.cases?.length
          ? ['تفاصيل الحالات:', ...attendance.cases.map((item) => attendanceCaseLine(item))]
          : []),
        'المصدر: مصدر الحضور اليومي للبصمات + سجل تصنيف الحضور (Attendance Resolution / Impact Ledger).',
        'تغطية هذا الدليل جزئية: الزي والتعليمات وتسليم الشيفت والسلوك المهني تحتاج واقعة أو ملاحظة موثقة إذا أثرت على الدرجة.',
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
        ? `${metrics.review_count} محادثة مراجعة · خدمة العميل ${conversation?.coreAverage ?? '—'}/10`
        : 'لا توجد مراجعات محادثات مسجلة لهذه الدورة',
      details: [
        `عدد المراجعات: ${metrics.review_count}`,
        conversation?.coreAverage !== null && conversation?.coreAverage !== undefined
          ? `متوسط أبعاد خدمة العميل الأساسية: ${conversation.coreAverage}/10`
          : '',
        ...(conversation?.coreDimensions || []).map((item) => `${item.label}: ${item.average}/10 من ${item.samples} مراجعة`),
        conversation && !conversation.sampleSufficient
          ? `العينة الحالية ${conversation.reviewCount} فقط؛ نحتاج ${conversation.minSamples} مراجعات على الأقل قبل استنتاج نقاط قوة أو ضعف.`
          : '',
        conversation?.strengths.length
          ? `أقوى أبعاد خدمة العميل: ${conversation.strengths.map((item) => `${item.label} ${item.average}/10`).join('، ')}`
          : '',
        conversation?.weaknesses.length
          ? `أضعف أبعاد خدمة العميل: ${conversation.weaknesses.map((item) => `${item.label} ${item.average}/10`).join('، ')}`
          : '',
        'المتابعة هنا تعني متابعة العميل داخل سياق المحادثة؛ تنفيذ المتابعات المسجلة له محور مستقل.',
        'أبعاد الجرعة والاستشارة والبدائل والبيع مستبعدة من متوسط هذا المحور لأنها مملوكة لمحوري الصرف والبيع.',
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
    const medicalErrors = conversation?.flags.medicalErrors || 0;
    const badAlternativeCases = conversation?.flags.badAlternativeCases || 0;
    const guidanceSamples = Math.max(
      consultation?.samples || 0,
      dosage?.samples || 0
    );

    const guidanceSummary = [
      dosage ? `شرح الجرعة ${dosage.average}/10` : '',
      consultation ? `الاستشارة ${consultation.average}/10` : '',
    ].filter(Boolean).join(' · ');

    return {
      status: medicalErrors > 0 || badAlternativeCases > 0 ? 'available' as const : 'manual' as const,
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
        followups?.needsNextFollowup
          ? `تحتاج متابعة لاحقة: ${followups.needsNextFollowup} حالة · موعد تالٍ مسجل ${followups.nextFollowupScheduled} · بدون موعد ${followups.missingNextFollowupSchedule}`
          : '',
        'هذا المحور يعتمد على المتابعات/الطلبات المسجلة فعليًا، وليس درجة follow_up داخل تقييم المحادثة.',
      ].filter(Boolean),
    };
  }

  if (key === 'development') {
    const development = coaching?.development;
    if (!development) {
      return {
        status: 'manual' as const,
        summary: 'لا توجد بيانات كافية لقياس التعلم والتحسن آليًا',
        details: ['استخدم مثالًا موثقًا على تنفيذ ملاحظة أو توقف تكرار خطأ بدل الانطباع العام.'],
      };
    }

    const training = development.training;
    const trend = development.reviewTrend;
    const summaryParts = [
      training.assigned > 0 ? `التدريب: ${training.completed}/${training.assigned} مكتمل` : '',
      trend.measurable && trend.delta !== null
        ? `اتجاه المراجعات: ${trend.delta > 0 ? '+' : ''}${trend.delta} نقطة`
        : '',
      development.repeatedIssues.length
        ? `${development.repeatedIssues.length} ملاحظة متكررة`
        : '',
    ].filter(Boolean);

    return {
      status: development.sourceStatus === 'available' ? 'available' as const : 'manual' as const,
      summary: summaryParts.join(' · ') || 'لا يوجد قياس آلي كافٍ؛ استخدم واقعة تطوير موثقة',
      details: [
        training.assigned > 0 ? `التدريبات المسندة: ${training.assigned} · المكتملة داخل الدورة: ${training.completed}` : '',
        training.completedAfterCycle > 0 ? `اكتمل بعد نهاية الدورة: ${training.completedAfterCycle}` : '',
        training.completionTimingUnknown > 0 ? `مكتمل بدون توقيت موثق: ${training.completionTimingUnknown}` : '',
        training.overdueOpen > 0 ? `كان مستحقًا بنهاية الدورة بدون إكمال موثق داخلها: ${training.overdueOpen}` : '',
        training.averageScore !== null ? `متوسط درجات التدريب: ${training.averageScore}` : '',
        training.titles.length ? `التدريبات: ${training.titles.join(' · ')}` : '',
        trend.measurable
          ? `بداية عينة المراجعات: ${trend.earlyAverage}/100 (${trend.earlyCount}) · آخر العينة: ${trend.recentAverage}/100 (${trend.recentCount})`
          : '',
        trend.measurable && trend.delta !== null
          ? `التغير داخل العينة: ${trend.delta > 0 ? '+' : ''}${trend.delta} نقطة · ${trend.direction === 'improving' ? 'تحسن' : trend.direction === 'declining' ? 'انخفاض' : 'مستقر تقريبًا'}`
          : '',
        ...development.repeatedIssues.map((item) => `ملاحظة متكررة: ${item.label} — ${item.count} مرات`),
        ...development.repeatedRecommendations.map((item) => `توصية تدريبية متكررة: ${item.label} — ${item.count} مرات`),
        ...development.notes,
        'لا يُعتمد اتجاه المراجعات وحده كدرجة تلقائية؛ هو دليل مساعد للمدير.',
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
      status: 'manual' as const,
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
        'تغطية هذا الدليل جزئية: التبليغ المبكر عن النواقص ومراجعة الصلاحية يحتاجان واقعة تشغيلية موثقة إذا أثرا على الدرجة.',
      ].filter(Boolean),
    };
  }

  if (key === 'sales_quality') {
    const sales = coaching?.salesQuality;
    const invoiceSource = pointsTruth?.source_breakdown?.find((source) => source.source === 'invoice_quality_vs_branch_baseline');

    if (!sales) {
      return {
        status: 'manual' as const,
        summary: 'لا توجد بيانات كافية لجودة البيع والفاتورة',
        details: ['استخدم مراجعة محادثة أو واقعة فاتورة موثقة بدل الانطباع العام.'],
      };
    }

    const conversationBits = [
      sales.conversation.salesQuality !== null ? `جودة البيع ${sales.conversation.salesQuality}/10` : '',
      sales.conversation.upsellCrossSell !== null ? `البيع التكميلي ${sales.conversation.upsellCrossSell}/10` : '',
      sales.conversation.alternativeHandling !== null ? `البدائل ${sales.conversation.alternativeHandling}/10` : '',
    ].filter(Boolean);

    const performance = sales.invoicePerformance;
    const summaryParts = [
      conversationBits.length ? conversationBits.join(' · ') : '',
      performance.available && performance.weightedPctVsBaseline !== null
        ? `مؤشر الفاتورة ${performance.weightedPctVsBaseline > 0 ? '+' : ''}${performance.weightedPctVsBaseline}% مقابل خط الأساس`
        : '',
      sales.conversation.invoiceErrors > 0
        ? `${sales.conversation.invoiceErrors} خطأ فاتورة موثق`
        : '',
    ].filter(Boolean);

    return {
      status: sales.sourceStatus === 'available' ? 'available' as const : 'manual' as const,
      summary: summaryParts.join(' · ') || 'لا يوجد دليل آلي كافٍ؛ استخدم واقعة موثقة',
      details: [
        sales.conversation.samples > 0 ? `عينة مراجعات البيع: ${sales.conversation.samples}` : '',
        sales.conversation.salesQuality !== null ? `جودة البيع: ${sales.conversation.salesQuality}/10` : '',
        sales.conversation.upsellCrossSell !== null ? `البيع التكميلي: ${sales.conversation.upsellCrossSell}/10` : '',
        sales.conversation.alternativeHandling !== null ? `التعامل مع البدائل: ${sales.conversation.alternativeHandling}/10` : '',
        sales.conversation.missedSales > 0 ? `فرص بيع ضائعة موثقة: ${sales.conversation.missedSales}` : '',
        sales.conversation.invoiceErrors > 0 ? `أخطاء فاتورة موثقة: ${sales.conversation.invoiceErrors}` : 'لا يوجد خطأ فاتورة موثق في المراجعات المتاحة.',
        performance.available ? `عدد الفواتير في مؤشر الأداء: ${performance.invoiceCount}` : '',
        performance.available && performance.weightedPctVsBaseline !== null
          ? `الفرق المرجح في متوسط قيمة الفاتورة وعدد الأصناف مقابل خط الأساس: ${performance.weightedPctVsBaseline > 0 ? '+' : ''}${performance.weightedPctVsBaseline}%`
          : '',
        performance.points !== null ? `تأثير Points Truth لهذا المؤشر: ${formatSignedPoints(performance.points)} نقطة` : '',
        invoiceSource ? `Points Truth: ${invoiceSource.events} حدث · ${formatSignedPoints(invoiceSource.points)} نقطة` : '',
        ...sales.notes,
      ].filter(Boolean),
    };
  }

  return {
    status: 'insufficient' as const,
    summary: 'لا يوجد مصدر Evidence canonical مربوط بهذا المحور حتى الآن',
    details: [
      'هذا المحور يظل غير قابل للدرجة إلى أن يُربط بمصدر دليل فعلي أو Evidence ID موثق.',
      'عدم وجود القياس لا يعني أداءً ضعيفًا ولا يساوي صفرًا.',
    ],
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

function feedbackIdentity(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, 'ا')
    .replace(/\u0649/g, 'ي')
    .replace(/\u0629/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function uniqueFeedbackLines(values: Array<string | null | undefined>, limit = Number.POSITIVE_INFINITY) {
  const result: string[] = [];
  const identities: string[] = [];

  values.forEach((raw) => {
    const value = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!value) return;
    const identity = feedbackIdentity(value);
    if (identity.length < 4) return;
    const duplicate = identities.some((existing) =>
      existing === identity
      || (Math.min(existing.length, identity.length) >= 18 && (existing.includes(identity) || identity.includes(existing)))
    );
    if (duplicate) return;
    identities.push(identity);
    result.push(value);
  });

  return result.slice(0, limit);
}

function appendUniqueLine(current: string, line: string) {
  const normalized = line.trim();
  if (!normalized) return current;
  return uniqueFeedbackLines([...current.split('\n'), normalized]).join('\n');
}

function appendUniqueLines(current: string, lines: string[]) {
  return uniqueFeedbackLines([...current.split('\n'), ...lines]).join('\n');
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
  const managerMode = ['branch_manager', 'branches_manager', 'executive', 'admin'].includes(actorRole);
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
  const [receiptFilter, setReceiptFilter] = useState<'all' | 'not_seen' | 'seen' | 'commented'>('all');
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
  const [employeeHeader, setEmployeeHeader] = useState<EvaluationHeaderSummary | null>(null);
  const [employeeHeaderLoading, setEmployeeHeaderLoading] = useState(false);
  const employeeHeaderRequestRef = useRef(0);
  const evaluationRequestRef = useRef(0);
  const staffRequestRef = useRef(0);
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
  const [publishedSnapshot, setPublishedSnapshot] = useState<Record<string, unknown> | null>(null);
  const [publishedSnapshotHash, setPublishedSnapshotHash] = useState('');
  const [employeeResponse, setEmployeeResponse] = useState<{
    acknowledged: boolean;
    acknowledged_at: string | null;
    comment: string | null;
    commented_at: string | null;
  } | null>(null);
  const [employeeCommentDraft, setEmployeeCommentDraft] = useState('');
  const [employeeResponseSaving, setEmployeeResponseSaving] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [evaluationLoadError, setEvaluationLoadError] = useState('');
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
  const employeeView = !managerMode;
  const employeeEvaluationPublished = employeeView && ['sent', 'approved'].includes(status) && Boolean(evaluationId);
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
    const requestId = ++staffRequestRef.current;
    const loadStaff = async () => {
      if (!user?.id) return;
      setStaffLoading(true);
      try {
        const [staffResult, responseStatusResult] = await Promise.all([
          supabase.rpc('list_staff_for_monthly_evaluation_v5', {
            p_actor_id: user.id,
            p_branch: globalScope ? branch : null,
            p_month: `${cycleLabel}-01`,
          }),
          managerMode
            ? supabase.rpc('list_staff_monthly_evaluation_response_status_v5', {
                p_actor_id: user.id,
                p_branch: globalScope ? branch : null,
                p_month: `${cycleLabel}-01`,
              })
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (staffResult.error) throw staffResult.error;
        if (responseStatusResult.error) throw responseStatusResult.error;

        const responseByStaff = new Map(
          ((responseStatusResult.data || []) as Array<{
            staff_id: string;
            acknowledged_at: string | null;
            commented_at: string | null;
          }>).map((row) => [row.staff_id, row])
        );

        const rows = ((staffResult.data || []) as StaffRow[]).map((row) => {
          const response = responseByStaff.get(row.id);
          return {
            ...row,
            evaluation_acknowledged_at: response?.acknowledged_at || null,
            evaluation_commented_at: response?.commented_at || null,
          };
        });
        if (staffRequestRef.current !== requestId) return;
        setStaff(rows);
        const own = rows.find((row) => row.id === user?.staffId || row.id === user?.id || row.name === user?.name);
        setSelectedId((current) => {
          if (!managerMode && own) return own.id;
          if (current && rows.some((row) => row.id === current)) return current;
          return rows[0]?.id || '';
        });
      } catch (cause) {
        if (staffRequestRef.current === requestId) toast.error(cause instanceof Error ? cause.message : 'تعذر تحميل الموظفين');
      } finally {
        if (staffRequestRef.current === requestId) setStaffLoading(false);
      }
    };
    void loadStaff();
  }, [branch, cycleLabel, globalScope, managerMode, user?.id, user?.name, user?.staffId]);

  useEffect(() => {
    setActiveStep(1);
  }, [cycleLabel, selectedId]);

  useEffect(() => {
    setReceiptFilter('all');
  }, [branch, cycleLabel]);

  useEffect(() => {
    if (!selectedId || !user?.id || !selected) return;
    const requestId = ++evaluationRequestRef.current;
    const loadEvaluation = async () => {
      setEvaluationLoading(true);
      setEvaluationLoadError('');
      setEmployeeHeader(null);
      setEmployeeHeaderLoading(true);
      try {
        const { startDate, endDate, endDateExclusive } = evaluationCycleDateKeys(cycleLabel);
        const cycleKeyDate = `${cycleLabel}-01`;
        const [savedResult, evidenceResult, pointsResult, statementResult] = await Promise.all([
          supabase.rpc('get_staff_monthly_evaluation_v5', {
            p_actor_id: user.id,
            p_staff_id: selectedId,
            p_month: cycleKeyDate,
          }),
          loadEmployeeMonthlyEvidence({
            staffId: selectedId,
            startDate,
            endDateExclusive,
            role: selected.job_title || selected.role,
            branch: selected.branch || branch,
          }),
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

        if (evaluationRequestRef.current !== requestId) return;
        setMetrics(evidenceResult.metrics);
        setEvidenceReady(evidenceResult.ready);
        setEvidenceHealth(evidenceResult.health);
        setEvidenceErrors(evidenceResult.errors);
        setCoaching(evidenceResult.coaching);
        const headerRequestId = ++employeeHeaderRequestRef.current;
        void loadEmployeeEvaluationHeader({
          staffId: selectedId,
          staffName: selected.name,
          role: selected.job_title || selected.role,
          branch: selected.branch || branch,
          start: startDate,
          end: endDate,
          evidence: evidenceResult,
        }).then((value) => {
          if (employeeHeaderRequestRef.current === headerRequestId) setEmployeeHeader(value);
        }).catch(() => {
          if (employeeHeaderRequestRef.current === headerRequestId) setEmployeeHeader(null);
        }).finally(() => {
          if (employeeHeaderRequestRef.current === headerRequestId) setEmployeeHeaderLoading(false);
        });
        setPointsTruth(pointsResult);
        setSettledStatement(statementResult.data || null);

        const saved = savedResult.data as EvaluationRow | null;
        const freshSections = evaluationProfileForRole(selected.job_title || selected.role).sections;
        if (saved) {
          setEvaluationId(String(saved.id || ''));
          const savedStatus = String(saved.status || 'draft');
          const savedSentAt = String(saved.sent_at || '');
          const metricsSnapshot = saved.metrics_snapshot as Record<string, unknown> | null;
          const finalSnapshotRaw = metricsSnapshot?.final_approval_snapshot;
          const finalSnapshot =
            finalSnapshotRaw && typeof finalSnapshotRaw === 'object' && !Array.isArray(finalSnapshotRaw)
              ? finalSnapshotRaw as Record<string, unknown>
              : null;
          const published = ['sent', 'approved'].includes(savedStatus) && finalSnapshot;
          const content = published || saved;

          setPublishedSnapshot(finalSnapshot);
          setPublishedSnapshotHash(String(metricsSnapshot?.final_approval_hash || ''));
          setSections(normalizeSavedSections(content.sections, freshSections));
          setStrengthsText(Array.isArray(content.strengths) ? content.strengths.map(String).join('\n') : '');
          setDevelopmentText(Array.isArray(content.development_points) ? content.development_points.map(String).join('\n') : '');
          setManagerNotes(String(content.manager_notes || ''));
          setStatus(savedStatus);
          setSentAtIso(savedSentAt);
          setPreviouslySent(
            ['sent', 'approved'].includes(savedStatus)
              && Boolean(savedSentAt)
              && new Date(savedSentAt).getTime() > cycleRange.end.getTime()
          );
          const savedGates = metricsSnapshot && Array.isArray(metricsSnapshot.active_critical_gates) ? (metricsSnapshot.active_critical_gates as string[]) : [];
          const validSavedGates = savedGates.filter((gate): gate is CriticalGateType => gate in CRITICAL_GATE_CAPS);
          setActiveGates(validSavedGates);
        } else {
          setEvaluationId(null);
          setPublishedSnapshot(null);
          setPublishedSnapshotHash('');
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
        if (evaluationRequestRef.current !== requestId) return;
        setEmployeeHeader(null);
        setEmployeeHeaderLoading(false);
        const message = cause instanceof Error ? cause.message : 'تعذر تحميل التقييم';
        setEvaluationLoadError(message);
        toast.error(message);
      } finally {
        if (evaluationRequestRef.current === requestId) setEvaluationLoading(false);
      }
    };
    void loadEvaluation();
  }, [cycleLabel, selected, selectedId, user?.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadEmployeeResponse() {
      if (!employeeView || !employeeEvaluationPublished || !selectedId || !user?.id) {
        if (!cancelled) {
          setEmployeeResponse(null);
          setEmployeeCommentDraft('');
        }
        return;
      }

      const { data, error } = await supabase.rpc('get_staff_monthly_evaluation_employee_response_v5', {
        p_actor_id: user.id,
        p_staff_id: selectedId,
        p_month: `${cycleLabel}-01`,
      });

      if (cancelled) return;
      if (error) {
        setEmployeeResponse(null);
        return;
      }

      const response = (data || null) as {
        acknowledged?: boolean;
        acknowledged_at?: string | null;
        comment?: string | null;
        commented_at?: string | null;
      } | null;

      setEmployeeResponse(response ? {
        acknowledged: Boolean(response.acknowledged),
        acknowledged_at: response.acknowledged_at || null,
        comment: response.comment || null,
        commented_at: response.commented_at || null,
      } : null);
      setEmployeeCommentDraft('');
    }

    void loadEmployeeResponse();
    return () => { cancelled = true; };
  }, [cycleLabel, employeeEvaluationPublished, employeeView, selectedId, user?.id]);

  async function acknowledgeEmployeeEvaluation() {
    if (!employeeView || !employeeEvaluationPublished || !selectedId || !user?.id) return;
    setEmployeeResponseSaving(true);
    try {
      const { data, error } = await supabase.rpc('respond_staff_monthly_evaluation_v5', {
        p_actor_id: user.id,
        p_staff_id: selectedId,
        p_month: `${cycleLabel}-01`,
        p_action: 'acknowledge',
        p_comment: null,
      });
      if (error) throw error;
      const result = (data || {}) as Record<string, unknown>;
      setEmployeeResponse((current) => ({
        acknowledged: true,
        acknowledged_at: String(result.acknowledged_at || current?.acknowledged_at || new Date().toISOString()),
        comment: current?.comment || (result.comment ? String(result.comment) : null),
        commented_at: current?.commented_at || null,
      }));
      setAuditRefreshKey((value) => value + 1);
      toast.success('تم تسجيل اطلاعك على التقييم.');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'تعذر تسجيل الاطلاع على التقييم');
    } finally {
      setEmployeeResponseSaving(false);
    }
  }

  async function submitEmployeeEvaluationComment() {
    const comment = employeeCommentDraft.trim();
    if (!employeeView || !employeeEvaluationPublished || !selectedId || !user?.id || !comment) return;
    if (comment.length < 3) {
      toast.error('اكتب ملاحظة أو تعليقًا واضحًا.');
      return;
    }
    setEmployeeResponseSaving(true);
    try {
      const { data, error } = await supabase.rpc('respond_staff_monthly_evaluation_v5', {
        p_actor_id: user.id,
        p_staff_id: selectedId,
        p_month: `${cycleLabel}-01`,
        p_action: 'comment',
        p_comment: comment,
      });
      if (error) throw error;
      const result = (data || {}) as Record<string, unknown>;
      setEmployeeResponse((current) => ({
        acknowledged: Boolean(current?.acknowledged),
        acknowledged_at: current?.acknowledged_at || null,
        comment,
        commented_at: String(result.commented_at || new Date().toISOString()),
      }));
      setEmployeeCommentDraft('');
      setAuditRefreshKey((value) => value + 1);
      toast.success('تم حفظ تعليقك على التقييم.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'تعذر حفظ التعليق';
      toast.error(message.includes('employee_comment_already_submitted') ? 'تم تسجيل تعليقك على هذا التقييم من قبل.' : message);
    } finally {
      setEmployeeResponseSaving(false);
    }
  }

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
      const persistedSections = publishedSnapshot
        ? normalizeSavedSections(publishedSnapshot.sections, profile.sections)
        : sections;
      const persistedStrengths = publishedSnapshot && Array.isArray(publishedSnapshot.strengths)
        ? publishedSnapshot.strengths.map(String)
        : strengthsText.split('\n').map((item) => item.trim()).filter(Boolean);
      const persistedDevelopment = publishedSnapshot && Array.isArray(publishedSnapshot.development_points)
        ? publishedSnapshot.development_points.map(String)
        : developmentText.split('\n').map((item) => item.trim()).filter(Boolean);
      const persistedScore = publishedSnapshot
        ? safeNumber(publishedSnapshot.overall_score)
        : overallScore;
      const persistedGrade = publishedSnapshot
        ? String(publishedSnapshot.grade || grade)
        : grade;
      const persistedManagerNotes = publishedSnapshot
        ? String(publishedSnapshot.manager_notes || '')
        : managerNotes;

      const { pdf, fileName } = await buildStaffMonthlyEvaluationPdf({
        staffName: selected.name,
        staffRole: selected.job_title || selected.role || profile.label,
        branch: selected.branch || branch,
        cycleDisplayLabel: cycleRange.displayLabel,
        evaluatorName: publishedSnapshot
          ? String(publishedSnapshot.evaluator_name || user?.name || 'المدير')
          : user?.name || 'المدير',
        overallScore: persistedScore,
        grade: persistedGrade,
        sections: persistedSections,
        strengths: persistedStrengths,
        developmentPoints: persistedDevelopment,
        managerNotes: persistedManagerNotes,
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
    if (nextStatus === 'sent' && hasStrongPerformance && !strengthsText.trim()) {
      toast.error('اكتب نقطة قوة واحدة على الأقل تعكس الأداء القوي الموثق قبل الاعتماد.');
      return;
    }
    if (nextStatus === 'sent' && hasDevelopmentNeed && !developmentText.trim()) {
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
          employee_feedback_draft: employeeFeedbackDraft,
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
        const [refreshedPoints, refreshedEvaluationResult] = await Promise.all([
          getStaffPointsDashboardV3(selected.id, cycleLabel).catch(() => null),
          supabase.rpc('get_staff_monthly_evaluation_v5', {
            p_actor_id: user.id,
            p_staff_id: selected.id,
            p_month: `${cycleLabel}-01`,
          }),
        ]);
        if (refreshedPoints) setPointsTruth(refreshedPoints);

        const refreshedEvaluation = refreshedEvaluationResult.error
          ? null
          : refreshedEvaluationResult.data as EvaluationRow | null;
        const refreshedMetrics = refreshedEvaluation?.metrics_snapshot as Record<string, unknown> | null;
        const refreshedSnapshotRaw = refreshedMetrics?.final_approval_snapshot;
        const refreshedSnapshot =
          refreshedSnapshotRaw && typeof refreshedSnapshotRaw === 'object' && !Array.isArray(refreshedSnapshotRaw)
            ? refreshedSnapshotRaw as Record<string, unknown>
            : null;
        const refreshedHash = String(refreshedMetrics?.final_approval_hash || '');

        if (refreshedSnapshot && refreshedHash) {
          setPublishedSnapshot(refreshedSnapshot);
          setPublishedSnapshotHash(refreshedHash);

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
                finalSnapshotHash: refreshedHash,
                hasStrengths: strengths.length > 0,
                hasDevelopmentPlan: developmentPoints.length > 0,
              },
              stateKey: serverSentAt || String(saveResult.action || 'approved'),
            });
          } catch {
            toast.warning('تم اعتماد التقييم، لكن تعذر إنشاء إشعار الموظف. التقييم نفسه محفوظ ومعتمد.');
          }
        } else {
          toast.warning('تم اعتماد التقييم وحفظه، لكن تعذر إعادة قراءة بصمة النسخة المعتمدة الآن؛ لم يُرسل إشعار غير موثّق.');
        }
        toast.success(`تم اعتماد التقييم على الخادم بنسبة أثر ${Number(saveResult.multiplier_pct ?? effectiveEvaluationMultiplierPct)}%.`);
      }

      setStaff((current) => current.map((item) => item.id === selected.id
        ? {
            ...item,
            evaluation_status: nextStatus === 'sent' ? 'sent' : 'draft',
            evaluation_score: Number(saveResult.overall_score ?? overallScore),
            sent_at: nextStatus === 'sent' ? (serverSentAt || new Date().toISOString()) : item.sent_at,
            evidence_ready: nextStatus === 'sent' ? true : evidenceReady,
          }
        : item));

      toast.success(nextStatus === 'sent' ? 'تم اعتماد التقييم' : 'تم حفظ المسودة');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'فشل حفظ التقييم');
    } finally {
      setSaving(false);
    }
  }

  const publishedStaff = staff.filter((item) =>
    ['sent', 'approved'].includes(String(item.evaluation_status || ''))
  );
  const cycleSummary = {
    total: staff.length,
    approved: publishedStaff.length,
    notStarted: staff.filter((item) => !item.evaluation_status || item.evaluation_status === 'not_started').length,
    draft: staff.filter((item) => item.evaluation_status === 'draft').length,
    needsReapproval: staff.filter((item) => item.evaluation_status === 'needs_reapproval').length,
  };
  const receiptCounts = {
    not_seen: publishedStaff.filter((item) => !item.evaluation_acknowledged_at && !item.evaluation_commented_at).length,
    seen: publishedStaff.filter((item) => Boolean(item.evaluation_acknowledged_at) && !item.evaluation_commented_at).length,
    commented: publishedStaff.filter((item) => Boolean(item.evaluation_commented_at)).length,
  };

  const roleGroupLabel = (item: StaffRow) => {
    const role = canonicalStaffRole(item.job_title || item.role);
    if (role === 'doctor') return 'دكاترة';
    if (role === 'assistant') return 'مساعدون';
    if (role === 'inventory_assistant') return 'المخزن';
    if (role === 'delivery') return 'الدليفري';
    if (['branch_manager','branches_manager','shift_supervisor','customer_service_manager','executive','admin'].includes(role)) return 'الإدارة';
    return 'وظائف أخرى';
  };

  const filteredStaff = staff.filter((item) => {
    const matchesSearch = item.name.includes(search);
    const matchesStatus = staffStatusFilter === 'all'
      || (staffStatusFilter === 'not_started' && (!item.evaluation_status || item.evaluation_status === 'not_started'))
      || (staffStatusFilter === 'draft' && item.evaluation_status === 'draft')
      || (staffStatusFilter === 'approved' && ['sent', 'approved'].includes(String(item.evaluation_status || '')))
      || (staffStatusFilter === 'needs_reapproval' && item.evaluation_status === 'needs_reapproval');

    const published = ['sent', 'approved'].includes(String(item.evaluation_status || ''));
    const matchesReceipt = receiptFilter === 'all'
      || (receiptFilter === 'not_seen' && published && !item.evaluation_acknowledged_at && !item.evaluation_commented_at)
      || (receiptFilter === 'seen' && published && Boolean(item.evaluation_acknowledged_at) && !item.evaluation_commented_at)
      || (receiptFilter === 'commented' && published && Boolean(item.evaluation_commented_at));

    return matchesSearch && matchesStatus && matchesReceipt;
  });
  const orderedFilteredStaff = [...filteredStaff].sort((a,b) => {
    const branchCompare = String(a.branch || '').localeCompare(String(b.branch || ''), 'ar');
    if (branchCompare) return branchCompare;
    const groupCompare = roleGroupLabel(a).localeCompare(roleGroupLabel(b), 'ar');
    if (groupCompare) return groupCompare;
    return a.name.localeCompare(b.name, 'ar');
  });
  const completedSections = sections.filter((item) => item.score > 0).length;
  const weakSectionsMissingNotes = sections.filter((item) => item.score > 0 && item.score <= 2 && !item.notes.trim());
  const criticalGateMissingReason = activeGates.length > 0 && !managerNotes.trim();
  const ratedSections = sections.filter((item) => item.score > 0);
  const ratedWeight = ratedSections.reduce((sum, item) => sum + item.weight, 0);
  const ratedEarnedPoints = Math.round(ratedSections.reduce((sum, item) => sum + sectionPoints(item), 0) * 10) / 10;
  const dispensingConsultationEvidence = coaching?.conversation.dimensions.find((item) => item.key === 'consultation_quality');
  const dispensingDosageEvidence = coaching?.conversation.dimensions.find((item) => item.key === 'dosage_explanation');
  const dispensingStrengthEvidence = hasStrongDispensingEvidence({
    consultation: dispensingConsultationEvidence,
    dosage: dispensingDosageEvidence,
    medicalErrors: coaching?.conversation.flags.medicalErrors || 0,
    badAlternativeCases: coaching?.conversation.flags.badAlternativeCases || 0,
  });
  const salesQualityStrengthEvidence = hasStrongSalesQualityEvidence({
    salesQuality: coaching?.conversation.dimensions.find((item) => item.key === 'sales_quality'),
    missedSales: coaching?.conversation.flags.missedSales || 0,
    invoiceErrors: coaching?.conversation.flags.invoiceErrors || 0,
    badAlternativeCases: coaching?.conversation.flags.badAlternativeCases || 0,
  });
  const followupsStrengthEvidence = hasStrongFollowupEvidence({
    total: coaching?.followups.total || 0,
    completed: coaching?.followups.completed || 0,
    documented: coaching?.followups.documented || 0,
    needsNextFollowup: coaching?.followups.needsNextFollowup || 0,
    nextFollowupScheduled: coaching?.followups.nextFollowupScheduled || 0,
  });
  const inventoryStrengthEvidence = hasStrongInventoryEvidence({
    sourceStatus: coaching?.inventory.sourceStatus || 'unavailable',
    measuredWeeks: coaching?.inventory.weekly.measuredWeeks || 0,
    onTrackWeeks: coaching?.inventory.weekly.onTrackWeeks || 0,
    aheadWeeks: coaching?.inventory.weekly.aheadWeeks || 0,
    behindWeeks: coaching?.inventory.weekly.behindWeeks || 0,
    unresolvedDiscrepancies: coaching?.inventory.weekly.unresolvedDiscrepancies || 0,
    assignedItems: coaching?.inventory.stagnant.assignedItems || 0,
    configuredTargets: coaching?.inventory.stagnant.configuredTargets || 0,
    targetAchievementPct: coaching?.inventory.stagnant.targetAchievementPct ?? null,
  });
  const developmentStrengthEvidence = hasStrongDevelopmentEvidence({
    sourceStatus: coaching?.development.sourceStatus || 'manual',
    trendMeasurable: coaching?.development.reviewTrend.measurable || false,
    direction: coaching?.development.reviewTrend.direction || 'not_measurable',
    delta: coaching?.development.reviewTrend.delta ?? null,
    repeatedIssueCount: coaching?.development.repeatedIssues.length || 0,
    trainingAssigned: coaching?.development.training.assigned || 0,
    trainingCompleted: coaching?.development.training.completed || 0,
    overdueTraining: coaching?.development.training.overdueOpen || 0,
  });
  const conversationStrengthEvidence = hasStrongConversationEvidence({
    reviewCount: coaching?.conversation.reviewCount || 0,
    coreAverage: coaching?.conversation.coreAverage ?? null,
    complaints: coaching?.conversation.flags.complaints || 0,
    badTone: coaching?.conversation.flags.badTone || 0,
    severeBadTone: coaching?.conversation.flags.severeBadTone || 0,
    criticalErrors: coaching?.conversation.flags.criticalErrors || 0,
  });
  const attendanceStrengthEvidence = hasStrongAttendanceEvidence({
    onTimeDays: coaching?.attendance.onTimeDays || 0,
    workedOnOffCases: coaching?.attendance.workedOnOffCases || 0,
    approvedTimeOffCases: coaching?.attendance.approvedTimeOffCases || 0,
    offDayCases: coaching?.attendance.offDayCases || 0,
    lateCases: coaching?.attendance.lateCases || 0,
    veryLateCases: coaching?.attendance.veryLateCases || 0,
    earlyLeaveCases: coaching?.attendance.earlyLeaveCases || 0,
    absenceCases: coaching?.attendance.absenceCases || 0,
    duplicateResolutionDays: coaching?.attendance.duplicateResolutionDays || 0,
    manualResolutionCases: coaching?.attendance.manualResolutionCases || 0,
  });
  const strengthEvidenceGates = {
    conversations: conversationStrengthEvidence,
    dispensing: dispensingStrengthEvidence,
    salesQuality: salesQualityStrengthEvidence,
    followupsRequests: followupsStrengthEvidence,
    inventory: inventoryStrengthEvidence,
    development: developmentStrengthEvidence,
    attendance: attendanceStrengthEvidence,
  };

  const canUseStrengthDraft = (...keys: string[]) => {
    const section = sections.find((item) => keys.includes(item.key));
    return section ? isMonthlyEvaluationStrengthEligible(section, strengthEvidenceGates) : false;
  };
  const hasStrongPerformance = hasEvidenceSupportedStrongPerformance(sections, strengthEvidenceGates);
  const objectiveDevelopmentKeys = new Set<string>();
  if (coaching?.attendance.drafts.development) ['discipline', 'attendance', 'shift_discipline'].forEach((key) => objectiveDevelopmentKeys.add(key));
  if (coaching?.conversation.drafts.development) ['conversations', 'conversation'].forEach((key) => objectiveDevelopmentKeys.add(key));
  if ((coaching?.conversation.flags.medicalErrors || 0) > 0
      || (coaching?.conversation.flags.badAlternativeCases || 0) > 0
      || (dispensingDosageEvidence && dispensingDosageEvidence.average < 8)
      || (dispensingConsultationEvidence && dispensingConsultationEvidence.average < 8)) objectiveDevelopmentKeys.add('dispensing');
  if (coaching?.followups.drafts.development) objectiveDevelopmentKeys.add('followups_requests');
  if (coaching?.salesQuality.drafts.development) objectiveDevelopmentKeys.add('sales_quality');
  if (coaching?.inventory.drafts.development) objectiveDevelopmentKeys.add('inventory');
  if (coaching?.development.drafts.development) objectiveDevelopmentKeys.add('development');

  const developmentSections = evaluationComplete
    ? [...ratedSections]
        .filter((item) => isMonthlyEvaluationDevelopmentEligible(item, objectiveDevelopmentKeys.has(item.key)))
        .sort((a, b) => Number(objectiveDevelopmentKeys.has(b.key)) - Number(objectiveDevelopmentKeys.has(a.key)) || a.score - b.score || b.weight - a.weight)
        .slice(0, 3)
    : [];
  const hasDevelopmentNeed = developmentSections.length > 0;
  const feedbackMissingStrength = evaluationComplete && hasStrongPerformance && !strengthsText.trim();
  const feedbackMissingDevelopment = evaluationComplete && hasDevelopmentNeed && !developmentText.trim();
  const approvalBlockers = [
    !cycleClosed ? 'الدورة لم تُقفل بعد' : '',
    !evidenceReady ? 'مصدر أو أكثر من أدلة الدورة غير متاح' : '',
    completedSections !== sections.length ? `باقي ${Math.max(0, sections.length - completedSections)} محور بدون تقييم` : '',
    weakSectionsMissingNotes.length ? `${weakSectionsMissingNotes.length} محور بدرجة ضعيفة يحتاج سبب مكتوب` : '',
    feedbackMissingStrength ? 'يوجد أداء قوي موثق لكن نقاط القوة لم تُكتب بعد' : '',
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

  const strongestSections = evaluationComplete
    ? [...ratedSections]
        .filter((item) => isMonthlyEvaluationStrengthEligible(item, strengthEvidenceGates))
        .sort((a, b) => b.score - a.score || b.weight - a.weight)
        .slice(0, 3)
    : [];

  const employeeFeedbackDraft = useMemo(() => {
    if (!evaluationComplete || !coaching) {
      return {
        strengths: [] as string[],
        developments: [] as string[],
        examples: [] as string[],
        actions: [] as string[],
        measurements: [] as string[],
      };
    }

    const sectionByKey = new Map(sections.map((item) => [item.key, item]));
    const strong = (key: string) => {
      const section = sectionByKey.get(key);
      return section ? isMonthlyEvaluationStrengthEligible(section, strengthEvidenceGates) : false;
    };
    const needsDevelopment = (key: string) =>
      developmentSections.some((item) => item.key === key);
    const hasObjectiveDevelopment = (key: string) =>
      objectiveDevelopmentKeys.has(key);

    const consultation = coaching.conversation.dimensions.find((item) => item.key === 'consultation_quality');
    const dosage = coaching.conversation.dimensions.find((item) => item.key === 'dosage_explanation');
    const dispensingEvidenceStrong = hasStrongDispensingEvidence({
      consultation,
      dosage,
      medicalErrors: coaching.conversation.flags.medicalErrors,
      badAlternativeCases: coaching.conversation.flags.badAlternativeCases,
    });

    const dispensingStrength =
      strong('dispensing') && dispensingEvidenceStrong
        ? `الإرشاد الدوائي موثق بمستوى قوي: ${[
            dosage ? `شرح الجرعة ${dosage.average}/10` : '',
            consultation ? `جودة الاستشارة ${consultation.average}/10` : '',
          ].filter(Boolean).join('، ')}، بدون خطأ طبي أو بديل غير مناسب موثق في العينة المتاحة.`
        : '';

    const dispensingDevelopment = hasObjectiveDevelopment('dispensing')
      ? [
          coaching.conversation.flags.medicalErrors > 0
            ? `${coaching.conversation.flags.medicalErrors} خطأ طبي موثق يحتاج مراجعة ومنع تكراره.`
            : '',
          coaching.conversation.flags.badAlternativeCases > 0
            ? `${coaching.conversation.flags.badAlternativeCases} حالة بديل غير مناسب موثقة تحتاج مراجعة.`
            : '',
          dosage && dosage.average < 8
            ? `شرح الجرعة يحتاج تطوير؛ المتوسط الحالي ${dosage.average}/10.`
            : '',
          consultation && consultation.average < 8
            ? `جودة الاستشارة تحتاج تطوير؛ المتوسط الحالي ${consultation.average}/10.`
            : '',
        ].filter(Boolean).join(' ')
      : '';

    const strengths = uniqueFeedbackLines([
      strong('discipline') ? coaching.attendance.drafts.strength : '',
      strong('conversations') ? coaching.conversation.drafts.strength : '',
      dispensingStrength,
      strong('followups_requests') ? coaching.followups.drafts.strength : '',
      strong('sales_quality') ? coaching.salesQuality.drafts.strength : '',
      strong('inventory') ? coaching.inventory.drafts.strength : '',
      strong('development') ? coaching.development.drafts.strength : '',
    ], 3);

    const weakSectionNotes = developmentSections
      .map((item) => item.notes.trim() ? `${item.title}: ${item.notes.trim()}` : '');

    const developments = uniqueFeedbackLines([
      hasObjectiveDevelopment('discipline') ? coaching.attendance.drafts.development : '',
      hasObjectiveDevelopment('conversations') ? coaching.conversation.drafts.development : '',
      dispensingDevelopment,
      hasObjectiveDevelopment('followups_requests') ? coaching.followups.drafts.development : '',
      hasObjectiveDevelopment('sales_quality') ? coaching.salesQuality.drafts.development : '',
      hasObjectiveDevelopment('inventory') ? coaching.inventory.drafts.development : '',
      hasObjectiveDevelopment('development') ? coaching.development.drafts.development : '',
      ...weakSectionNotes,
    ], 2);

    const examples = uniqueFeedbackLines([
      ...coaching.conversation.examples.slice(0, 2).map((example) =>
        `مراجعة محادثة ${example.date || 'بدون تاريخ'} بدرجة خدمة عميل ${example.score}/100 — يمكن فتح التقييم من دليل المحور.`
      ),
      coaching.attendance.lateCases + coaching.attendance.veryLateCases > 0
        ? `الحضور: ${coaching.attendance.lateCases + coaching.attendance.veryLateCases} حالة تأخير مسجلة بإجمالي ${coaching.attendance.lateMinutes} دقيقة.`
        : '',
      coaching.followups.open > 0
        ? `المتابعات: ${coaching.followups.open} متابعة ما زالت غير مكتملة من أصل ${coaching.followups.total}.`
        : '',
      coaching.salesQuality.conversation.invoiceErrors > 0
        ? `الفواتير: ${coaching.salesQuality.conversation.invoiceErrors} خطأ فاتورة موثق في مراجعات الدورة.`
        : '',
      coaching.inventory.weekly.unresolvedDiscrepancies > 0
        ? `المخزون: ${coaching.inventory.weekly.unresolvedDiscrepancies} فرق جرد غير محلول.`
        : '',
      coaching.development.repeatedIssues[0]
        ? `التعلم: الملاحظة «${coaching.development.repeatedIssues[0].label}» تكررت ${coaching.development.repeatedIssues[0].count} مرات.`
        : '',
    ], 3);

    const actions = uniqueFeedbackLines([
      hasObjectiveDevelopment('discipline') ? coaching.attendance.drafts.actionPlan : '',
      hasObjectiveDevelopment('conversations') ? coaching.conversation.drafts.actionPlan : '',
      hasObjectiveDevelopment('dispensing') && dispensingDevelopment
        ? 'مراجعة الحالات الدوائية الموثقة والتركيز على شرح الجرعة والاستشارة قبل إغلاق المحادثة.'
        : '',
      hasObjectiveDevelopment('followups_requests') ? coaching.followups.drafts.actionPlan : '',
      hasObjectiveDevelopment('sales_quality') ? coaching.salesQuality.drafts.actionPlan : '',
      hasObjectiveDevelopment('inventory') ? coaching.inventory.drafts.actionPlan : '',
      hasObjectiveDevelopment('development') ? coaching.development.drafts.actionPlan : '',
    ], 3);

    const measurements = uniqueFeedbackLines([
      hasObjectiveDevelopment('conversations') && coaching.conversation.weaknesses.length
        ? coaching.conversation.drafts.measurement
        : '',
      hasObjectiveDevelopment('discipline') && (coaching.attendance.lateCases + coaching.attendance.veryLateCases > 0)
        ? `في الدورة القادمة نقارن عدد حالات التأخير ودقائقه بالدورة الحالية (${coaching.attendance.lateCases + coaching.attendance.veryLateCases} حالة / ${coaching.attendance.lateMinutes} دقيقة).`
        : '',
      hasObjectiveDevelopment('followups_requests') && coaching.followups.total > 0
        ? `نقيس التحسن بمقارنة نسبة إكمال المتابعات الحالية ${coaching.followups.completionPct}% ونسبة التوثيق ${coaching.followups.documentedPct}% بالدورة القادمة.`
        : '',
      hasObjectiveDevelopment('sales_quality')
        ? 'نقيس التحسن على عينة جديدة من مراجعات البيع مع متابعة فرص البيع الضائعة وأخطاء الفاتورة الموثقة.'
        : '',
      hasObjectiveDevelopment('inventory')
        ? 'نقيس التحسن بعدد الأسابيع المتأخرة وفروق الجرد غير المحلولة وتحقيق أهداف الرواكد المسندة في الدورة القادمة.'
        : '',
      hasObjectiveDevelopment('dispensing')
        ? 'نقيس التحسن على عينة جديدة من الإرشاد الدوائي مع متابعة أي خطأ طبي/بديل غير مناسب ومتوسط شرح الجرعة والاستشارة.'
        : '',
      hasObjectiveDevelopment('development') ? coaching.development.drafts.measurement : '',
    ], 2);

    return { strengths, developments, examples, actions, measurements };
  }, [coaching, developmentSections, evaluationComplete, sections, strengthEvidenceGates]);

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

        {!employeeView && (!cycleClosed || requiresPostCycleReapproval) ? (
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

      <div className={employeeView ? 'grid gap-4' : 'grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]'}>
        <aside className={employeeView ? 'hidden' : 'rounded-3xl border p-3 xl:sticky xl:top-4 xl:h-fit'} style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}>
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
              <div className="text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                {filteredStaff.length === cycleSummary.total ? `${cycleSummary.total} موظف` : `${filteredStaff.length} من ${cycleSummary.total}`}
              </div>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-1.5">
              {[
                { label: 'المعتمد', value: cycleSummary.approved, tone: 'success' as const },
                { label: 'لم يطلع', value: receiptCounts.not_seen, tone: 'warning' as const },
                { label: 'اطلع', value: receiptCounts.seen, tone: 'success' as const },
                { label: 'علّق', value: receiptCounts.commented, tone: 'info' as const },
                { label: 'إعادة اعتماد', value: cycleSummary.needsReapproval, tone: 'danger' as const },
                { label: 'مسودة/لم يبدأ', value: cycleSummary.draft + cycleSummary.notStarted, tone: 'muted' as const },
              ].map((item) => {
                const style = item.tone === 'success'
                  ? { borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-status-success-bg)', color: 'var(--dawaa-status-success-text)' }
                  : item.tone === 'warning'
                    ? { borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)', color: 'var(--dawaa-status-warning-text)' }
                    : item.tone === 'danger'
                      ? { borderColor: 'var(--dawaa-status-danger-border)', background: 'var(--dawaa-status-danger-bg)', color: 'var(--dawaa-status-danger-text)' }
                      : item.tone === 'info'
                        ? { borderColor: 'var(--dawaa-status-info-border)', background: 'var(--dawaa-status-info-bg)', color: 'var(--dawaa-status-info-text)' }
                        : { borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)', color: 'var(--dawaa-theme-muted)' };

                return (
                  <div key={item.label} className="rounded-lg border px-2 py-1.5" style={style}>
                    <div className="text-[9px] font-black">{item.label}</div>
                    <div className="mt-0.5 text-sm font-black">{item.value}</div>
                  </div>
                );
              })}
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

            <div className="mt-2 border-t pt-2" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
              <div className="mb-1 text-[10px] font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>
                استلام التقييم
              </div>
              <div className="flex flex-wrap gap-1">
                {([
                  ['all', 'الكل', publishedStaff.length],
                  ['not_seen', 'لم يطلع', receiptCounts.not_seen],
                  ['seen', 'اطلع', receiptCounts.seen],
                  ['commented', 'علّق', receiptCounts.commented],
                ] as const).map(([value, label, count]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setReceiptFilter(value)}
                    className="rounded-lg border px-2 py-1 text-[10px] font-black"
                    style={receiptFilter === value
                      ? { borderColor: 'var(--dawaa-theme-accent-border)', background: 'var(--dawaa-theme-accent-soft)', color: 'var(--dawaa-theme-primary-strong)' }
                      : { borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }}
                  >
                    {label} · {count}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2 max-h-[72vh] space-y-1.5 overflow-y-auto">
              {orderedFilteredStaff.map((item, index) => {
                const previous = orderedFilteredStaff[index - 1];
                const groupKey = `${item.branch || 'بدون فرع'} · ${roleGroupLabel(item)}`;
                const previousGroupKey = previous ? `${previous.branch || 'بدون فرع'} · ${roleGroupLabel(previous)}` : '';
                const showGroup = groupKey !== previousGroupKey;
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
                const publishedEvaluation = ['sent', 'approved'].includes(String(item.evaluation_status || ''));
                const receiptLabel = !publishedEvaluation
                  ? ''
                  : item.evaluation_commented_at
                    ? 'علّق'
                    : item.evaluation_acknowledged_at
                      ? 'اطلع'
                      : 'لم يطلع';
                const receiptStyle = item.evaluation_commented_at
                  ? { borderColor: 'var(--dawaa-theme-accent-border)', color: 'var(--dawaa-theme-primary-strong)', background: 'var(--dawaa-theme-accent-soft)' }
                  : item.evaluation_acknowledged_at
                    ? { borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)', background: 'var(--dawaa-status-success-bg)' }
                    : { borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)', background: 'var(--dawaa-status-warning-bg)' };

                return (
                  <div key={item.id}>
                  {showGroup ? <div className="px-1 pb-1 pt-2 text-[10px] font-black" style={{color:'var(--dawaa-theme-muted)'}}>{groupKey}</div> : null}
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
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-[10px] font-black" style={{ color: statusColor }}>{statusLabel}</span>
                        {receiptLabel ? (
                          <span
                            className="rounded-md border px-1.5 py-0.5 text-[9px] font-black"
                            style={receiptStyle}
                            title={
                              item.evaluation_commented_at
                                ? `علّق في ${new Date(item.evaluation_commented_at).toLocaleString('ar-EG')}`
                                : item.evaluation_acknowledged_at
                                  ? `اطلع في ${new Date(item.evaluation_acknowledged_at).toLocaleString('ar-EG')}`
                                  : 'لم يسجل اطلاعًا على التقييم حتى الآن'
                            }
                          >
                            {receiptLabel}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                  </div>
                );
              })}
              {!orderedFilteredStaff.length ? (
                <div className="rounded-xl border border-dashed p-4 text-center text-xs font-bold" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }}>
                  {receiptFilter === 'all' ? 'لا يوجد موظف مطابق للبحث.' : 'لا يوجد موظف في حالة الاستلام المختارة.'}
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        <main className="space-y-4">
          {staffLoading && !staff.length ? (
            <Panel className="p-10 text-center"><Loader2 className="mx-auto animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /> <span style={{ color: 'var(--dawaa-theme-muted)' }}>جاري تحميل الموظفين...</span></Panel>
          ) : evaluationLoadError && selected ? (
            <Panel className="p-5">
              <div className="text-sm font-black" style={{color:'var(--dawaa-status-danger-text)'}}>تعذر تحميل تفاصيل التقييم</div>
              <div className="mt-1 text-xs font-bold" style={{color:'var(--dawaa-theme-muted)'}}>{evaluationLoadError}</div>
              <div className="mt-2 text-xs font-bold" style={{color:'var(--dawaa-theme-muted)'}}>اختيار الموظف مرة أخرى يعيد المحاولة بدون فقد قائمة الموظفين.</div>
            </Panel>
          ) : selected ? (
            <>
              {evaluationLoading ? <div className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold" style={{borderColor:'var(--dawaa-theme-border)',background:'var(--dawaa-theme-soft)',color:'var(--dawaa-theme-muted)'}}><Loader2 size={14} className="animate-spin"/> جاري تحديث تفاصيل الموظف…</div> : null}
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

              {employeeView ? (
                employeeEvaluationPublished ? (
                  <section className="space-y-3">
                    <Panel className="overflow-hidden p-0">
                      <div className="border-b p-4" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)' }}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>تقييمك الشهري المعتمد</div>
                            <h2 className="mt-1 text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                              دورة {cycleRange.displayLabel}
                            </h2>
                            <div className="mt-1 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-muted)' }}>
                              ابدأ بالمميزات وخطة التطوير، وبعدها راجع تفاصيل المحاور لو حابب تعرف توزيع الدرجة.
                            </div>
                          </div>
                          <div className="text-left">
                            <div className="text-3xl font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>{overallScore}/100</div>
                            <div className="mt-1 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>{grade}</div>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 p-4 lg:grid-cols-2">
                        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-status-success-bg)' }}>
                          <div className="text-xs font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>مميزاتك هذا الشهر</div>
                          {strengthsText.trim() ? (
                            <div className="mt-2 space-y-1.5 text-sm font-bold leading-7" style={{ color: 'var(--dawaa-theme-text)' }}>
                              {strengthsText.split('\n').map((item) => item.trim()).filter(Boolean).map((item) => <div key={item}>• {item}</div>)}
                            </div>
                          ) : (
                            <div className="mt-2 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>لا توجد نقطة قوة مكتوبة في هذا التقييم.</div>
                          )}
                        </div>

                        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)' }}>
                          <div className="text-xs font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>أهم حاجة نطورها</div>
                          {developmentText.trim() ? (
                            <div className="mt-2 space-y-1.5 text-sm font-bold leading-7" style={{ color: 'var(--dawaa-theme-text)' }}>
                              {developmentText.split('\n').map((item) => item.trim()).filter(Boolean).map((item) => <div key={item}>• {item}</div>)}
                            </div>
                          ) : (
                            <div className="mt-2 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>لا توجد خطة تطوير مكتوبة في هذا التقييم.</div>
                          )}
                        </div>
                      </div>

                      {managerNotes.trim() ? (
                        <div className="mx-4 mb-4 rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}>
                          <div className="text-xs font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>ملاحظة المدير</div>
                          <div className="mt-2 whitespace-pre-wrap text-sm font-bold leading-7" style={{ color: 'var(--dawaa-theme-text)' }}>{managerNotes}</div>
                        </div>
                      ) : null}
                    </Panel>

                    <Panel className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>تفاصيل المحاور</div>
                          <div className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                            الدرجة والملاحظة المكتوبة لكل محور، بدون تفاصيل النظام الداخلية.
                          </div>
                        </div>
                        <span className="rounded-full border px-2.5 py-1 text-[10px] font-black" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }}>
                          {sections.length} محاور
                        </span>
                      </div>

                      <div className="mt-3 grid gap-2 lg:grid-cols-2">
                        {sections.map((item) => (
                          <div key={item.key} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)' }}>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-xs font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{item.title}</div>
                                <div className="mt-1 text-[11px] font-bold leading-5" style={{ color: 'var(--dawaa-theme-muted)' }}>{item.description}</div>
                              </div>
                              <div className="shrink-0 text-left">
                                <div className="text-sm font-black" style={{ color: item.score >= 4 ? 'var(--dawaa-status-success-text)' : item.score <= 2 ? 'var(--dawaa-status-danger-text)' : 'var(--dawaa-status-warning-text)' }}>
                                  {item.score}/5
                                </div>
                                <div className="mt-0.5 text-[10px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{sectionPoints(item)}/{item.weight}</div>
                              </div>
                            </div>
                            <div className="mt-2 flex gap-0.5" aria-label={`${item.score} من 5`}>
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Star
                                  key={star}
                                  size={14}
                                  fill={star <= item.score ? 'currentColor' : 'none'}
                                  style={{ color: star <= item.score ? 'var(--dawaa-status-warning-text)' : 'var(--dawaa-theme-border)' }}
                                />
                              ))}
                            </div>
                            {item.notes.trim() ? (
                              <div className="mt-2 rounded-lg border px-2.5 py-2 text-xs font-bold leading-6" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }}>
                                {item.notes}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </Panel>

                    <Panel className="p-4">
                      <div className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>النقاط والحافز</div>
                      <div className="mt-1 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-muted)' }}>
                        نقاط الأداء والحافز منفصلان عن درجة التقييم الشهري.
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
                      {!settledStatement && pointsTruth ? (
                        <div className="mt-2 text-[11px] font-bold leading-5" style={{ color: 'var(--dawaa-theme-muted)' }}>
                          المبلغ المعروض قراءة من Points Truth، وقد يظل غير نهائي حتى إقفال كشف الحافز.
                        </div>
                      ) : null}
                    </Panel>

                    <Panel className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>استلام التقييم</div>
                          <div className="mt-1 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-muted)' }}>
                            تأكيد الاطلاع لا يعني الموافقة على كل التفاصيل، ولا يغيّر أي درجة أو نقطة أو حافز.
                          </div>
                        </div>
                        <span
                          className="rounded-full border px-2.5 py-1 text-[10px] font-black"
                          style={employeeResponse?.acknowledged
                            ? { borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)' }
                            : { borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)' }}
                        >
                          {employeeResponse?.acknowledged ? 'تم الاطلاع' : 'بانتظار تأكيدك'}
                        </span>
                      </div>

                      {employeeResponse?.acknowledged ? (
                        <div className="mt-3 rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-status-success-bg)', color: 'var(--dawaa-status-success-text)' }}>
                          تم تسجيل اطلاعك{employeeResponse.acknowledged_at ? ` في ${new Date(employeeResponse.acknowledged_at).toLocaleString('ar-EG')}` : ''}.
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={employeeResponseSaving}
                          onClick={() => void acknowledgeEmployeeEvaluation()}
                          className="btn-primary mt-3 inline-flex items-center gap-2 disabled:opacity-60"
                        >
                          {employeeResponseSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                          اطلعت على التقييم
                        </button>
                      )}

                      <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                        <div className="text-xs font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>تعليقك على التقييم</div>
                        <div className="mt-1 text-[11px] font-bold leading-5" style={{ color: 'var(--dawaa-theme-muted)' }}>
                          اختياري، تعليق واحد فقط. استخدمه لتوضيح معلومة أو تأكيد خطة التطوير، بدون تعديل نتيجة التقييم.
                        </div>

                        {employeeResponse?.comment ? (
                          <div className="mt-2 rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)' }}>
                            <div className="whitespace-pre-wrap text-sm font-bold leading-7" style={{ color: 'var(--dawaa-theme-text)' }}>{employeeResponse.comment}</div>
                            {employeeResponse.commented_at ? (
                              <div className="mt-1 text-[10px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                                تم التسجيل في {new Date(employeeResponse.commented_at).toLocaleString('ar-EG')}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <>
                            <textarea
                              value={employeeCommentDraft}
                              onChange={(event) => setEmployeeCommentDraft(event.target.value.slice(0, 1000))}
                              rows={3}
                              placeholder="اكتب ملاحظتك باختصار..."
                              className="mt-2 w-full rounded-xl border px-3 py-2 text-sm font-bold"
                              style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-text)' }}
                            />
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[10px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{employeeCommentDraft.length}/1000</span>
                              <button
                                type="button"
                                disabled={employeeResponseSaving || employeeCommentDraft.trim().length < 3}
                                onClick={() => void submitEmployeeEvaluationComment()}
                                className="btn-secondary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                {employeeResponseSaving ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                                إرسال التعليق
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </Panel>

                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        disabled={exportingPdf || !evaluationComplete}
                        onClick={() => void handleExportPdf()}
                        className="btn-secondary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {exportingPdf ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
                        تحميل PDF
                      </button>
                    </div>
                  </section>
                ) : (
                  <Panel className="p-8 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)', color: 'var(--dawaa-theme-primary-strong)' }}>
                      <Clock3 size={22} />
                    </div>
                    <div className="mt-3 text-base font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>التقييم لم يُعتمد بعد</div>
                    <div className="mx-auto mt-2 max-w-xl text-sm font-bold leading-7" style={{ color: 'var(--dawaa-theme-muted)' }}>
                      تقييم دورة {cycleRange.displayLabel} لم يتم اعتماده وإرساله لك حتى الآن. بعد الاعتماد ستظهر هنا الدرجة والمميزات وخطة التطوير.
                    </div>
                  </Panel>
                )
              ) : null}

              {!employeeView && selected ? (
                <EmployeeEvaluationHeaderV1
                  name={selected.name}
                  role={selected.job_title || selected.role || 'غير محدد'}
                  branch={selected.branch || branch}
                  cycle={cycleRange.displayLabel}
                  summary={employeeHeader}
                  loading={employeeHeaderLoading}
                />
              ) : null}

              {!employeeView && selected ? (
                <EvaluationDecisionHeaderV1
                  employeeName={selected.name}
                  role={selected.job_title || selected.role || 'غير محدد'}
                  branch={selected.branch || branch}
                  cycle={cycleRange.displayLabel}
                  score={evaluationComplete ? overallScore : null}
                  completed={completedSections}
                  total={sections.length}
                  evidenceReady={evidenceReady}
                  status={status}
                  blockers={approvalBlockers}
                  incentive={canonicalIncentive}
                  settled={Boolean(settledStatement)}
                />
              ) : null}

              {!employeeView ? (
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
                blockers={approvalBlockers}
              />
              ) : null}

              {!employeeView && activeStep === 1 ? (
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

              {!employeeView && activeStep === 3 ? (
                <Panel className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>المخالفات الحرجة</div>
                      <div className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                        فعّل فقط المخالفة المؤكدة لأنها تؤثر على معامل حافز النقاط الأساسي فقط؛ لا تغيّر درجة التقييم، ومكافأة المنافسة مستقلة.
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
                          <span>{active ? (gate.blocksFully ? 'حافز النقاط الأساسي 0%' : `حد معامل حافز النقاط ${gate.capPercent}%`) : 'غير مفعلة'}</span>
                        </button>
                      );
                    })}
                  </div>

                  {isGatedByCriticalViolation ? (
                    <div className="mt-3 rounded-xl border px-3 py-2 text-xs font-black" style={{ borderColor: 'var(--dawaa-status-danger-border)', background: 'var(--dawaa-status-danger-bg)', color: 'var(--dawaa-status-danger-text)' }}>
                      {effectiveEvaluationMultiplierPct == null
                        ? 'معامل حافز النقاط الأساسي يظهر بعد اكتمال كل محاور التقييم.'
                        : `درجة التقييم ${overallScore}% · معامل حافز النقاط الأساسي ${effectiveEvaluationMultiplierPct}%`}
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

              {!employeeView && activeStep === 2 ? (
                <section className="space-y-2">
                  {sections.map((item) => {
                    const sectionEvidence = sectionEvidenceFor(item.key, selected?.job_title || selected?.role, metrics, evidenceHealth, pointsTruth, coaching);
                    const conversationEvidence = isConversationSectionKey(item.key) ? coaching?.conversation : null;
                    return (
                      <EvaluationAxisCardV1
                        key={item.key}
                        axisKey={item.key}
                        title={item.title}
                        description={item.description}
                        weight={item.weight}
                        score={item.score}
                        earned={sectionPoints(item)}
                        rubricText={item.score > 0 && item.rubric ? item.rubric[item.score - 1] : null}
                        evidence={{ ...sectionEvidence, examples: conversationEvidence?.examples }}
                        note={item.notes}
                        canEdit={canEdit}
                        onScore={(score) => updateSection(item.key, { score })}
                        onNote={(notes) => updateSection(item.key, { notes })}
                      />
                    );
                  })}
                </section>
              ) : null}

              {!employeeView && activeStep === 4 ? (
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

                  {evaluationComplete ? (
                    <div className="mt-3 rounded-2xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>مسودة الملاحظة النهائية للموظف</div>
                          <div className="mt-1 text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                            مختصرة من الأدلة المرتبطة بدرجات المدير، بدون تكرار نفس الملاحظة في أكثر من محور.
                          </div>
                        </div>
                        <span className="rounded-full border px-2 py-1 text-[10px] font-black" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }}>
                          {employeeFeedbackDraft.strengths.length} قوة · {employeeFeedbackDraft.developments.length} تطوير
                        </span>
                      </div>

                      <div className="mt-3 grid gap-2 lg:grid-cols-2">
                        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-theme-soft)' }}>
                          <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>أبرز المميزات المثبتة</div>
                          {employeeFeedbackDraft.strengths.length ? (
                            <div className="mt-2 space-y-1.5 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>
                              {employeeFeedbackDraft.strengths.map((item) => <div key={item}>• {item}</div>)}
                            </div>
                          ) : (
                            <div className="mt-2 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                              لا يوجد دليل كافٍ لإضافة نقطة قوة تلقائيًا من المحاور الحاصلة على 4–5 نجوم.
                            </div>
                          )}
                        </div>

                        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-theme-soft)' }}>
                          <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-status-warning-text)' }}>أهم فرص التطوير</div>
                          {employeeFeedbackDraft.developments.length ? (
                            <div className="mt-2 space-y-1.5 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>
                              {employeeFeedbackDraft.developments.map((item) => <div key={item}>• {item}</div>)}
                            </div>
                          ) : (
                            <div className="mt-2 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                              لا توجد فرصة تطوير موثقة متوافقة مع درجات 1–3 الحالية.
                            </div>
                          )}
                        </div>

                        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)' }}>
                          <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-theme-primary-strong)' }}>أمثلة وأدلة للمراجعة</div>
                          {employeeFeedbackDraft.examples.length ? (
                            <div className="mt-2 space-y-1.5 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>
                              {employeeFeedbackDraft.examples.map((item) => <div key={item}>• {item}</div>)}
                            </div>
                          ) : (
                            <div className="mt-2 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>لا يوجد مثال إضافي يحتاج إبرازه في الملخص.</div>
                          )}
                        </div>

                        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-status-info-border)', background: 'var(--dawaa-theme-soft)' }}>
                          <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-status-info-text)' }}>خطة الشهر القادم وقياس التحسن</div>
                          <div className="mt-2 space-y-1.5 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>
                            {employeeFeedbackDraft.actions.map((item) => <div key={item}>• {item}</div>)}
                            {employeeFeedbackDraft.measurements.map((item) => <div key={item}>• قياس: {item}</div>)}
                            {!employeeFeedbackDraft.actions.length && !employeeFeedbackDraft.measurements.length ? (
                              <div style={{ color: 'var(--dawaa-theme-muted)' }}>لا توجد خطة آلية؛ اكتب خطة يدوية إذا كان هناك هدف تطوير خاص.</div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {canEdit ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {employeeFeedbackDraft.strengths.length ? (
                            <button
                              type="button"
                              onClick={() => setStrengthsText((current) => appendUniqueLines(current, employeeFeedbackDraft.strengths))}
                              className="rounded-lg border px-2.5 py-1.5 text-[11px] font-black"
                              style={{ borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)' }}
                            >
                              إضافة المميزات المقترحة
                            </button>
                          ) : null}
                          {employeeFeedbackDraft.developments.length || employeeFeedbackDraft.actions.length || employeeFeedbackDraft.measurements.length ? (
                            <button
                              type="button"
                              onClick={() => setDevelopmentText((current) => appendUniqueLines(current, [
                                ...employeeFeedbackDraft.developments,
                                ...employeeFeedbackDraft.actions,
                                ...employeeFeedbackDraft.measurements.map((item) => `مقياس التحسن: ${item}`),
                              ]))}
                              className="rounded-lg border px-2.5 py-1.5 text-[11px] font-black"
                              style={{ borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)' }}
                            >
                              إضافة التطوير والخطة
                            </button>
                          ) : null}
                        </div>
                      ) : null}
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
                            {coaching.conversation.drafts.strength && canUseStrengthDraft('conversations', 'conversation') ? (
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

                  {(coaching?.attendance.activeLedgerEvents || coaching?.followups.total) ? (
                    <div className="mt-3 grid gap-2 lg:grid-cols-2">
                      {coaching?.attendance.activeLedgerEvents ? (
                        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}>
                          <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>Coaching سجل الحضور</div>
                          <div className="mt-2 space-y-1.5 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>
                            {coaching.attendance.drafts.strength ? <div style={{ color: 'var(--dawaa-status-success-text)' }}>{coaching.attendance.drafts.strength}</div> : null}
                            {coaching.attendance.drafts.development ? <div style={{ color: 'var(--dawaa-status-warning-text)' }}>{coaching.attendance.drafts.development}</div> : null}
                            {coaching.attendance.drafts.actionPlan ? <div>{coaching.attendance.drafts.actionPlan}</div> : null}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {coaching.attendance.drafts.strength && canUseStrengthDraft('discipline', 'attendance', 'shift_discipline') ? (
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
                            {coaching.followups.drafts.strength && canUseStrengthDraft('followups_requests') ? (
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

                  {coaching?.salesQuality && (
                    coaching.salesQuality.conversation.samples > 0
                    || coaching.salesQuality.invoicePerformance.available
                    || coaching.salesQuality.notes.length > 0
                  ) ? (
                    <div className="mt-3 rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>Coaching جودة البيع والفاتورة</div>
                          <div className="mt-1 text-[10px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                            يفصل بين مهارة البيع، أداء قيمة/تركيب الفاتورة، وخطأ الفاتورة الموثق.
                          </div>
                        </div>
                        <span
                          className="rounded-full border px-2 py-1 text-[10px] font-black"
                          style={coaching.salesQuality.sourceStatus === 'available'
                            ? { borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)' }
                            : { borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)' }}
                        >
                          {coaching.salesQuality.sourceStatus === 'available' ? 'دليل متاح' : 'يحتاج حكم المدير'}
                        </span>
                      </div>

                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <MiniBox
                          label="جودة البيع"
                          value={coaching.salesQuality.conversation.salesQuality === null ? '—' : `${coaching.salesQuality.conversation.salesQuality}/10`}
                          tone="cyan"
                        />
                        <MiniBox
                          label="أخطاء فاتورة موثقة"
                          value={String(coaching.salesQuality.conversation.invoiceErrors)}
                          tone={coaching.salesQuality.conversation.invoiceErrors > 0 ? 'red' : 'green'}
                        />
                        <MiniBox
                          label="أداء الفاتورة مقابل الخط"
                          value={coaching.salesQuality.invoicePerformance.weightedPctVsBaseline === null
                            ? 'غير متاح'
                            : `${coaching.salesQuality.invoicePerformance.weightedPctVsBaseline > 0 ? '+' : ''}${coaching.salesQuality.invoicePerformance.weightedPctVsBaseline}%`}
                          tone="cyan"
                        />
                      </div>

                      <div className="mt-2 space-y-1.5 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>
                        {coaching.salesQuality.drafts.strength ? <div style={{ color: 'var(--dawaa-status-success-text)' }}>{coaching.salesQuality.drafts.strength}</div> : null}
                        {coaching.salesQuality.drafts.development ? <div style={{ color: 'var(--dawaa-status-warning-text)' }}>{coaching.salesQuality.drafts.development}</div> : null}
                        {coaching.salesQuality.drafts.actionPlan ? <div>{coaching.salesQuality.drafts.actionPlan}</div> : null}
                        {coaching.salesQuality.notes.map((note) => <div key={note} style={{ color: 'var(--dawaa-theme-muted)' }}>• {note}</div>)}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {coaching.salesQuality.drafts.strength && canUseStrengthDraft('sales_quality') ? (
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => setStrengthsText((current) => appendUniqueLine(current, coaching.salesQuality.drafts.strength))}
                            className="rounded-lg border px-2 py-1 text-[10px] font-black disabled:cursor-default"
                            style={{ borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)' }}
                          >
                            إضافة القوة
                          </button>
                        ) : null}
                        {coaching.salesQuality.drafts.development || coaching.salesQuality.drafts.actionPlan ? (
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => setDevelopmentText((current) => appendUniqueLine(
                              appendUniqueLine(current, coaching.salesQuality.drafts.development),
                              coaching.salesQuality.drafts.actionPlan
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

                  {coaching?.development && (
                    coaching.development.training.assigned > 0
                    || coaching.development.reviewTrend.measurable
                    || coaching.development.repeatedIssues.length > 0
                    || coaching.development.notes.length > 0
                  ) ? (
                    <div className="mt-3 rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>Coaching التعلم والتحسن</div>
                          <div className="mt-1 text-[10px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                            تدريب مسند + اتجاه مراجعات + تكرار الملاحظة بعد التوجيه.
                          </div>
                        </div>
                        <span
                          className="rounded-full border px-2 py-1 text-[10px] font-black"
                          style={coaching.development.sourceStatus === 'available'
                            ? { borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)' }
                            : { borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)' }}
                        >
                          {coaching.development.sourceStatus === 'available' ? 'دليل متاح' : 'يحتاج حكم المدير'}
                        </span>
                      </div>

                      <div className="mt-2 space-y-1.5 text-xs font-bold leading-6" style={{ color: 'var(--dawaa-theme-text)' }}>
                        {coaching.development.drafts.strength ? <div style={{ color: 'var(--dawaa-status-success-text)' }}>{coaching.development.drafts.strength}</div> : null}
                        {coaching.development.drafts.development ? <div style={{ color: 'var(--dawaa-status-warning-text)' }}>{coaching.development.drafts.development}</div> : null}
                        {coaching.development.drafts.actionPlan ? <div>{coaching.development.drafts.actionPlan}</div> : null}
                        <div style={{ color: 'var(--dawaa-theme-muted)' }}>{coaching.development.drafts.measurement}</div>
                        {coaching.development.notes.map((note) => <div key={note} style={{ color: 'var(--dawaa-theme-muted)' }}>• {note}</div>)}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {coaching.development.drafts.strength && canUseStrengthDraft('development') ? (
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => setStrengthsText((current) => appendUniqueLine(current, coaching.development.drafts.strength))}
                            className="rounded-lg border px-2 py-1 text-[10px] font-black disabled:cursor-default"
                            style={{ borderColor: 'var(--dawaa-status-success-border)', color: 'var(--dawaa-status-success-text)' }}
                          >
                            إضافة القوة
                          </button>
                        ) : null}
                        {coaching.development.drafts.development || coaching.development.drafts.actionPlan ? (
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => setDevelopmentText((current) => appendUniqueLine(
                              appendUniqueLine(
                                appendUniqueLine(current, coaching.development.drafts.development),
                                coaching.development.drafts.actionPlan
                              ),
                              coaching.development.drafts.measurement
                            ))}
                            className="rounded-lg border px-2 py-1 text-[10px] font-black disabled:cursor-default"
                            style={{ borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)' }}
                          >
                            إضافة خطة التحسن
                          </button>
                        ) : null}
                      </div>
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
                        {coaching.inventory.drafts.strength && canUseStrengthDraft('inventory') ? (
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
                            onClick={() => setStrengthsText((current) => appendUniqueLine(
                              current,
                              item.notes.trim() ? `${item.title}: ${item.notes.trim()}` : item.title
                            ))}
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
                            onClick={() => setDevelopmentText((current) => appendUniqueLine(current, item.notes.trim() ? `${item.title}: ${item.notes.trim()}` : item.title))}
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

              {!employeeView && activeStep === 5 ? (
                <section className="space-y-3">
                  <FinalEvaluationReviewV1
                    ready={approvalReady}
                    blockers={approvalBlockers}
                    score={evaluationComplete ? overallScore : null}
                    completed={completedSections}
                    total={sections.length}
                    criticalCount={activeGates.length}
                    incentive={canonicalIncentive}
                    incentiveSettled={Boolean(settledStatement)}
                    strengths={strengthsText}
                    development={developmentText}
                    managerNotes={managerNotes}
                  />

                  <Panel className="p-4">
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
                        {publishedSnapshotHash ? (
                          <div className="mb-2 text-[10px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                            بصمة النسخة المعتمدة: {publishedSnapshotHash.slice(0, 12)}
                          </div>
                        ) : null}
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
              {!employeeView ? (
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
