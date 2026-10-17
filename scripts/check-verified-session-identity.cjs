#!/usr/bin/env node
// Guards the verified staff session identity contract.
//
// The database must identify callers only from the opaque `x-dawaa-session-token` (verified against
// staff_login_sessions), never from the client-chosen `x-dawaa-user-id` header, and a client-supplied
// p_actor_id must never authorize a caller unless it is bound to the verified session.
//
// Why this is effective-definition based: an earlier version of this check only verified that one hardening
// migration FILE contained the right clauses and that later files did not mention the header. It passed while
// Production still trusted the header (the hardening migration was never applied and older policy/function
// definitions stayed live). This version reasons about the LAST definition of every object across all
// migrations, plus the in-place neutralization manifests of the 20261017 security migrations. The live catalog
// is checked separately by supabase/tests/identity_contract_live_v1.sql (run against any database).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const failures = [];
const migrationsDir = path.join(ROOT, 'supabase/migrations');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, '');
const migrations = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();

// ---------------------------------------------------------------------------------------------------
// 1. The security migrations that remove header trust and bind p_actor_id must exist and keep their guards.
// ---------------------------------------------------------------------------------------------------
const READERS = '20261017090000_security_verified_identity_readers_v1.sql';
const POLICIES = '20261017090100_security_identity_rls_policies_v1.sql';
const BINDINGS = [
  '20261017090200_security_actor_binding_shared_gatekeepers_v1.sql',
  '20261017090300_security_actor_binding_customer_service_v1.sql',
  '20261017090400_security_actor_binding_hr_weekly_evaluations_v1.sql',
  '20261017090500_security_actor_binding_sales_targets_v1.sql',
];
const REVOKES = '20261017090600_security_revoke_client_internal_actor_writers_v1.sql';
const SECURITY_SET = new Set([READERS, POLICIES, ...BINDINGS, REVOKES]);
const CUTOFF = REVOKES; // migrations sorted after this must satisfy the forward rules below

const requireClauses = (file, clauses) => {
  if (!migrations.includes(file)) return failures.push(`missing ${file}`);
  const sql = stripSqlComments(read(`supabase/migrations/${file}`));
  for (const clause of clauses) {
    if (!sql.includes(clause)) failures.push(`${file} lost required clause: ${clause}`);
  }
};
requireClauses(READERS, [
  'create or replace function public.dawaa_request_context_is_client_v1()',
  'create or replace function public.dawaa_bind_actor_v1(p_actor uuid)',
  'create or replace function public.dawaa_bind_actor_v1(p_actor text)',
  'create or replace function public.dawaa_current_staff_id_v1()',
  'create or replace function public.dawaa_current_notification_account_id_v1()',
  'create or replace function public.dawaa_has_active_app_session()',
  "raise exception 'identity readers v1: functions still read x-dawaa-user-id: %'",
  'drifted from the reviewed Production body',
]);
requireClauses(POLICIES, [
  'dawaa_current_staff_account_id_strict()',
  "raise exception 'identity rls v1: policies still read request headers: %'",
  "raise exception 'identity rls v1: unexpected header-based policies %",
  'alter policy %I on public.%I',
]);
for (const file of BINDINGS) {
  requireClauses(file, [
    'pg_temp.dawaa_bind_actor_in_place',
    'public.dawaa_bind_actor_v1(p_actor_id)',
    'drifted from the reviewed Production body',
    "must be applied first",
  ]);
}
requireClauses(REVOKES, [
  'revoke all on function %s from public, anon, authenticated',
  "raise exception 'revoke internal writers: still client-executable: %'",
  'is called by SECURITY INVOKER',
]);

