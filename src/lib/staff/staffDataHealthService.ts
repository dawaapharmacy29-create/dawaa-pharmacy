import { supabase } from '@/lib/supabase';

export interface StaffDataHealthReport {
  staffId: string;
  staffName: string;
  overallHealthScore: number;
  criticalIssues: DataHealthIssue[];
  warnings: DataHealthIssue[];
  info: DataHealthIssue[];
  lastChecked: string;
}

export interface DataHealthIssue {
  severity: 'critical' | 'warning' | 'info';
  category: string;
  table: string;
  description: string;
  affectedRecords: number;
  suggestedAction: string;
  relatedMetric?: string;
}

export interface DataHealthCheckResult {
  healthy: boolean;
  issues: DataHealthIssue[];
  score: number;
}

type InvoiceHealth = {
  scopeStart?: string;
  invoicesCount?: number;
  missingStaffId?: number;
  missingCustomerData?: number;
  invalidPhoneRows?: number;
  customersMissingValidPhone?: number;
  missingClassification?: number;
  mismatchedInvoiceNames?: number;
  sellerNames?: Array<{ sellerName?: string; invoices?: number }>;
};

async function loadInvoiceHealth(staffId: string): Promise<InvoiceHealth> {
  try {
    const { data, error } = await supabase.rpc('get_staff_invoice_health_read_v1', {
      p_staff_id: staffId,
    });
    if (error || !data || typeof data !== 'object') return {};
    return data as InvoiceHealth;
  } catch {
    return {};
  }
}

function invoiceHealthIssues(health: InvoiceHealth): DataHealthIssue[] {
  const issues: DataHealthIssue[] = [];
  const scopeSuffix = health.scopeStart ? ` خلال فترة القياس منذ ${health.scopeStart}` : '';

  const mismatched = Number(health.mismatchedInvoiceNames || 0);
  if (mismatched > 0) {
    issues.push({
      severity: 'warning',
      category: 'identity',
      table: 'sales_invoices',
      description: `يوجد ${mismatched} فاتورة مرتبطة باسم بائع بديل${scopeSuffix}`,
      affectedRecords: mismatched,
      suggestedAction: 'راجع staff_identity_aliases وتأكد أن الأسماء البديلة تخص الموظف نفسه',
      relatedMetric: 'unresolvedSellerNames',
    });
  }

  const missingStaffId = Number(health.missingStaffId || 0);
  if (missingStaffId > 0) {
    issues.push({
      severity: 'info',
      category: 'sales',
      table: 'sales_invoices',
      description: `يوجد ${missingStaffId} فاتورة مرتبطة بالاسم لكن بدون staff_id${scopeSuffix}`,
      affectedRecords: missingStaffId,
      suggestedAction: 'استكمل staff_id في الفواتير التاريخية لتحسين الربط وتقليل الاعتماد على الأسماء',
      relatedMetric: 'missingStaffIdInSales',
    });
  }

  const missingCustomerData = Number(health.missingCustomerData || 0);
  if (missingCustomerData > 0) {
    issues.push({
      severity: 'warning',
      category: 'sales',
      table: 'sales_invoices',
      description: `يوجد ${missingCustomerData} فاتورة ناقصة اسم العميل أو كوده${scopeSuffix}`,
      affectedRecords: missingCustomerData,
      suggestedAction: 'تأكد من تسجيل اسم العميل وكوده عند البيع كلما كان العميل معروفًا',
      relatedMetric: 'missingCustomerInInvoices',
    });
  }

  const customersMissingPhone = Number(health.customersMissingValidPhone || 0);
  if (customersMissingPhone > 0) {
    issues.push({
      severity: 'warning',
      category: 'customers',
      table: 'sales_invoices',
      description: `يوجد ${customersMissingPhone} عميل بدون رقم هاتف مصري صالح${scopeSuffix}`,
      affectedRecords: customersMissingPhone,
      suggestedAction: 'استكمل أرقام الهاتف الصحيحة لتحسين المتابعة وخدمة العملاء',
      relatedMetric: 'customersWithMissingPhone',
    });
  }

  const missingClassification = Number(health.missingClassification || 0);
  if (missingClassification > 0) {
    issues.push({
      severity: 'warning',
      category: 'classification',
      table: 'sales_invoices',
      description: `يوجد ${missingClassification} فاتورة بدون تصنيف عميل${scopeSuffix}`,
      affectedRecords: missingClassification,
      suggestedAction: 'استكمل تصنيف العميل من مصدر العميل المركزي بدل إعادة إدخاله يدويًا',
      relatedMetric: 'missingClassification',
    });
  }

  return issues;
}

