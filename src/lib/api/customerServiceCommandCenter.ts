import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { ALL_FILTER, getCustomers, normalizeCustomerMetric, type CustomerMetric } from "@/lib/api/customers";
import { normalizeBranchName } from "@/lib/branch";
import { getBestCustomerPhone, isValidEgyptPhone } from "@/lib/customerAnalyticsService";
import { calculateMonthlyIncentive } from "@/lib/performance/performanceRulesEngine";
import {
  buildCustomerSearchPattern,
  buildPhoneSearchVariants,
  enrichFollowupsWithCustomerData,
  isAllFilter,
} from "@/lib/customerFollowupEnrichmentService";

export function clearCustomerServiceCommandCenterCache() {
  // Customer Service command center fetches live followups/summary data; this hook keeps import invalidation explicit.
}

export type FollowupRow = {
  id: string;
  date: string | null;
  customer_id: string | null;
  customer_name: string | null;
  phone: string | null;
  segment: string | null;
  status: string | null;
  total_spent: number | null;
  followup_type: string | null;
  followup_status: string | null;
  notes: string | null;
  branch: string | null;
  created_at: string | null;
  followup_date: string | null;
  name: string | null;
  classification: string | null;
  customer_status: string | null;
  followup_reason: string | null;
  priority: string | null;
  contact_status: string | null;
  contact_result: string | null;
  responsible_name: string | null;
  contacted_at: string | null;
  staff_id: string | null;
  customer_code: string | null;
  customer_phone: string | null;
  customer_flags?: Record<string, boolean> | null;
  customer_notes?: string | null;
  service_notes?: string | null;
  team_notes?: string | null;
  handling_notes?: string | null;
  whatsapp_notes?: string | null;
  address?: string | null;
  phone_alt?: string | null;
  whatsapp_phone?: string | null;
  assigned_to: string | null;
  assigned_staff_id: string | null;
  contact_method: string | null;
  followup_summary: string | null;
  followup_result: string | null;
  next_followup_date: string | null;
  request_type: string | null;
  request_details: string | null;
  request_status: string | null;
  purchase_after_followup: boolean | null;
  purchase_amount: number | null;
  purchase_invoice_no: string | null;
  purchase_date: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_by: string | null;
  created_by_name: string | null;
  assigned_doctor: string | null;
  followup_notes: string | null;
  last_purchase_date: string | null;
  purchase_count_current_month: number | null;
  average_monthly_purchase_count: number | null;
  purchase_frequency_status: string | null;
  updated_at: string | null;
  category: string | null;
  suggested_action: string | null;
  quality_rating: number | null;
  customer_satisfaction: string | null;
  response_status: string | null;
  needs_manager: boolean | null;
  completed_at: string | null;
  postponed_until: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  updated_by: string | null;
  followup_datetime: string | null;
  customer_metrics?: CustomerMetric | null;
};

export type FollowupFilters = {
  branch?: string;
  status?: string;
  responsible?: string;
  search?: string;
  limit?: number;
};

export type CustomerServiceSearchResult = CustomerMetric & {
  source: "customer_metrics_summary" | "customers";
  hasTodayFollowup: boolean;
  displayPhone: string | null;
  profile?: Row | null;
};

export type FollowupStats = {
  totalToday: number;
  completed: number;
  noAnswer: number;
  postponed: number;
  overdue: number;
  needsManager: number;
  purchaseAfterCount: number;
  purchaseAfterAmount: number;
};

export type FollowupPerformanceRow = {
  responsible: string;
  branch: string;
  assigned: number;
  completed: number;
  overdue: number;
  noAnswer: number;
  postponed: number;
  needsManager: number;
  purchaseAfterCount: number;
  purchaseAfterAmount: number;
  avgQualityRating: number | null;
  completionRate: number;
  recoveredCustomers: number;
  improvedFrequencyCount: number;
  avgCustomerSatisfaction: number | null;
  totalPoints: number;
  incentiveValueEstimate: number;
};

export type CreateExceptionalFollowupInput = {
  customer?: CustomerMetric | null;
  customerName: string;
  customerPhone?: string | null;
  branch?: string | null;
  priority?: string | null;
  requestType?: string | null;
  followupReason?: string | null;
  assignedDoctor?: string | null;
  followupDatetime?: string | null;
  requestDetails?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
};

export type FollowupResultPayload = {
  contact_method?: string | null;
  contact_status?: string | null;
  contact_result?: string | null;
  followup_result?: string | null;
  followup_summary?: string | null;
  followup_notes?: string | null;
  purchase_after_followup?: boolean | null;
  purchase_amount?: number | null;
  purchase_invoice_no?: string | null;
  purchase_date?: string | null;
  next_followup_date?: string | null;
  quality_rating?: number | null;
  customer_satisfaction?: string | null;
  needs_manager?: boolean | null;
  response_status?: string | null;
  completed_at?: string | null;
  postponed_until?: string | null;
  updated_by?: string | null;
  status?: string | null;
  followup_status?: string | null;
};

