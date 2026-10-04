import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") || "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-dawaa-staff-session",
  "access-control-allow-methods": "POST,OPTIONS",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8" } });
const sha256 = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const token = (req.headers.get("x-dawaa-staff-session") || "").trim();
  if (token.length < 32 || token.length > 512) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const start = new Date(String(body.start_at || ""));
  const end = new Date(String(body.end_at || ""));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start ||
      end.getTime() - start.getTime() > 90 * 86_400_000) return json({ error: "invalid_window" }, 400);

  const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const tokenHash = await sha256(token);
  const { data: session, error: sessionError } = await db.from("staff_login_sessions")
    .select("staff_account_id,expires_at,revoked_at").eq("token_hash", tokenHash).is("revoked_at", null)
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (sessionError || !session) return json({ error: "unauthorized" }, 401);

  const { data: account, error: accountError } = await db.from("staff_accounts")
    .select("role,active,is_active,can_login,status").eq("id", session.staff_account_id).maybeSingle();
  const role = String(account?.role || "").trim().toLowerCase();
  const inactiveStatus = ["archived", "inactive", "disabled"].includes(String(account?.status || "").toLowerCase());
  if (accountError || !account || account.active !== true || account.can_login === false || account.is_active === false ||
      inactiveStatus || !["general_manager", "executive_manager", "branches_manager"].includes(role)) {
    return json({ error: "forbidden" }, 403);
  }

  const { data, error } = await db.rpc("sales_invoice_items_completeness_v1", {
    p_start_at: start.toISOString(), p_end_at: end.toISOString(),
  });
  if (error) return json({ error: "completeness_failed" }, 500);
  return json({ rows: data || [] });
});
