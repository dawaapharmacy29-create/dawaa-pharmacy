import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export type CustomerSpecialItem = {
  id: string;
  customer_id?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
  item_name: string;
  importance_reason?: string | null;
  notes?: string | null;
  last_requested_at?: string | null;
  repeats_monthly?: boolean | null;
  created_by_name?: string | null;
  created_at?: string | null;
};

export type CustomerSpecialIdentity = {
  customer_id?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
};

function clean(value?: string | null) {
  return String(value || "").trim();
}

function localKey(identity: CustomerSpecialIdentity) {
  return `dawaa_customer_special_items_${clean(identity.customer_code) || clean(identity.customer_phone) || clean(identity.customer_id) || clean(identity.customer_name) || "unknown"}`;
}

function localRows(identity: CustomerSpecialIdentity): CustomerSpecialItem[] {
  try {
    const raw = window.localStorage.getItem(localKey(identity));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row: any) => ({
      id: String(row.id || crypto.randomUUID()),
      item_name: String(row.item_name || row.name || ""),
      notes: row.notes || "",
      importance_reason: row.importance_reason || row.reason || null,
      created_at: row.created_at || row.createdAt || new Date().toISOString(),
    })).filter((row) => row.item_name);
  } catch {
    return [];
  }
}

function saveLocal(identity: CustomerSpecialIdentity, rows: CustomerSpecialItem[]) {
  window.localStorage.setItem(localKey(identity), JSON.stringify(rows));
}

function orClause(identity: CustomerSpecialIdentity) {
  const clauses = [
    clean(identity.customer_id) ? `customer_id.eq.${clean(identity.customer_id)}` : "",
    clean(identity.customer_code) ? `customer_code.eq.${clean(identity.customer_code)}` : "",
    clean(identity.customer_phone) ? `customer_phone.eq.${clean(identity.customer_phone)}` : "",
  ].filter(Boolean);
  return clauses.join(",");
}

export async function fetchCustomerSpecialItems(identity: CustomerSpecialIdentity): Promise<{ rows: CustomerSpecialItem[]; source: "supabase" | "local"; warning?: string }> {
  const fallback = localRows(identity);
  if (!isSupabaseConfigured) return { rows: fallback, source: "local", warning: "Supabase غير مضبوط؛ يتم عرض الأصناف المحلية فقط." };
  const clause = orClause(identity);
  if (!clause) return { rows: fallback, source: "local", warning: "لا توجد بيانات تعريف كافية للعميل." };
  try {
    const { data, error } = await supabase
      .from("customer_special_items")
      .select("id,customer_id,customer_code,customer_phone,customer_name,item_name,importance_reason,notes,last_requested_at,repeats_monthly,created_by_name,created_at")
      .or(clause)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return { rows: (data || []) as CustomerSpecialItem[], source: "supabase" };
  } catch (error) {
    return { rows: fallback, source: "local", warning: error instanceof Error ? error.message : "تعذر تحميل الأصناف المميزة من Supabase" };
  }
}

export async function addCustomerSpecialItem(identity: CustomerSpecialIdentity, item: Omit<CustomerSpecialItem, "id" | "created_at">) {
  const local = localRows(identity);
  if (!isSupabaseConfigured) {
    const next = [{ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...identity, ...item }, ...local];
    saveLocal(identity, next);
    return { row: next[0], source: "local" as const };
  }
  try {
    const { data, error } = await supabase
      .from("customer_special_items")
      .insert({ ...identity, ...item })
      .select("id,customer_id,customer_code,customer_phone,customer_name,item_name,importance_reason,notes,last_requested_at,repeats_monthly,created_by_name,created_at")
      .single();
    if (error) throw error;
    return { row: data as CustomerSpecialItem, source: "supabase" as const };
  } catch {
    const next = [{ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...identity, ...item }, ...local];
    saveLocal(identity, next);
    return { row: next[0], source: "local" as const };
  }
}

export async function deleteCustomerSpecialItem(identity: CustomerSpecialIdentity, id: string) {
  if (isSupabaseConfigured) {
    try {
      const { error } = await supabase.from("customer_special_items").delete().eq("id", id);
      if (!error) return true;
    } catch {
      // fallback to local cleanup
    }
  }
  saveLocal(identity, localRows(identity).filter((row) => row.id !== id));
  return true;
}
