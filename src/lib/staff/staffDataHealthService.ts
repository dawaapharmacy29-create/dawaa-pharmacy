import { supabase } from "@/lib/supabase";
import { normalizeStaffName } from "@/lib/staffIdentityService";

export interface StaffDataHealthReport {
  staffId: string;
  staffName: string;
  overallHealthScore: number; // 0-100
  criticalIssues: DataHealthIssue[];
  warnings: DataHealthIssue[];
  info: DataHealthIssue[];
  lastChecked: string;
}

export interface DataHealthIssue {
  severity: "critical" | "warning" | "info";
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

export async function checkStaffDataHealth(staffId: string, staffName: string): Promise<StaffDataHealthReport> {
  const issues: DataHealthIssue[] = [];
  const startTime = new Date();

  // Check 1: Staff identity resolution
  const identityIssues = await checkStaffIdentityResolution(staffId, staffName);
  issues.push(...identityIssues);

  // Check 2: Sales data linkage
  const salesIssues = await checkSalesDataLinkage(staffId, staffName);
  issues.push(...salesIssues);

  // Check 3: Incentive data linkage
  const incentiveIssues = await checkIncentiveDataLinkage(staffId);
  issues.push(...incentiveIssues);

  // Check 4: Customer data completeness
  const customerIssues = await checkCustomerDataCompleteness(staffId, staffName);
  issues.push(...customerIssues);

  // Check 5: Stagnant/List assignment
  const stagnantIssues = await checkStagnantListAssignment(staffId, staffName);
  issues.push(...stagnantIssues);

  // Check 6: Attendance data
  const attendanceIssues = await checkAttendanceData(staffId);
  issues.push(...attendanceIssues);

  // Check 7: Classification quality
  const classificationIssues = await checkClassificationQuality(staffId, staffName);
  issues.push(...classificationIssues);

  // Calculate overall health score
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;

  const score = Math.max(0, 100 - (criticalCount * 25) - (warningCount * 10) - (infoCount * 2));

  return {
    staffId,
    staffName,
    overallHealthScore: score,
    criticalIssues: issues.filter((i) => i.severity === "critical"),
    warnings: issues.filter((i) => i.severity === "warning"),
    info: issues.filter((i) => i.severity === "info"),
    lastChecked: startTime.toISOString(),
  };
}

async function checkStaffIdentityResolution(staffId: string, staffName: string): Promise<DataHealthIssue[]> {
  const issues: DataHealthIssue[] = [];

  try {
    // Check for inactive duplicates
    const { data: sameNameStaff } = await supabase
      .from("staff")
      .select("id,name,branch,active,is_active")
      .neq("id", staffId)
      .eq("name", staffName)
      .limit(10);

    if (sameNameStaff && sameNameStaff.length > 0) {
      const inactiveCount = sameNameStaff.filter((row) => !row.is_active || !row.active).length;
      const activeCount = sameNameStaff.filter((row) => row.is_active && row.active).length;

      if (activeCount > 0) {
        issues.push({
          severity: "critical",
          category: "identity",
          table: "staff",
          description: `يوجد ${activeCount} موظف نشط بنفس الاسم`,
          affectedRecords: activeCount,
          suggestedAction: "راجع سجلات الموظفين ودمج الحسابات المكررة",
          relatedMetric: "duplicateStaff",
        });
      }

      if (inactiveCount > 0) {
        issues.push({
          severity: "warning",
          category: "identity",
          table: "staff",
          description: `يوجد ${inactiveCount} موظف غير نشط بنفس الاسم`,
          affectedRecords: inactiveCount,
          suggestedAction: "تأكد من أن الموظف غير النشط هو الحساب الصحيح",
          relatedMetric: "inactiveDuplicates",
        });
      }
    }

    // Check for unresolved seller names in invoices
    const { data: invoiceNames } = await supabase
      .from("sales_invoices")
      .select("seller_name")
      .ilike("seller_name", `%${staffName}%`)
      .limit(100);

    if (invoiceNames && invoiceNames.length > 0) {
      const normalizedStaffName = normalizeStaffName(staffName);
      const mismatchedNames = invoiceNames.filter((row) => {
        const sellerName = String(row.seller_name || "");
        return normalizeStaffName(sellerName) !== normalizedStaffName;
      });

      if (mismatchedNames.length > 0) {
        issues.push({
          severity: "warning",
          category: "identity",
          table: "sales_invoices",
          description: `يوجد ${mismatchedNames.length} فاتورة باسم موظف غير مطابق تماماً`,
          affectedRecords: mismatchedNames.length,
          suggestedAction: "استخدم staff_identity_aliases لربط الأسماء المختلفة",
          relatedMetric: "unresolvedSellerNames",
        });
      }
    }
  } catch (error) {
    // Ignore errors in identity check
  }

  return issues;
}

async function checkSalesDataLinkage(staffId: string, staffName: string): Promise<DataHealthIssue[]> {
  const issues: DataHealthIssue[] = [];

  try {
    // Check staff_sales_summary linkage
    const { data: summaryData, error: summaryError } = await supabase
      .from("staff_sales_summary")
      .select("*")
      .eq("staff_id", staffId)
      .limit(10);

    if (!summaryError && (!summaryData || summaryData.length === 0)) {
      issues.push({
        severity: "warning",
        category: "sales",
        table: "staff_sales_summary",
        description: "لا توجد بيانات ملخص مبيعات مرتبطة بـ staff_id",
        affectedRecords: 0,
        suggestedAction: "تأكد من أن staff_sales_summary يتم تحديثه بشكل صحيح",
        relatedMetric: "salesLinked",
      });
    }

    // Check for missing staff_id in sales_invoices
    const { data: invoicesWithoutStaff } = await supabase
      .from("sales_invoices")
      .select("id, invoice_no, invoice_number")
      .ilike("seller_name", `%${staffName}%`)
      .is("staff_id", null)
      .limit(100);

    if (invoicesWithoutStaff && invoicesWithoutStaff.length > 0) {
      issues.push({
        severity: "info",
        category: "sales",
        table: "sales_invoices",
        description: `يوجد ${invoicesWithoutStaff.length} فاتورة بدون staff_id`,
        affectedRecords: invoicesWithoutStaff.length,
        suggestedAction: "قم بتحديث staff_id في الفواتير لتحسين الربط",
        relatedMetric: "missingStaffIdInSales",
      });
    }

    // Check for missing customer data
    const { data: invoicesWithoutCustomer } = await supabase
      .from("sales_invoices")
      .select("id, invoice_no, invoice_number")
      .ilike("seller_name", `%${staffName}%`)
      .or("customer_name.is.null,customer_code.is.null")
      .limit(100);

    if (invoicesWithoutCustomer && invoicesWithoutCustomer.length > 0) {
      issues.push({
        severity: "warning",
        category: "sales",
        table: "sales_invoices",
        description: `يوجد ${invoicesWithoutCustomer.length} فاتورة بدون بيانات عميل`,
        affectedRecords: invoicesWithoutCustomer.length,
        suggestedAction: "تأكد من تسجيل اسم العميل أو الكود في كل فاتورة",
        relatedMetric: "missingCustomerInInvoices",
      });
    }
  } catch (error) {
    // Ignore errors in sales check
  }

  return issues;
}

async function checkIncentiveDataLinkage(staffId: string): Promise<DataHealthIssue[]> {
  const issues: DataHealthIssue[] = [];

  try {
    // Check employee_transactions linkage
    const { data: transactions, error: txError } = await supabase
      .from("employee_transactions")
      .select("*")
      .eq("staff_id", staffId)
      .limit(10);

    if (!txError && (!transactions || transactions.length === 0)) {
      issues.push({
        severity: "info",
        category: "incentives",
        table: "employee_transactions",
        description: "لا توجد معاملات حوافز مرتبطة بـ staff_id",
        affectedRecords: 0,
        suggestedAction: "تأكد من أن employee_transactions يتم تحديثه بشكل صحيح",
        relatedMetric: "missingStaffIdInIncentives",
      });
    }

    // Check for transactions without proper status
    const { data: pendingTransactions } = await supabase
      .from("employee_transactions")
      .select("id")
      .eq("staff_id", staffId)
      .in("status", ["pending", "review"])
      .limit(50);

    if (pendingTransactions && pendingTransactions.length > 10) {
      issues.push({
        severity: "warning",
        category: "incentives",
        table: "employee_transactions",
        description: `يوجد ${pendingTransactions.length} معاملة معلقة أو قيد المراجعة`,
        affectedRecords: pendingTransactions.length,
        suggestedAction: "راجع واعتمد أو رفض المعاملات المعلقة",
        relatedMetric: "pendingTransactions",
      });
    }
  } catch (error) {
    // Ignore errors in incentive check
  }

  return issues;
}

async function checkCustomerDataCompleteness(staffId: string, staffName: string): Promise<DataHealthIssue[]> {
  const issues: DataHealthIssue[] = [];

  try {
    // Check for customers without phone
    const { data: customersWithoutPhone } = await supabase
      .from("sales_invoices")
      .select("customer_name")
      .ilike("seller_name", `%${staffName}%`)
      .or("customer_phone.is.null,customer_phone.eq.'',customer_phone.length.lt.10")
      .limit(100);

    if (customersWithoutPhone && customersWithoutPhone.length > 0) {
      const uniqueCustomers = new Set(customersWithoutPhone.map((r) => String(r.customer_name || ""))).size;
      issues.push({
        severity: "warning",
        category: "customers",
        table: "sales_invoices",
        description: `يوجد ${uniqueCustomers} عميل بدون رقم هاتف صحيح`,
        affectedRecords: uniqueCustomers,
        suggestedAction: "حاول الحصول على أرقام هواتف العملاء لتحسين التواصل",
        relatedMetric: "customersWithMissingPhone",
      });
    }
  } catch (error) {
    // Ignore errors in customer check
  }

  return issues;
}

async function checkStagnantListAssignment(staffId: string, staffName: string): Promise<DataHealthIssue[]> {
  const issues: DataHealthIssue[] = [];

  try {
    // Check stagnant_medicines assignment
    const { data: stagnantAssignments } = await supabase
      .from("stagnant_medicines")
      .select("id")
      .eq("responsible_doctor_id", staffId)
      .limit(10);

    if (!stagnantAssignments || stagnantAssignments.length === 0) {
      // Try by name
      const { data: byName } = await supabase
        .from("stagnant_medicines")
        .select("id")
        .eq("responsible_doctor_name", staffName)
        .limit(10);

      if (!byName || byName.length === 0) {
        issues.push({
          severity: "info",
          category: "stagnant_list",
          table: "stagnant_medicines",
          description: "لا توجد أصناف راكدة مسندة لهذا الموظف",
          affectedRecords: 0,
          suggestedAction: "يمكن تعيين أصناف راكدة للموظف إذا لزم الأمر",
          relatedMetric: "hasStagnant",
        });
      }
    }

    // Check incentive_medicines assignment
    const { data: listAssignments } = await supabase
      .from("incentive_medicines")
      .select("id")
      .eq("doctor_id", staffId)
      .limit(10);

    if (!listAssignments || listAssignments.length === 0) {
      // Try by name
      const { data: byName } = await supabase
        .from("incentive_medicines")
        .select("id")
        .eq("responsible_doctor", staffName)
        .limit(10);

      if (!byName || byName.length === 0) {
        issues.push({
          severity: "info",
          category: "stagnant_list",
          table: "incentive_medicines",
          description: "لا توجد أصناف لستة مسندة لهذا الموظف",
          affectedRecords: 0,
          suggestedAction: "يمكن تعيين أصناف لستة للموظف إذا لزم الأمر",
          relatedMetric: "hasList",
        });
      }
    }
  } catch (error) {
    // Ignore errors in stagnant/list check
  }

  return issues;
}

async function checkAttendanceData(staffId: string): Promise<DataHealthIssue[]> {
  const issues: DataHealthIssue[] = [];

  try {
    // Check for schedule data
    const { data: scheduleData } = await supabase
      .from("staff_schedule")
      .select("id")
      .eq("staff_id", staffId)
      .limit(10);

    if (!scheduleData || scheduleData.length === 0) {
      issues.push({
        severity: "info",
        category: "attendance",
        table: "staff_schedule",
        description: "لا يوجد جدول عمل مسجل لهذا الموظف",
        affectedRecords: 0,
        suggestedAction: "قم بإضافة جدول عمل للموظف",
        relatedMetric: "hasSchedule",
      });
    }
  } catch (error) {
    // Ignore errors in attendance check
  }

  return issues;
}

async function checkClassificationQuality(staffId: string, staffName: string): Promise<DataHealthIssue[]> {
  const issues: DataHealthIssue[] = [];

  try {
    // Check for missing customer classification
    const { data: invoicesWithoutCustomerClass } = await supabase
      .from("sales_invoices")
      .select("id, invoice_no, invoice_number")
      .ilike("seller_name", `%${staffName}%`)
      .is("customer_segment", null)
      .limit(100);

    if (invoicesWithoutCustomerClass && invoicesWithoutCustomerClass.length > 0) {
      issues.push({
        severity: "warning",
        category: "classification",
        table: "sales_invoices",
        description: `يوجد ${invoicesWithoutCustomerClass.length} فاتورة بدون تصنيف العميل`,
        affectedRecords: invoicesWithoutCustomerClass.length,
        suggestedAction: "تأكد من تصنيف العميل في كل فاتورة",
        relatedMetric: "missingClassification",
      });
    }
  } catch (error) {
    // Ignore errors in classification check
  }

  return issues;
}

export async function checkAllStaffDataHealth(limit = 50): Promise<StaffDataHealthReport[]> {
  const { data: staff } = await supabase
    .from("staff")
    .select("id,name")
    .eq("is_active", true)
    .limit(limit);

  if (!staff || staff.length === 0) {
    return [];
  }

  const reports: StaffDataHealthReport[] = [];

  for (const staffMember of staff) {
    const report = await checkStaffDataHealth(
      String(staffMember.id),
      String(staffMember.name || "")
    );
    reports.push(report);
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
  const healthyStaff = reports.filter((r) => r.overallHealthScore >= 80).length;
  const criticalIssues = reports.reduce((sum, r) => sum + r.criticalIssues.length, 0);
  const warnings = reports.reduce((sum, r) => sum + r.warnings.length, 0);
  const avgHealthScore = totalStaff > 0 ? reports.reduce((sum, r) => sum + r.overallHealthScore, 0) / totalStaff : 0;

  return {
    totalStaff,
    healthyStaff,
    criticalIssues,
    warnings,
    avgHealthScore,
  };
}
