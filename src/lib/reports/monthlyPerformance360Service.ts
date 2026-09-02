import { supabase } from '@/lib/supabase';
import { fetchSalesInvoicesPagedSafe } from '@/lib/salesInvoiceQueries';
import { computeStaffSalesMetrics } from '@/lib/salesInvoiceSource';
import { readAttendanceRange } from '@/lib/readModels/attendanceReadModel';
import { getStaffPointsDashboardV3, type StaffPointsDashboardV3 } from '@/lib/staff/staffPointsDashboardService';
import { canonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';
import {
  evaluationCycleQueryBounds,
  evaluationCycleRangeFromLabel,
} from '@/lib/evaluations/monthlyEvaluationCycle';

export type ReportSourceStatus = 'available' | 'partial' | 'unavailable';

export type Monthly360Pillar = {
  key: 'points' | 'sales_linking' | 'conversations' | 'followups' | 'manager_evaluation';
  label: string;
  weight: number;
  score: number | null;
  status: ReportSourceStatus;
  detail: string;
};

export type MonthlyPerformance360Report = {
  employee: {
    id: string;
    name: string;
    role: string;
    canonicalRole: string;
    branch: string;
  };
  cycle: {
    label: string;
    displayLabel: string;
    startDate: string;
    endDate: string;
  };
  sales: {
    status: ReportSourceStatus;
    totalSales: number;
    invoiceCount: number;
    averageInvoice: number;
    customersHandled: number;
    linkedInvoices: number;
    linkingRate: number | null;
  };
  points: {
    status: ReportSourceStatus;
    dashboard: StaffPointsDashboardV3 | null;
  };
  attendance: {
    status: ReportSourceStatus;
    recordedDays: number;
    presentDays: number;
    absentDays: number;
    note: string;
  };
  conversations: {
    status: ReportSourceStatus;
    count: number;
    averageScore: number | null;
  };
  followups: {
    status: ReportSourceStatus;
    total: number;
    completed: number;
    completionRate: number | null;
  };
  managerEvaluation: {
    status: ReportSourceStatus;
    score: number | null;
  };
  pillars: Monthly360Pillar[];
  overall: {
    score: number | null;
    grade: string;
    coveragePct: number;
    availableWeight: number;
  };
  warnings: string[];
};

function numberOrZero(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

function normalizeReviewScore(value: number) {
  if (value <= 0) return 0;
  return clampScore(value <= 5 ? value * 20 : value);
}

function completedFollowup(row: Record<string, unknown>) {
  const status = String(row.followup_status ?? row.status ?? '').trim().toLowerCase();
  return Boolean(row.completed_at) || ['completed', 'done', 'closed', 'تم', 'مكتمل', 'تمت'].some((token) => status.includes(token));
}

function gradeFor(score: number | null, coveragePct: number) {
  if (score == null) return coveragePct > 0 ? 'بيانات غير كافية' : 'لم يبدأ القياس';
  if (score >= 90) return 'ممتاز';
  if (score >= 80) return 'جيد جدًا';
  if (score >= 70) return 'جيد';
  if (score >= 60) return 'مقبول';
  return 'يحتاج تحسين';
}

function evaluationScoreFrom(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  for (const key of ['overall_score', 'final_score', 'evaluation_score', 'score']) {
    const number = Number(row[key]);
    if (Number.isFinite(number) && number > 0) return clampScore(number <= 5 ? number * 20 : number);
  }
  if (Array.isArray(row.sections) && row.sections.length) {
    let earned = 0;
    let weight = 0;
    for (const item of row.sections as Record<string, unknown>[]) {
      const itemWeight = numberOrZero(item.weight);
      const itemScore = numberOrZero(item.score);
      if (itemWeight > 0 && itemScore > 0) {
        earned += (itemScore / 5) * itemWeight;
        weight += itemWeight;
      }
    }
    if (weight > 0) return clampScore((earned / weight) * 100);
  }
  return null;
}

export async function loadMonthlyPerformance360(args: {
  actorId: string;
  staffId: string;
  cycleLabel: string;
}): Promise<MonthlyPerformance360Report> {
  const { actorId, staffId, cycleLabel } = args;
  if (!actorId || !staffId || !cycleLabel) throw new Error('بيانات التقرير غير مكتملة.');

  const range = evaluationCycleRangeFromLabel(cycleLabel);
  const { startDate, endDateExclusive } = evaluationCycleQueryBounds(cycleLabel);
  const endDate = range.end.toISOString().slice(0, 10);
  const warnings: string[] = [];

  const staffResult = await supabase
    .from('staff')
    .select('id,name,role,branch,status,is_active')
    .eq('id', staffId)
    .single();
  if (staffResult.error || !staffResult.data) {
    throw new Error(staffResult.error?.message || 'تعذر تحميل بيانات الموظف.');
  }
  const staff = staffResult.data as Record<string, unknown>;
  const employeeName = String(staff.name || 'موظف');
  const employeeRole = String(staff.role || 'غير محدد');
  const employeeBranch = String(staff.branch || 'غير محدد');

  const salesErrors: string[] = [];
  const [salesSettled, pointsSettled, attendanceSettled, conversationsSettled, followupsSettled, evaluationSettled] = await Promise.allSettled([
    fetchSalesInvoicesPagedSafe({
      startDate,
      endDate,
      branch: employeeBranch,
      pageSize: 1000,
      maxPages: 50,
      errors: salesErrors,
    }),
    getStaffPointsDashboardV3(staffId, cycleLabel),
    readAttendanceRange({ staffId, startDate, endDateExclusive, limit: 400 }),
    supabase
      .from('conversation_sales_reviews')
      .select('total_score,final_score,score,created_at')
      .eq('staff_id', staffId)
      .gte('created_at', startDate)
      .lt('created_at', endDateExclusive)
      .limit(1000),
    supabase
      .from('daily_followups')
      .select('status,followup_status,completed_at,created_at,assigned_staff_id,requested_by_staff_id')
      .or(`assigned_staff_id.eq.${staffId},requested_by_staff_id.eq.${staffId}`)
      .gte('created_at', startDate)
      .lt('created_at', endDateExclusive)
      .limit(2000),
    supabase.rpc('get_staff_monthly_evaluation_safe', {
      p_actor_id: actorId,
      p_staff_id: staffId,
      p_month: `${cycleLabel}-01`,
    }),
  ]);

  let salesStatus: ReportSourceStatus = 'unavailable';
  let totalSales = 0;
  let invoiceCount = 0;
  let averageInvoice = 0;
  let customersHandled = 0;
  let linkedInvoices = 0;
  let linkingRate: number | null = null;
  if (salesSettled.status === 'fulfilled') {
    const rows = salesSettled.value;
    const metrics = computeStaffSalesMetrics(employeeName, rows);
    totalSales = metrics.totalSales;
    invoiceCount = metrics.invoiceCount;
    averageInvoice = metrics.averageInvoice;
    customersHandled = metrics.customersHandled;
    const normalizedName = employeeName.trim().toLowerCase();
    const ownRows = rows.filter((row) => {
      const seller = String(row.normalized_seller_name ?? row.seller_name ?? row.staff_name ?? '').trim().toLowerCase();
      return seller === normalizedName;
    });
    linkedInvoices = ownRows.filter((row) => String(row.customer_code || '').trim()).length;
    linkingRate = invoiceCount > 0 ? clampScore((linkedInvoices / invoiceCount) * 100) : null;
    salesStatus = salesErrors.length ? 'partial' : 'available';
    if (salesErrors.length) warnings.push(...salesErrors);
  } else {
    warnings.push(`تعذر تحميل المبيعات: ${salesSettled.reason instanceof Error ? salesSettled.reason.message : 'خطأ غير معروف'}`);
  }

  let pointsDashboard: StaffPointsDashboardV3 | null = null;
  let pointsStatus: ReportSourceStatus = 'unavailable';
  if (pointsSettled.status === 'fulfilled') {
    pointsDashboard = pointsSettled.value;
    pointsStatus = pointsDashboard.profile_configured ? 'available' : 'partial';
    if (!pointsDashboard.profile_configured) warnings.push('ملف تعويض الموظف غير مكتمل؛ تم عرض النقاط المتاحة بدون افتراض حافز.');
  } else {
    warnings.push(`تعذر تحميل النقاط: ${pointsSettled.reason instanceof Error ? pointsSettled.reason.message : 'خطأ غير معروف'}`);
  }

  let attendanceStatus: ReportSourceStatus = 'unavailable';
  let recordedDays = 0;
  let presentDays = 0;
  let absentDays = 0;
  let attendanceNote = 'الحضور غير متاح.';
  if (attendanceSettled.status === 'fulfilled') {
    const result = attendanceSettled.value;
    if (result.status === 'available') {
      attendanceStatus = 'available';
      recordedDays = result.rows.length;
      presentDays = result.rows.filter((row) => String(row.status || '').toLowerCase() === 'present').length;
      absentDays = result.rows.filter((row) => ['absent', 'غياب', 'غائب'].includes(String(row.status || '').toLowerCase())).length;
      attendanceNote = 'الحضور معروض كمعلومة تشغيلية فقط؛ لا يدخل الدرجة المركبة بدون جدول أيام عمل متوقع موحد.';
    } else {
      warnings.push(`الحضور غير متاح: ${result.error}`);
    }
  } else {
    warnings.push('تعذر تحميل الحضور.');
  }

  let conversationStatus: ReportSourceStatus = 'unavailable';
  let conversationCount = 0;
  let averageConversationScore: number | null = null;
  if (conversationsSettled.status === 'fulfilled') {
    const result = conversationsSettled.value;
    if (result.error) {
      warnings.push(`تعذر تحميل تقييمات المحادثات: ${result.error.message}`);
    } else {
      const rows = (result.data || []) as Record<string, unknown>[];
      conversationCount = rows.length;
      const scores = rows
        .map((row) => numberOrZero(row.final_score ?? row.total_score ?? row.score))
        .filter((value) => value > 0)
        .map(normalizeReviewScore);
      averageConversationScore = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
      conversationStatus = 'available';
    }
  } else {
    warnings.push('تعذر تحميل تقييمات المحادثات.');
  }

  let followupStatus: ReportSourceStatus = 'unavailable';
  let followupTotal = 0;
  let followupCompleted = 0;
  let followupCompletionRate: number | null = null;
  if (followupsSettled.status === 'fulfilled') {
    const result = followupsSettled.value;
    if (result.error) {
      warnings.push(`تعذر تحميل المتابعات: ${result.error.message}`);
    } else {
      const rows = (result.data || []) as Record<string, unknown>[];
      followupTotal = rows.length;
      followupCompleted = rows.filter(completedFollowup).length;
      followupCompletionRate = followupTotal > 0 ? clampScore((followupCompleted / followupTotal) * 100) : null;
      followupStatus = 'available';
    }
  } else {
    warnings.push('تعذر تحميل المتابعات.');
  }

  let managerEvaluationStatus: ReportSourceStatus = 'unavailable';
  let managerEvaluationScore: number | null = null;
  if (evaluationSettled.status === 'fulfilled') {
    const result = evaluationSettled.value;
    if (result.error) {
      warnings.push(`تعذر تحميل تقييم المدير: ${result.error.message}`);
    } else {
      managerEvaluationScore = evaluationScoreFrom(result.data);
      managerEvaluationStatus = 'available';
    }
  } else {
    warnings.push('تعذر تحميل تقييم المدير.');
  }

  const pillars: Monthly360Pillar[] = [
    {
      key: 'points',
      label: 'النقاط والحافز',
      weight: 35,
      score: pointsDashboard?.profile_configured && pointsDashboard.target_points > 0 ? clampScore(pointsDashboard.progress_pct) : null,
      status: pointsStatus,
      detail: pointsDashboard ? `${pointsDashboard.final_points} / ${pointsDashboard.target_points} نقطة` : 'المصدر غير متاح',
    },
    {
      key: 'sales_linking',
      label: 'جودة تسجيل المبيعات',
      weight: 20,
      score: linkingRate,
      status: salesStatus,
      detail: invoiceCount > 0 ? `${linkedInvoices} من ${invoiceCount} فاتورة مرتبطة بكود عميل` : 'لا توجد فواتير منسوبة للموظف في الدورة',
    },
    {
      key: 'conversations',
      label: 'جودة المحادثات',
      weight: 20,
      score: conversationCount > 0 ? averageConversationScore : null,
      status: conversationStatus,
      detail: conversationCount > 0 ? `${conversationCount} مراجعة محادثة` : 'لا توجد مراجعات محادثات في الدورة',
    },
    {
      key: 'followups',
      label: 'المتابعات',
      weight: 10,
      score: followupCompletionRate,
      status: followupStatus,
      detail: followupTotal > 0 ? `${followupCompleted} مكتملة من ${followupTotal}` : 'لا توجد متابعات مسجلة في الدورة',
    },
    {
      key: 'manager_evaluation',
      label: 'تقييم المدير',
      weight: 15,
      score: managerEvaluationScore,
      status: managerEvaluationStatus,
      detail: managerEvaluationScore == null ? 'التقييم لم يبدأ أو لم يعتمد بعد' : `${managerEvaluationScore.toFixed(1)} / 100`,
    },
  ];

  const available = pillars.filter((pillar) => pillar.score != null);
  const availableWeight = available.reduce((sum, pillar) => sum + pillar.weight, 0);
  const coveragePct = Math.round(availableWeight);
  const weighted = available.reduce((sum, pillar) => sum + (pillar.score as number) * pillar.weight, 0);
  const overallScore = availableWeight >= 35 ? Math.round((weighted / availableWeight) * 10) / 10 : null;
  if (availableWeight < 100) warnings.push(`تغطية الدرجة المركبة ${coveragePct}% فقط؛ الأقسام غير المتاحة لم تحصل على درجات افتراضية.`);

  return {
    employee: {
      id: staffId,
      name: employeeName,
      role: employeeRole,
      canonicalRole: canonicalStaffRole(staff.role),
      branch: employeeBranch,
    },
    cycle: {
      label: cycleLabel,
      displayLabel: range.displayLabel,
      startDate,
      endDate,
    },
    sales: { status: salesStatus, totalSales, invoiceCount, averageInvoice, customersHandled, linkedInvoices, linkingRate },
    points: { status: pointsStatus, dashboard: pointsDashboard },
    attendance: { status: attendanceStatus, recordedDays, presentDays, absentDays, note: attendanceNote },
    conversations: { status: conversationStatus, count: conversationCount, averageScore: averageConversationScore },
    followups: { status: followupStatus, total: followupTotal, completed: followupCompleted, completionRate: followupCompletionRate },
    managerEvaluation: { status: managerEvaluationStatus, score: managerEvaluationScore },
    pillars,
    overall: { score: overallScore, grade: gradeFor(overallScore, coveragePct), coveragePct, availableWeight },
    warnings: [...new Set(warnings)],
  };
}
