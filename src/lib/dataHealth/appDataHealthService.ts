import { supabase } from '@/lib/supabase';
import { countStaffAccountsWithoutStaffSafe } from '@/lib/staff/staffAccountsApi';

export type DataHealthIssue = {
  key: string;
  label: string;
  count: number | null;
  severity: 'info' | 'warning' | 'danger';
  source: string;
  suggestedFix: string;
  affectedPages: string[];
  error?: string | null;
};

type CountResult = {
  count: number | null;
  error: { message?: string } | null;
  data?: unknown[] | null;
};

type CountQuery = PromiseLike<CountResult> & {
  or: (filters: string) => CountQuery;
  eq: (column: string, value: unknown) => CountQuery;
  is: (column: string, value: unknown) => CountQuery;
  not: (column: string, operator: string, value: unknown) => CountQuery;
  limit: (count: number) => CountQuery;
};

async function safeCount(source: string, build: (query: CountQuery) => PromiseLike<CountResult>) {
  try {
    const exact = await build(
      supabase.from(source).select('*', { count: 'exact', head: true }) as unknown as CountQuery
    );
    if (!exact.error && exact.count !== null && exact.count !== undefined) {
      return { count: exact.count, error: null };
    }

    const fallback = await build(
      supabase.from(source).select('*').limit(1001) as unknown as CountQuery
    );
    if (fallback.error)
      return { count: null, error: fallback.error.message || 'تعذر تحميل المصدر' };
    return { count: fallback.data?.length ?? 0, error: null };
  } catch (error) {
    return {
      count: null,
      error: error instanceof Error ? error.message : 'تعذر تحميل المصدر',
    };
  }
}

function issue(
  args: Omit<DataHealthIssue, 'severity'> & {
    severity?: DataHealthIssue['severity'];
  }
): DataHealthIssue {
  return { severity: args.severity || 'warning', ...args };
}

function severityForCount(count: number | null, dangerAt = 100) {
  if (count === null) return 'warning' as const;
  if (count >= dangerAt) return 'danger' as const;
  if (count > 0) return 'warning' as const;
  return 'info' as const;
}

