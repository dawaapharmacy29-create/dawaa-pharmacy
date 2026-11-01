import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// مزامنة تسليمات الشيفت من بيز٤٤ (ShiftDelivery) → shift_handovers.
// تعمل كل 15 دقيقة عن طريق pg_cron + pg_net، بنفس مفتاح مزامنة المشتريات (personal access token).
const BASE44_APP_ID = "6a11bdb86cda73e6c2a7fde4";
const BASE44_API_BASE = "https://app.base44.com/api/apps";
// Base44 names the branches «دواء شكري» / «دواء الشامي»; the pharmacy system uses «فرع ...».
const BRANCHES: Record<string, string> = { "دواء شكري": "فرع شكري", "دواء الشامي": "فرع الشامي" };
const LOOKBACK_DAYS = 45;

const FIELDS = [
  "id", "shift_type", "shift_date", "submitted_by", "total_sales", "total_expenses", "net_amount", "expenses",
  "status", "recorded_at", "calculation_date", "cash_sales", "visa_sales", "insta_sales", "vodafone_sales",
  "other_sales", "cash_handover", "cash_variance", "notes", "submitted_by_staff_id", "is_archived",
  "created_date", "updated_date",
] as const;

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: keyData, error: keyError } = await admin.rpc("get_base44_api_key_v1");
    if (keyError || !keyData) throw new Error(`تعذر جلب مفتاح بيز٤٤: ${keyError?.message || "مفيش مفتاح مخزن"}`);

    const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString().slice(0, 10);
    const records: Array<Record<string, unknown>> = [];
    for (const [base44Branch, branch] of Object.entries(BRANCHES)) {
      const q = encodeURIComponent(JSON.stringify({ branch: base44Branch, shift_date: { $gte: since } }));
      const res = await fetch(`${BASE44_API_BASE}/${BASE44_APP_ID}/entities/ShiftDelivery?q=${q}&sort=-created_date&limit=500`, {
        headers: { Authorization: `Bearer ${keyData as string}`, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Base44 API error ${res.status}: ${body.slice(0, 300)}`);
      }
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      for (const row of rows) {
        if (row.is_sample === true) continue;
        const record: Record<string, unknown> = { branch };
        for (const field of FIELDS) record[field] = row[field] ?? null;
        records.push(record);
      }
    }

    const { data: rpcJson, error: rpcError } = await admin.rpc("import_base44_shift_deliveries_v1", { p_records: records });
    if (rpcError) throw new Error(`import_base44_shift_deliveries_v1 error: ${rpcError.message}`);

    const result = (rpcJson || {}) as Record<string, unknown>;
    await admin.from("base44_sync_run_log").insert({
      source: "shift_deliveries",
      status: "success",
      total: (result.total as number) ?? records.length,
      matched: (result.upserted as number) ?? null,
    });
    return new Response(JSON.stringify({ ok: true, result }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin.from("base44_sync_run_log").insert({ source: "shift_deliveries", status: "error", error_message: message });
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
