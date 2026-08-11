from pathlib import Path
import re

path = Path('src/lib/dataHealth/appDataHealthService.ts')
text = path.read_text(encoding='utf-8')
text = text.replace("import { countStaffAccountsWithoutStaffSafe } from '@/lib/staff/staffAccountsApi';\n", '')

pattern = re.compile(
    r"export async function loadAppDataHealthSummary\(\) \{.*?\n\}\n\nexport function summarizeDataHealth",
    re.S,
)
replacement = r'''export async function loadAppDataHealthSummary() {
  const [healthResult, performanceResult] = await Promise.allSettled([
    supabase.rpc('get_app_data_health_v2'),
    supabase.rpc('get_app_performance_health_v2'),
  ]);

  const healthResponse = healthResult.status === 'fulfilled' ? healthResult.value : null;
  const performanceResponse = performanceResult.status === 'fulfilled' ? performanceResult.value : null;
  const healthError = healthResponse?.error?.message || (healthResult.status === 'rejected' ? String(healthResult.reason) : null);
  const performanceError = performanceResponse?.error?.message || (performanceResult.status === 'rejected' ? String(performanceResult.reason) : null);
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
    issue({ key: 'invoices-without-customer', label: 'فواتير بدون عميل', count: num('invoices_without_customer'), severity: severityForCount(num('invoices_without_customer'), 500), source: 'sales_invoices', suggestedFix: 'راجع ربط customer_code/customer_id بعد الاستيراد.', affectedPages: ['/invoices', '/customers', '/customer-service', '/'] }),
    issue({ key: 'invoices-without-doctor', label: 'فواتير بدون دكتور/موظف', count: num('invoices_without_doctor'), severity: severityForCount(num('invoices_without_doctor'), 25), source: 'sales_invoices', suggestedFix: 'اربط seller_name بالموظف الصحيح.', affectedPages: ['/invoices', '/analytics', '/'] }),
    issue({ key: 'invoices-without-branch', label: 'فواتير بدون فرع', count: num('invoices_without_branch'), severity: severityForCount(num('invoices_without_branch'), 25), source: 'sales_invoices', suggestedFix: 'راجع الفرع في ملف الاستيراد.', affectedPages: ['/invoices', '/analytics', '/'] }),
    issue({ key: 'duplicate-invoice-groups', label: 'مجموعات فواتير مكررة', count: num('duplicate_invoice_groups'), severity: severityForCount(num('duplicate_invoice_groups'), 1), source: 'sales_invoices', suggestedFix: 'راجع الفرع + التاريخ + رقم الفاتورة قبل أي حذف.', affectedPages: ['/invoices', '/'] }),
    issue({ key: 'invalid-customer-phones', label: 'عملاء بدون رقم صالح', count: num('invalid_customer_phones'), severity: severityForCount(num('invalid_customer_phones'), 300), source: 'customer_metrics_summary', suggestedFix: 'استكمل أرقام العملاء قبل حملات واتساب والمتابعات.', affectedPages: ['/customers', '/customer-service'] }),
    issue({ key: 'customers-without-branch', label: 'عملاء بدون فرع', count: num('customers_without_branch'), severity: severityForCount(num('customers_without_branch'), 100), source: 'customers', suggestedFix: 'حدد الفرع الرئيسي للعميل.', affectedPages: ['/customers'] }),
    issue({ key: 'customers-without-phone', label: 'عملاء بدون رقم هاتف', count: num('customers_without_phone'), severity: severityForCount(num('customers_without_phone'), 100), source: 'customers', suggestedFix: 'استكمل الهاتف الصحيح للعميل.', affectedPages: ['/customers'] }),
    issue({ key: 'accounts-without-staff', label: 'حسابات بدون موظف مربوط', count: num('accounts_without_staff'), severity: severityForCount(num('accounts_without_staff'), 5), source: 'staff_accounts', suggestedFix: 'اربط كل حساب دخول بسجل موظف صحيح.', affectedPages: ['/staff-accounts', '/team'] }),
    issue({ key: 'points-without-staff', label: 'سجلات نقاط بدون staff_id', count: num('points_without_staff'), severity: severityForCount(num('points_without_staff'), 10), source: 'employee_transactions', suggestedFix: 'اربط سجلات النقاط بالموظف.', affectedPages: ['/points'] }),
    issue({ key: 'reviews-without-points', label: 'تقييمات محادثات تنتظر اعتماد تأثير النقاط', count: num('reviews_without_points'), severity: severityForCount(num('reviews_without_points'), 10), source: 'conversation_sales_reviews', suggestedFix: 'راجع واعتمد تأثير التقييمات المعلقة.', affectedPages: ['/reviews', '/points'] }),
    issue({ key: 'unassigned-customer-requests', label: 'طلبات عملاء مفتوحة بدون مسؤول', count: num('unassigned_customer_requests'), severity: severityForCount(num('unassigned_customer_requests'), 5), source: 'customer_requests', suggestedFix: 'اسند كل طلب مفتوح لمسؤول واضح.', affectedPages: ['/customer-requests'] }),
    issue({ key: 'overdue-customer-requests', label: 'طلبات عملاء متأخرة عن الموعد', count: num('overdue_customer_requests'), severity: severityForCount(num('overdue_customer_requests'), 5), source: 'customer_requests', suggestedFix: 'راجع الطلبات المتأخرة وحدّث الموعد أو مرحلة التنفيذ.', affectedPages: ['/customer-requests'] }),
    issue({ key: 'rls-coverage', label: 'جداول public بدون RLS', count: num('public_tables_without_rls'), severity: severityForCount(num('public_tables_without_rls'), 1), source: 'PostgreSQL RLS', suggestedFix: 'أي جدول جديد في public يجب تأمينه بسياسات RLS قبل الاعتماد.', affectedPages: ['/'] }),
    issue({ key: 'invoice-volume-review', label: 'حجم الفواتير المقروءة', count: num('invoice_volume'), severity: 'info', source: 'sales_invoices', suggestedFix: 'مؤشر جاهزية مصدر الفواتير.', affectedPages: ['/invoices', '/analytics', '/'] }),
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
        suggestedFix: slow > 0 ? 'راجع الاستعلامات الجديدة التي تجاوز متوسطها 500ms منذ آخر Baseline.' : 'لا يوجد تراجع أداء جديد مسجل منذ آخر Baseline.',
        affectedPages: ['/'],
      })
    );
  }

  return rows;
}

export function summarizeDataHealth'''
new_text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    if "get_app_data_health_v2" in text:
        print('data health v2: already applied')
    else:
        raise SystemExit('loadAppDataHealthSummary block not found')
else:
    text = new_text
    print('data health v2: applied')

path.write_text(text, encoding='utf-8')