// Neutralization manifests: objects the security migrations rewrite IN PLACE (so their last textual
// definition in an older migration is superseded).
const readSecurity = (file) => (migrations.includes(file) ? read(`supabase/migrations/${file}`) : '');
const neutralizedPolicies = new Set(
  [...readSecurity(POLICIES).matchAll(/'(\w+)\.(\w+)'/g)].map((m) => `${m[1]}.${m[2]}`)
);
const boundFunctions = new Set(
  BINDINGS.flatMap((file) => [...readSecurity(file).matchAll(/\('public\.(\w+)\(/g)].map((m) => m[1]))
);
const revokedFunctions = new Set([...readSecurity(REVOKES).matchAll(/\('public\.(\w+)\(/g)].map((m) => m[1]));

// ---------------------------------------------------------------------------------------------------
// 2. Effective definitions: the LAST definition of every function and policy must not trust the header.
// ---------------------------------------------------------------------------------------------------
const lastFunction = new Map(); // name -> { file, body }
const lastPolicy = new Map(); // table.policy -> { file, text }
const fnRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*returns[\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\3/gi;
const policyRe = /(create|alter)\s+policy\s+"?(\w+)"?\s+on\s+(?:public\.)?"?(\w+)"?([\s\S]*?);/gi;
const dropPolicyRe = /drop\s+policy\s+(?:if\s+exists\s+)?"?(\w+)"?\s+on\s+(?:public\.)?"?(\w+)"?/gi;
const dropFunctionRe = /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(/gi;
for (const file of migrations) {
  const sql = stripSqlComments(read(`supabase/migrations/${file}`));
  // Statements are applied in file order: collect every definition and drop with its offset, then replay.
  const events = [
    ...[...sql.matchAll(fnRe)].map((m) => ({ at: m.index, apply: () => lastFunction.set(m[1], { file, args: m[2], body: m[4] }) })),
    ...[...sql.matchAll(dropFunctionRe)].map((m) => ({ at: m.index, apply: () => lastFunction.delete(m[1]) })),
    ...[...sql.matchAll(policyRe)].map((m) => ({ at: m.index, apply: () => lastPolicy.set(`${m[3]}.${m[2]}`, { file, text: m[4] }) })),
    ...[...sql.matchAll(dropPolicyRe)].map((m) => ({ at: m.index, apply: () => lastPolicy.delete(`${m[2]}.${m[1]}`) })),
  ].sort((a, b) => a.at - b.at);
  for (const event of events) event.apply();
}
for (const [name, def] of lastFunction) {
  if (SECURITY_SET.has(def.file)) continue;
  if (/x-dawaa-user-id/i.test(def.body)) {
    failures.push(`function ${name} (last defined in ${def.file}) reads x-dawaa-user-id; derive identity from public.dawaa_current_staff_account_id_strict()`);
  }
}
for (const [key, def] of lastPolicy) {
  if (!/x-dawaa-user-id|request\.headers/i.test(def.text)) continue;
  const neutralized = neutralizedPolicies.has(key) && def.file < POLICIES;
  if (!neutralized) {
    failures.push(`policy ${key} (last defined in ${def.file}) reads request headers and is not neutralized by ${POLICIES}`);
  }
}

// ---------------------------------------------------------------------------------------------------
// 3. Forward rules for every migration after the security cutoff.
// ---------------------------------------------------------------------------------------------------
const VERIFIED_ACTOR_RESOLVERS = [
  /public\.dawaa_bind_actor_v1\(\s*p_actor_id\s*\)/i,
  /monthly_eval_actor\(\s*p_actor_id\s*\)/i,
  /dawaa_current_followup_actor_v2\(\s*p_actor_id/i,
];
for (const file of migrations.filter((n) => n > CUTOFF)) {
  const raw = read(`supabase/migrations/${file}`);
  const sql = stripSqlComments(raw);
  if (/x-dawaa-user-id/i.test(sql)) {
    failures.push(`${file} reads x-dawaa-user-id; derive identity from public.dawaa_current_staff_account_id_strict()`);
  }
  if (/set_config\(\s*'request\.headers'/i.test(sql) && !/x-dawaa-session-token/i.test(sql)) {
    failures.push(`${file} rewrites request.headers without carrying a verified x-dawaa-session-token`);
  }
  if (/coalesce\(\s*p_actor_id\s*,/i.test(sql)) {
    failures.push(`${file} uses coalesce(p_actor_id, ...): a client-supplied actor would override the verified session`);
  }
  for (const m of sql.matchAll(fnRe)) {
    const [, name, args, , body] = m;
    const definer = /security\s+definer/i.test(sql.slice(m.index, m.index + m[0].length));
    const revokedFromClients = new RegExp(
      `revoke[^;]*on\\s+function\\s+(?:public\\.)?${name}\\b[^;]*from[^;]*\\b(public|anon)\\b`, 'i'
    ).test(sql);
    // Schema default privileges grant EXECUTE on every new function to anon/authenticated (that is how
    // 20260825233000's revokes were silently undone). A new SECURITY DEFINER function must state its grants.
    if (definer && !revokedFromClients) {
      failures.push(`${file}: SECURITY DEFINER function ${name} has no explicit "revoke ... from public/anon" (default privileges grant EXECUTE to anon)`);
    }
    if (/\bp_actor_id\b/i.test(args) && /\bp_actor_id\b/i.test(body)) {
      const verified = VERIFIED_ACTOR_RESOLVERS.some((re) => re.test(body));
      const serverOnly = new RegExp(
        `revoke[^;]*on\\s+function\\s+(?:public\\.)?${name}\\b[^;]*from[^;]*\\banon\\b[^;]*\\bauthenticated\\b|revoke[^;]*on\\s+function\\s+(?:public\\.)?${name}\\b[^;]*from[^;]*\\bauthenticated\\b[^;]*\\banon\\b`, 'i'
      ).test(sql) && !new RegExp(`grant\\s+execute\\s+on\\s+function\\s+(?:public\\.)?${name}\\b[^;]*\\bto\\b[^;]*\\b(anon|authenticated)\\b`, 'i').test(sql);
      if (!verified && !serverOnly) {
        failures.push(`${file}: function ${name} uses p_actor_id without binding it (public.dawaa_bind_actor_v1(p_actor_id)) or a verified resolver, and stays client-executable`);
      }
    }
  }
  // A later migration may not re-open what the security migrations closed.
  for (const name of revokedFunctions) {
    if (new RegExp(`grant\\s+execute\\s+on\\s+function\\s+(?:public\\.)?${name}\\b[^;]*\\bto\\b[^;]*\\b(anon|authenticated|public)\\b`, 'i').test(sql)) {
      failures.push(`${file} re-grants client EXECUTE on internal actor-trusting writer ${name}`);
    }
  }
  for (const name of boundFunctions) {
    const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${name}\\s*\\(([\\s\\S]*?)\\)\\s*returns[\\s\\S]*?\\bas\\s+(\\$\\w*\\$)([\\s\\S]*?)\\2`, 'gi');
    for (const m of sql.matchAll(re)) {
      if (/\bp_actor_id\b/.test(m[3]) && !/public\.dawaa_bind_actor_v1\(\s*p_actor_id\s*\)/i.test(m[3])) {
        failures.push(`${file} redefines bound function ${name} without public.dawaa_bind_actor_v1(p_actor_id)`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// 4. Live contract, rollback and test assets must stay in the repository.
// ---------------------------------------------------------------------------------------------------
for (const rel of [
  'supabase/tests/identity_contract_live_v1.sql',
  'supabase/sql/ROLLBACK_20261017_security_identity_hardening_v1.sql',
]) {
  if (!fs.existsSync(path.join(ROOT, rel))) failures.push(`missing ${rel}`);
}

// ---------------------------------------------------------------------------------------------------
// 5. Browser client: only the session token identifies the caller; p_actor_id is only the logged-in user.
// ---------------------------------------------------------------------------------------------------
const client = read('src/lib/supabase.ts');
if (!/headers\.set\('x-dawaa-session-token'/.test(client)) {
  failures.push('src/lib/supabase.ts must send the x-dawaa-session-token header on every request');
}
const session = read('src/lib/auth/staffSession.ts');
if (!/export async function verifyStoredStaffSession/.test(session)) {
  failures.push('src/lib/auth/staffSession.ts must expose verifyStoredStaffSession()');
}
const auth = read('src/hooks/useAuth.ts');
if (!/STAFF_SESSION_RENEW_INTERVAL_MS/.test(auth) || !/checkStaffSession\(\)/.test(auth)) {
  failures.push('src/hooks/useAuth.ts must renew the server session and sign out when it is rejected');
}

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
// Expressions a browser call may pass as p_actor_id: the logged-in account (or null). Anything else must be
// reviewed and added here deliberately; the database binds it anyway, but a new form usually means a new intent.
const ALLOWED_ACTOR_EXPRESSIONS = new Set([
  'user.id', 'user?.id', 'actorId', 'actorKey', 'args.actorId', 'null',
  'input.actorId || null', 'actorId || null', 'filters.actor_id || null',
  // Reviewed: save_quick_reply_script receives the draft's created_by (the original author when editing).
  // The database binds p_actor_id to the verified caller (20261017090300), so it authorizes the logged-in
  // editor; created_by stays attribution only (coalesce(created_by, p_actor_id) for new scripts).
  'script.created_by||null',
]);
for (const file of walk(path.join(ROOT, 'src'))) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const text = fs.readFileSync(file, 'utf8');
  if (/x-dawaa-user-id/i.test(text)) {
    failures.push(`${rel} references x-dawaa-user-id; the client must not send a caller-chosen identity`);
  }
  if (rel !== 'src/lib/supabase.ts' && /x-dawaa-session-token/.test(text)) {
    failures.push(`${rel} sets identity headers directly; use the shared supabase client`);
  }
  for (const m of text.matchAll(/\bp_actor_id\s*:\s*([^,}\n]+)/g)) {
    const expr = m[1].trim();
    if (!ALLOWED_ACTOR_EXPRESSIONS.has(expr)) {
      failures.push(`${rel} passes p_actor_id: ${expr}; only the logged-in user may be the actor`);
    }
  }
}

if (failures.length) {
  console.error('Verified session identity check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  `Verified session identity check passed (${lastFunction.size} functions, ${lastPolicy.size} policies, ` +
  `${neutralizedPolicies.size} neutralized policies, ${boundFunctions.size} bound functions, ${revokedFunctions.size} revoked writers).`
);