async function checkStaffIdentityResolution(
  staffId: string,
  staffName: string
): Promise<DataHealthIssue[]> {
  const issues: DataHealthIssue[] = [];
  try {
    const { data: sameNameStaff } = await supabase
      .from('staff')
      .select('id,name,branch,active,is_active,status')
      .neq('id', staffId)
      .eq('name', staffName)
      .limit(20);

    const rows = sameNameStaff || [];
    const isActive = (row: Record<string, unknown>) =>
      row.active !== false && row.is_active !== false && String(row.status || '').toLowerCase() !== 'inactive';
    const activeCount = rows.filter((row) => isActive(row as Record<string, unknown>)).length;
    const inactiveCount = Math.max(0, rows.length - activeCount);

    if (activeCount > 0) {
      issues.push({
        severity: 'critical',
        category: 'identity',
        table: 'staff',
        description: `يوجد ${activeCount} موظف نشط آخر بنفس الاسم`,
        affectedRecords: activeCount,
        suggestedAction: 'راجع الهوية المركزية للموظف وادمج الحسابات المكررة قبل احتساب الأداء',
        relatedMetric: 'duplicateStaff',
      });
    }
    if (inactiveCount > 0) {
      issues.push({
        severity: 'warning',
        category: 'identity',
        table: 'staff',
        description: `يوجد ${inactiveCount} سجل موظف غير نشط بنفس الاسم`,
        affectedRecords: inactiveCount,
        suggestedAction: 'احتفظ بسجل تاريخي واحد واربطه بالهوية المركزية للموظف',
        relatedMetric: 'inactiveDuplicates',
      });
    }
  } catch {
    // Health checks are best-effort and should not break the staff page.
  }
  return issues;
}

async function checkSalesSummaryLinkage(staffId: string): Promise<DataHealthIssue[]> {
  try {
    const { data, error } = await supabase
      .from('staff_sales_summary')
      .select('staff_id')
      .eq('staff_id', staffId)
      .limit(1);
    if (error || (data && data.length > 0)) return [];
    return [{
      severity: 'warning',
      category: 'sales',
      table: 'staff_sales_summary',
      description: 'لا توجد بيانات ملخص مبيعات مرتبطة بـ staff_id',
      affectedRecords: 0,
      suggestedAction: 'راجع ربط هوية البائع قبل الاعتماد على تقارير الموظف',
      relatedMetric: 'salesLinked',
    }];
  } catch {
    return [];
  }
}

async function checkIncentiveDataLinkage(staffId: string): Promise<DataHealthIssue[]> {
  const issues: DataHealthIssue[] = [];
  try {
    const [anyTx, pendingTx] = await Promise.all([
      supabase.from('employee_transactions').select('id').eq('staff_id', staffId).limit(1),
      supabase
        .from('employee_transactions')
        .select('id')
        .eq('staff_id', staffId)
        .in('status', ['pending', 'review'])
        .limit(50),
    ]);

    if (!anyTx.error && (!anyTx.data || anyTx.data.length === 0)) {
      issues.push({
        severity: 'info',
        category: 'incentives',
        table: 'employee_transactions',
        description: 'لا توجد معاملات حوافز مرتبطة بـ staff_id',
        affectedRecords: 0,
        suggestedAction: 'تأكد من ربط معاملات النقاط والحوافز بالهوية المركزية للموظف',
        relatedMetric: 'missingStaffIdInIncentives',
      });
    }

    const pendingCount = pendingTx.data?.length || 0;
    if (pendingCount > 10) {
      issues.push({
        severity: 'warning',
        category: 'incentives',
        table: 'employee_transactions',
        description: `يوجد ${pendingCount} معاملة معلقة أو قيد المراجعة`,
        affectedRecords: pendingCount,
        suggestedAction: 'راجع واعتمد أو ارفض المعاملات المعلقة',
        relatedMetric: 'pendingTransactions',
      });
    }
  } catch {
    // Best-effort diagnostic.
  }
  return issues;
}

