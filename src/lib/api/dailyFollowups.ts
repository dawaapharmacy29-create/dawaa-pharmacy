import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { DailyFollowup } from "@/types/database";
import { cleanEgyptianPhone } from "@/lib/whatsapp";
import { generateTodayFollowupsFromCustomerMetrics } from "@/lib/api/customerServiceCommandCenter";

type DailyFollowupInsert = Partial<Omit<DailyFollowup, "id" | "created_at" | "updated_at">>;
type DailyFollowupUpdate = Partial<DailyFollowup>;

export const DAILY_FOLLOWUP_QUOTAS = {
  important: 10,
  medium: 10,
  threatened: 15,
  stopped: 10,
} as const;

function requireSupabaseConfig() {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة.");
  }
}

function startOfToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
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

  throw new Error("تعذر إنشاء المتابعة بسبب اختلاف أعمدة جدول daily_followups.");
}

function isSmartFollowup(row: DailyFollowup) {
  const notes = row.notes || "";
  return notes.includes("قائمة يومية ذكية") || /daily|smart/i.test(notes);
}

function cleanCustomerCode(value: unknown) {
  const code = String(value ?? "").trim();
  if (!code || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code)) return "";
  return code;
}

function phoneKey(value?: string | null) {
  return cleanEgyptianPhone(value || "");
}

async function loadCustomerPhoneLookup(followups: DailyFollowup[]) {
  const missing = followups.filter((row) => !phoneKey(row.customer_phone));
  const lookup = new Map<string, string>();
  if (missing.length === 0) return lookup;

  const codes = [...new Set(missing.map((row) => cleanCustomerCode(row.customer_code)).filter(Boolean))].slice(0, 200);
  if (!codes.length) return lookup;

  const { data } = await supabase
    .from("customers")
    .select("customer_code, phone, whatsapp_phone, phone_alt")
    .in("customer_code", codes);

  for (const row of (data || []) as Record<string, unknown>[]) {
    const code = cleanCustomerCode(row.customer_code);
    const phone = phoneKey(String(row.whatsapp_phone || row.phone || row.phone_alt || ""));
    if (code && phone) lookup.set(`code:${code}`, phone);
  }

  return lookup;
}

async function hydrateFollowupCustomerPhones(rows: DailyFollowup[]) {
  const phoneLookup = await loadCustomerPhoneLookup(rows);
  if (phoneLookup.size === 0) return rows;

  return rows.map((row) => {
    if (phoneKey(row.customer_phone)) return row;
    const code = cleanCustomerCode(row.customer_code) || "";
    const phone = phoneLookup.get(`code:${code}`);
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
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as DailyFollowup[];
  const smartRows = rows.filter(isSmartFollowup);
  return hydrateFollowupCustomerPhones(smartRows.length ? smartRows : rows);
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
    .limit(Math.min(options.limit || 500, 1000));

  if (options.from) query = query.gte("created_at", options.from);
  if (options.to) query = query.lte("created_at", options.to);
  if (options.status && options.status !== "all") query = query.eq("status", options.status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return hydrateFollowupCustomerPhones((data ?? []) as DailyFollowup[]);
}

export async function getCustomerFollowupHistory(customer: { code?: string | null; name?: string | null; phone?: string | null }, limit = 100) {
  requireSupabaseConfig();
  const code = cleanCustomerCode(customer.code);
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
    .limit(Math.min(limit, 200));

  if (clauses.length) query = query.or(clauses.join(","));

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return hydrateFollowupCustomerPhones((data ?? []) as DailyFollowup[]);
}

export async function generateTodayFollowups() {
  requireSupabaseConfig();
  return generateTodayFollowupsFromCustomerMetrics();
}

export async function clearTodayTrialFollowups() {
  requireSupabaseConfig();

  const { data, error: loadError } = await supabase
    .from("daily_followups")
    .select("id, notes, followup_type, status, followup_status, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (loadError) throw new Error(loadError.message);

  const rows = ((data ?? []) as DailyFollowup[]).filter((row) => {
    const text = [row.notes, row.followup_type, row.status, row.followup_status].join(" ");
    return isSmartFollowup(row) || /قائمة يومية|تجريبي|trial|test|daily smart/i.test(text);
  });

  if (rows.length === 0) return 0;

  for (let index = 0; index < rows.length; index += 200) {
    const chunk = rows.slice(index, index + 200).map((row) => row.id);
    const { error } = await supabase.from("daily_followups").delete().in("id", chunk);
    if (error) throw new Error(error.message);
  }

  return rows.length;
}
