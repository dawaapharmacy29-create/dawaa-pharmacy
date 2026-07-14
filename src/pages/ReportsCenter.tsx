import { useMemo, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { CommandHeader } from '@/components/command/CommandUI';
import { useAuth } from '@/hooks/useAuth';
import { BRANCHES } from '@/lib/constants';
import { formatCycleDate, getCurrentCycle, getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import { loadSalesAnalyticsSummary } from '@/lib/salesAnalyticsSummaryService';
import { canViewAllBranches, getScopedBranch } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';
import { normalizeDoctorName } from '@/lib/staff/staffIdentityResolver';

type ReportType =
  | 'customer_stopped'
  | 'staff_payroll'
  | 'daily_sales'
  | 'shortages_summary'
  | 'top_customers'
  | 'reviews_summary'
  | 'whatsapp_performance'
  | 'doctor_performance'
  | 'stagnant_list'
  | 'points_incentives'
  | 'monthly_comprehensive';

type ReviewRow = Record<string, unknown>;

const ALL_BRANCHES = 'كل الفروع';

const REPORTS: { type: ReportType; label: string; icon: string; desc: string }[] = [
  { type: 'customer_stopped', label: 'العملاء المتوقفين', icon: '👥', desc: 'عملاء لم يشتروا منذ فترة طويلة' },
  { type: 'staff_payroll', label: 'الرواتب والحوافز', icon: '💰', desc: 'رواتب + بونص + خصومات لكل موظف' },
  { type: 'daily_sales', label: 'المبيعات اليومي', icon: '📊', desc: 'مبيعات يومية حسب الفرع' },
  { type: 'shortages_summary', label: 'النواقص', icon: '📦', desc: 'أدوية ناقصة حسب الفرع' },
  { type: 'top_customers', label: 'أفضل العملاء', icon: '⭐', desc: 'أعلى العملاء مبيعاً' },
  { type: 'reviews_summary', label: 'تقييمات المحادثات', icon: '💬', desc: 'تحليل جودة وتدريب متعدد الصفحات' },
  { type: 'whatsapp_performance', label: 'أداء الواتساب', icon: '📱', desc: 'سرعة وجودة وتحويل ومبيعات مرتبطة' },
  { type: 'doctor_performance', label: 'أداء الدكاترة', icon: '🩺', desc: 'مبيعات ومتوسط فاتورة لكل دكتور' },
  { type: 'stagnant_list', label: 'الرواكد واللستة', icon: '🧪', desc: 'ملخص الرواكد واللستة' },
  { type: 'points_incentives', label: 'الحوافز والنقاط', icon: '🏆', desc: 'حركة النقاط والحوافز' },
  { type: 'monthly_comprehensive', label: 'تقرير شهري شامل', icon: '📋', desc: 'ملخص شامل للدورة الحالية' },
];

function safeFilePart(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
}

function formatReportFileName(type: ReportType, branch: string, start: string, end: string) {
  const labelMap: Record<ReportType, string> = {
    customer_stopped: 'تقرير_العملاء_المتوقفين',
    staff_payroll: 'تقرير_الرواتب_والحوافز',
    daily_sales: 'تقرير_المبيعات_اليومي',
    shortages_summary: 'تقرير_النواقص',
    top_customers: 'تقرير_أفضل_العملاء',
    reviews_summary: 'تقرير_تقييمات_المحادثات_المتطور',
    whatsapp_performance: 'تقرير_أداء_الواتساب_المتطور',
    doctor_performance: 'تقرير_أداء_الدكاترة',
    stagnant_list: 'تقرير_الرواكد_واللستة',
    points_incentives: 'تقرير_الحوافز_والنقاط',
    monthly_comprehensive: 'تقرير_شهري_شامل',
  };
  const branchPart =
    branch === ALL_BRANCHES ? 'كل_الفروع' : safeFilePart(normalizeBranchName(branch) || branch);
  return `${labelMap[type]}_${branchPart}_${start}_${end}.xlsx`;
}

function downloadXlsx(rows: Record<string, unknown>[], sheetName: string, filename: string) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = Object.keys(rows[0] || {}).map((key) => ({ wch: Math.min(40, Math.max(12, key.length + 4)) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, filename);
}

function asNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'نعم';
}

function scoreOf(row: ReviewRow): number {
  return asNumber(row.final_score ?? row.total_score ?? row.score);
}

function salesOf(row: ReviewRow): number {
  return asNumber(row.generated_sales ?? row.sales_value ?? row.invoice_amount ?? row.sale_amount);
}

function reviewDateOf(row: ReviewRow): string {
  return String(row.review_date ?? row.conversation_date ?? row.created_at ?? '').slice(0, 10);
}

function displayDoctorName(row: ReviewRow): string {
  return String(row.doctor_name ?? row.staff_name ?? row.employee_name ?? 'غير محدد').trim() || 'غير محدد';
}

function canonicalDoctorKey(row: ReviewRow): string {
  const staffId = String(row.staff_id ?? row.doctor_id ?? '').trim();
  if (staffId) return `id:${staffId}`;
  let normalized = normalizeDoctorName(displayDoctorName(row));
  if (['اسلام', 'اسلام فاروق'].includes(normalized)) normalized = 'اسلام فاروق';
  return `name:${normalized || 'غير محدد'}`;
}

function branchOf(row: ReviewRow): string {
  const raw = String(row.branch ?? row.branch_name ?? '').trim();
  return normalizeBranchName(raw) || raw || 'غير محدد';
}

function responseMinutesOf(row: ReviewRow): number {
  return asNumber(row.first_response_minutes ?? row.response_minutes ?? row.reply_minutes);
}

function appendSheet(
  workbook: XLSX.WorkBook,
  rows: Record<string, unknown>[],
  name: string,
  widths?: number[]
) {
  const safeRows = rows.length ? rows : [{ ملاحظة: 'لا توجد بيانات مطابقة' }];
  const worksheet = XLSX.utils.json_to_sheet(safeRows);
  const keys = Object.keys(safeRows[0] || {});
  worksheet['!cols'] = keys.map((key, index) => ({
    wch: widths?.[index] ?? Math.min(45, Math.max(13, key.length + 5)),
  }));
  worksheet['!autofilter'] = worksheet['!ref'] ? { ref: worksheet['!ref'] } : undefined;
  XLSX.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31));
}

