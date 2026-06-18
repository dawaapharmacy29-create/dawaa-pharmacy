import { calculateStaffCycleIncentiveFromRows } from './staffIncentiveService';
import { type PointLedgerRecord, type StaffLedgerTarget } from './pointsLedger';
import { getCurrentCycle } from './pharmacy-cycle';
import { STAFF_OPERATING_POLICY_SECTIONS } from './performance/ruleDefinitions';
import { PermissionPolicyService } from './permissionPolicyService';
import { RepeatErrorService } from './repeatErrorService';

export interface MonthlyPDFReportData {
  staff_id: string;
  staff_name: string;
  branch: string;
  cycle_start: string;
  cycle_end: string;
  starting_points: number;
  final_points: number;
  incentive_value: number;
  max_incentive_value: number;
  progress_percent: number;
  distinction_points: number;
  reward_transactions: Array<{
    title: string;
    points: number;
    date: string;
    source: string;
    details?: string;
    reference?: string;
    created_by?: string;
    approved_by?: string;
    status?: string;
  }>;
  deduction_transactions: Array<{
    title: string;
    points: number;
    date: string;
    source: string;
    details?: string;
    reference?: string;
    created_by?: string;
    approved_by?: string;
    status?: string;
  }>;
  pending_transactions: Array<{
    title: string;
    points: number;
    date: string;
    source: string;
    details?: string;
    reference?: string;
    created_by?: string;
    approved_by?: string;
    status?: string;
  }>;
  quarterly_cash_rewards: number;
  cash_reward_transactions: Array<{
    title: string;
    amount: number;
    date: string;
    source: string;
  }>;
  pillar_scores: Array<{
    pillar: string;
    score: number;
    max_score: number;
    description: string;
  }>;
  permissions_used: number;
  permissions_remaining: number;
  permission_deduction: number;
  repeat_errors: Array<{
    rule_title: string;
    count: number;
    total_deduction: number;
  }>;
  classification_violations: number;
  classification_deduction: number;
  operating_policy_summary: string;
}

function transactionDetails(row: PointLedgerRecord): string {
  const meta =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : {};
  const parts = [
    row.description,
    row.manager_note,
    meta.details,
    meta.note,
    meta.reason,
    meta.customer_name ? `العميل: ${meta.customer_name}` : '',
    meta.invoice_no ? `فاتورة: ${meta.invoice_no}` : '',
    meta.rule_title ? `البند: ${meta.rule_title}` : '',
    meta.violation_date ? `تاريخ المخالفة: ${meta.violation_date}` : '',
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).join(' | ');
}

function transactionReference(row: PointLedgerRecord): string {
  const meta =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : {};
  return String(
    row.source_id || meta.source_id || meta.invoice_id || meta.invoice_no || row.id || ''
  ).trim();
}

function transactionDate(row: PointLedgerRecord): string {
  const meta =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : {};
  return (
    String(row.approved_at || meta.violation_date || meta.event_date || row.created_at || '').slice(
      0,
      10
    ) || 'غير محدد'
  );
}

/**
 * خدمة إنشاء تقرير PDF الشهري
 */
