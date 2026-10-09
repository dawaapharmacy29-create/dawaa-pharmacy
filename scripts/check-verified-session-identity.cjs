#!/usr/bin/env node
// Guards the verified staff session identity contract (migration 20261009081000):
// the database must identify callers only from the opaque `x-dawaa-session-token`, never from the
// client-chosen `x-dawaa-user-id` header, and client-supplied p_actor_id values must stay bound.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const failures = [];
const HARDENING = '20261009081000_verified_staff_session_identity_v1.sql';
const migrationsDir = path.join(ROOT, 'supabase/migrations');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, '');

const migrations = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
if (!migrations.includes(HARDENING)) {
  failures.push(`missing ${HARDENING}`);
} else {
  const hardening = stripSqlComments(read(`supabase/migrations/${HARDENING}`));
  for (const required of [
    'create or replace function public.dawaa_session_account_id_v1()',
    "->> 'x-dawaa-session-token'",
    'create or replace function public.dawaa_request_staff_identifier()',
    'create or replace function public.dawaa_bind_actor_v1(p_actor uuid)',
    'create or replace function public.dawaa_bind_actor_v1(p_actor text)',
    'public.dawaa_identity_hardening_snapshot_v1',
    "raise exception 'identity hardening: functions still read x-dawaa-user-id",
  ]) {
    if (!hardening.includes(required)) failures.push(`${HARDENING} lost required clause: ${required}`);
  }
  // Every later migration must not re-introduce trust in the client-chosen identity header.
  for (const name of migrations.filter((n) => n > HARDENING)) {
    const sql = stripSqlComments(read(`supabase/migrations/${name}`));
    if (/x-dawaa-user-id/i.test(sql)) {
      failures.push(`${name} reads x-dawaa-user-id; derive identity from public.dawaa_current_staff_account_id_strict()`);
    }
    if (/set_config\(\s*'request\.headers'/i.test(sql) && !/x-dawaa-session-token/i.test(sql)) {
      failures.push(`${name} rewrites request.headers without carrying a verified x-dawaa-session-token`);
    }
  }
}

// Machine callers must not need a forged staff identity once the header stops being trusted.
const BASE44 = '20261009080000_base44_purchase_sync_service_actor_v1.sql';
if (!migrations.includes(BASE44) || BASE44 > HARDENING) {
  failures.push(`${BASE44} must exist and sort before ${HARDENING} (Base44 sync service path)`);
}
const functionsDir = path.join(ROOT, 'supabase/functions');
if (fs.existsSync(functionsDir)) {
  for (const name of fs.readdirSync(functionsDir)) {
    const entry = path.join(functionsDir, name, 'index.ts');
    if (!fs.existsSync(entry)) continue;
    const code = fs.readFileSync(entry, 'utf8').replace(/\/\/[^\n]*/g, '');
    if (/['"]x-dawaa-user-id['"]/i.test(code)) {
      failures.push(`supabase/functions/${name} sends or reads x-dawaa-user-id; use service_role or a verified session token`);
    }
  }
}

for (const rel of [
  'supabase/sql/TEST_20261008_verified_staff_session_identity_v1.sql',
  'supabase/sql/ROLLBACK_20261008_verified_staff_session_identity_v1.sql',
]) {
  if (!fs.existsSync(path.join(ROOT, rel))) failures.push(`missing ${rel}`);
}

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

// No other client code may attach identity headers.
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
for (const file of walk(path.join(ROOT, 'src'))) {
  const rel = path.relative(ROOT, file);
  if (rel === path.join('src', 'lib', 'supabase.ts')) continue;
  if (/x-dawaa-(user-id|session-token)/.test(fs.readFileSync(file, 'utf8'))) {
    failures.push(`${rel} sets identity headers directly; use the shared supabase client`);
  }
}

if (failures.length) {
  console.error('Verified session identity check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Verified session identity check passed.');