function errorLabels(row: ReviewRow): string[] {
  const labels: string[] = [];
  if (asBoolean(row.has_critical_error)) labels.push('خطأ حرج');
  if (asBoolean(row.bad_tone_flag)) labels.push('أسلوب غير مناسب');
  if (asBoolean(row.severe_bad_tone_flag)) labels.push('أسلوب سيئ جدًا');
  if (asBoolean(row.misunderstood_customer_flag)) labels.push('سوء فهم الطلب');
  if (asBoolean(row.rushed_response_flag)) labels.push('رد متسرع');
  if (asBoolean(row.bad_alternative_flag)) labels.push('بديل غير مناسب');
  if (asBoolean(row.missed_sales_opportunity) || asBoolean(row.missed_sale_opportunity)) labels.push('فرصة بيع ضائعة');
  if (asBoolean(row.has_medical_error)) labels.push('خطأ طبي');
  if (asBoolean(row.has_invoice_error)) labels.push('خطأ فاتورة');
  if (asBoolean(row.has_delivery_issue)) labels.push('مشكلة توصيل');
  if (responseMinutesOf(row) > 10) labels.push('تأخير رد أكثر من 10 دقائق');
  return labels;
}

interface DoctorStats {
  key: string;
  name: string;
  staffId: string;
  branch: string;
  count: number;
  totalScore: number;
  minScore: number;
  maxScore: number;
  excellent: number;
  weak: number;
  critical: number;
  responseTotal: number;
  responseCount: number;
  fastResponses: number;
  delayedResponses: number;
  greetingOk: number;
  customerNameUsed: number;
  crossSell: number;
  missedSales: number;
  sales: number;
  errorCounts: Map<string, number>;
}

