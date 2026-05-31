import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export const ALL_BRANCHES = "كل الفروع";

export type DashboardKpis = {
  netSales: number | null;
  invoicesCount: number | null;
  avgInvoice: number | null;
  uniqueCustomers: number | null;
  activeDoctors: number | null;
  activeDelivery: number | null;
  dueFollowups: number | null;
  overdueFollowups: number | null;
};

export type SalesDailySummary = {
  day: string;
  branch: string | null;
  shift: string | null;
  netTotal: number;
  invoicesCount: number;
  avgInvoice: number;
  uniqueCustomers: number;
};

export type StaffSalesSummary = {
  sellerName: string | null;
  branch: string | null;
  netTotal: number;
  invoicesCount: number;
  avgInvoice: number;
  uniqueCustomers: number;
};

export type DeliveryPerformanceSummary = {
  deliveryStaff: string | null;
  branch: string | null;
  deliveriesCount: number;
  deliverySalesTotal: number;
  courierCashTotal: number;
  extraFeesTotal: number;
};

export type FollowupPerformanceSummary = {
  branch: string | null;
  responsibleName: string | null;
  assignedCount: number;
  completedCount: number;
  overdueCount: number;
  noAnswerCount: number;
  postponedCount: number;
  needsManagerCount: number;
  purchaseAfterFollowupAmount: number;
};

export type DashboardNotification = {
  id: string;
  title: string | null;
  message: string | null;
  priority: string | null;
  createdAt: string | null;
  routePath: string | null;
};

export type DashboardActivity = {
  id: string;
  action: string | null;
  description: string | null;
  userName: string | null;
  branch: string | null;
  createdAt: string | null;
  staffId: string | null;
  targetType: string | null;
  targetId: string | null;
  details: unknown;
  routePath: string | null;
};

export type DashboardSummary = {
  kpis: DashboardKpis | null;
  dailySales: SalesDailySummary[];
  staffSales: StaffSalesSummary[];
  deliveryPerformance: DeliveryPerformanceSummary[];
  followupPerformance: FollowupPerformanceSummary[];
  notifications: DashboardNotification[];
  activity: DashboardActivity[];
  errors: string[];
};

type Row = Record<string, unknown>;

const DATE_COLUMNS = ["invoice_date", "summary_date", "sales_date", "day", "date"];
const ALL_BRANCH_VALUES = new Set(["", ALL_BRANCHES, "الكل", "كل الفروع"]);

function toNumber(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function readFirst(row: Row | null | undefined, keys: string[], fallback: unknown = null) {
  if (!row) return fallback;
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function readDate(row: Row) {
  return String(readFirst(row, DATE_COLUMNS, "") || "").slice(0, 10);
}

function dayAfter(date: string) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + 1);
  return next.toISOString().slice(0, 10);
}

function isAllBranches(branch?: string | null) {
  return ALL_BRANCH_VALUES.has(String(branch || "").trim());
}

function friendlyError(source: string, message: string) {
  return `${source}: ${message}`;
}

function normalizeRpcKpis(data: unknown): DashboardKpis {
  const row = Array.isArray(data) ? (data[0] as Row | undefined) : (data as Row | null);
  return {
    netSales: toNumber(readFirst(row, ["net_total", "net_sales", "period_net_sales"])),
    invoicesCount: toNumber(readFirst(row, ["invoices_count", "invoice_count", "total_invoices"])),
    avgInvoice: toNumber(readFirst(row, ["avg_invoice", "average_invoice"])),
    uniqueCustomers: toNumber(readFirst(row, ["unique_customers", "customers_count", "purchasing_customers"])),
    activeDoctors: toNumber(readFirst(row, ["active_doctors", "active_sellers", "doctors_count"])),
    activeDelivery: toNumber(readFirst(row, ["active_delivery", "active_delivery_staff", "delivery_staff_count"])),
    dueFollowups: toNumber(readFirst(row, ["due_followups", "followups_due", "due_today"])),
    overdueFollowups: toNumber(readFirst(row, ["overdue_followups", "followups_overdue", "overdue_count"])),
  };
}

async function fetchKpis(startDate: string, endDate: string, branch: string, errors: string[]) {
  const payload = {
    start_date: startDate,
    end_date: endDate,
    branch: isAllBranches(branch) ? null : branch,
  };
  const { data, error } = await supabase.rpc("get_dashboard_kpis", payload);
  if (error) {
    errors.push(friendlyError("get_dashboard_kpis", error.message));
    return null;
  }
  return normalizeRpcKpis(data);
}

async function fetchSummaryRows(table: string, startDate: string, endDate: string, branch: string, limit: number, errors: string[]) {
  for (const column of DATE_COLUMNS) {
    let query = supabase
      .from(table)
      .select("*")
      .gte(column, startDate)
      .lt(column, dayAfter(endDate))
      .limit(limit);

    if (!isAllBranches(branch)) query = query.eq("branch", branch);

    const { data, error } = await query;
    if (!error) return (data ?? []) as Row[];

    const message = error.message.toLowerCase();
    if (!message.includes("does not exist") && !message.includes("schema cache")) {
      errors.push(friendlyError(table, error.message));
      return [];
    }
  }

  errors.push(friendlyError(table, "تعذر تحديد عمود التاريخ في مصدر الملخص."));
  return [];
}

async function fetchOrderedRows(table: string, orderColumn: string, limit: number, errors: string[]) {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .order(orderColumn, { ascending: false })
    .limit(limit);

  if (error) {
    errors.push(friendlyError(table, error.message));
    return [];
  }
  return (data ?? []) as Row[];
}

