// GENERATED from server/attendance-inline-command.ts; run node scripts/build-attendance-inline-api.cjs

// server/attendance-inline-command.ts
import { createClient } from "@supabase/supabase-js";

// src/lib/deployEnvironmentGuard.ts
var PRODUCTION_SUPABASE_PROJECT_REF = "jkjqeqkshllustwlzzbf";
var DELIVERY_SUPABASE_PROJECT_REF = "qlugjplnnkjzxcbhwopg";
var FORBIDDEN_OUTSIDE_PRODUCTION = {
  [PRODUCTION_SUPABASE_PROJECT_REF]: "the production project",
  [DELIVERY_SUPABASE_PROJECT_REF]: "the delivery project (dawaa-delivery-os)"
};
var CLIENT_PREFIXES = ["VITE_", "NEXT_PUBLIC_"];
var URL_VARS = ["VITE_SUPABASE_URL", "SUPABASE_URL"];
var KEY_VARS = ["VITE_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
function supabaseProjectRefFromUrl(value) {
  const match = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/i.exec(String(value || "").trim());
  return match ? match[1].toLowerCase() : null;
}
function isLoopbackUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}
function jwtPayload(value) {
  const parts = String(value || "").trim().split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}
function supabaseProjectRefFromKey(value) {
  const ref = jwtPayload(value)?.ref;
  return typeof ref === "string" ? ref.toLowerCase() : null;
}
function clientExposedSecrets(env) {
  return Object.keys(env).filter((name) => CLIENT_PREFIXES.some((prefix) => name.startsWith(prefix)) && env[name]).filter((name) => {
    const value = String(env[name]).trim();
    return /SERVICE_ROLE|SECRET/i.test(name) || value.startsWith("sb_secret_") || jwtPayload(value)?.role === "service_role";
  }).sort();
}
function environmentOf(env) {
  const vercel = String(env.VERCEL_ENV || "").trim().toLowerCase();
  const declared = String(env.DAWAA_DEPLOY_ENV || "").trim().toLowerCase();
  if (vercel === "development" && declared === "local")
    return { environment: "local", enforced: true };
  if (vercel === "production" || vercel === "preview" || vercel === "development")
    return { environment: vercel, enforced: true };
  if (declared === "production" || declared === "preview" || declared === "development" || declared === "local") {
    return { environment: declared, enforced: true };
  }
  return { environment: "local", enforced: false };
}
function evaluateDeployEnvironment(env) {
  const { environment, enforced } = environmentOf(env);
  const errors = [];
  const warnings = [];
  const projectRefs = {};
  for (const name of URL_VARS)
    if (env[name]) projectRefs[name] = supabaseProjectRefFromUrl(env[name]);
  for (const name of KEY_VARS)
    if (env[name]) projectRefs[name] = supabaseProjectRefFromKey(env[name]);
  const production = PRODUCTION_SUPABASE_PROJECT_REF;
  const pointsAtProduction = Object.entries(projectRefs).filter(([, ref]) => ref === production).map(([name]) => name);
  for (const name of URL_VARS) {
    if (env[name] && String(env[name]).includes(production) && !pointsAtProduction.includes(name))
      pointsAtProduction.push(name);
  }
  for (const name of clientExposedSecrets(env))
    errors.push(`${name} is readable by the browser bundle and holds a service-role or secret key`);
  if (environment === "production") {
    if (!env.VITE_SUPABASE_URL) warnings.push("VITE_SUPABASE_URL is not set for production");
    for (const [name, ref] of Object.entries(projectRefs)) {
      if (ref && ref !== production)
        warnings.push(`${name} points to project ${ref}, not the production project`);
    }
  } else if (environment === "preview" || environment === "development") {
    const approvedSha = String(env.DAWAA_APPROVED_PRODUCTION_PREVIEW_SHA || "").trim();
    const productionReview = environment === "preview" && /^[a-f0-9]{40}$/.test(approvedSha) && approvedSha === env.VERCEL_GIT_COMMIT_SHA;
    const expected = String(productionReview ? production : env.DAWAA_STAGING_SUPABASE_REF || "").trim().toLowerCase();
    if (!env.VITE_SUPABASE_URL)
      errors.push("VITE_SUPABASE_URL is missing: a preview must use the staging Supabase project");
    if (!env.VITE_SUPABASE_ANON_KEY)
      errors.push(
        "VITE_SUPABASE_ANON_KEY is missing: a preview must use the staging Supabase project"
      );
    if (!expected)
      errors.push(
        "DAWAA_STAGING_SUPABASE_REF is missing: declare the staging project ref this preview must use"
      );
    if (productionReview) warnings.push(`Explicitly approved Preview ${approvedSha} uses Production data; normal application authorization remains required`);
    if (!productionReview && FORBIDDEN_OUTSIDE_PRODUCTION[expected])
      errors.push(`DAWAA_STAGING_SUPABASE_REF is ${FORBIDDEN_OUTSIDE_PRODUCTION[expected]}`);
    if (!productionReview)
      for (const name of pointsAtProduction) errors.push(`${name} points to the production project`);
    for (const [name, ref] of Object.entries(projectRefs)) {
      if (ref === DELIVERY_SUPABASE_PROJECT_REF)
        errors.push(`${name} points to the delivery project`);
    }
    for (const name of URL_VARS) {
      if (env[name] && String(env[name]).includes(DELIVERY_SUPABASE_PROJECT_REF) && projectRefs[name] !== DELIVERY_SUPABASE_PROJECT_REF)
        errors.push(`${name} points to the delivery project`);
    }
    for (const name of URL_VARS) {
      if (!env[name]) continue;
      const ref = projectRefs[name];
      if (!ref) errors.push(`${name} is not a https://<ref>.supabase.co project URL`);
      else if (expected && ref !== expected)
        errors.push(`${name} points to project ${ref}, expected staging ${expected}`);
    }
    for (const name of KEY_VARS) {
      const ref = projectRefs[name];
      if (ref && expected && ref !== expected)
        errors.push(`${name} belongs to project ${ref}, expected staging ${expected}`);
    }
  } else if (enforced) {
    for (const [name, ref] of Object.entries(projectRefs)) {
      if (ref === DELIVERY_SUPABASE_PROJECT_REF)
        errors.push(`${name} points to the delivery project`);
    }
    for (const name of pointsAtProduction)
      errors.push(
        `${name} points to the production project; local must use a local or test database`
      );
    for (const name of URL_VARS) {
      if (env[name] && !isLoopbackUrl(env[name]))
        errors.push(`${name} must be a loopback URL when DAWAA_DEPLOY_ENV=local`);
    }
  } else if (pointsAtProduction.length) {
    warnings.push(
      `local run points to the production project (${pointsAtProduction.join(", ")}); set DAWAA_DEPLOY_ENV=local to enforce isolation`
    );
  }
  return { environment, enforced, ok: errors.length === 0, errors, warnings, projectRefs };
}