type Row = Record<string, unknown>;

function requireSupabaseConfig() {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة.");
  }
}

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString(), day: start.toISOString().slice(0, 10) };
}

function relativeDayRange(offsetDays: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + offsetDays);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString(), day: start.toISOString().slice(0, 10) };
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeSearchPattern(search: string) {
  return buildCustomerSearchPattern(search);
}

function normalizeDigits(value: string) {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return value
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[^\d]/g, "");
}

function phoneVariants(search: string) {
  return buildPhoneSearchVariants(search);
}

function extractCodeLikePhone(value?: string | null) {
  const trimmed = String(value || "").trim();
  const match = trimmed.match(/^code:(.+)$/i);
  return match?.[1]?.trim() || "";
}

function normalizeStatus(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw || raw === "pending") return "معلق";
  if (["done", "completed", "تم التواصل", "تم"].includes(raw)) return "تم";
  if (["no_answer", "لم يرد"].includes(raw)) return "لم يرد";
  if (["postponed", "مؤجل"].includes(raw)) return "مؤجل";
  if (["needs_manager", "يحتاج مدير"].includes(raw)) return "يحتاج مدير";
  return raw;
}

function isDone(row: FollowupRow) {
  return Boolean(row.completed_at) || ["تم", "تم التواصل", "تم الشراء بعد المتابعة"].includes(normalizeStatus(row.followup_status || row.status || row.contact_status));
}

function isNoAnswer(row: FollowupRow) {
  return normalizeStatus(row.followup_status || row.status || row.contact_status) === "لم يرد";
}

function isPostponed(row: FollowupRow) {
  return Boolean(row.postponed_until) || normalizeStatus(row.followup_status || row.status || row.contact_status) === "مؤجل";
}

function isOverdue(row: FollowupRow) {
  if (isDone(row) || isPostponed(row)) return false;
  const due = row.followup_datetime || row.followup_date || row.date;
  if (!due) return false;
  return new Date(due).getTime() < Date.now();
}

function latestFollowupTimestamp(row: FollowupRow) {
  const value = row.followup_date || row.followup_datetime || row.date || row.created_at || row.updated_at || "";
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function compareFollowupPriority(a: FollowupRow, b: FollowupRow) {
  const rank = (row: FollowupRow) => {
    const value = String(row.priority || row.followup_reason || row.request_type || "").trim().toLowerCase();
    if (value.includes("urgent") || value.includes("critical") || value.includes("عاجل") || value.includes("حرج")) return 0;
    if (value.includes("high") || value.includes("important") || value.includes("مهم") || value.includes("مرتفع")) return 1;
    if (row.needs_manager || value.includes("manager") || value.includes("مدير")) return 2;
    if (value.includes("medium") || value.includes("متوسط")) return 3;
    if (value.includes("low") || value.includes("منخفض")) return 5;
    return 4;
  };
  const priorityDiff = rank(a) - rank(b);
  if (priorityDiff) return priorityDiff;
  if (isOverdue(a) !== isOverdue(b)) return isOverdue(a) ? -1 : 1;
  return latestFollowupTimestamp(b) - latestFollowupTimestamp(a);
}

function dedupeLatestFollowupPerCustomer(rows: FollowupRow[]) {
  const byCustomer = new Map<string, FollowupRow>();
  const withoutCustomerKey: FollowupRow[] = [];

  for (const row of rows) {
    const key = String(row.customer_code || row.customer_id || row.customer_phone || row.phone || "").trim();
    if (!key) {
      withoutCustomerKey.push(row);
      continue;
    }

    const current = byCustomer.get(key);
    if (!current || latestFollowupTimestamp(row) >= latestFollowupTimestamp(current)) {
      byCustomer.set(key, row);
    }
  }

  return [...byCustomer.values(), ...withoutCustomerKey].sort((a, b) => {
    const priorityDiff = compareFollowupPriority(a, b);
    if (priorityDiff) return priorityDiff;
    return latestFollowupTimestamp(b) - latestFollowupTimestamp(a);
  });
}

function missingColumn(message: string) {
  return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || "";
}

function withoutColumn<T extends Row>(record: T, column: string) {
  const next = { ...record };
  delete next[column];
  return next;
}

async function safeInsertFollowup(payload: Row) {
  let current = payload;
  const removed = new Set<string>();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await supabase.from("daily_followups").insert(current).select("*").single();
    if (!error) return data as FollowupRow;
    const column = missingColumn(error.message);
    if (!column || removed.has(column)) throw new Error(error.message);
    removed.add(column);
    current = withoutColumn(current, column);
  }
  throw new Error("تعذر إنشاء المتابعة بسبب اختلاف أعمدة daily_followups.");
}

