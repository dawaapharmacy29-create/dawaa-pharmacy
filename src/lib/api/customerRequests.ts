import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activityLog";

export type CustomerRequestStatus =
  | "new"
  | "purchasing_review"
  | "searching_suppliers"
  | "needs_customer_confirmation"
  | "customer_confirmed"
  | "sourcing"
  | "available"
  | "arrived"
  | "customer_contacted"
  | "delivered"
  | "closed"
  | "cancelled"
  | "not_available";

export interface CustomerRequest {
  id: string;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  branch: string | null;
  medicine_name: string;
  medicine_image_url: string | null;
  quantity: number | null;
  urgency: string | null;
  status: CustomerRequestStatus | string | null;
  request_type: string | null;
  needs_customer_confirmation: boolean | null;
  is_expensive_or_special: boolean | null;
  doctor_id: string | null;
  doctor_name: string | null;
  purchasing_assignee: string | null;
  doctor_notes: string | null;
  supplier_hint: string | null;
  purchasing_notes: string | null;
  customer_confirmation_status: string | null;
  contact_summary: string | null;
  expected_arrival_date: string | null;
  closed_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CustomerRequestEvent {
  id: string;
  request_id: string;
  old_status: string | null;
  new_status: string | null;
  action: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string | null;
}

export interface CustomerRequestInput {
  customer_id?: string | null;
  customer_code?: string | null;
  customer_name: string;
  customer_phone?: string | null;
  branch?: string | null;
  medicine_name: string;
  medicine_image_url?: string | null;
  quantity?: number | null;
  urgency?: string | null;
  request_type?: string | null;
  needs_customer_confirmation?: boolean | null;
  is_expensive_or_special?: boolean | null;
  doctor_id?: string | null;
  doctor_name?: string | null;
  doctor_notes?: string | null;
  supplier_hint?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
}

function requireSupabaseConfig() {
  if (!isSupabaseConfigured) {
    throw new Error("إعدادات Supabase غير موجودة. أضف VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في ملف .env.");
  }
}

function missingColumn(message: string) {
  return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || "";
}

function removeColumn<T extends Record<string, unknown>>(payload: T, column: string) {
  const next = { ...payload };
  delete next[column];
  return next;
}

async function insertResilient(table: string, payload: Record<string, unknown>) {
  let nextPayload = payload;
  const removed = new Set<string>();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await supabase.from(table).insert(nextPayload).select("*").single();
    if (!error) return data;

    const column = missingColumn(error.message);
    if (!column || removed.has(column)) throw new Error(error.message);
    removed.add(column);
    nextPayload = removeColumn(nextPayload, column);
  }

  throw new Error(`تعذر حفظ البيانات في ${table}`);
}

async function updateResilient(table: string, id: string, payload: Record<string, unknown>) {
  let nextPayload = payload;
  const removed = new Set<string>();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await supabase.from(table).update(nextPayload).eq("id", id).select("*").single();
    if (!error) return data;

    const column = missingColumn(error.message);
    if (!column || removed.has(column) || !(column in nextPayload)) throw new Error(error.message);
    removed.add(column);
    nextPayload = removeColumn(nextPayload, column);
  }

  throw new Error(`تعذر تحديث البيانات في ${table}`);
}

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  new: "طلب جديد",
  purchasing_review: "قيد مراجعة المشتريات",
  searching_suppliers: "جاري البحث عند الموردين",
  needs_customer_confirmation: "يحتاج تأكيد العميل",
  customer_confirmed: "تم تأكيد العميل",
  sourcing: "جاري التوفير",
  available: "تم توفيره",
  arrived: "وصل للصيدلية",
  customer_contacted: "تم التواصل مع العميل",
  delivered: "تم التسليم / البيع",
  closed: "مغلق",
  cancelled: "ملغي",
  not_available: "غير متوفر",
};

export const REQUEST_STATUS_FLOW: Array<{ value: CustomerRequestStatus; label: string }> = [
  { value: "new", label: REQUEST_STATUS_LABELS.new },
  { value: "purchasing_review", label: REQUEST_STATUS_LABELS.purchasing_review },
  { value: "searching_suppliers", label: REQUEST_STATUS_LABELS.searching_suppliers },
  { value: "needs_customer_confirmation", label: REQUEST_STATUS_LABELS.needs_customer_confirmation },
  { value: "customer_confirmed", label: REQUEST_STATUS_LABELS.customer_confirmed },
  { value: "sourcing", label: REQUEST_STATUS_LABELS.sourcing },
  { value: "available", label: REQUEST_STATUS_LABELS.available },
  { value: "arrived", label: REQUEST_STATUS_LABELS.arrived },
  { value: "customer_contacted", label: REQUEST_STATUS_LABELS.customer_contacted },
  { value: "delivered", label: REQUEST_STATUS_LABELS.delivered },
  { value: "closed", label: REQUEST_STATUS_LABELS.closed },
  { value: "cancelled", label: REQUEST_STATUS_LABELS.cancelled },
  { value: "not_available", label: REQUEST_STATUS_LABELS.not_available },
];

export function requestStatusLabel(status?: string | null) {
  return REQUEST_STATUS_LABELS[status || ""] || status || "طلب جديد";
}