export async function loadAppDataHealthSummary() {
  const staffAccountsWithoutStaffPromise = countStaffAccountsWithoutStaffSafe()
    .then((count) => ({ count, error: null as string | null }))
    .catch((error) => ({
      count: null,
      error: error instanceof Error ? error.message : 'تعذر تحميل مصدر الحسابات',
    }));

  const [
    invoicesWithoutCustomer,
    invoicesWithoutDoctor,
    invoicesWithoutBranch,
    invalidPhones,
    inactiveStaff,
    pointRowsWithoutStaff,
    invoicesWithNumber,
    customersWithoutBranch,
    customersWithoutPhone,
    staffAccountsWithoutStaff,
    reviewsWithoutPoints,
    ...tableChecks
  ] = await Promise.all([
    safeCount('sales_invoices', (query) =>
      query.or(
        'customer_name.ilike.%عميل غير مسجل%,customer_name.ilike.%عميل الصيدلية%,and(customer_code.is.null,customer_phone.is.null,customer_name.is.null),and(customer_code.eq.,customer_phone.eq.,customer_name.eq.)'
      )
    ),
    safeCount('sales_invoices', (query) => query.or('seller_name.is.null,seller_name.eq.')),
    safeCount('sales_invoices', (query) => query.or('branch.is.null,branch.eq.')),
    safeCount('customer_metrics_summary', (query) =>
      query.or('customer_phone.is.null,customer_phone.eq.,customer_phone.ilike.code:%')
    ),
    safeCount('staff', (query) => query.eq('active', false)),
    safeCount('employee_transactions', (query) => query.is('staff_id', null)),
    safeCount('sales_invoices', (query) =>
      query.or('invoice_no.not.is.null,invoice_number.not.is.null')
    ),
    safeCount('customers', (query) => query.or('branch.is.null,branch.eq.')),
    safeCount('customers', (query) => query.or('phone.is.null,phone.eq.')),
    staffAccountsWithoutStaffPromise,
    safeCount('conversation_sales_reviews', (query) => query.is('points_transaction_id', null)),
    ...[
      'customers',
      'sales_invoices',
      'staff',
      'daily_followups',
      'conversation_sales_reviews',
      'employee_transactions',
      'activity_log',
      'branches',
      'branch_sales_targets',
    ].map((table) => safeCount(table, (query) => query.limit(1))),
  ]);

  const coreTables = [
    'customers',
    'sales_invoices',
    'staff',
    'daily_followups',
    'conversation_sales_reviews',
    'employee_transactions',
    'activity_log',
    'branches',
    'branch_sales_targets',
  ];
  return [
    issue({
      key: 'invoices-without-customer',
      label: 'فواتير بدون عميل',
      count: invoicesWithoutCustomer.count,
      severity: severityForCount(invoicesWithoutCustomer.count, 500),
      source: 'sales_invoices',
      suggestedFix: 'راجع customer_code/customer_id بعد الاستيراد، ثم شغل تحديث ملخص العملاء.',
      affectedPages: ['/invoices', '/customers', '/customer-service', '/'],
      error: invoicesWithoutCustomer.error,
    }),
    issue({
      key: 'invoices-without-doctor',
      label: 'فواتير بدون دكتور/موظف',
      count: invoicesWithoutDoctor.count,
      severity: severityForCount(invoicesWithoutDoctor.count, 25),
      source: 'sales_invoices',
      suggestedFix: 'اربط seller_name بموظف أو أضف alias للموظف الصحيح.',
      affectedPages: ['/invoices', '/staff/:id', '/analytics', '/'],
      error: invoicesWithoutDoctor.error,
    }),
    issue({
      key: 'invoices-without-branch',
      label: 'فواتير بدون فرع',
      count: invoicesWithoutBranch.count,
      severity: severityForCount(invoicesWithoutBranch.count, 25),
      source: 'sales_invoices',
      suggestedFix: 'راجع عمود الفرع/المخزن في ملف الاستيراد.',
      affectedPages: ['/invoices', '/analytics', '/'],
      error: invoicesWithoutBranch.error,
    }),
    issue({
      key: 'invalid-customer-phones',
      label: 'عملاء بدون رقم صالح',
      count: invalidPhones.count,
      severity: severityForCount(invalidPhones.count, 300),
      source: 'customer_metrics_summary',
      suggestedFix: 'راجع أرقام العملاء الفارغة أو التي تبدأ بـ code: قبل حملات واتساب والمتابعات.',
      affectedPages: ['/customers', '/customer-service', '/whatsapp-analytics'],
      error: invalidPhones.error,
    }),
    issue({
      key: 'inactive-staff-with-data',
      label: 'موظفون غير نشطين لهم بيانات',
      count: inactiveStaff.count,
      severity: 'info',
      source: 'staff',
      suggestedFix:
        'اعرض غير النشطين كأسماء بديلة فقط عند الحاجة، وليس كموظفين مكررين في التقارير.',
      affectedPages: ['/team', '/staff/:id', '/analytics', '/quarterly-incentives'],
      error: inactiveStaff.error,
    }),
    issue({
      key: 'points-without-staff',
      label: 'سجلات نقاط بدون staff_id',
      count: pointRowsWithoutStaff.count,
      severity: severityForCount(pointRowsWithoutStaff.count, 10),
      source: 'employee_transactions',
      suggestedFix: 'اربط سجلات النقاط بالموظف حتى تتطابق صفحة النقاط مع صفحة الموظف.',
      affectedPages: ['/points', '/staff/:id'],
      error: pointRowsWithoutStaff.error,
    }),
    issue({
      key: 'invoice-volume-review',
      label: 'حجم الفواتير المقروءة',
      count: invoicesWithNumber.count,
      severity: 'info',
      source: 'sales_invoices',
      suggestedFix: 'استخدم هذا الرقم كمؤشر أن مصدر الفواتير متاح للصفحات والتحليلات.',
      affectedPages: ['/invoices', '/analytics', '/', '/staff/:id'],
      error: invoicesWithNumber.error,
    }),
    issue({
      key: 'customers-without-branch',
      label: 'عملاء بدون فرع',
      count: customersWithoutBranch.count,
      severity: severityForCount(customersWithoutBranch.count, 100),
      source: 'customers',
      suggestedFix: 'حدد الفرع الرئيسي للعميل لضمان دقة التقارير والمتابعات.',
      affectedPages: ['/customers', '/customer-data-review'],
      error: customersWithoutBranch.error,
    }),
    issue({
      key: 'customers-without-phone',
      label: 'عملاء بدون رقم هاتف',
      count: customersWithoutPhone.count,
      severity: severityForCount(customersWithoutPhone.count, 100),
      source: 'customers',
      suggestedFix: 'استكمل الهاتف الصحيح قبل تشغيل رسائل واتساب أو إعادة الصرف.',
      affectedPages: ['/customers', '/customer-data-review'],
      error: customersWithoutPhone.error,
    }),
    issue({
      key: 'accounts-without-staff',
      label: 'حسابات بدون موظف',
      count: staffAccountsWithoutStaff.count,
      severity: severityForCount(staffAccountsWithoutStaff.count, 5),
      source: 'staff_accounts',
      suggestedFix: 'اربط كل حساب دخول بسجل موظف نشط.',
      affectedPages: ['/staff-accounts', '/team'],
      error: staffAccountsWithoutStaff.error,
    }),
    issue({
      key: 'reviews-without-points',
      label: 'تقييمات محادثات بدون ربط نقاط',
      count: reviewsWithoutPoints.count,
      severity: severityForCount(reviewsWithoutPoints.count, 10),
      source: 'conversation_sales_reviews',
      suggestedFix: 'راجع تكامل التقييمات مع سجل النقاط قبل اعتماد الحافز.',
      affectedPages: ['/reviews', '/points'],
      error: reviewsWithoutPoints.error,
    }),
    ...coreTables.map((table, index) =>
      issue({
        key: `table-${table}`,
        label: `جاهزية جدول ${table}`,
        count: tableChecks[index]?.error ? null : 0,
        severity: tableChecks[index]?.error ? 'warning' : 'info',
        source: table,
        suggestedFix: tableChecks[index]?.error
          ? 'الجدول غير موجود أو غير مفعّل'
          : 'الجدول متاح للقراءة',
        affectedPages: ['/data-health'],
        error: tableChecks[index]?.error,
      })
    ),
  ];
}

export function summarizeDataHealth(issues: DataHealthIssue[]): {
  actionableCount: number;
  dangerCount: number;
  warningCount: number;
  totalRecords: number;
  status: 'danger' | 'warning' | 'ready';
} {
  const actionable = issues.filter((item) => (item.count || 0) > 0 && item.severity !== 'info');
  const danger = actionable.filter((item) => item.severity === 'danger');
  const warnings = actionable.filter((item) => item.severity === 'warning');
  const totalRecords = actionable.reduce((sum, item) => sum + (item.count || 0), 0);

  return {
    actionableCount: actionable.length,
    dangerCount: danger.length,
    warningCount: warnings.length,
    totalRecords,
    status: danger.length ? 'danger' : warnings.length ? 'warning' : 'ready',
  };
}
