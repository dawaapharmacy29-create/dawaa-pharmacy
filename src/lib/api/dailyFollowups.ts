import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Customer, DailyFollowup } from "@/types/database";
import { classifyCustomer, customerStatus, getCustomerMonthlyInteractionSummary } from "@/lib/customerMetrics";
import { enrichCustomersWithSalesMetrics, fetchSalesInvoices } from "@/lib/salesInvoiceSource";
import { getScript } from "@/lib/followupScripts";
import { cleanEgyptianPhone } from "@/lib/whatsapp";
import { logActivity } from "@/lib/activityLog";

type DailyFollowupInsert = Partial<Omit<DailyFollowup, "id" | "created_at" | "updated_at">>;
type DailyFollowupUpdate = Partial<DailyFollowup>;

const LIMITS = {
  vip: 10,
  important: 10,
  medium: 10,
  risk: 15,
};

function requireSupabaseConfig() {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة. أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في ملف .env.");
  }
}

function startOfToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
}

function readLabel(notes: string | null | undefined, labels: string[]) {
  const lines = (notes || "").split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    for (const label of labels) {
      if (trimmed.startsWith(`${label}:`)) {
        return trimmed.split(":").slice(1).join(":").trim();
      }
    }
  }

  return "";
}

function extractBatch(notes: string | null | undefined) {
  return readLabel(notes, ["دفعة"]);
}

function isSmartFollowup(row: DailyFollowup) {
  return (row.notes || "").includes("قائمة يومية ذكية");
}

function missingColumn(message: string) {
  return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || "";
}

function withoutColumn<T extends Record<string, unknown>>(records: T[], column: string) {
  return records.map((record) => {
    const next = { ...record };
    delete next[column];
    return next;
  });
}

async function insertFollowupRecords(records: Array<Record<string, unknown>>) {
  let payload = records;
  const removed = new Set<string>();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase.from("daily_followups").insert(payload).select("*");
    if (!error) return (data ?? []) as DailyFollowup[];

    const column = missingColumn(error.message);
    if (!column || removed.has(column)) throw new Error(error.message);

    removed.add(column);
    payload = withoutColumn(payload, column);
  }

  throw new Error("تعذر إنشاء قائمة المتابعة بسبب اختلاف أعمدة جدول daily_followups.");
}

function daysSince(date: string | null | undefined) {
  if (!date) return 999;
  const value = new Date(date).getTime();
  if (Number.isNaN(value)) return 999;
  return Math.floor((Date.now() - value) / 86400000);
}

function toNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function readFirstText(row: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }
  return fallback;
}

function readCustomerPhone(row: Record<string, unknown>) {
  const raw = readFirstText(row, [
    "phone",
    "customer_phone",
    "phone_number",
    "mobile",
    "customer_mobile",
    "telephone",
    "tel",
    "whatsapp",
    "contact_phone",
    "رقم الهاتف",
    "الهاتف",
    "تليفون",
    "تلفون",
    "الموبايل",
    "موبايل",
    "رقم الموبايل",
    "واتساب",
    "رقم الواتساب",
    "تليفون العميل",
    "هاتف العميل",
  ]);

  return cleanEgyptianPhone(raw) ? raw : "";
}

function phoneKey(value?: string | null) {
  return cleanEgyptianPhone(value || "");
}