function buildDoctorStats(rows: ReviewRow[]): DoctorStats[] {
  const grouped = new Map<string, DoctorStats>();
  for (const row of rows) {
    const key = canonicalDoctorKey(row);
    const score = scoreOf(row);
    const responseMinutes = responseMinutesOf(row);
    const errors = errorLabels(row);
    const current =
      grouped.get(key) ||
      {
        key,
        name: displayDoctorName(row),
        staffId: String(row.staff_id ?? row.doctor_id ?? ''),
        branch: branchOf(row),
        count: 0,
        totalScore: 0,
        minScore: Number.POSITIVE_INFINITY,
        maxScore: 0,
        excellent: 0,
        weak: 0,
        critical: 0,
        responseTotal: 0,
        responseCount: 0,
        fastResponses: 0,
        delayedResponses: 0,
        greetingOk: 0,
        customerNameUsed: 0,
        crossSell: 0,
        missedSales: 0,
        sales: 0,
        errorCounts: new Map<string, number>(),
      };
    current.count += 1;
    current.totalScore += score;
    current.minScore = Math.min(current.minScore, score);
    current.maxScore = Math.max(current.maxScore, score);
    if (score >= 90) current.excellent += 1;
    if (score > 0 && score < 60) current.weak += 1;
    if (asBoolean(row.has_critical_error)) current.critical += 1;
    if (responseMinutes > 0) {
      current.responseTotal += responseMinutes;
      current.responseCount += 1;
      if (responseMinutes <= 5) current.fastResponses += 1;
      if (responseMinutes > 10) current.delayedResponses += 1;
    }
    if (asNumber(row.greeting_score) > 0 || asBoolean(row.doctor_name_used_in_greeting)) current.greetingOk += 1;
    if (asBoolean(row.customer_name_used)) current.customerNameUsed += 1;
    if (asBoolean(row.successful_cross_sell)) current.crossSell += 1;
    if (asBoolean(row.missed_sales_opportunity) || asBoolean(row.missed_sale_opportunity)) current.missedSales += 1;
    current.sales += salesOf(row);
    errors.forEach((error) => current.errorCounts.set(error, (current.errorCounts.get(error) || 0) + 1));
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => b.totalScore / b.count - a.totalScore / a.count);
}

function percent(part: number, total: number): number {
  return total ? Math.round((part / total) * 1000) / 10 : 0;
}