async function safeUpdateFollowup(id: string, payload: Row) {
  let current = payload;
  const removed = new Set<string>();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await supabase.from("daily_followups").update(current).eq("id", id).select("*").single();
    if (!error) return data as FollowupRow;
    const column = missingColumn(error.message);
    if (!column || removed.has(column)) throw new Error(error.message);
    removed.add(column);
    current = withoutColumn(current, column);
  }
  throw new Error("تعذر حفظ المتابعة بسبب اختلاف أعمدة daily_followups.");
}

function enrichFollowup(row: FollowupRow, metrics: CustomerMetric | null): FollowupRow {
  if (!metrics) return row;
  const bestPhone = getBestCustomerPhone(row, metrics, null);
  return {
    ...row,
    customer_metrics: metrics,
    customer_code: row.customer_code || metrics.customer_code,
    customer_phone: bestPhone || metrics.customer_phone,
    phone: bestPhone || null,
    customer_name: row.customer_name || row.name || metrics.customer_name,
    name: row.name || row.customer_name || metrics.customer_name,
    branch: normalizeBranchName(row.branch || metrics.branch),
    segment: row.segment || row.classification || metrics.segment,
    classification: row.classification || row.segment || metrics.segment,
    customer_status: row.customer_status || metrics.customer_status,
    total_spent: row.total_spent ?? metrics.total_spent,
    last_purchase_date: row.last_purchase_date || metrics.last_purchase,
  };
}

async function loadMetricsForFollowups(rows: FollowupRow[]) {
  return enrichFollowupsWithCustomerData(rows);
}

function rowCustomerCode(rows: FollowupRow[], phone: unknown) {
  const match = rows.find((row) => row.customer_phone === phone || row.phone === phone);
  return match?.customer_code || extractCodeLikePhone(String(phone || ""));
}

export async function searchCustomerMetrics(search: string, branch?: string): Promise<CustomerServiceSearchResult[]> {
  const metricResult = await getCustomers({
    search,
    branch: !isAllFilter(branch) ? branch : ALL_FILTER,
    limit: 30,
    offset: 0,
  }).then((result) => result.customers);

  const pattern = normalizeSearchPattern(search);
  const variants = phoneVariants(search);
  const branchFilter = !isAllFilter(branch) ? branch : "";
  const profileClauses = [
    pattern ? `customer_code.ilike.${pattern}` : "",
    pattern ? `customer_name.ilike.${pattern}` : "",
    pattern ? `name.ilike.${pattern}` : "",
    pattern ? `final_customer_key.ilike.${pattern}` : "",
    ...variants.flatMap((phone) => [
      `phone.eq.${phone}`,
      `phone_alt.eq.${phone}`,
      `whatsapp_phone.eq.${phone}`,
    ]),
  ].filter(Boolean);

  const profileQuery = profileClauses.length
    ? supabase
      .from("customers")
      .select("id,customer_code,name,phone,whatsapp_phone,phone_alt,branch,address,customer_flags,customer_notes,service_notes,team_notes,handling_notes,whatsapp_notes")
      .or(profileClauses.join(","))
      .limit(30)
    : Promise.resolve<{ data: Row[]; error: null }>({ data: [], error: null });

  const profileResult = await profileQuery;
  const profileRows = ((profileResult.data ?? []) as Row[]).filter((row) => !branchFilter || normalizeBranchName(row.branch) === normalizeBranchName(branchFilter));

  const byKey = new Map<string, CustomerServiceSearchResult>();
  for (const metric of metricResult) {
    const key = metric.final_customer_key || metric.customer_id || metric.customer_code || metric.customer_phone || metric.id;
    byKey.set(String(key), {
      ...metric,
      source: "customer_metrics_summary",
      hasTodayFollowup: false,
      displayPhone: getBestCustomerPhone({ customer_code: metric.customer_code, customer_phone: metric.customer_phone, phone: metric.phone } as FollowupRow, metric, null),
      profile: null,
    });
  }

  for (const profile of profileRows) {
    const metric = normalizeCustomerMetric({
      final_customer_key: profile.final_customer_key || profile.id || profile.customer_id,
      customer_id: profile.customer_id || profile.id,
      customer_code: profile.customer_code,
      customer_name: profile.customer_name || profile.name,
      customer_phone: profile.customer_phone || profile.phone || profile.whatsapp_phone || profile.phone_alt,
      branch: profile.branch,
      invoices_count: 0,
      total_spent: 0,
      avg_invoice: 0,
      first_purchase: null,
      last_purchase: null,
      active_months: 0,
      avg_monthly: 0,
      segment: null,
      customer_status: null,
    });
    const key = metric.final_customer_key || metric.customer_id || metric.customer_code || metric.customer_phone || metric.id;
    const displayPhone = getBestCustomerPhone({ customer_code: metric.customer_code, customer_phone: metric.customer_phone, phone: metric.phone } as FollowupRow, metric, profile);
    byKey.set(String(key), {
      ...(byKey.get(String(key)) || metric),
      ...metric,
      source: byKey.has(String(key)) ? "customer_metrics_summary" : "customers",
      hasTodayFollowup: false,
      displayPhone,
      profile,
    });
  }

  const { start, end } = todayRange();
  const codes = [...byKey.values()].map((item) => item.customer_code).filter(Boolean);
  const phones = [...byKey.values()].map((item) => item.displayPhone || item.customer_phone).filter(Boolean);
  const followupClauses = [
    ...codes.map((code) => `customer_code.eq.${code}`),
    ...phones.map((phone) => `customer_phone.eq.${phone}`),
    ...phones.map((phone) => `phone.eq.${phone}`),
  ];
  if (followupClauses.length) {
    const { data } = await supabase
      .from("daily_followups")
      .select("id,customer_code,customer_phone,phone")
      .gte("created_at", start)
      .lt("created_at", end)
      .or(followupClauses.join(","))
      .limit(80);
    const todayKeys = new Set((data ?? []).flatMap((row: Row) => [row.customer_code, row.customer_phone, row.phone].filter(Boolean).map(String)));
    for (const [key, item] of byKey) {
      byKey.set(key, {
        ...item,
        hasTodayFollowup: Boolean(
          (item.customer_code && todayKeys.has(item.customer_code)) ||
          (item.displayPhone && todayKeys.has(item.displayPhone)) ||
          (item.customer_phone && todayKeys.has(item.customer_phone))
        ),
      });
    }
  }

  return [...byKey.values()].slice(0, 30);
}