function normalizeCustomer(row: Record<string, unknown>): Customer {
  const phone = readCustomerPhone(row);
  const customerCode = readFirstText(row, ["customer_code", "code", "customer_id", "كود العميل", "كود"]);
  const lastPurchase = readFirstText(row, ["last_purchase", "last_purchase_date", "last_invoice_date", "آخر شراء"]);
  const firstPurchase = readFirstText(row, ["first_purchase", "first_purchase_date", "أول شراء"]);

  return {
    id: String(row.id || customerCode || phone || ""),
    customer_code: customerCode,
    name: readFirstText(row, ["name", "customer_name", "client_name", "اسم العميل", "العميل"], "عميل بدون اسم"),
    phone,
    branch: readFirstText(row, ["branch", "branch_name", "store", "store_name", "الفرع", "اسم الفرع"], "غير محدد"),
    type: readFirstText(row, ["segment", "type", "customer_type"], "عادي"),
    avg_monthly: toNumber(row.avg_monthly || row.monthly_avg || row.avg_monthly_spend),
    total_purchases: toNumber(row.total_spent || row.total_purchases || row.total_amount),
    total_invoices: toNumber(row.total_invoices || row.invoice_count),
    avg_invoice: toNumber(row.avg_invoice),
    clv: toNumber(row.clv),
    risk_score: toNumber(row.days_inactive || row.risk_score),
    retention_status: readFirstText(row, ["status", "retention_status"], "نشط"),
    last_purchase: lastPurchase || null,
    first_purchase: firstPurchase || null,
    notes: null,
    customer_notes: row.customer_notes ? String(row.customer_notes) : null,
    whatsapp_notes: null,
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

function isVip(c: Customer) {
  return Number(c.avg_monthly || 0) >= 8000;
}

function isImportant(c: Customer) {
  const avg = Number(c.avg_monthly || 0);
  return avg >= 4000 && avg < 8000;
}

function isMedium(c: Customer) {
  const avg = Number(c.avg_monthly || 0);
  return avg >= 1500 && avg < 4000;
}

function isThreatened(c: Customer) {
  const status = c.retention_status || "";
  return status.includes("معرض") || status.includes("مهدد") || daysSince(c.last_purchase) >= 45;
}

function isStopped(c: Customer) {
  const status = c.retention_status || "";
  return status.includes("مفقود") || status.includes("متوقف") || daysSince(c.last_purchase) >= 75;
}

function bucketScore(c: Customer, existing: DailyFollowup[]) {
  const inactiveDays = daysSince(c.last_purchase);
  const customerPhone = phoneKey(c.phone);
  const hadRecentFollowup = existing.some((f) => {
    const sameCode = f.customer_id === (c.customer_code || c.id);
    const samePhone = customerPhone && phoneKey(f.customer_phone) === customerPhone;
    return (sameCode || samePhone) && daysSince(f.created_at) <= 7;
  });
  const valueScore = Math.min(80, Math.round((c.avg_monthly || 0) / 250));
  const inactivityScore = Math.min(100, inactiveDays * 1.5);
  const freshnessPenalty = hadRecentFollowup ? 60 : 0;
  return valueScore + inactivityScore - freshnessPenalty;
}

function preferredAssignee(c: Customer, topDoctor?: string | null) {
  if (topDoctor) return topDoctor;
  if ((c.branch || "").includes("الشامي")) return "خدمة العملاء - فرع الشامي";
  return "خدمة العملاء - فرع شكري";
}

function suggestedAction(category: string, c: Customer, topDoctor?: string | null) {
  const doctor = topDoctor || "مسؤول خدمة العملاء";
  const inactiveDays = daysSince(c.last_purchase);

  if (category === "مهم جدًا") return `اتصال تقديري من ${doctor}: مراجعة احتياجات العميل الشهرية وتأكيد توفر الأدوية المتكررة.`;
  if (category === "مهم") return `متابعة منتظمة من ${doctor}: سؤال عن التجربة السابقة وعرض تجهيز الطلب القادم.`;
  if (category === "متوسط") return `متابعة تنشيط من ${doctor}: اقتراح طلب مناسب حسب آخر شراء وتأكيد خدمة التوصيل.`;
  return `استرجاع عميل من ${doctor}: العميل بعيد منذ ${inactiveDays} يوم. اسأل عن سبب التوقف وسجل الاعتراض أو الطلب الناقص.`;
}

function buildNotes(category: string, c: Customer, batch: string, topDoctor?: string | null) {
  const cls = classifyCustomer(c.avg_monthly);
  const status = customerStatus(c.last_purchase);
  const scriptKey = category === "مهم جدًا" ? "vip" : category === "مهم" ? "important" : category === "متوسط" ? "medium" : status.key === "stopped" ? "stopped" : "at_risk";
  const assignee = topDoctor || preferredAssignee(c);
  const script = getScript(scriptKey, status.key, { customerName: c.name, staffName: assignee, branchName: c.branch || "" });

  return [
    "قائمة يومية ذكية",
    `دفعة: ${batch}`,
    `الفئة: ${category}`,
    `كود العميل: ${c.customer_code || "غير مسجل"}`,
    `متوسط شهري: ${Math.round(c.avg_monthly || 0)} ج.م`,
    `آخر شراء: ${c.last_purchase || "غير محدد"}`,
    `أول شراء: ${c.first_purchase || "غير محدد"}`,
    `تصنيف العميل: ${cls.label}`,
    `حالة العميل: ${status.label}`,
    `الدكتور الأنسب للمتابعة: ${assignee}`,
    `سبب الاختيار: ${category === "مهم جدًا" ? "عميل عالي القيمة يحتاج متابعة مستمرة" : category === "مهم" ? "عميل مهم يحتاج متابعة منتظمة" : category === "متوسط" ? "عميل متوسط قابل للنمو" : "عميل مهدد أو متوقف يحتاج استرجاع"}`,
    `السكريبت المقترح: ${script}`,
    `المطلوب: ${suggestedAction(category, c, topDoctor)}`,
  ].join("\n");
}

async function getTopDoctorsByCustomer(codes: string[]) {
  const result = new Map<string, string>();
  if (codes.length === 0) return result;

  const { data, error } = await supabase
    .from("sales_invoices")
    .select("customer_code, seller_name, amount")
    .in("customer_code", codes)
    .limit(5000);

  if (error) return result;

  const scores = new Map<string, Map<string, { count: number; total: number }>>();
  for (const row of (data || []) as Array<{ customer_code: string; seller_name: string | null; amount: number }>) {
    if (!row.customer_code || !row.seller_name) continue;
    const customerScores = scores.get(row.customer_code) || new Map();
    const current = customerScores.get(row.seller_name) || { count: 0, total: 0 };
    current.count += 1;
    current.total += Number(row.amount || 0);
    customerScores.set(row.seller_name, current);
    scores.set(row.customer_code, customerScores);
  }

  for (const [code, doctors] of scores) {
    const top = [...doctors.entries()].sort((a, b) => b[1].count - a[1].count || b[1].total - a[1].total)[0];
    if (top) result.set(code, top[0]);
  }

  return result;
}

function pickBucket(
  customers: Customer[],
  existing: DailyFollowup[],
  predicate: (c: Customer) => boolean,
  alreadyPicked: Set<string>,
  limit: number,
) {
  return customers
    .filter((c) => {
      const key = c.customer_code || c.id || c.phone;
      return key && !alreadyPicked.has(key) && predicate(c);
    })
    .sort((a, b) => bucketScore(b, existing) - bucketScore(a, existing))
    .slice(0, limit);
}

function needsMonthlyFrequencyFollowup(c: Customer, invoices: Record<string, unknown>[]) {
  return getCustomerMonthlyInteractionSummary(c as unknown as Record<string, unknown>, invoices).shouldAlert;
}

async function loadCustomerPhoneLookup(followups: DailyFollowup[]) {
  const missing = followups.filter((row) => !phoneKey(row.customer_phone));
  const lookup = new Map<string, string>();
  if (missing.length === 0) return lookup;

  const searches = [
    { table: "customers", column: "customer_code", key: "code" },
    { table: "customers", column: "code", key: "code" },
    { table: "customers", column: "name", key: "name" },
    { table: "customers", column: "customer_name", key: "name" },
  ];

  for (const search of searches) {
    const values = missing
      .map((row) => String(search.key === "code" ? row.customer_code || row.customer_id || "" : row.customer_name || "").trim())
      .filter(Boolean);

    if (values.length === 0) continue;

    const { data, error } = await supabase
      .from(search.table)
      .select("*")
      .in(search.column, [...new Set(values)].slice(0, 200));

    if (error || !data) continue;

    for (const raw of data as Record<string, unknown>[]) {
      const code = readFirstText(raw, ["customer_code", "code", "customer_id", "id"]);
      const name = readFirstText(raw, ["name", "customer_name", "client_name"]);
      const phone = readCustomerPhone(raw);
      if (!phoneKey(phone)) continue;
      if (code) lookup.set(`code:${code}`, phone);
      if (name) lookup.set(`name:${name}`, phone);
    }
  }

  return lookup;
}

async function hydrateFollowupCustomerPhones(rows: DailyFollowup[]) {
  const phoneLookup = await loadCustomerPhoneLookup(rows);
  if (phoneLookup.size === 0) return rows;

  return rows.map((row) => {
    if (phoneKey(row.customer_phone)) return row;
    const code = String(row.customer_code || row.customer_id || "").trim();
    const name = String(row.customer_name || "").trim();
    const phone = phoneLookup.get(`code:${code}`) || phoneLookup.get(`name:${name}`);
    return phone ? { ...row, customer_phone: phone } : row;
  });
}

export async function getTodayFollowups() {
  requireSupabaseConfig();
  const start = startOfToday();
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const { data, error } = await supabase
    .from("daily_followups")
    .select("*")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as DailyFollowup[];
  const smartRows = rows.filter(isSmartFollowup);
  if (smartRows.length === 0) return hydrateFollowupCustomerPhones(rows);

  const latestBatch = smartRows.map((row) => extractBatch(row.notes)).filter(Boolean).sort().pop();
  const latestRows = latestBatch ? smartRows.filter((row) => extractBatch(row.notes) === latestBatch) : smartRows;
  return hydrateFollowupCustomerPhones(latestRows);
}

export async function createDailyFollowup(followup: DailyFollowupInsert) {
  requireSupabaseConfig();
  const today = startOfToday().toISOString().slice(0, 10);
  const payload = { date: followup.followup_date || today, followup_date: followup.followup_date || today, ...followup };
  const rows = await insertFollowupRecords([payload as Record<string, unknown>]);
  return rows[0];
}

export async function updateFollowupStatus(id: string, updates: DailyFollowupUpdate) {
  requireSupabaseConfig();
  const payload: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await supabase.from("daily_followups").update(payload).eq("id", id).select().single();
    if (!error) return data as DailyFollowup;

    const column = missingColumn(error.message);
    if (!column || !(column in payload)) throw new Error(error.message);
    delete payload[column];
  }

  throw new Error("تعذر حفظ المتابعة.");
}


export async function getFollowupHistory(options: { limit?: number; from?: string; to?: string; status?: string } = {}) {
  requireSupabaseConfig();

  let query = supabase
    .from("daily_followups")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(options.limit || 500);

  if (options.from) query = query.gte("created_at", options.from);
  if (options.to) query = query.lte("created_at", options.to);
  if (options.status && options.status !== "all") query = query.eq("status", options.status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return hydrateFollowupCustomerPhones((data ?? []) as DailyFollowup[]);
}

export async function getCustomerFollowupHistory(customer: { code?: string | null; name?: string | null; phone?: string | null }, limit = 100) {
  requireSupabaseConfig();
  const code = String(customer.code || "").trim();
  const name = String(customer.name || "").trim();
  const phone = cleanEgyptianPhone(customer.phone || "");

  const clauses: string[] = [];
  if (code) clauses.push(`customer_code.eq.${code}`, `customer_id.eq.${code}`);
  if (name) clauses.push(`customer_name.eq.${name}`);
  if (phone) clauses.push(`customer_phone.ilike.%${phone.slice(-10)}%`);

  let query = supabase
    .from("daily_followups")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (clauses.length) query = query.or(clauses.join(","));

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return hydrateFollowupCustomerPhones((data ?? []) as DailyFollowup[]);
}

export async function generateTodayFollowups() {
  requireSupabaseConfig();
  const start = startOfToday();
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const batch = new Date().toISOString();

  const { data: todayRows } = await supabase
    .from("daily_followups")
    .select("*")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .order("created_at", { ascending: false });

  const existingSmartToday = ((todayRows ?? []) as DailyFollowup[]).filter(isSmartFollowup);
  if (existingSmartToday.length > 0) return getTodayFollowups();

  const { data: customerRows, error } = await supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1200);

  if (error) throw new Error(error.message);

  const invoices = await fetchSalesInvoices();
  const customers = enrichCustomersWithSalesMetrics(((customerRows ?? []) as Record<string, unknown>[]).map(normalizeCustomer), invoices);
  const { data: recentRows } = await supabase
    .from("daily_followups")
    .select("*")
    .gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1000);

  const recentFollowups = (recentRows ?? []) as DailyFollowup[];
  const picked = new Set<string>(((todayRows ?? []) as DailyFollowup[]).map((row) => row.customer_id || row.customer_phone || row.customer_name || "").filter(Boolean));

  const bucketDefinitions: Array<[string, (c: Customer) => boolean, number]> = [
    ["أقل من المعدل الشهري", (c) => needsMonthlyFrequencyFollowup(c, invoices), 8],
    ["مهم جدًا", isVip, LIMITS.vip],
    ["مهم", isImportant, LIMITS.important],
    ["متوسط", isMedium, LIMITS.medium],
    ["مهدد/متوقف", (c) => isStopped(c) || isThreatened(c), LIMITS.risk],
  ];

  const buckets = bucketDefinitions.map(([category, predicate, limit]) => {
    const selected = pickBucket(customers, recentFollowups, predicate, picked, limit);
    selected.forEach((c) => picked.add(c.customer_code || c.id || c.phone));
    return { category, customers: selected };
  });

  const allSelected = buckets.flatMap((bucket) => bucket.customers);
  const topDoctors = await getTopDoctorsByCustomer(allSelected.map((c) => c.customer_code || c.id).filter(Boolean));
  const today = start.toISOString().slice(0, 10);
  const records = buckets.flatMap((bucket) =>
    bucket.customers.map((c) => {
      const code = c.customer_code || c.id;
      const topDoctor = topDoctors.get(code) || null;
      const monthly = getCustomerMonthlyInteractionSummary(c as unknown as Record<string, unknown>, invoices);
      const monthlyNote = monthly.shouldAlert
        ? `\nتنبيه التكرار الشهري: العميل تعامل هذا الشهر ${monthly.currentMonthVisits} مرة، ومتوسطه المعتاد ${monthly.expectedMonthlyVisits} مرة.`
        : "";
      return {
        customer_id: code,
        customer_code: c.customer_code || null,
        customer_name: c.name,
        customer_phone: c.phone,
        branch: c.branch,
        assigned_to: topDoctor || preferredAssignee(c),
        category: bucket.category,
        suggested_action: suggestedAction(bucket.category, c, topDoctor),
        status: "معلق",
        date: today,
        followup_date: today,
        notes: `${buildNotes(bucket.category, c, batch, topDoctor)}${monthlyNote}`,
      };
    }),
  );

  if (records.length === 0) return [];

  const inserted = await insertFollowupRecords(records);
  await logActivity({
    action: "إنشاء قائمة متابعة يومية",
    module: "خدمة العملاء",
    target_type: "daily_followups",
    target_id: batch,
    user_id: "system",
    user_name: "النظام",
    user_role: "system",
    branch_name: "كل الفروع",
    details: { count: inserted.length, batch },
  });

  return hydrateFollowupCustomerPhones(inserted);
}
