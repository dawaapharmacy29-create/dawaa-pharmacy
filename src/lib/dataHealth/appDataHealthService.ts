import { supabase } from '@/lib/supabase';

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
  const [healthResult, performanceResult] = await Promise.allSettled([
    supabase.rpc('get_app_data_health_v2'),
    supabase.rpc('get_app_performance_health_v2'),
  ]);

  const healthResponse = healthResult.status === 'fulfilled' ? healthResult.value : null;
  const performanceResponse = performanceResult.status === 'fulfilled' ? performanceResult.value : null;
  const healthError =
    healthResponse?.error?.message ||
    (healthResult.status === 'rejected' ? String(healthResult.reason) : null);
  const performanceError =
    performanceResponse?.error?.message ||
    (performanceResult.status === 'rejected' ? String(performanceResult.reason) : null);
  const health = (healthResponse?.data || {}) as Record<string, unknown>;
  const performance = (performanceResponse?.data || {}) as Record<string, unknown>;
  const num = (key: string) => {
    const value = Number(health[key] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };
  const perfNum = (key: string) => {
    const value = Number(performance[key] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };

  if (healthError) {
    return [
      issue({
        key: 'data-health-rpc',
        label: 'تعذر تحميل فحص سلامة البيانات',
        count: null,
        severity: 'warning',
        source: 'get_app_data_health_v2',
        suggestedFix: 'أعد المحاولة وتحقق من RPC الخاصة بفحص سلامة البيانات.',
        affectedPages: ['/'],
        error: healthError,
      }),
    ];
  }

  const rows: DataHealthIssue[] = [
    issue({
      key: 'invoices-without-customer-identity',
      label: 'فواتير بدون هوية عميل فعلية — كل التاريخ',
      count: num('invoices_without_customer'),
      severity: severityForCount(num('invoices_without_customer'), 1),
      source: 'sales_invoices',
      suggestedFix: 'هذا العداد لا يشمل «عميل غير مسجل» أو «عميل الصيدلية»؛ هو فقط للفواتير التي لا تحتوي اسمًا ولا كودًا ولا هاتفًا.',
      affectedPages: ['/invoices', '/customers', '/customer-service', '/'],
    }),
    issue({
      key: 'unregistered-customer-invoices',
      label: 'فواتير «عميل غير مسجل» — كل التاريخ',
      count: num('unregistered_customer_invoices'),
      severity: 'info',
      source: 'sales_invoices.customer_name',
      suggestedFix: 'معلومة تشغيلية وليست خطأ ربط تلقائيًا. هذه الفواتير لا تحمل كودًا أو هاتفًا موثوقًا يسمح بربط عميل آمن.',
      affectedPages: ['/invoices', '/analytics'],
    }),
    issue({
      key: 'pharmacy-customer-invoices',
      label: 'فواتير «عميل الصيدلية» — كل التاريخ',
      count: num('pharmacy_customer_invoices'),
      severity: 'info',
      source: 'sales_invoices.customer_name',
      suggestedFix: 'بيع عام/نقدي مصنف صراحة كعميل الصيدلية؛ لا يعتبر فقدًا لهوية عميل مسجل.',
      affectedPages: ['/invoices', '/analytics'],
    }),
    issue({
      key: 'cycle-invoices-without-doctor',
      label: 'فواتير الدورة الحالية بدون دكتور/موظف',
      count: num('cycle_invoices_without_doctor'),
      severity: severityForCount(num('cycle_invoices_without_doctor'), 25),
      source: 'dawaa_sales_invoices_dashboard_v1',
      suggestedFix: 'راجع seller_name للفواتير النظيفة في دورة 26→25 الحالية فقط، ولا تخمّن الدكتور إذا لم يوجد دليل موثوق.',
      affectedPages: ['/invoices', '/analytics', '/'],
    }),
    issue({
      key: 'historical-invoices-without-doctor',
      label: 'فواتير بدون دكتور/موظف — كل التاريخ',
      count: num('invoices_without_doctor'),
      severity: 'info',
      source: 'sales_invoices',
      suggestedFix: 'مؤشر تاريخي للمراجعة؛ مؤشر الدورة الحالية أعلاه هو الأهم للتشغيل اليومي.',
      affectedPages: ['/invoices', '/analytics'],
    }),
    issue({
      key: 'invoices-without-branch',
      label: 'فواتير بدون فرع — كل التاريخ',
      count: num('invoices_without_branch'),
      severity: severityForCount(num('invoices_without_branch'), 1),
      source: 'sales_invoices',
      suggestedFix: 'راجع الفرع في مصدر الاستيراد قبل أي تصحيح يدوي.',
      affectedPages: ['/invoices', '/analytics', '/'],
    }),
    issue({
      key: 'duplicate-invoice-groups',
      label: 'مجموعات فواتير مكررة',
      count: num('duplicate_invoice_groups'),
      severity: severityForCount(num('duplicate_invoice_groups'), 1),
      source: 'sales_invoices',
      suggestedFix: 'راجع الفرع + التاريخ + رقم الفاتورة قبل أي حذف.',
      affectedPages: ['/invoices', '/'],
    }),
    issue({
      key: 'invalid-customer-phones',
      label: 'عملاء التشغيل بدون رقم هاتف صالح',
      count: num('invalid_customer_phones'),
      severity: severityForCount(num('invalid_customer_phones'), 300),
      source: 'dawaa_customer_metrics_app_view',
      suggestedFix: 'هذا هو العدد المؤثر فعليًا على صفحة العملاء والمتابعات. استكمل الهواتف قبل حملات واتساب.',
      affectedPages: ['/customers', '/customer-service'],
    }),
    issue({
      key: 'customers-without-branch',
      label: 'عملاء التشغيل بدون فرع',
      count: num('customers_without_branch'),
      severity: severityForCount(num('customers_without_branch'), 1),
      source: 'dawaa_customer_metrics_app_view',
      suggestedFix: 'هذا هو المصدر الذي تستخدمه صفحة العملاء فعليًا؛ أي رقم هنا يؤثر على الفلاتر والتقارير التشغيلية.',
      affectedPages: ['/customers'],
    }),
    issue({
      key: 'legacy-master-customers-without-branch',
      label: 'Master customers قديمة بدون فرع',
      count: num('master_customers_without_branch'),
      severity: 'info',
      source: 'customers',
      suggestedFix: 'معلومة Legacy للمراجعة التدريجية. لا تعني أن صفحة العملاء التشغيلية بلا فرع إذا كان الـView الموحّد قد استكمل الفرع من مصدر موثوق.',
      affectedPages: ['/customers'],
    }),
    issue({
      key: 'legacy-master-customers-without-phone',
      label: 'Master customers قديمة بدون هاتف',
      count: num('master_customers_without_phone'),
      severity: 'info',
      source: 'customers',
      suggestedFix: 'معلومة Legacy منفصلة عن العدد التشغيلي؛ لا تُجمع معها كإنذار مزدوج.',
      affectedPages: ['/customers'],
    }),
    issue({
      key: 'accounts-without-staff',
      label: 'حسابات دخول نشطة بدون موظف مربوط',
      count: num('accounts_without_staff'),
      severity: severityForCount(num('accounts_without_staff'), 1),
      source: 'staff_accounts',
      suggestedFix: 'اربط أي حساب دخول نشط بسجل موظف صحيح. حسابات المدير العام والدليفري مستثناة من هذا الفحص.',
      affectedPages: ['/staff-accounts', '/team'],
    }),
    issue({
      key: 'legacy-inactive-accounts',
      label: 'حسابات Legacy معطلة',
      count: num('legacy_inactive_accounts'),
      severity: 'info',
      source: 'staff_accounts',
      suggestedFix: 'معلومة أرشيفية فقط؛ الحسابات معطلة ولا تستطيع تسجيل الدخول.',
      affectedPages: ['/staff-accounts'],
    }),
    issue({
      key: 'points-without-staff',
      label: 'سجلات نقاط بدون staff_id',
      count: num('points_without_staff'),
      severity: severityForCount(num('points_without_staff'), 10),
      source: 'employee_transactions',
      suggestedFix: 'اربط سجلات النقاط بالموظف الصحيح قبل اعتماد تأثيرها.',
      affectedPages: ['/points'],
    }),
    issue({
      key: 'reviews-without-points',
      label: 'تقييمات ناقصها سجل نقاط',
      count: num('reviews_without_points'),
      severity: severityForCount(num('reviews_without_points'), 1),
      source: 'conversation_sales_reviews + employee_transactions',
      suggestedFix: 'أعد بناء Transaction pending للتقييم فقط إذا لم يكن له source_id مطابق؛ لا تعتمد الخصم تلقائيًا.',
      affectedPages: ['/reviews', '/points'],
    }),
    issue({
      key: 'pending-review-approvals',
      label: 'تقييمات تنتظر اعتماد تأثير النقاط',
      count: num('pending_review_approvals'),
      severity: 'info',
      source: 'conversation_sales_reviews + employee_transactions',
      suggestedFix: 'طابور اعتماد إداري طبيعي؛ الاعتماد أو الرفض يتم من الصلاحية المختصة ولا يعتبر خطأ بيانات.',
      affectedPages: ['/reviews', '/points'],
    }),
    issue({
      key: 'unassigned-customer-requests',
      label: 'طلبات عملاء مفتوحة بدون مسؤول',
      count: num('unassigned_customer_requests'),
      severity: severityForCount(num('unassigned_customer_requests'), 5),
      source: 'customer_requests',
      suggestedFix: 'راجع الطلبات المفتوحة غير المسندة. إذا كان الفرع غير محسوم فحدده أولًا قبل الإسناد.',
      affectedPages: ['/customer-requests'],
    }),
    issue({
      key: 'customer-requests-without-branch',
      label: 'طلبات عملاء مفتوحة بدون فرع',
      count: num('customer_requests_without_branch'),
      severity: severityForCount(num('customer_requests_without_branch'), 1),
      source: 'customer_requests.branch',
      suggestedFix: 'افتح مركز جودة طلبات العملاء ثم فلتر «يحتاج تحديد فرع». لا تعيّن فرعًا تلقائيًا إذا لم يوجد دليل موثوق.',
      affectedPages: ['/customer-requests'],
    }),
    issue({
      key: 'request-sync-conflicts',
      label: 'طلبات مزامنة تحتاج تحديد فرع',
      count: num('unresolved_request_sync_conflicts'),
      severity: severityForCount(num('unresolved_request_sync_conflicts'), 5),
      source: 'customer_requests.sync_conflict',
      suggestedFix: 'راجع بيانات العميل/الهاتف وحدد الفرع يدويًا فقط عندما لا يوجد دليل يسمح بالربط التلقائي.',
      affectedPages: ['/customer-requests'],
    }),
    issue({
      key: 'overdue-customer-requests',
      label: 'طلبات عملاء متأخرة عن الموعد',
      count: num('overdue_customer_requests'),
      severity: severityForCount(num('overdue_customer_requests'), 5),
      source: 'customer_requests',
      suggestedFix: 'راجع الطلبات المتأخرة وحدّث الموعد أو مرحلة التنفيذ.',
      affectedPages: ['/customer-requests'],
    }),
    issue({
      key: 'rls-coverage',
      label: 'جداول public بدون RLS',
      count: num('public_tables_without_rls'),
      severity: severityForCount(num('public_tables_without_rls'), 1),
      source: 'PostgreSQL RLS',
      suggestedFix: 'أي جدول جديد في public يجب تأمينه بسياسات RLS أو حجبه عن أدوار العميل قبل الاعتماد.',
      affectedPages: ['/'],
    }),
    issue({
      key: 'cycle-invoice-volume',
      label: 'حجم الفواتير النظيفة في الدورة الحالية',
      count: num('cycle_invoice_volume'),
      severity: 'info',
      source: 'dawaa_sales_invoices_dashboard_v1',
      suggestedFix: 'مؤشر مرجعي لحجم الدورة الحالية 26→25 حتى اليوم.',
      affectedPages: ['/invoices', '/analytics', '/'],
    }),
    issue({
      key: 'invoice-volume-review',
      label: 'حجم الفواتير المقروءة — كل التاريخ',
      count: num('invoice_volume'),
      severity: 'info',
      source: 'sales_invoices',
      suggestedFix: 'مؤشر مرجعي لحجم مصدر الفواتير التاريخي.',
      affectedPages: ['/invoices', '/analytics'],
    }),
  ];

  if (!performanceError) {
    const slow = perfNum('slow_query_groups');
    const verySlow = perfNum('very_slow_query_groups');
    rows.push(
      issue({
        key: 'performance-regression-monitor',
        label: 'استعلامات بطيئة منذ آخر Baseline',
        count: slow,
        severity: verySlow > 0 ? 'danger' : slow > 0 ? 'warning' : 'info',
        source: 'pg_stat_statements delta baseline',
        suggestedFix:
          slow > 0
            ? 'راجع الاستعلامات الجديدة التي تجاوز متوسطها 500ms منذ آخر Baseline.'
            : 'لا يوجد تراجع أداء جديد مسجل منذ آخر Baseline.',
        affectedPages: ['/'],
      })
    );
  }

  return rows;
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