async function checkStagnantListAssignment(
  staffId: string,
  staffName: string
): Promise<DataHealthIssue[]> {
  const issues: DataHealthIssue[] = [];
  try {
    const [stagnantById, stagnantByName, listById, listByName] = await Promise.all([
      supabase.from('stagnant_medicines').select('id').eq('responsible_doctor_id', staffId).limit(1),
      supabase.from('stagnant_medicines').select('id').eq('responsible_doctor_name', staffName).limit(1),
      supabase.from('incentive_medicines').select('id').eq('doctor_id', staffId).limit(1),
      supabase.from('incentive_medicines').select('id').eq('responsible_doctor', staffName).limit(1),
    ]);

    if (!(stagnantById.data?.length || stagnantByName.data?.length)) {
      issues.push({
        severity: 'info',
        category: 'stagnant_list',
        table: 'stagnant_medicines',
        description: 'لا توجد أصناف راكدة مسندة لهذا الموظف',
        affectedRecords: 0,
        suggestedAction: 'يمكن تعيين أصناف راكدة للموظف إذا كانت ضمن خطة الفرع',
        relatedMetric: 'hasStagnant',
      });
    }
    if (!(listById.data?.length || listByName.data?.length)) {
      issues.push({
        severity: 'info',
        category: 'stagnant_list',
        table: 'incentive_medicines',
        description: 'لا توجد أصناف لستة مسندة لهذا الموظف',
        affectedRecords: 0,
        suggestedAction: 'يمكن تعيين أصناف لستة للموظف إذا كانت ضمن خطة الحافز',
        relatedMetric: 'hasList',
      });
    }
  } catch {
    // Best-effort diagnostic.
  }
  return issues;
}

async function checkAttendanceData(staffId: string): Promise<DataHealthIssue[]> {
  try {
    const { data } = await supabase
      .from('staff_schedule')
      .select('id')
      .eq('staff_id', staffId)
      .limit(1);
    if (data?.length) return [];
    return [{
      severity: 'info',
      category: 'attendance',
      table: 'staff_schedule',
      description: 'لا يوجد جدول عمل مسجل لهذا الموظف',
      affectedRecords: 0,
      suggestedAction: 'أضف جدول عمل للموظف حتى تكون مؤشرات الحضور قابلة للمقارنة',
      relatedMetric: 'hasSchedule',
    }];
  } catch {
    return [];
  }
}

export async function checkStaffDataHealth(
  staffId: string,
  staffName: string
): Promise<StaffDataHealthReport> {
  const startTime = new Date();
  const [invoiceHealth, identityIssues, salesIssues, incentiveIssues, stagnantIssues, attendanceIssues] =
    await Promise.all([
      loadInvoiceHealth(staffId),
      checkStaffIdentityResolution(staffId, staffName),
      checkSalesSummaryLinkage(staffId),
      checkIncentiveDataLinkage(staffId),
      checkStagnantListAssignment(staffId, staffName),
      checkAttendanceData(staffId),
    ]);

  const issues = [
    ...identityIssues,
    ...invoiceHealthIssues(invoiceHealth),
    ...salesIssues,
    ...incentiveIssues,
    ...stagnantIssues,
    ...attendanceIssues,
  ];

  const criticalCount = issues.filter((issue) => issue.severity === 'critical').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const infoCount = issues.filter((issue) => issue.severity === 'info').length;
  const score = Math.max(0, 100 - criticalCount * 25 - warningCount * 10 - infoCount * 2);

  return {
    staffId,
    staffName,
    overallHealthScore: score,
    criticalIssues: issues.filter((issue) => issue.severity === 'critical'),
    warnings: issues.filter((issue) => issue.severity === 'warning'),
    info: issues.filter((issue) => issue.severity === 'info'),
    lastChecked: startTime.toISOString(),
  };
}

export async function checkAllStaffDataHealth(limit = 50): Promise<StaffDataHealthReport[]> {
  const { data: staff } = await supabase
    .from('staff')
    .select('id,name')
    .eq('is_active', true)
    .limit(limit);

  if (!staff?.length) return [];

  const reports: StaffDataHealthReport[] = [];
  const concurrency = 4;
  for (let index = 0; index < staff.length; index += concurrency) {
    const batch = staff.slice(index, index + concurrency);
    const batchReports = await Promise.all(
      batch.map((staffMember) =>
        checkStaffDataHealth(String(staffMember.id), String(staffMember.name || ''))
      )
    );
    reports.push(...batchReports);
  }
  return reports.sort((a, b) => a.overallHealthScore - b.overallHealthScore);
}

export function getDataHealthSummary(reports: StaffDataHealthReport[]): {
  totalStaff: number;
  healthyStaff: number;
  criticalIssues: number;
  warnings: number;
  avgHealthScore: number;
} {
  const totalStaff = reports.length;
  return {
    totalStaff,
    healthyStaff: reports.filter((report) => report.overallHealthScore >= 80).length,
    criticalIssues: reports.reduce((sum, report) => sum + report.criticalIssues.length, 0),
    warnings: reports.reduce((sum, report) => sum + report.warnings.length, 0),
    avgHealthScore:
      totalStaff > 0
        ? reports.reduce((sum, report) => sum + report.overallHealthScore, 0) / totalStaff
        : 0,
  };
}