export class MonthlyPDFReportService {
  /**
   * إنشاء بيانات التقرير الشهري لموظف
   */
  static async generateMonthlyReportData(
    staff: StaffLedgerTarget,
    records: PointLedgerRecord[]
  ): Promise<MonthlyPDFReportData> {
    const cycle = getCurrentCycle();
    const incentiveData = calculateStaffCycleIncentiveFromRows({ staff, records, cycle });

    // تحويل المعاملات إلى تنسيق مناسب للتقرير
    const rewardTransactions = incentiveData.rewardTransactions.map((t) => ({
      title: t.shortReason || t.reason || 'مكافأة',
      points: t.absPoints,
      date: transactionDate(t),
      source: t.sourceLabel || 'غير محدد',
      details: transactionDetails(t),
      reference: transactionReference(t),
      created_by: t.created_by_name || t.created_by || 'غير محدد',
      approved_by: t.approved_by_name || t.manager_name || 'غير محدد',
      status: t.status || 'approved',
    }));

    const deductionTransactions = incentiveData.deductionTransactions.map((t) => ({
      title: t.shortReason || t.reason || 'خصم',
      points: t.absPoints,
      date: transactionDate(t),
      source: t.sourceLabel || 'غير محدد',
      details: transactionDetails(t),
      reference: transactionReference(t),
      created_by: t.created_by_name || t.created_by || 'غير محدد',
      approved_by: t.approved_by_name || t.manager_name || 'غير محدد',
      status: t.status || 'approved',
    }));

    const pendingTransactions = incentiveData.pendingTransactions.map((t) => ({
      title: t.shortReason || t.reason || 'معلق',
      points: t.absPoints,
      date: transactionDate(t),
      source: t.sourceLabel || 'غير محدد',
      details: transactionDetails(t),
      reference: transactionReference(t),
      created_by: t.created_by_name || t.created_by || 'غير محدد',
      approved_by: t.approved_by_name || t.manager_name || 'غير محدد',
      status: t.status || 'pending',
    }));

    const cashRewardTransactions = incentiveData.cashRewardTransactions.map((t) => ({
      title: t.shortReason || t.reason || 'مكافأة مالية رواكد/لستة',
      amount: t.moneyAmount || 0,
      date: (t.created_at || '').slice(0, 10),
      source: t.sourceLabel || 'مكافأة مالية ربع سنوية',
    }));

    // حساب درجات الأعمدة (محاكاة - يمكن تحسينها بالبيانات الفعلية)
    const pillarScores = [
      {
        pillar: 'خدمة العملاء والمتابعات',
        score: Math.min(100, (incentiveData.approvedRewardPoints / 200) * 100),
        max_score: 200,
        description: 'جودة التعامل، المتابعة، الشكاوى، ملاحظات العميل، ونجاح إعادة الشراء',
      },
      {
        pillar: 'الالتزام والتشغيل',
        score: Math.min(100, incentiveData.approvedDeductionPoints < 50 ? 100 : 50),
        max_score: 120,
        description: 'الحضور، الشيفت، التعليمات، التعاون، وإغلاق المهام اليومية',
      },
      {
        pillar: 'جودة البيع والتسجيل',
        score: Math.min(100, 80),
        max_score: 70,
        description: 'متوسط الفاتورة، التصنيف، دقة بيانات الفاتورة، وعدم إزعاج العميل',
      },
      {
        pillar: 'المخزون والرواكد واللستة',
        score: Math.min(100, 70),
        max_score: 70,
        description: 'تحريك الرواكد، أهداف اللستة، التسجيل بالفاتورة والعميل، وطلبات النواقص',
      },
      {
        pillar: 'استخدام السيستم والتطوير',
        score: Math.min(100, 60),
        max_score: 40,
        description: 'الالتزام بالتسجيل، جودة البيانات، المبادرات، وسجل الأنشطة',
      },
    ];

    let permissions_used = 0;
    let permissions_remaining = 3;
    let permission_deduction = 0;
    try {
      const permissionStatus = await PermissionPolicyService.getPermissionPolicyStatus(
        String(staff.id),
        incentiveData.cycleStart,
        incentiveData.cycleEnd
      );
      permissions_used =
        permissionStatus.free_allowance_used + permissionStatus.penalized_permission_number;
      permissions_remaining = permissionStatus.remaining_free_permissions;
      permission_deduction = permissionStatus.deduction_points;
    } catch {
      permissions_used = 0;
      permissions_remaining = 3;
      permission_deduction = 0;
    }

    let repeatErrors: MonthlyPDFReportData['repeat_errors'] = [];
    try {
      const repeats = await RepeatErrorService.getRepeatErrorsForStaff(
        String(staff.id),
        incentiveData.cycleStart,
        incentiveData.cycleEnd
      );
      repeatErrors = repeats.map((row) => ({
        rule_title: row.rule_title,
        count: row.occurrence_count,
        total_deduction: row.total_deduction,
      }));
    } catch {
      repeatErrors = [];
    }
    const classification_violations = deductionTransactions.filter((t) =>
      /تصنيف|classification/i.test(`${t.title} ${t.source}`)
    ).length;
    const classification_deduction = deductionTransactions
      .filter((t) => /تصنيف|classification/i.test(`${t.title} ${t.source}`))
      .reduce((sum, t) => sum + t.points, 0);

    const operating_policy_summary = STAFF_OPERATING_POLICY_SECTIONS.map(
      (section) => `**${section.title}**\n${section.items.map((item) => `• ${item}`).join('\n')}`
    ).join('\n\n');

    return {
      staff_id: staff.id,
      staff_name: staff.name,
      branch: (staff as any).branch || 'غير محدد',
      cycle_start: incentiveData.cycleStart,
      cycle_end: incentiveData.cycleEnd,
      starting_points: incentiveData.startingPoints,
      final_points: incentiveData.finalPoints,
      incentive_value: incentiveData.incentiveValue,
      max_incentive_value: incentiveData.maxIncentiveValue,
      progress_percent: incentiveData.progressPercent,
      distinction_points: incentiveData.distinctionPointsAbove500,
      reward_transactions: rewardTransactions,
      deduction_transactions: deductionTransactions,
      pending_transactions: pendingTransactions,
      quarterly_cash_rewards: incentiveData.quarterlyCashRewards,
      cash_reward_transactions: cashRewardTransactions,
      pillar_scores: pillarScores,
      permissions_used: permissions_used,
      permissions_remaining: permissions_remaining,
      permission_deduction: permission_deduction,
      repeat_errors: repeatErrors,
      classification_violations: classification_violations,
      classification_deduction: classification_deduction,
      operating_policy_summary: operating_policy_summary,
    };
  }

