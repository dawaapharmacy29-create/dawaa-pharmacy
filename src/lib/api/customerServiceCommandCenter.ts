import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { ALL_FILTER, getCustomers, normalizeCustomerMetric, type CustomerMetric } from "@/lib/api/customers";
import { normalizeBranchName } from "@/lib/branch";

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

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeSearchPattern(search: string) {
  const trimmed = search.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const safe = trimmed.replace(/[%,()]/g, "").replace(/\*/g, "%");
  return safe.includes("%") ? safe : `%${safe}%`;
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
  return {
    ...row,
    customer_metrics: metrics,
    customer_code: row.customer_code || metrics.customer_code,
    customer_phone: row.customer_phone || row.phone || metrics.customer_phone,
    phone: row.phone || row.customer_phone || metrics.customer_phone,
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
  const keys = rows
    .flatMap((row) => [row.customer_code, row.customer_phone, row.phone])
    .filter(Boolean)
    .map(String);
  if (!keys.length) return rows;

  const codeValues = [...new Set(rows.map((row) => row.customer_code).filter(Boolean).map(String))].slice(0, 120);
  const phoneValues = [...new Set(rows.flatMap((row) => [row.customer_phone, row.phone]).filter(Boolean).map(String))].slice(0, 120);

  const clauses = [
    ...codeValues.map((code) => `customer_code.eq.${code}`),
    ...phoneValues.map((phone) => `customer_phone.eq.${phone}`),
  ];
  if (!clauses.length) return rows;

  const { data, error } = await supabase
    .from("customer_metrics_summary")
    .select("final_customer_key,customer_id,customer_code,customer_name,customer_phone,branch,invoices_count,total_spent,avg_invoice,first_purchase,last_purchase,active_months,avg_monthly,segment,customer_status")
    .or(clauses.join(","))
    .limit(250);

  if (error) return rows;

  const byCode = new Map<string, CustomerMetric>();
  const byPhone = new Map<string, CustomerMetric>();
  for (const raw of (data ?? []) as Row[]) {
    const metric = normalizeCustomerMetric(raw);
    if (metric.customer_code) byCode.set(metric.customer_code, metric);
    if (metric.customer_phone) byPhone.set(metric.customer_phone, metric);
  }

  return rows.map((row) => enrichFollowup(row, (row.customer_code && byCode.get(row.customer_code)) || (row.customer_phone && byPhone.get(row.customer_phone)) || (row.phone && byPhone.get(row.phone)) || null));
}

export async function searchCustomerMetrics(search: string, branch?: string) {
  return getCustomers({
    search,
    branch: branch && branch !== ALL_FILTER ? branch : ALL_FILTER,
    limit: 20,
    offset: 0,
  }).then((result) => result.customers);
}

export async function fetchCustomerServiceFollowups(filters: FollowupFilters = {}) {
  requireSupabaseConfig();
  const { start, end } = todayRange();
  let query = supabase
    .from("daily_followups")
    .select("*")
    .gte("created_at", start)
    .lt("created_at", end)
    .order("followup_datetime", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(filters.limit || 160);

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

  const { data, error } = await query;
  if (error) throw new Error(`daily_followups: ${error.message}`);
  const rows = await loadMetricsForFollowups((data ?? []) as FollowupRow[]);
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
    }
    const rating = toNumber(row.quality_rating);
    if (rating > 0) {
      current.qualitySum += rating;
      current.qualityCount += 1;
      current.avgQualityRating = current.qualitySum / current.qualityCount;
    }
    current.completionRate = current.assigned ? (current.completed / current.assigned) * 100 : 0;
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
  const { data: existingRows, error: existingError } = await supabase
    .from("daily_followups")
    .select("id,customer_code,customer_phone,phone,customer_name")
    .gte("created_at", start)
    .lt("created_at", end)
    .limit(400);
  if (existingError) throw new Error(existingError.message);

  const existingKeys = new Set((existingRows ?? []).flatMap((row: Row) => [row.customer_code, row.customer_phone, row.phone, row.customer_name].filter(Boolean).map(String)));
  const buckets = [
    { label: "مهم جدًا", type: "مهم جدًا", limit: 12 },
    { label: "مهم", type: "مهم", limit: 12 },
    { label: "متوسط", type: "متوسط", limit: 10 },
    { label: "مهدد بالتوقف", status: "مهدد بالتوقف", limit: 12 },
    { label: "متوقف", status: "متوقف", limit: 10 },
  ];

  const selected: Array<{ bucket: string; customer: CustomerMetric }> = [];
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
      selected.push({ bucket: bucket.label, customer });
    }
  }

  if (!selected.length) return [];

  const records = selected.map(({ bucket, customer }) => ({
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
    priority: bucket === "مهم جدًا" || bucket === "متوقف" ? "عاجل" : "مهم",
    followup_reason: recommendedAction(customer),
    suggested_action: recommendedAction(customer),
    status: "معلق",
    followup_status: "معلق",
    contact_status: "معلق",
    assigned_to: createdByName || "خدمة العملاء",
    responsible_name: createdByName || "خدمة العملاء",
    notes: "قائمة يومية من customer_metrics_summary",
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
