// Management-side, strictly read-only catalog search for authenticated purchasing staff.
const PURCHASES_URL = "https://zqfsakrxazznkqnjlgzv.supabase.co";
const PURCHASES_PUBLISHABLE_KEY = "sb_publishable_tEd7T-2d_MRdSKnLCZDqzQ_hp7DvnE5";
const MGMT_URL = Deno.env.get("SUPABASE_URL")!;
const MGMT_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
function pattern(input: string) {
  const cleaned = input.trim().replace(/[%,.()\\]/g, " ").replace(/\s+/g, " ");
  return cleaned.replace(/[*\s]/g, "") ? (cleaned.includes("*") ? cleaned : `*${cleaned}*`) : null;
}
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return reply(405, { ok: false, error: "method_not_allowed" });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return reply(400, { ok: false, error: "invalid_json" }); }
  const session = typeof body.session_token === "string" ? body.session_token : "";
  const mode = body.mode;
  const query = typeof body.query === "string" ? body.query.trim() : "";
  const search = pattern(query);
  if (!session || session.length > 500 || !["customer", "product"].includes(mode as string) || query.length > 120 || query.replace(/\*/g, "").trim().length < 2 || !search) {
    return reply(400, { ok: false, error: "invalid_request" });
  }
  try {
    const auth = await fetch(`${PURCHASES_URL}/rest/v1/rpc/validate_staff_session`, {
      method: "POST", headers: { apikey: PURCHASES_PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_session_token: session }), signal: AbortSignal.timeout(4500),
    });
    if (!auth.ok) return reply(502, { ok: false, error: "session_check_unavailable" });
    const validation = await auth.json();
    if (!validation?.ok || !validation.account?.id) return reply(401, { ok: false, error: "invalid_session" });
    const url = new URL(mode === "customer" ? "/rest/v1/customers" : "/rest/v1/products", MGMT_URL);
    url.searchParams.set("select", mode === "customer" ? "customer_code,code,name,phone" : "product_code,name");
    url.searchParams.set("or", mode === "customer"
      ? `(customer_code.ilike.${search},code.ilike.${search},name.ilike.${search},phone.ilike.${search})`
      : `(name.ilike.${search},product_code.ilike.${search})`);
    url.searchParams.set("limit", "12");
    const dataResponse = await fetch(url, { headers: { apikey: MGMT_SERVICE_KEY, Authorization: `Bearer ${MGMT_SERVICE_KEY}` }, signal: AbortSignal.timeout(5000) });
    if (!dataResponse.ok) return reply(502, { ok: false, error: "management_lookup_unavailable" });
    const rows = await dataResponse.json();
    if (!Array.isArray(rows)) return reply(502, { ok: false, error: "invalid_management_response" });
    return reply(200, { ok: true, data: mode === "customer"
      ? rows.map(c => ({ customer_code: c.customer_code || c.code, customer_name: c.name, phone: c.phone || "" }))
      : rows.map(p => ({ product_code: p.product_code, product_name: p.name })) });
  } catch { return reply(502, { ok: false, error: "reference_lookup_unavailable" }); }
});