  /**
   * إنشاء نص التقرير (يمكن استخدامه لإنشاء PDF)
   */
  static generateReportText(data: MonthlyPDFReportData): string {
    return `
# تقرير الأداء الشهري - ${data.staff_name}
## الفرع: ${data.branch}
## الدورة: ${data.cycle_start} إلى ${data.cycle_end}

---

## ملخص الأداء

- **نقاط البداية:** ${data.starting_points} (دورة 26 → 25)
- **الحافز الشهري الكامل:** ${data.max_incentive_value} جنيه عند 500 نقطة
- **النقاط النهائية:** ${data.final_points}
- **نقاط التميز فوق 500:** ${data.distinction_points}
- **الحافز الشهري المحسوب:** ${data.incentive_value} جنيه
- **مكافآت مالية للرواكد واللستة (حافز ربع سنوي — لا تزيد نقاط الشهر):** ${data.quarterly_cash_rewards} جنيه
- **نسبة الإنجاز:** ${data.progress_percent.toFixed(1)}%

---

## درجات الأعمدة

${data.pillar_scores
  .map(
    (p) => `
### ${p.pillar}
- الدرجة: ${p.score.toFixed(1)} / ${p.max_score}
- ${p.description}
`
  )
  .join('\n')}

---

## المكافآت

${
  data.reward_transactions.length > 0
    ? data.reward_transactions
        .map(
          (t) => `
- **${t.title}**: +${t.points} نقطة (${t.date}) - ${t.source}${
            t.details
              ? `
  - التفاصيل: ${t.details}`
              : ''
          }${
            t.reference
              ? `
  - المرجع: ${t.reference}`
              : ''
          }${
            t.created_by
              ? `
  - أُضيف بواسطة: ${t.created_by}`
              : ''
          }${
            t.approved_by
              ? `
  - اعتمد بواسطة: ${t.approved_by}`
              : ''
          }
`
        )
        .join('\n')
    : 'لا توجد مكافآت في هذه الدورة'
}

---

## مكافآت مالية منفصلة للربع سنوي

${
  data.cash_reward_transactions.length > 0
    ? data.cash_reward_transactions
        .map(
          (t) => `
- **${t.title}**: ${t.amount} جنيه (${t.date}) - ${t.source}
`
        )
        .join('\n')
    : 'لا توجد مكافآت مالية للرواكد أو اللستة في هذه الدورة'
}

ملاحظة: هذه المكافآت لا تزيد نقاط الشهر، لكنها تُرحّل لقسم الحافز الربع سنوي.

---

## الخصومات

${
  data.deduction_transactions.length > 0
    ? data.deduction_transactions
        .map(
          (t) => `
- **${t.title}**: -${t.points} نقطة (${t.date}) - ${t.source}${
            t.details
              ? `
  - التفاصيل: ${t.details}`
              : ''
          }${
            t.reference
              ? `
  - المرجع: ${t.reference}`
              : ''
          }${
            t.created_by
              ? `
  - أُضيف بواسطة: ${t.created_by}`
              : ''
          }${
            t.approved_by
              ? `
  - اعتمد بواسطة: ${t.approved_by}`
              : ''
          }
`
        )
        .join('\n')
    : 'لا توجد خصومات في هذه الدورة'
}

---

## المعاملات المعلقة

${
  data.pending_transactions.length > 0
    ? data.pending_transactions
        .map(
          (t) => `
- **${t.title}**: ${t.points} نقطة (${t.date}) - ${t.source}${
            t.details
              ? `
  - التفاصيل: ${t.details}`
              : ''
          }${
            t.reference
              ? `
  - المرجع: ${t.reference}`
              : ''
          }${
            t.created_by
              ? `
  - أُضيف بواسطة: ${t.created_by}`
              : ''
          }
`
        )
        .join('\n')
    : 'لا توجد معاملات معلقة'
}

---

## الإذنات

- **الإذنات المستخدمة:** ${data.permissions_used}
- **الإذنات المتبقية:** ${data.permissions_remaining}
- **خصم الإذنات:** ${data.permission_deduction} نقطة

---

## الأخطاء المتكررة

${
  data.repeat_errors.length > 0
    ? data.repeat_errors
        .map(
          (e) => `
- **${e.rule_title}**: ${e.count} مرة، خصم ${e.total_deduction} نقطة
`
        )
        .join('\n')
    : 'لا توجد أخطاء متكررة'
}

---

## انتهاكات التصنيف

- **عدد الانتهاكات:** ${data.classification_violations}
- **خصم التصنيف:** ${data.classification_deduction} نقطة

---

## ملخص لائحة التشغيل

${data.operating_policy_summary}

---

*تم إنشاء هذا التقرير تلقائياً بواسطة نظام صيدليات دواء 2027*
    `.trim();
  }

  /**
   * تصدير التقرير كملف JSON
   */
  static exportReportAsJSON(data: MonthlyPDFReportData): string {
    return JSON.stringify(data, null, 2);
  }

  /**
   * تصدير التقرير كملف CSV
   */
  static exportReportAsCSV(data: MonthlyPDFReportData): string {
    const headers = [
      'Staff Name',
      'Branch',
      'Cycle Start',
      'Cycle End',
      'Starting Points',
      'Final Points',
      'Incentive Value',
      'Progress %',
      'Rewards Count',
      'Deductions Count',
      'Pending Count',
      'Quarterly Cash Rewards',
      'Permissions Used',
      'Classification Violations',
    ];

    const row = [
      data.staff_name,
      data.branch,
      data.cycle_start,
      data.cycle_end,
      data.starting_points,
      data.final_points,
      data.incentive_value,
      data.progress_percent.toFixed(1),
      data.reward_transactions.length,
      data.deduction_transactions.length,
      data.pending_transactions.length,
      data.quarterly_cash_rewards,
      data.permissions_used,
      data.classification_violations,
    ];

    return [headers.join(','), row.join(',')].join('\n');
  }
}