function buildAdvancedConversationWorkbook(
  rows: ReviewRow[],
  type: 'reviews_summary' | 'whatsapp_performance',
  filename: string,
  meta: { branch: string; startDate: string; endDate: string; staffFilter: string }
) {
  const workbook = XLSX.utils.book_new();
  const doctors = buildDoctorStats(rows);
  const total = rows.length;
  const avgScore = total ? rows.reduce((sum, row) => sum + scoreOf(row), 0) / total : 0;
  const excellent = rows.filter((row) => scoreOf(row) >= 90).length;
  const weak = rows.filter((row) => scoreOf(row) > 0 && scoreOf(row) < 60).length;
  const critical = rows.filter((row) => asBoolean(row.has_critical_error)).length;
  const missedSales = rows.filter(
    (row) => asBoolean(row.missed_sales_opportunity) || asBoolean(row.missed_sale_opportunity)
  ).length;
  const crossSell = rows.filter((row) => asBoolean(row.successful_cross_sell)).length;
  const responseRows = rows.filter((row) => responseMinutesOf(row) > 0);
  const avgResponse = responseRows.length
    ? responseRows.reduce((sum, row) => sum + responseMinutesOf(row), 0) / responseRows.length
    : 0;
  const totalSales = rows.reduce((sum, row) => sum + salesOf(row), 0);

  appendSheet(
    workbook,
    [
      { المؤشر: 'نوع التقرير', القيمة: type === 'reviews_summary' ? 'تقييمات المحادثات' : 'أداء الواتساب' },
      { المؤشر: 'الفترة', القيمة: `${meta.startDate} إلى ${meta.endDate}` },
      { المؤشر: 'الفرع', القيمة: meta.branch },
      { المؤشر: 'فلتر الموظف', القيمة: meta.staffFilter },
      { المؤشر: 'إجمالي المحادثات المراجعة', القيمة: total },
      { المؤشر: 'عدد الدكاترة', القيمة: doctors.length },
      { المؤشر: 'متوسط الجودة العام', القيمة: Math.round(avgScore * 100) / 100 },
      { المؤشر: 'نسبة الممتاز', القيمة: percent(excellent, total) },
      { المؤشر: 'نسبة الضعيف', القيمة: percent(weak, total) },
      { المؤشر: 'الأخطاء الحرجة', القيمة: critical },
      { المؤشر: 'متوسط أول رد بالدقائق', القيمة: Math.round(avgResponse * 100) / 100 },
      { المؤشر: 'رد خلال 5 دقائق', القيمة: responseRows.filter((row) => responseMinutesOf(row) <= 5).length },
      { المؤشر: 'رد بعد أكثر من 10 دقائق', القيمة: responseRows.filter((row) => responseMinutesOf(row) > 10).length },
      { المؤشر: 'Cross-sell ناجح', القيمة: crossSell },
      { المؤشر: 'فرص بيع ضائعة', القيمة: missedSales },
      { المؤشر: 'المبيعات المرتبطة المسجلة', القيمة: Math.round(totalSales * 100) / 100 },
      {
        المؤشر: 'تنبيه جودة البيانات',
        القيمة: totalSales === 0 ? 'المبيعات المرتبطة غير مسجلة أو غير مربوطة بالفواتير' : 'المبيعات المرتبطة متاحة',
      },
    ],
    'لوحة القيادة',
    [32, 42]
  );

  const doctorRows = doctors.map((doctor, index) => {
    const average = doctor.totalScore / doctor.count;
    const topErrors = [...doctor.errorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => `${name} (${count})`)
      .join('، ');
    return {
      الترتيب: index + 1,
      staff_id: doctor.staffId,
      الدكتور: doctor.name,
      الفرع: doctor.branch,
      عدد_التقييمات: doctor.count,
      مستوى_الثقة: doctor.count >= 10 ? 'قوي' : doctor.count >= 5 ? 'متوسط' : 'عينة صغيرة',
      متوسط_الدرجة: Math.round(average * 100) / 100,
      أعلى_درجة: doctor.maxScore,
      أقل_درجة: Number.isFinite(doctor.minScore) ? doctor.minScore : 0,
      ممتازة: doctor.excellent,
      ضعيفة: doctor.weak,
      أخطاء_حرجة: doctor.critical,
      متوسط_الرد_بالدقائق: doctor.responseCount
        ? Math.round((doctor.responseTotal / doctor.responseCount) * 100) / 100
        : '',
      رد_خلال_5_دقائق: doctor.fastResponses,
      تأخير_أكثر_من_10_دقائق: doctor.delayedResponses,
      ترحيب_صحيح: doctor.greetingOk,
      استخدام_اسم_العميل: doctor.customerNameUsed,
      Cross_sell_ناجح: doctor.crossSell,
      فرص_بيع_ضائعة: doctor.missedSales,
      مبيعات_مرتبطة: Math.round(doctor.sales * 100) / 100,
      أهم_المشكلات: topErrors || 'لا توجد مشكلات مسجلة',
      الحالة: average >= 95 && doctor.critical === 0 ? 'متميز' : average >= 90 ? 'جيد جدًا' : average >= 80 ? 'يحتاج تحسين' : 'أولوية تدريب',
    };
  });
  appendSheet(workbook, doctorRows, 'تحليل الدكاترة');

  const branchMap = new Map<string, { count: number; total: number; excellent: number; weak: number; sales: number }>();
  rows.forEach((row) => {
    const branch = branchOf(row);
    const current = branchMap.get(branch) || { count: 0, total: 0, excellent: 0, weak: 0, sales: 0 };
    const score = scoreOf(row);
    current.count += 1;
    current.total += score;
    if (score >= 90) current.excellent += 1;
    if (score > 0 && score < 60) current.weak += 1;
    current.sales += salesOf(row);
    branchMap.set(branch, current);
  });
  appendSheet(
    workbook,
    [...branchMap.entries()].map(([branch, stats]) => ({
      الفرع: branch,
      عدد_التقييمات: stats.count,
      متوسط_الدرجة: Math.round((stats.total / stats.count) * 100) / 100,
      نسبة_الممتاز: percent(stats.excellent, stats.count),
      نسبة_الضعيف: percent(stats.weak, stats.count),
      المبيعات_المرتبطة: Math.round(stats.sales * 100) / 100,
    })),
    'مقارنة الفروع'
  );

  const detailRows = rows
    .slice()
    .sort((a, b) => reviewDateOf(b).localeCompare(reviewDateOf(a)))
    .map((row) => ({
      تاريخ_التقييم: reviewDateOf(row),
      تاريخ_المحادثة: String(row.conversation_date ?? '').slice(0, 19),
      staff_id: row.staff_id ?? row.doctor_id ?? '',
      الدكتور: displayDoctorName(row),
      الفرع: branchOf(row),
      العميل: row.customer_name ?? '',
      كود_العميل: row.customer_code ?? row.customer_id ?? '',
      الهاتف: row.customer_phone ?? '',
      رقم_الفاتورة: row.invoice_number ?? '',
      نوع_التقييم: row.evaluation_kind ?? row.conversation_type ?? '',
      الدرجة_النهائية: scoreOf(row),
      المستوى: row.level ?? row.conversation_level ?? '',
      أول_رد_بالدقائق: responseMinutesOf(row) || '',
      درجة_الترحيب: row.greeting_score ?? '',
      استخدام_اسم_العميل: asBoolean(row.customer_name_used) ? 'نعم' : 'لا',
      جودة_فهم_الطلب: row.understanding_score ?? '',
      جودة_الاستشارة: row.consultation_quality_score ?? '',
      شرح_الجرعة: row.dosage_explanation_score ?? '',
      التعامل_مع_البديل: row.alternative_handling_score ?? '',
      جودة_البيع: row.sales_quality_score ?? '',
      Upsell_Cross_sell: row.upsell_cross_sell_score ?? '',
      التعامل_مع_الشكوى: row.complaint_handling_score ?? '',
      تأكيد_الطلب: row.order_confirmation_score ?? '',
      رسالة_الإغلاق: row.closing_message_score ?? '',
      Cross_sell_ناجح: asBoolean(row.successful_cross_sell) ? 'نعم' : 'لا',
      فرصة_بيع_ضائعة:
        asBoolean(row.missed_sales_opportunity) || asBoolean(row.missed_sale_opportunity) ? 'نعم' : 'لا',
      خطأ_حرج: asBoolean(row.has_critical_error) ? 'نعم' : 'لا',
      المشكلات: errorLabels(row).join('، '),
      السبب_الإيجابي: row.main_positive_reason ?? row.top_positive_reason ?? '',
      السبب_السلبي: row.main_negative_reason ?? row.top_deduction_reason ?? '',
      ملاحظات_المراجع: row.reviewer_notes ?? '',
      توصية_التدريب: row.training_recommendation ?? '',
      المبيعات_المرتبطة: salesOf(row),
    }));
  appendSheet(workbook, detailRows, 'تفاصيل المحادثات');

  const errorMap = new Map<string, { count: number; doctors: Set<string>; branches: Set<string> }>();
  rows.forEach((row) => {
    errorLabels(row).forEach((label) => {
      const current = errorMap.get(label) || { count: 0, doctors: new Set<string>(), branches: new Set<string>() };
      current.count += 1;
      current.doctors.add(displayDoctorName(row));
      current.branches.add(branchOf(row));
      errorMap.set(label, current);
    });
  });
  appendSheet(
    workbook,
    [...errorMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([error, stats]) => ({
        المشكلة: error,
        عدد_التكرار: stats.count,
        نسبة_من_التقييمات: percent(stats.count, total),
        الدكاترة: [...stats.doctors].join('، '),
        الفروع: [...stats.branches].join('، '),
        الإجراء_المقترح:
          error.includes('تأخير') ? 'تدريب سرعة الاستجابة ومتابعة أول رد' :
          error.includes('بيع') ? 'تدريب Cross-sell وUpsell وربط المحادثة بالفاتورة' :
          error.includes('بديل') ? 'مراجعة بروتوكول البدائل والاستشارة' :
          error.includes('أسلوب') ? 'تدريب خدمة العملاء واللغة الودودة' :
          'مراجعة الحالات وتدريب موجه',
      })),
    'الأخطاء والتدريب'
  );

  const actionRows = doctors
    .map((doctor) => {
      const average = doctor.totalScore / doctor.count;
      const topError = [...doctor.errorCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      const needsAction =
        average < 90 || doctor.weak > 0 || doctor.critical > 0 || doctor.missedSales > 0 || doctor.delayedResponses > 0;
      if (!needsAction) return null;
      const priority = doctor.critical > 0 || average < 80 ? 'عاجلة' : average < 90 || doctor.weak > 0 ? 'مرتفعة' : 'متوسطة';
      return {
        الدكتور: doctor.name,
        الفرع: doctor.branch,
        متوسط_الدرجة: Math.round(average * 100) / 100,
        المشكلة_الرئيسية: topError?.[0] || (doctor.missedSales ? 'فرص بيع ضائعة' : 'تفاوت في الأداء'),
        عدد_التكرار: topError?.[1] || doctor.missedSales || doctor.delayedResponses,
        الأولوية: priority,
        الإجراء:
          doctor.critical > 0
            ? 'مراجعة الحالات الحرجة فورًا واعتماد خطة تصحيح'
            : average < 90
              ? 'جلسة تدريب فردية ومراجعة 3 محادثات لاحقة'
              : doctor.missedSales > 0
                ? 'تدريب بيع إضافي ومتابعة التحويل'
                : 'متابعة سرعة الرد في الأسبوع القادم',
        موعد_المتابعة: priority === 'عاجلة' ? 'خلال 24 ساعة' : priority === 'مرتفعة' ? 'خلال 3 أيام' : 'خلال أسبوع',
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  appendSheet(workbook, actionRows, 'خطة العمل');

  XLSX.writeFile(workbook, filename);
}

async function fetchConversationReviewRows(
  branch: string,
  startDate: string,
  endDate: string,
  staffFilter: string
): Promise<ReviewRow[]> {
  const scopedBranch = branch === ALL_BRANCHES ? undefined : normalizeBranchName(branch);
  const { data, error } = await supabase
    .from('conversation_sales_reviews')
    .select('*')
    .gte('review_date', startDate)
    .lte('review_date', endDate)
    .order('review_date', { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);

  const normalizedStaffFilter = staffFilter !== 'الكل' ? normalizeDoctorName(staffFilter) : '';
  return ((data || []) as ReviewRow[]).filter((row) => {
    const branchMatches = !scopedBranch || branchOf(row) === scopedBranch;
    const staffMatches =
      !normalizedStaffFilter ||
      normalizeDoctorName(displayDoctorName(row)).includes(normalizedStaffFilter) ||
      String(row.staff_id ?? row.doctor_id ?? '') === staffFilter;
    return branchMatches && staffMatches;
  });
}

async function fetchReportRows(
  type: ReportType,
  branch: string,
  startDate: string,
  endDate: string,
  staffFilter: string
): Promise<Record<string, unknown>[]> {
  const scopedBranch = branch === ALL_BRANCHES ? undefined : normalizeBranchName(branch);

  if (type === 'daily_sales' || type === 'doctor_performance' || type === 'monthly_comprehensive') {
    const summary = await loadSalesAnalyticsSummary({
      startDate,
      endDate,
      branch: scopedBranch,
      doctor: staffFilter !== 'الكل' ? staffFilter : undefined,
    });
    if (type === 'daily_sales') {
      return summary.dailyTrend.map((row) => ({
        التاريخ: row.date,
        المبيعات: row.netSales,
        عدد_الفواتير: row.invoicesCount,
        متوسط_الفاتورة: row.avgInvoice,
        عملاء_فريدون: row.uniqueCustomers,
      }));
    }
    if (type === 'doctor_performance') {
      return summary.doctorRows.map((row) => ({
        الدكتور: row.doctor,
        الفرع: row.branch,
        المبيعات: row.netSales,
        عدد_الفواتير: row.invoicesCount,
        متوسط_الفاتورة: row.avgInvoice,
        عملاء_فريدون: row.uniqueCustomers,
      }));
    }
    return [
      {
        من: startDate,
        إلى: endDate,
        الفرع: branch,
        إجمالي_المبيعات: summary.kpis.netSales,
        عدد_الفواتير: summary.kpis.invoicesCount,
        متوسط_الفاتورة: summary.kpis.avgInvoice,
        عملاء_فريدون: summary.kpis.uniqueCustomers,
        أيام_نشطة: summary.kpis.activeDays,
      },
      ...summary.branchRows.map((row) => ({
        الفرع: row.branch,
        المبيعات: row.netSales,
        عدد_الفواتير: row.invoicesCount,
        متوسط_الفاتورة: row.avgInvoice,
        الحصة: row.share,
      })),
    ];
  }

  if (type === 'customer_stopped') {
    const { data, error } = await supabase
      .from('customer_metrics')
      .select('customer_name,phone,branch,last_invoice_date,total_invoices_count')
      .lt('last_invoice_date', startDate)
      .order('last_invoice_date', { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data || [])
      .filter((row) => !scopedBranch || normalizeBranchName(row.branch) === scopedBranch)
      .map((row) => ({
        العميل: row.customer_name,
        الهاتف: row.phone,
        الفرع: row.branch,
        آخر_فاتورة: row.last_invoice_date,
        عدد_الفواتير: row.total_invoices_count,
      }));
  }

  if (type === 'staff_payroll') {
    const { data, error } = await supabase.from('staff_payroll_summary').select('*').limit(500);
    if (error) throw new Error(error.message);
    return (data || [])
      .filter((row) => !scopedBranch || normalizeBranchName(String(row.branch || '')) === scopedBranch)
      .map((row) => row as Record<string, unknown>);
  }

  if (type === 'shortages_summary') {
    const { data, error } = await supabase.from('medicine_shortages').select('*').limit(500);
    if (error) throw new Error(error.message);
    return (data || [])
      .filter((row) => !scopedBranch || normalizeBranchName(String(row.branch || '')) === scopedBranch)
      .map((row) => row as Record<string, unknown>);
  }

  if (type === 'top_customers') {
    const { data, error } = await supabase
      .from('customer_metrics')
      .select('customer_name,phone,branch,total_sales,total_invoices_count,last_invoice_date')
      .order('total_sales', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data || [])
      .filter((row) => !scopedBranch || normalizeBranchName(row.branch) === scopedBranch)
      .map((row) => ({
        العميل: row.customer_name,
        الهاتف: row.phone,
        الفرع: row.branch,
        إجمالي_المبيعات: row.total_sales,
        عدد_الفواتير: row.total_invoices_count,
        آخر_فاتورة: row.last_invoice_date,
      }));
  }

  if (type === 'stagnant_list') {
    const stagnant = await supabase.from('stagnant_medicines').select('*').limit(500);
    const incentive = await supabase.from('incentive_medicines').select('*').eq('active', true).limit(500);
    if (stagnant.error) throw new Error(stagnant.error.message);
    const stagnantRows = (stagnant.data || [])
      .filter((row) => !scopedBranch || normalizeBranchName(String(row.branch || '')) === scopedBranch)
      .map((row) => ({ النوع: 'راكد', ...(row as Record<string, unknown>) }));
    const incentiveRows =
      incentive.error || !incentive.data
        ? []
        : incentive.data
            .filter((row) => !scopedBranch || normalizeBranchName(String(row.branch || '')) === scopedBranch)
            .map((row) => ({ النوع: 'لستة', ...(row as Record<string, unknown>) }));
    return [...stagnantRows, ...incentiveRows];
  }

  if (type === 'points_incentives') {
    const { data, error } = await supabase
      .from('employee_transactions')
      .select('*')
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`)
      .limit(3000);
    if (error) throw new Error(error.message);
    return (data || [])
      .filter((row) => !scopedBranch || normalizeBranchName(String(row.branch || '')) === scopedBranch)
      .map((row) => ({
        التاريخ: String(row.created_at || '').slice(0, 10),
        الموظف: row.employee_name || row.staff_name,
        الفرع: row.branch,
        النقاط: row.points_delta ?? row.points,
        السبب: row.reason || row.description,
        المصدر: row.source || row.source_module,
        الحالة: row.status,
      }));
  }

  return [];
}

export default function ReportsCenter() {
  const { user } = useAuth();
  const cycle = getCurrentCycle();
  const canAllBranches = canViewAllBranches(user);
  const defaultBranch = getScopedBranch(user, ALL_BRANCHES, ALL_BRANCHES);
  const [loading, setLoading] = useState<ReportType | null>(null);
  const [branch, setBranch] = useState(canAllBranches ? ALL_BRANCHES : defaultBranch);
  const [startDate, setStartDate] = useState(formatCycleDate(cycle.start));
  const [endDate, setEndDate] = useState(formatCycleDate(cycle.end));
  const [staffFilter, setStaffFilter] = useState('الكل');
  const [useCurrentCycle, setUseCurrentCycle] = useState(true);

  const branchOptions = useMemo(() => {
    if (canAllBranches) return [ALL_BRANCHES, ...BRANCHES];
    return [defaultBranch].filter(Boolean);
  }, [canAllBranches, defaultBranch]);

  function applyCycleRange() {
    const range = getPharmacyCycleRange(new Date());
    setStartDate(range.start);
    setEndDate(range.end);
    setUseCurrentCycle(true);
  }

  async function handleGenerate(type: ReportType) {
    setLoading(type);
    try {
      const filename = formatReportFileName(type, branch, startDate, endDate);
      if (type === 'reviews_summary' || type === 'whatsapp_performance') {
        const rows = await fetchConversationReviewRows(branch, startDate, endDate, staffFilter);
        if (!rows.length) {
          toast.error('لا توجد تقييمات محادثات للفترة والفلاتر المحددة');
          return;
        }
        buildAdvancedConversationWorkbook(rows, type, filename, { branch, startDate, endDate, staffFilter });
        toast.success(`تم تنزيل التقرير المتطور بنجاح (${rows.length} محادثة)`);
        return;
      }

      const rows = await fetchReportRows(type, branch, startDate, endDate, staffFilter);
      if (!rows.length) {
        toast.error('لا توجد بيانات للفترة المحددة');
        return;
      }
      downloadXlsx(rows, 'التقرير', filename);
      toast.success('تم تنزيل التقرير');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'خطأ غير معروف';
      toast.error(`تعذر إنشاء التقرير: ${reason}`);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-5 p-4" dir="rtl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <CommandHeader title="مركز التقارير" subtitle="تصدير تقارير Excel تحليلية جاهزة للإدارة والتدريب" />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1 text-xs text-slate-300">
            <span>من تاريخ</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                setUseCurrentCycle(false);
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="space-y-1 text-xs text-slate-300">
            <span>إلى تاريخ</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => {
                setEndDate(event.target.value);
                setUseCurrentCycle(false);
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="space-y-1 text-xs text-slate-300">
            <span>الفرع</span>
            <select
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            >
              {branchOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-slate-300">
            <span>الموظف/الدكتور</span>
            <input
              value={staffFilter}
              onChange={(event) => setStaffFilter(event.target.value)}
              placeholder="الكل"
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"
            />
          </label>
          <button
            type="button"
            onClick={applyCycleRange}
            className={`rounded-xl px-3 py-2 text-sm font-bold ${
              useCurrentCycle ? 'bg-teal-600 text-white' : 'border border-slate-700 text-slate-200'
            }`}
          >
            الدورة 26 → 25
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => (
          <div
            key={report.type}
            className="rounded-2xl border border-slate-700 bg-slate-800/50 p-5 transition hover:border-teal-500/50"
          >
            <div className="mb-3 flex items-start justify-between">
              <span className="text-3xl">{report.icon}</span>
              <FileText size={16} className="text-slate-500" />
            </div>
            <h3 className="font-black text-white">{report.label}</h3>
            <p className="mt-1 text-xs text-slate-400">{report.desc}</p>
            <button
              onClick={() => void handleGenerate(report.type)}
              disabled={loading === report.type}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-sm font-black text-white transition hover:bg-teal-500 disabled:opacity-50"
            >
              {loading === report.type ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> جاري الإنشاء...
                </>
              ) : (
                <>
                  <Download size={15} /> تنزيل Excel
                </>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