export async function fetchCustomerServiceFollowups(filters: FollowupFilters = {}) {
  requireSupabaseConfig();

  const fetchFrom = async (source: "dawaa_customer_service_current_queue_v166" | "dawaa_customer_service_current_queue_v14" | "daily_followups") => {
    const { start, end } = todayRange();
    let query = supabase
      .from(source)
      .select("*")
      .order("followup_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(filters.limit || 160);

    // The queue views already return the latest open followup per customer.
    // Fallback daily_followups keeps the old same-day filter if the view is not installed yet.
    if (source === "daily_followups") {
      query = query.gte("created_at", start).lt("created_at", end);
    }

    if (filters.branch && filters.branch !== ALL_FILTER) query = query.eq("branch", filters.branch);
    if (filters.status && filters.status !== ALL_FILTER) {
      if (filters.status === "متأخرة") {
        query = query.is("completed_at", null).is("postponed_until", null);
      } else if (filters.status === "يحتاج مدير") {
        query = query.eq("needs_manager", true);
      } else {
        query = query.or(`status.eq.${filters.status},followup_status.eq.${filters.status},contact_status.eq.${filters.status}`);
      }
    }
    if (filters.responsible && filters.responsible !== ALL_FILTER) {
      query = query.or(`responsible_name.eq.${filters.responsible},assigned_to.eq.${filters.responsible},assigned_doctor.eq.${filters.responsible}`);
    }

    const pattern = normalizeSearchPattern(filters.search || "");
    if (pattern) {
      query = query.or([
        `customer_name.ilike.${pattern}`,
        `name.ilike.${pattern}`,
        `customer_code.ilike.${pattern}`,
        `customer_phone.ilike.${pattern}`,
        `phone.ilike.${pattern}`,
        `responsible_name.ilike.${pattern}`,
        `assigned_to.ilike.${pattern}`,
      ].join(","));
    }

    return query;
  };

  let data: FollowupRow[] = [];
  const queueV166Result = await fetchFrom("dawaa_customer_service_current_queue_v166");
  if (!queueV166Result.error) {
    data = (queueV166Result.data ?? []) as FollowupRow[];
  } else {
    console.warn("dawaa_customer_service_current_queue_v166 failed, falling back to v14", queueV166Result.error);
    const queueV14Result = await fetchFrom("dawaa_customer_service_current_queue_v14");
    if (!queueV14Result.error) {
      data = (queueV14Result.data ?? []) as FollowupRow[];
    } else {
      console.warn("dawaa_customer_service_current_queue_v14 failed, falling back to daily_followups", queueV14Result.error);
      const fallbackResult = await fetchFrom("daily_followups");
      if (fallbackResult.error) throw new Error(`daily_followups: ${fallbackResult.error.message}`);
      data = (fallbackResult.data ?? []) as FollowupRow[];
    }
  }

  let doctorRequestRows: FollowupRow[] = [];
  try {
    let requestQuery = supabase
      .from("daily_followups")
      .select("*")
      .eq("request_type", "doctor_requested_followup")
      .is("completed_at", null)
      .is("cancelled_at", null)
      .order("created_at", { ascending: false })
      .limit(120);

    if (filters.branch && filters.branch !== ALL_FILTER) requestQuery = requestQuery.eq("branch", filters.branch);
    const { data: requestData } = await requestQuery;
    doctorRequestRows = ((requestData ?? []) as FollowupRow[]).filter((row) => {
      if (filters.responsible && filters.responsible !== ALL_FILTER) {
        const responsible = row.responsible_name || row.assigned_to || row.assigned_doctor || "";
        if (responsible !== filters.responsible) return false;
      }
      if (filters.status && filters.status !== ALL_FILTER) {
        const statuses = [row.status, row.followup_status, row.contact_status].filter(Boolean);
        if (filters.status === "متأخرة") {
          if (!isOverdue(row)) return false;
        } else if (filters.status === "يحتاج مدير") {
          if (!row.needs_manager) return false;
        } else if (!statuses.includes(filters.status)) {
          return false;
        }
      }
      const search = String(filters.search || "").trim().toLowerCase();
      if (search) {
        const haystack = [
          row.customer_name,
          row.name,
          row.customer_code,
          row.customer_phone,
          row.phone,
          row.responsible_name,
          row.assigned_to,
          row.assigned_doctor,
          row.created_by_name,
          row.request_details,
          row.followup_reason,
          row.notes,
          row.followup_notes,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  } catch (requestError) {
    console.warn("doctor requested followups query failed", requestError);
  }

  const byId = new Map<string, FollowupRow>();
  for (const row of [...(data ?? []), ...doctorRequestRows]) {
    byId.set(row.id, row);
  }
  const dedupedRows = dedupeLatestFollowupPerCustomer([...byId.values()]);
  const rows = await loadMetricsForFollowups(dedupedRows);
  return filters.status === "متأخرة" ? rows.filter(isOverdue) : rows;
}

export async function fetchFollowupPerformanceSummary(branch?: string) {
  requireSupabaseConfig();
  const { day } = todayRange();
  let query = supabase
    .from("followup_performance_summary")
    .select("*")
    .eq("followup_date", day)
    .limit(120);
  if (branch && branch !== ALL_FILTER) query = query.eq("branch", branch);
  const { data, error } = await query;
  if (error) return null;
  return (data ?? []) as Row[];
}

export function calculateFollowupStats(rows: FollowupRow[]): FollowupStats {
  return rows.reduce((acc, row) => {
    acc.totalToday += 1;
    if (isDone(row)) acc.completed += 1;
    if (isNoAnswer(row)) acc.noAnswer += 1;
    if (isPostponed(row)) acc.postponed += 1;
    if (isOverdue(row)) acc.overdue += 1;
    if (row.needs_manager || normalizeStatus(row.followup_status || row.status) === "يحتاج مدير") acc.needsManager += 1;
    if (row.purchase_after_followup) {
      acc.purchaseAfterCount += 1;
      acc.purchaseAfterAmount += toNumber(row.purchase_amount);
    }
    return acc;
  }, {
    totalToday: 0,
    completed: 0,
    noAnswer: 0,
    postponed: 0,
    overdue: 0,
    needsManager: 0,
    purchaseAfterCount: 0,
    purchaseAfterAmount: 0,
  });
}

export function calculateTeamPerformance(rows: FollowupRow[]): FollowupPerformanceRow[] {
  const map = new Map<string, FollowupPerformanceRow & { qualitySum: number; qualityCount: number }>();
  for (const row of rows) {
    const responsible = row.responsible_name || row.assigned_to || row.assigned_doctor || "غير محدد";
    const current = map.get(responsible) || {
      responsible,
      branch: normalizeBranchName(row.branch),
      assigned: 0,
      completed: 0,
      overdue: 0,
      noAnswer: 0,
      postponed: 0,
      needsManager: 0,
      purchaseAfterCount: 0,
      purchaseAfterAmount: 0,
      avgQualityRating: null,
      completionRate: 0,
      recoveredCustomers: 0,
      improvedFrequencyCount: 0,
      avgCustomerSatisfaction: null,
      totalPoints: 0,
      incentiveValueEstimate: 0,
      qualitySum: 0,
      qualityCount: 0,
    };
    current.assigned += 1;
    if (isDone(row)) current.completed += 1;
    if (isOverdue(row)) current.overdue += 1;
    if (isNoAnswer(row)) current.noAnswer += 1;
    if (isPostponed(row)) current.postponed += 1;
    if (row.needs_manager) current.needsManager += 1;
    if (row.purchase_after_followup) {
      current.purchaseAfterCount += 1;
      current.purchaseAfterAmount += toNumber(row.purchase_amount);
      if (["متوقف", "مهدد بالتوقف"].includes(row.customer_status || row.customer_metrics?.customer_status || "")) current.recoveredCustomers += 1;
      if (["stopped", "decreased", "توقف عن الشراء", "انخفض الشراء"].includes(row.purchase_frequency_status || "")) current.improvedFrequencyCount += 1;
    }
    const rating = toNumber(row.quality_rating);
    if (rating > 0) {
      current.qualitySum += rating;
      current.qualityCount += 1;
      current.avgQualityRating = current.qualitySum / current.qualityCount;
    }
    current.completionRate = current.assigned ? (current.completed / current.assigned) * 100 : 0;
    const satisfaction = String(row.customer_satisfaction || "");
    const excellentSatisfaction = satisfaction.includes("ممتاز") || satisfaction.includes("راض");
    current.totalPoints =
      current.completed * 2 +
      current.purchaseAfterCount * 5 +
      current.recoveredCustomers * 10 +
      current.improvedFrequencyCount * 5 +
      (rating >= 5 ? 3 : 0) +
      (excellentSatisfaction ? 3 : 0) -
      current.overdue * 3;
    current.incentiveValueEstimate = calculateMonthlyIncentive({
      startingPoints: Math.max(0, current.totalPoints),
      approvedDeductionPoints: 0,
      approvedExceptionalRewardPoints: 0,
    }).monthlyIncentiveValue;
    map.set(responsible, current);
  }
  return [...map.values()]
    .map(({ qualitySum: _qualitySum, qualityCount: _qualityCount, ...row }) => row)
    .sort((a, b) => b.assigned - a.assigned || b.completionRate - a.completionRate);
}

export async function createExceptionalFollowup(input: CreateExceptionalFollowupInput) {
  requireSupabaseConfig();
  const { day } = todayRange();
  const customer = input.customer || null;
  const payload: Row = {
    date: day,
    followup_date: day,
    followup_datetime: input.followupDatetime || new Date().toISOString(),
    customer_id: customer?.customer_id || customer?.final_customer_key || null,
    customer_code: customer?.customer_code || null,
    customer_name: customer?.customer_name || input.customerName,
    name: customer?.customer_name || input.customerName,
    customer_phone: customer?.customer_phone || input.customerPhone || null,
    phone: customer?.customer_phone || input.customerPhone || null,
    branch: input.branch || customer?.branch || null,
    segment: customer?.segment || (customer ? null : "عميل غير مسجل"),
    classification: customer?.segment || (customer ? null : "عميل غير مسجل"),
    customer_status: customer?.customer_status || (customer ? null : "عميل غير مسجل"),
    total_spent: customer?.total_spent ?? null,
    last_purchase_date: customer?.last_purchase || null,
    followup_type: "exceptional",
    category: "متابعة استثنائية",
    priority: input.priority || "مهم",
    followup_reason: input.followupReason || null,
    suggested_action: input.followupReason || "متابعة استثنائية",
    request_type: input.requestType || null,
    request_details: input.requestDetails || null,
    request_status: input.requestType ? "open" : null,
    notes: input.notes || null,
    followup_notes: input.notes || null,
    status: "معلق",
    followup_status: "معلق",
    contact_status: "معلق",
    assigned_to: input.assignedDoctor || null,
    responsible_name: input.assignedDoctor || null,
    assigned_doctor: input.assignedDoctor || null,
    created_by: input.createdBy || null,
    created_by_name: input.createdByName || null,
  };
  return safeInsertFollowup(payload);
}

export async function updateFollowupResult(id: string, payload: FollowupResultPayload) {
  requireSupabaseConfig();
  return safeUpdateFollowup(id, {
    ...payload,
    updated_at: new Date().toISOString(),
  } as Row);
}

export async function generateTodayFollowupsFromCustomerMetrics(branch?: string, createdByName?: string) {
  requireSupabaseConfig();
  const { start, end, day } = todayRange();
  const yesterday = relativeDayRange(-1);
  const { data: existingRows, error: existingError } = await supabase
    .from("daily_followups")
    .select("id,customer_code,customer_phone,phone,customer_name")
    .gte("created_at", start)
    .lt("created_at", end)
    .limit(600);
  if (existingError) throw new Error(existingError.message);

  const existingKeys = new Set((existingRows ?? []).flatMap((row: Row) => [row.customer_code, row.customer_phone, row.phone, row.customer_name].filter(Boolean).map(String)));
  const requestedBranch = branch && branch !== ALL_FILTER ? normalizeBranchName(branch) : "";
  const buckets = [
    { label: "أولوية قصوى", type: "مهم جدًا", status: "مهدد بالتوقف", limit: 10, reason: "عميل مهم جدًا ومهدد بالتوقف؛ يحتاج تواصل عالي الجودة." },
    { label: "عملاء مهمون", type: "مهم", limit: 10, reason: "حماية عميل مهم من الانخفاض وتحسين العلاقة." },
    { label: "مهددون بالتوقف", status: "مهدد بالتوقف", limit: 12, reason: "منع توقف العميل وتحليل سبب انخفاض الشراء." },
    { label: "متوقفون", status: "متوقف", limit: 8, reason: "محاولة استرجاع العميل بعرض مناسب وتسجيل سبب التوقف." },
    { label: "متوسطون قابلون للنمو", type: "متوسط", limit: 8, reason: "رفع العميل من متوسط إلى مهم بمتابعة احتياجاته." },
    { label: "بدون شراء", status: "بدون شراء", limit: 8, reason: "تأكيد بيانات العميل وفهم سبب عدم الشراء." },
  ];

  const selected: Array<{ bucket: string; customer: CustomerMetric; reason?: string }> = [];
  for (const bucket of buckets) {
    const result = await getCustomers({
      branch: branch && branch !== ALL_FILTER ? branch : ALL_FILTER,
      type: bucket.type || ALL_FILTER,
      status: bucket.status || ALL_FILTER,
      limit: bucket.limit,
      offset: 0,
    });
    for (const customer of result.customers) {
      const key = customer.customer_code || customer.customer_phone || customer.customer_name || customer.id;
      if (!key || existingKeys.has(key)) continue;
      existingKeys.add(key);
      selected.push({ bucket: bucket.label, customer, reason: bucket.reason });
    }
  }

  const { data: carryRows } = await supabase
    .from("daily_followups")
    .select("*")
    .gte("created_at", yesterday.start)
    .lt("created_at", yesterday.end)
    .is("completed_at", null)
    .limit(60);

  for (const row of (carryRows ?? []) as FollowupRow[]) {
    if (row.cancelled_at || row.postponed_until) continue;
    if (requestedBranch && normalizeBranchName(row.branch) !== requestedBranch) continue;
    const key = row.customer_code || row.customer_phone || row.phone || row.customer_name || row.id;
    if (!key || existingKeys.has(String(key))) continue;
    existingKeys.add(String(key));
    selected.push({
      bucket: "مرحّل من أمس",
      reason: "متابعة غير مكتملة من قائمة أمس ويجب إغلاق نتيجتها اليوم.",
      customer: normalizeCustomerMetric({
        final_customer_key: row.customer_id || row.customer_code || row.customer_phone || row.id,
        customer_id: row.customer_id || row.customer_code || null,
        customer_code: row.customer_code,
        customer_name: row.customer_name || row.name,
        customer_phone: row.customer_phone || row.phone,
        branch: row.branch,
        invoices_count: 0,
        total_spent: row.total_spent || 0,
        avg_invoice: 0,
        first_purchase: null,
        last_purchase: row.last_purchase_date,
        active_months: 0,
        avg_monthly: row.customer_metrics?.avg_monthly || 0,
        segment: row.segment || row.classification,
        customer_status: row.customer_status,
      }),
    });
  }

  const { data: teamRequestRows } = await supabase
    .from("daily_followups")
    .select("*")
    .is("completed_at", null)
    .or("request_status.eq.open,request_status.is.null,followup_type.eq.exceptional,followup_type.eq.doctor_request")
    .limit(120);

  for (const row of (teamRequestRows ?? []) as FollowupRow[]) {
    if (row.cancelled_at || row.postponed_until) continue;
    if (requestedBranch && normalizeBranchName(row.branch) !== requestedBranch) continue;
    const dueDate = String(row.followup_date || row.date || row.next_followup_date || "").slice(0, 10);
    if (dueDate && dueDate > day) continue;
    const hasTeamRequest = Boolean(row.request_details || row.request_type || row.created_by_name || row.assigned_doctor || row.assigned_to);
    if (!hasTeamRequest) continue;
    const key = row.customer_code || row.customer_phone || row.phone || row.customer_name || row.id;
    if (!key || existingKeys.has(String(key))) continue;
    existingKeys.add(String(key));
    selected.push({
      bucket: "طلب متابعة من الفريق",
      reason: [
        row.request_type || row.followup_reason || "طلب متابعة مسجل",
        row.request_details || row.notes || row.followup_notes || "",
        row.created_by_name ? `بواسطة: ${row.created_by_name}` : "",
      ].filter(Boolean).join(" - "),
      customer: normalizeCustomerMetric({
        final_customer_key: row.customer_id || row.customer_code || row.customer_phone || row.id,
        customer_id: row.customer_id || row.customer_code || null,
        customer_code: row.customer_code,
        customer_name: row.customer_name || row.name,
        customer_phone: row.customer_phone || row.phone,
        branch: row.branch,
        invoices_count: 0,
        total_spent: row.total_spent || 0,
        avg_invoice: 0,
        first_purchase: null,
        last_purchase: row.last_purchase_date,
        active_months: 0,
        avg_monthly: row.customer_metrics?.avg_monthly || 0,
        segment: row.segment || row.classification,
        customer_status: row.customer_status,
      }),
    });
  }

  const { data: newCustomerRows } = await supabase
    .from("customers")
    .select("id,customer_code,name,phone,whatsapp_phone,phone_alt,branch,created_at")
    .gte("created_at", start)
    .lt("created_at", end)
    .limit(60);

  for (const row of (newCustomerRows ?? []) as Row[]) {
    if (requestedBranch && normalizeBranchName(row.branch) !== requestedBranch) continue;
    const code = String(row.customer_code || "").trim();
    const phone = getBestCustomerPhone({ customer_code: code, customer_phone: String(row.phone || "") } as FollowupRow, null, row);
    const key = code || phone || String(row.name || row.id || "");
    if (!key || existingKeys.has(key)) continue;
    existingKeys.add(key);
    selected.push({
      bucket: "ترحيب العملاء الجدد",
      reason: "رسالة ترحيب وتعريف بخدمات الصيدليات وتأكيد بيانات التواصل.",
      customer: normalizeCustomerMetric({
        final_customer_key: row.id,
        customer_id: row.id,
        customer_code: code,
        customer_name: row.name,
        customer_phone: phone,
        branch: row.branch,
        invoices_count: 0,
        total_spent: 0,
        avg_invoice: 0,
        first_purchase: null,
        last_purchase: null,
        active_months: 0,
        avg_monthly: 0,
        segment: "عادي",
        customer_status: "جديد",
      }),
    });
  }

  if (!selected.length) return [];

  const records = selected.map(({ bucket, customer, reason }) => ({
    date: day,
    followup_date: day,
    followup_datetime: new Date().toISOString(),
    customer_id: customer.customer_id || customer.final_customer_key || null,
    customer_code: customer.customer_code,
    customer_name: customer.customer_name,
    name: customer.customer_name,
    customer_phone: customer.customer_phone,
    phone: customer.customer_phone,
    branch: customer.branch,
    segment: customer.segment,
    classification: customer.segment,
    customer_status: customer.customer_status,
    total_spent: customer.total_spent,
    last_purchase_date: customer.last_purchase,
    category: bucket,
    followup_type: "smart_daily",
    priority: ["أولوية قصوى", "متوقفون", "مرحّل من أمس"].includes(bucket) ? "عاجل" : "مهم",
    followup_reason: reason || recommendedAction(customer),
    suggested_action: reason || recommendedAction(customer),
    status: "معلق",
    followup_status: "معلق",
    contact_status: "معلق",
    assigned_to: createdByName || "خدمة العملاء",
    responsible_name: createdByName || "خدمة العملاء",
    notes: `قائمة يومية ذكية ${day} - ${bucket}`,
    created_by_name: createdByName || null,
  }));

  const inserted: FollowupRow[] = [];
  for (const record of records) {
    inserted.push(await safeInsertFollowup(record));
  }
  return inserted;
}
export function recommendedAction(customer?: CustomerMetric | null) {
  if (!customer) return "تأكيد بيانات العميل وتحديد سبب المتابعة.";
  if (customer.segment === "مهم جدًا" && customer.customer_status === "مهدد بالتوقف") return "تواصل عاجل من مدير أو أفضل دكتور.";
  if (customer.segment === "مهم" && customer.customer_status === "متوقف") return "محاولة استرجاع مع عرض مناسب.";
  if (customer.customer_status === "بدون شراء") return "تأكيد بيانات العميل وسبب عدم وجود شراء.";
  if (customer.customer_status === "نشط") return "متابعة عادية للحفاظ على العلاقة.";
  return "تواصل مهني وتسجيل نتيجة المتابعة بوضوح.";
}

export function riskLevel(customer?: CustomerMetric | null) {
  if (!customer) return "غير محدد";
  if (customer.segment === "مهم جدًا" && ["مهدد بالتوقف", "متوقف"].includes(customer.customer_status)) return "مرتفع";
  if (["مهم", "متوسط"].includes(customer.segment) && ["مهدد بالتوقف", "متوقف"].includes(customer.customer_status)) return "متوسط";
  if (customer.customer_status === "بدون شراء") return "بحاجة تأكيد";
  return "طبيعي";
}