export function requestNeedsAttention(row: CustomerRequest) {
  return ["new", "needs_customer_confirmation", "arrived", "available"].includes(String(row.status || "new"));
}

export async function getCustomerRequests(options: { status?: string; branch?: string; search?: string } = {}) {
  requireSupabaseConfig();

  let query = supabase
    .from("customer_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (options.status && options.status !== "all") query = query.eq("status", options.status);
  if (options.branch && options.branch !== "all") query = query.eq("branch", options.branch);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as CustomerRequest[];
  const q = (options.search || "").trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    [row.customer_name, row.customer_code, row.customer_phone, row.medicine_name, row.doctor_name, row.supplier_hint]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q)),
  );
}

export async function getCustomerRequestEvents(requestId: string) {
  requireSupabaseConfig();
  const { data, error } = await supabase
    .from("customer_request_events")
    .select("*")
    .eq("request_id", requestId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as CustomerRequestEvent[];
}

export async function createCustomerRequest(input: CustomerRequestInput) {
  requireSupabaseConfig();
  const needsConfirmation = Boolean(input.needs_customer_confirmation || input.is_expensive_or_special);
  const status: CustomerRequestStatus = needsConfirmation ? "needs_customer_confirmation" : "new";
  const payload: Record<string, unknown> = {
    customer_id: input.customer_id || input.customer_code || null,
    customer_code: input.customer_code || null,
    customer_name: input.customer_name,
    customer_phone: input.customer_phone || null,
    branch: input.branch || null,
    medicine_name: input.medicine_name,
    medicine_image_url: input.medicine_image_url || null,
    quantity: Number(input.quantity || 1),
    urgency: input.urgency || "normal",
    status,
    request_type: input.request_type || "missing_medicine",
    needs_customer_confirmation: needsConfirmation,
    is_expensive_or_special: Boolean(input.is_expensive_or_special),
    doctor_id: input.doctor_id || null,
    doctor_name: input.doctor_name || null,
    doctor_notes: input.doctor_notes || null,
    supplier_hint: input.supplier_hint || null,
    created_by: input.created_by || null,
    created_by_name: input.created_by_name || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const created = (await insertResilient("customer_requests", payload)) as CustomerRequest;
  await addCustomerRequestEvent(created.id, {
    old_status: null,
    new_status: created.status || status,
    action: "إنشاء طلب عميل",
    notes: input.doctor_notes || `تم تسجيل طلب صنف: ${input.medicine_name}`,
    created_by: input.created_by || null,
    created_by_name: input.created_by_name || null,
  });
  return created;
}

export async function updateCustomerRequestStatus(
  request: CustomerRequest,
  input: {
    status: string;
    notes?: string | null;
    purchasing_notes?: string | null;
    customer_confirmation_status?: string | null;
    contact_summary?: string | null;
    purchasing_assignee?: string | null;
    expected_arrival_date?: string | null;
    user_id?: string | null;
    user_name?: string | null;
  },
) {
  requireSupabaseConfig();
  const payload: Record<string, unknown> = {
    status: input.status,
    purchasing_notes: input.purchasing_notes ?? request.purchasing_notes,
    customer_confirmation_status: input.customer_confirmation_status ?? request.customer_confirmation_status,
    contact_summary: input.contact_summary ?? request.contact_summary,
    purchasing_assignee: input.purchasing_assignee ?? request.purchasing_assignee,
    expected_arrival_date: input.expected_arrival_date ?? request.expected_arrival_date,
    updated_at: new Date().toISOString(),
  };
  if (["closed", "delivered", "cancelled", "not_available"].includes(input.status)) {
    payload.closed_at = new Date().toISOString();
  }

  const updated = (await updateResilient("customer_requests", request.id, payload)) as CustomerRequest;
  await addCustomerRequestEvent(request.id, {
    old_status: request.status,
    new_status: input.status,
    action: "تغيير حالة طلب عميل",
    notes: input.notes || input.purchasing_notes || input.contact_summary || "تم تحديث حالة الطلب",
    created_by: input.user_id || null,
    created_by_name: input.user_name || null,
  });
  await logActivity({
    action: "تحديث طلب عميل",
    module: "طلبات العملاء",
    target_type: "customer_request",
    target_id: request.id,
    user_id: input.user_id || undefined,
    user_name: input.user_name || undefined,
    branch_name: request.branch || undefined,
    details: {
      customer_name: request.customer_name,
      customer_code: request.customer_code,
      medicine_name: request.medicine_name,
      old_status: request.status,
      new_status: input.status,
    },
  });
  return updated;
}

export async function addCustomerRequestEvent(
  requestId: string,
  input: {
    old_status?: string | null;
    new_status?: string | null;
    action: string;
    notes?: string | null;
    created_by?: string | null;
    created_by_name?: string | null;
  },
) {
  const payload: Record<string, unknown> = {
    request_id: requestId,
    old_status: input.old_status || null,
    new_status: input.new_status || null,
    action: input.action,
    notes: input.notes || null,
    created_by: input.created_by || null,
    created_by_name: input.created_by_name || null,
    created_at: new Date().toISOString(),
  };

  try {
    return (await insertResilient("customer_request_events", payload)) as CustomerRequestEvent;
  } catch {
    return null;
  }
}