// server/attendance-inline-command.ts
function createAttendanceInlineHandler(dependencies = {}) {
  return async function handler(req, res) {
    const reply = (status, body2) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.status(status).end(JSON.stringify(body2));
    };
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return reply(405, { error: "method_not_allowed" });
    }
    const token = /^Bearer ([^\s]{32,512})$/.exec(String(req.headers.authorization || ""))?.[1];
    if (!token) return reply(401, { error: "invalid_or_expired_staff_session" });
    let body;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      return reply(400, { error: "invalid_json_body" });
    }
    if (!body || Array.isArray(body) || typeof body !== "object" || JSON.stringify(body).length > 8192 || !["shift", "permission", "approve", "punch"].includes(body.action) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.staffId || "") || !/^\d{4}-\d{2}-\d{2}$/.test(body.date || "") || !body.payload || Array.isArray(body.payload) || typeof body.payload !== "object") {
      return reply(400, { error: "attendance_inline_invalid_command" });
    }
    const env = dependencies.env || process.env;
    const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    if (!evaluateDeployEnvironment(env).ok || !url || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return reply(503, { error: "attendance_transport_not_configured" });
    }
    try {
      const client = (dependencies.clientFactory || createClient)(url, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { "x-dawaa-session-token": token } }
      });
      const { data, error } = await client.rpc("attendance_inline_command_v1", {
        p_action: body.action,
        p_staff_id: body.staffId,
        p_date: body.date,
        p_payload: body.payload
      }).abortSignal(AbortSignal.timeout(2e4));
      if (error) {
        const sessionInvalid = error.message === "invalid_or_expired_staff_session";
        const status = sessionInvalid ? 401 : error.code === "42501" ? 403 : ["23505", "55000"].includes(error.code) ? 409 : ["22023", "22007", "22008"].includes(error.code) ? 400 : 503;
        const safeMessage = /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : "attendance_inline_command_failed";
        return reply(status, { error: safeMessage });
      }
      if (!data || typeof data !== "object") return reply(502, { error: "attendance_inline_empty_response" });
      return reply(200, { data });
    } catch {
      return reply(503, { error: "attendance_inline_transport_unavailable" });
    }
  };
}
var attendance_inline_command_default = createAttendanceInlineHandler();
export {
  createAttendanceInlineHandler,
  attendance_inline_command_default as default
};
