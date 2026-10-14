import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// مزامنة تلقائية لفواتير المشتريات من بيز٤٤ → base44_purchase_invoice_sync.
// تعمل كل 15 دقيقة عن طريق pg_cron + pg_net.
// الاستيراد الداخلي يتم من خلال service-role client داخل الـEdge Function نفسها،
// بدل تمرير x-dawaa-user-id قديم لم يعد مقبولًا بعد تشديد هوية الجلسة.
const BASE44_APP_ID = "6a11bdb86cda73e6c2a7fde4";
const BASE44_API_BASE = "https://app.base44.com/api/apps";

function mapBranch(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.includes("شكري")) return "دواء شكري";
  if (raw.includes("شامي")) return "دواء الشامي";
  return raw;
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: keyData, error: keyError } = await admin.rpc("get_base44_api_key_v1");
    if (keyError || !keyData) throw new Error(`تعذر جلب مفتاح بيز٤٤: ${keyError?.message || "مفيش مفتاح مخزن"}`);
    const base44ApiKey = keyData as string;

    const listUrl = `${BASE44_API_BASE}/${BASE44_APP_ID}/entities/PurchaseInvoice?sort=-created_date&limit=300`;
    const base44Res = await fetch(listUrl, {
      headers: { api_key: base44ApiKey, "Content-Type": "application/json" },
    });
    if (!base44Res.ok) {
      const body = await base44Res.text();
      throw new Error(`Base44 API error ${base44Res.status}: ${body.slice(0, 300)}`);
    }
    const invoices = (await base44Res.json()) as Array<Record<string, unknown>>;

    const records = invoices.map((inv) => ({
      id: inv.id,
      system_invoice_number: inv.system_invoice_number ?? null,
      supplier_invoice_number: inv.supplier_invoice_number ?? null,
      branch: mapBranch((inv.branch as string) ?? null),
      transaction_type: inv.transaction_type ?? null,
      entered_by: inv.entered_by ?? null,
      invoice_date: inv.invoice_date ?? null,
      total_value: inv.total_value ?? null,
      status: inv.status ?? null,
      supplier_id: inv.supplier_id ?? null,
      purchase_category: inv.purchase_category ?? null,
      source_branch: mapBranch((inv.source_branch as string) ?? null),
      destination_branch: mapBranch((inv.destination_branch as string) ?? null),
      cash_amount: inv.cash_amount ?? null,
      payment_type: inv.payment_type ?? null,
      notes: inv.notes ?? null,
      transfer_authorization_number: inv.transfer_authorization_number ?? null,
    }));

    const { data: rpcJson, error: rpcError } = await admin.rpc("import_base44_purchase_invoices_v1", {
      p_records: records,
    });
    if (rpcError) throw new Error(`import_base44_purchase_invoices_v1 error: ${rpcError.message}`);

    const result = (rpcJson || {}) as Record<string, unknown>;
    await admin.from("base44_sync_run_log").insert({
      status: "success",
      total: result.total ?? records.length,
      matched: result.matched ?? null,
      ambiguous: result.ambiguous ?? null,
      unmatched: result.unmatched ?? null,
    });

    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin.from("base44_sync_run_log").insert({ status: "error", error_message: message });
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
