import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// مزامنة تلقائية لفواتير المشتريات من بيز٤٤ → base44_purchase_invoice_sync.
// تعمل كل 15 دقيقة عن طريق pg_cron + pg_net.
// الاستيراد الداخلي يتم من خلال service-role client داخل الـEdge Function نفسها،
// بدل تمرير x-dawaa-user-id قديم لم يعد مقبولًا بعد تشديد هوية الجلسة.
const BASE44_APP_ID = "6a11bdb86cda73e6c2a7fde4";
const BASE44_API_BASE = "https://app.base44.com/api/apps";
const PAGE = 500;

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

    // The latest changed invoices, so a review in DawaaWael (status) reaches older invoices too;
    // {"full": true} reads every invoice once.
    const { full } = (await _req.json().catch(() => ({}))) as { full?: boolean };
    const startedAt = new Date().toISOString();
    const invoices: Array<Record<string, unknown>> = [];
    for (let skip = 0; ; skip += PAGE) {
      const sort = full ? "id" : "-updated_date";
      const listUrl = `${BASE44_API_BASE}/${BASE44_APP_ID}/entities/PurchaseInvoice?sort=${sort}&limit=${PAGE}&skip=${skip}`;
      const base44Res = await fetch(listUrl, {
        // Base44 refuses account API keys since 2026-10-28; the stored secret is a personal access token.
        headers: { Authorization: `Bearer ${base44ApiKey}`, "Content-Type": "application/json" },
      });
      if (!base44Res.ok) {
        const body = await base44Res.text();
        throw new Error(`Base44 API error ${base44Res.status}: ${body.slice(0, 300)}`);
      }
      const page = (await base44Res.json()) as Array<Record<string, unknown>>;
      invoices.push(...page);
      if (!full || page.length < PAGE || skip > 100000) break;
    }

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
      // The app's net purchases rules: returns on the invoice, and invoices excluded one by one.
      returned_value: inv.returned_value ?? null,
      net_purchase_mode: inv.net_purchase_mode ?? null,
      exclusion_reason: inv.exclusion_reason ?? null,
    }));

    // One call per page: the whole book in one statement runs past the statement timeout.
    const result: Record<string, number> = {};
    for (let i = 0; i < records.length; i += PAGE) {
      const { data: rpcJson, error: rpcError } = await admin.rpc("import_base44_purchase_invoices_v1", {
        p_records: records.slice(i, i + PAGE),
      });
      if (rpcError) throw new Error(`import_base44_purchase_invoices_v1 error: ${rpcError.message}`);
      for (const [key, value] of Object.entries((rpcJson || {}) as Record<string, number>)) {
        result[key] = (result[key] ?? 0) + Number(value || 0);
      }
    }
    // Suppliers excluded from net purchases, as the app has them (a short list, read every run).
    const suppliers: Array<Record<string, unknown>> = [];
    for (let skip = 0; ; skip += PAGE) {
      const res = await fetch(`${BASE44_API_BASE}/${BASE44_APP_ID}/entities/Supplier?sort=id&limit=${PAGE}&skip=${skip}`, {
        headers: { Authorization: `Bearer ${base44ApiKey}`, "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`Base44 Supplier API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const page = (await res.json()) as Array<Record<string, unknown>>;
      suppliers.push(...page);
      if (page.length < PAGE || skip > 20000) break;
    }
    const { error: supplierError } = await admin.rpc("import_base44_purchase_suppliers_v1", {
      p_records: suppliers.map((s) => ({ id: s.id, name: s.name ?? null, exclude_from_net_purchases: s.exclude_from_net_purchases === true })),
    });
    if (supplierError) throw new Error(`import_base44_purchase_suppliers_v1 error: ${supplierError.message}`);
    result.suppliers = suppliers.length;

    // A full read holds every invoice DawaaWael still has: the ones it did not return were deleted there.
    if (full) {
      const { data: missing, error: missingError } = await admin.rpc("mark_base44_purchase_invoices_missing_v1", {
        p_since: startedAt,
        p_seen: records.length,
      });
      if (missingError) throw new Error(`mark_base44_purchase_invoices_missing_v1 error: ${missingError.message}`);
      result.missing = Number(missing || 0);
    }
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
