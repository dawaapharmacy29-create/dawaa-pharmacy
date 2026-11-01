import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// مزامنة دفتر الخزن من تطبيق دواء بيلز (AccountantVault + AccountantTransaction) → accountant_*.
// تعمل كل 15 دقيقة عن طريق pg_cron + pg_net، بنفس مفتاح بيز٤٤ (personal access token لكل التطبيقات).
const BASE44_APP_ID = "6a00735e63f2bcce7f4bb37e";
const BASE44_API_BASE = "https://app.base44.com/api/apps";
const PAGE = 5000;

const VAULT_FIELDS = ["id", "code", "name", "opening_balance", "opening_date", "is_active", "is_sample"] as const;
const TX_FIELDS = [
  "id", "vault_code", "date", "direction", "amount", "category_name", "category_group", "classification_override",
  "description", "created_by_name", "is_offset_pair", "voided", "is_sample", "created_date", "updated_date",
] as const;

async function fetchAll(key: string, entity: string, fields: readonly string[]) {
  const rows: Array<Record<string, unknown>> = [];
  for (let skip = 0; ; skip += PAGE) {
    const res = await fetch(`${BASE44_API_BASE}/${BASE44_APP_ID}/entities/${entity}?sort=created_date&limit=${PAGE}&skip=${skip}`, {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Base44 ${entity} error ${res.status}: ${body.slice(0, 300)}`);
    }
    const page = (await res.json()) as Array<Record<string, unknown>>;
    for (const row of page) {
      const record: Record<string, unknown> = {};
      for (const field of fields) record[field] = row[field] ?? null;
      rows.push(record);
    }
    if (page.length < PAGE) return rows;
  }
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: keyData, error: keyError } = await admin.rpc("get_base44_api_key_v1");
    if (keyError || !keyData) throw new Error(`تعذر جلب مفتاح بيز٤٤: ${keyError?.message || "مفيش مفتاح مخزن"}`);

    const vaults = await fetchAll(keyData as string, "AccountantVault", VAULT_FIELDS);
    const transactions = await fetchAll(keyData as string, "AccountantTransaction", TX_FIELDS);

    const { data: rpcJson, error: rpcError } = await admin.rpc("import_base44_accountant_v1", {
      p_vaults: vaults,
      p_transactions: transactions,
    });
    if (rpcError) throw new Error(`import_base44_accountant_v1 error: ${rpcError.message}`);

    const result = (rpcJson || {}) as Record<string, unknown>;
    await admin.from("base44_sync_run_log").insert({
      source: "accountant",
      status: "success",
      total: (result.total as number) ?? transactions.length,
      matched: (result.transactions as number) ?? null,
    });
    return new Response(JSON.stringify({ ok: true, result }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin.from("base44_sync_run_log").insert({ source: "accountant", status: "error", error_message: message });
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
