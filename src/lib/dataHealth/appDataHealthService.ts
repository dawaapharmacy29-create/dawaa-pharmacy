import { supabase } from "@/lib/supabase";

export type DataHealthIssue = {
  key: string;
  label: string;
  count: number | null;
  severity: "info" | "warning" | "danger";
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

async function safeCount(
  source: string,
  build: (query: CountQuery) => PromiseLike<CountResult>,
) {
  try {
    const exact = await build(
      supabase.from(source).select("*", { count: "exact", head: true }) as unknown as CountQuery,
    );
    if (!exact.error && exact.count !== null && exact.count !== undefined) {
      return { count: exact.count, error: null };
    }

    const fallback = await build(
      supabase.from(source).select("*").limit(1001) as unknown as CountQuery,
    );
    if (fallback.error) return { count: null, error: fallback.error.message || "تعذر تحميل المصدر" };
    return { count: fallback.data?.length ?? 0, error: null };
  } catch (error) {
    return {
      count: null,
      error: error instanceof Error ? error.message : "تعذر تحميل المصدر",
    };
  }
}

function issue(
  args: Omit<DataHealthIssue, "severity"> & {
    severity?: DataHealthIssue["severity"];
  },
): DataHealthIssue {
  return { severity: args.severity || "warning", ...args };
}

function severityForCount(count: number | null, dangerAt = 100) {
  if (count === null) return "warning" as const;
  if (count >= dangerAt) return "danger" as const;
  if (count > 0) return "warning" as const;
  return "info" as const;
}

export async function loadAppDataHealthSummary() {
  const [
    invoicesWithoutCustomer,
    invoicesWithoutDoctor,
    invoicesWithoutBranch,
    invalidPhones,
    inactiveStaff,
    pointRowsWithoutStaff,
    invoicesWithNumber,
  ] = await Promise.all([
    safeCount("sales_invoices", (query) =>
      query.or("customer_name.ilike.%عميل غير مسجل%,customer_name.ilike.%عميل الصيدلية%,and(customer_code.is.null,customer_phone.is.null,customer_name.is.null),and(customer_code.eq.,customer_phone.eq.,customer_name.eq.)"),
    ),
    safeCount("sales_invoices", (query) =>
      query.or("seller_name.is.null,seller_name.eq."),
    ),
    safeCount("sales_invoices", (query) => query.or("branch.is.null,branch.eq.")),
    safeCount("customer_metrics_summary", (query) =>
      query.or("customer_phone.is.null,customer_phone.eq.,customer_phone.ilike.code:%"),
    ),
    safeCount("staff", (query) => query.eq("active", false)),
    safeCount("employee_transactions", (query) => query.is("staff_id", null)),
    safeCount("sales_invoices", (query) => query.or("invoice_no.not.is.null,invoice_number.not.is.null")),
  ]);

  return [
    issue({
      key: "invoices-without-customer",
      label: "فواتير بدون عميل",
      count: invoicesWithoutCustomer.count,
      severity: severityForCount(invoicesWithoutCustomer.count, 500),
      source: "sales_invoices",
      suggestedFix: "راجع customer_code/customer_id بعد الاستيراد، ثم شغل تحديث ملخص العملاء.",
      affectedPages: ["/invoices", "/customers", "/customer-service", "/"],
      error: invoicesWithoutCustomer.error,
    }),
    issue({
      key: "invoices-without-doctor",
      label: "فواتير بدون دكتور/موظف",
      count: invoicesWithoutDoctor.count,
      severity: severityForCount(invoicesWithoutDoctor.count, 25),
      source: "sales_invoices",
      suggestedFix: "اربط seller_name بموظف أو أضف alias للموظف الصحيح.",
      affectedPages: ["/invoices", "/staff/:id", "/analytics", "/"],
      error: invoicesWithoutDoctor.error,
    }),
    issue({
      key: "invoices-without-branch",
      label: "فواتير بدون فرع",
      count: invoicesWithoutBranch.count,
      severity: severityForCount(invoicesWithoutBranch.count, 25),
      source: "sales_invoices",
      suggestedFix: "راجع عمود الفرع/المخزن في ملف الاستيراد.",
      affectedPages: ["/invoices", "/analytics", "/"],
      error: invoicesWithoutBranch.error,
    }),
    issue({
      key: "invalid-customer-phones",
      label: "عملاء بدون رقم صالح",
      count: invalidPhones.count,
      severity: severityForCount(invalidPhones.count, 300),
      source: "customer_metrics_summary",
      suggestedFix: "راجع أرقام العملاء الفارغة أو التي تبدأ بـ code: قبل حملات واتساب والمتابعات.",
      affectedPages: ["/customers", "/customer-service", "/whatsapp-analytics"],
      error: invalidPhones.error,
    }),
    issue({
      key: "inactive-staff-with-data",
      label: "موظفون غير نشطين لهم بيانات",
      count: inactiveStaff.count,
      severity: "info",
      source: "staff",
      suggestedFix: "اعرض غير النشطين كأسماء بديلة فقط عند الحاجة، وليس كموظفين مكررين في التقارير.",
      affectedPages: ["/team", "/staff/:id", "/analytics", "/quarterly-incentives"],
      error: inactiveStaff.error,
    }),
    issue({
      key: "points-without-staff",
      label: "سجلات نقاط بدون staff_id",
      count: pointRowsWithoutStaff.count,
      severity: severityForCount(pointRowsWithoutStaff.count, 10),
      source: "employee_transactions",
      suggestedFix: "اربط سجلات النقاط بالموظف حتى تتطابق صفحة النقاط مع صفحة الموظف.",
      affectedPages: ["/points", "/staff/:id"],
      error: pointRowsWithoutStaff.error,
    }),
    issue({
      key: "invoice-volume-review",
      label: "حجم الفواتير المقروءة",
      count: invoicesWithNumber.count,
      severity: "info",
      source: "sales_invoices",
      suggestedFix: "استخدم هذا الرقم كمؤشر أن مصدر الفواتير متاح للصفحات والتحليلات.",
      affectedPages: ["/invoices", "/analytics", "/", "/staff/:id"],
      error: invoicesWithNumber.error,
    }),
  ];
}

export function summarizeDataHealth(issues: DataHealthIssue[]) {
  const actionable = issues.filter((item) => (item.count || 0) > 0 && item.severity !== "info");
  const danger = actionable.filter((item) => item.severity === "danger");
  const warnings = actionable.filter((item) => item.severity === "warning");
  const totalRecords = actionable.reduce((sum, item) => sum + (item.count || 0), 0);

  return {
    actionableCount: actionable.length,
    dangerCount: danger.length,
    warningCount: warnings.length,
    totalRecords,
    status: danger.length ? "danger" : warnings.length ? "warning" : "ready",
  };
}