function mapDaily(row: Row): SalesDailySummary {
  return {
    day: readDate(row),
    branch: readFirst(row, ["branch", "branch_name"], null) as string | null,
    shift: readFirst(row, ["shift_name", "shift"], null) as string | null,
    netTotal: toNumber(readFirst(row, ["net_total", "net_sales"])),
    invoicesCount: toNumber(readFirst(row, ["invoices_count", "invoice_count"])),
    avgInvoice: toNumber(readFirst(row, ["avg_invoice", "average_invoice"])),
    uniqueCustomers: toNumber(readFirst(row, ["unique_customers", "customers_count"])),
  };
}

function mapStaff(row: Row): StaffSalesSummary {
  return {
    sellerName: readFirst(row, ["seller_name", "doctor_name", "staff_name"], null) as string | null,
    branch: readFirst(row, ["branch", "branch_name"], null) as string | null,
    netTotal: toNumber(readFirst(row, ["net_total", "net_sales"])),
    invoicesCount: toNumber(readFirst(row, ["invoices_count", "invoice_count"])),
    avgInvoice: toNumber(readFirst(row, ["avg_invoice", "average_invoice"])),
    uniqueCustomers: toNumber(readFirst(row, ["unique_customers", "customers_count"])),
  };
}

function mapDelivery(row: Row): DeliveryPerformanceSummary {
  return {
    deliveryStaff: readFirst(row, ["delivery_staff", "delivery_name", "staff_name"], null) as string | null,
    branch: readFirst(row, ["branch", "branch_name"], null) as string | null,
    deliveriesCount: toNumber(readFirst(row, ["deliveries_count", "delivery_count", "invoices_count"])),
    deliverySalesTotal: toNumber(readFirst(row, ["delivery_sales_total", "net_total", "net_sales"])),
    courierCashTotal: toNumber(readFirst(row, ["courier_cash_total", "courier_cash"])),
    extraFeesTotal: toNumber(readFirst(row, ["extra_fees_total", "extra_fees"])),
  };
}

function mapFollowup(row: Row): FollowupPerformanceSummary {
  return {
    branch: readFirst(row, ["branch", "branch_name"], null) as string | null,
    responsibleName: readFirst(row, ["responsible_name", "assigned_to", "staff_name"], null) as string | null,
    assignedCount: toNumber(readFirst(row, ["assigned_count", "total_assigned"])),
    completedCount: toNumber(readFirst(row, ["completed_count", "done_count"])),
    overdueCount: toNumber(readFirst(row, ["overdue_count"])),
    noAnswerCount: toNumber(readFirst(row, ["no_answer_count"])),
    postponedCount: toNumber(readFirst(row, ["postponed_count"])),
    needsManagerCount: toNumber(readFirst(row, ["needs_manager_count"])),
    purchaseAfterFollowupAmount: toNumber(readFirst(row, ["purchase_after_followup_amount", "purchase_amount"])),
  };
}

function mapNotification(row: Row): DashboardNotification {
  return {
    id: String(readFirst(row, ["id"], crypto.randomUUID())),
    title: readFirst(row, ["title", "notification_title"], null) as string | null,
    message: readFirst(row, ["message", "body", "description"], null) as string | null,
    priority: readFirst(row, ["priority", "severity"], null) as string | null,
    createdAt: readFirst(row, ["created_at"], null) as string | null,
    routePath: readFirst(row, ["route_path", "link", "url"], null) as string | null,
  };
}

function mapActivity(row: Row): DashboardActivity {
  return {
    id: String(readFirst(row, ["id"], crypto.randomUUID())),
    action: readFirst(row, ["action"], null) as string | null,
    description: readFirst(row, ["description"], null) as string | null,
    userName: readFirst(row, ["user_name"], null) as string | null,
    branch: readFirst(row, ["branch"], null) as string | null,
    createdAt: readFirst(row, ["created_at"], null) as string | null,
    staffId: readFirst(row, ["staff_id"], null) as string | null,
    targetType: readFirst(row, ["target_type"], null) as string | null,
    targetId: readFirst(row, ["target_id"], null) as string | null,
    details: readFirst(row, ["details"], null),
    routePath: readFirst(row, ["route_path"], null) as string | null,
  };
}

export async function fetchExecutiveDashboardSummary(params: {
  startDate: string;
  endDate: string;
  branch: string;
}): Promise<DashboardSummary> {
  if (!isSupabaseConfigured) {
    return {
      kpis: null,
      dailySales: [],
      staffSales: [],
      deliveryPerformance: [],
      followupPerformance: [],
      notifications: [],
      activity: [],
      errors: ["إعدادات Supabase غير موجودة."],
    };
  }

  const errors: string[] = [];
  const { startDate, endDate, branch } = params;

  const [kpis, dailyRows, staffRows, deliveryRows, followupRows, notificationsRows, activityRows] = await Promise.all([
    fetchKpis(startDate, endDate, branch, errors),
    fetchSummaryRows("sales_daily_summary", startDate, endDate, branch, 500, errors),
    fetchSummaryRows("staff_sales_summary", startDate, endDate, branch, 200, errors),
    fetchSummaryRows("delivery_performance_summary", startDate, endDate, branch, 200, errors),
    fetchSummaryRows("followup_performance_summary", startDate, endDate, branch, 200, errors),
    fetchOrderedRows("notifications", "created_at", 10, errors),
    fetchOrderedRows("activity_log", "created_at", 12, errors),
  ]);

  return {
    kpis,
    dailySales: dailyRows.map(mapDaily).filter((row) => row.day),
    staffSales: staffRows.map(mapStaff).filter((row) => row.sellerName),
    deliveryPerformance: deliveryRows.map(mapDelivery).filter((row) => row.deliveryStaff),
    followupPerformance: followupRows.map(mapFollowup),
    notifications: notificationsRows.map(mapNotification),
    activity: activityRows.map(mapActivity),
    errors,
  };
}
