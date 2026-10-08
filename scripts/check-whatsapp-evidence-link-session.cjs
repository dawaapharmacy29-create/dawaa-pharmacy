#!/usr/bin/env node
// Evidence V17 journey/story link must authenticate the Dawaa staff session, never auth.uid() or the
// client-controlled x-dawaa-user-id header.
// Phase A cutover: the session command is added, every app caller uses it, and the legacy
// dawaa_link_whatsapp_evidence_journey_v17 RPC stays untouched for the current Production bundle.
// Its revoke/drop belongs to a separate, later Phase B migration.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const failures = [];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const MIGRATION =
  'supabase/migrations/20261008104059_whatsapp_evidence_journey_link_staff_session_v1.sql';
const COMMAND = 'dawaa_link_whatsapp_evidence_journey_session_v1';

const sql = read(MIGRATION);
const fnStart = sql.indexOf(`create or replace function public.${COMMAND}(`);
const header = sql.slice(fnStart, sql.indexOf('as $function$', fnStart));
const body = sql.slice(sql.indexOf('as $function$', fnStart), sql.indexOf('$function$;', fnStart));
if (fnStart < 0) failures.push(`${MIGRATION}: ${COMMAND} not defined.`);
if (!/security definer/i.test(header)) failures.push(`${MIGRATION}: missing SECURITY DEFINER.`);
if (!/set search_path to 'public','extensions','pg_catalog'/.test(header))
  failures.push(`${MIGRATION}: missing pinned search_path.`);
const required = [
  [/staff_session_required/, 'non-empty token check'],
  [/extensions\.digest\(btrim\(p_session_token\),'sha256'\)/, 'sha256 token hash'],
  [/s\.revoked_at is null/, 'revoked_at IS NULL'],
  [/s\.expires_at>now\(\)/, 'expires_at > now()'],
  [/a\.active is true/, 'fail-closed active check'],
  [/a\.is_active is true/, 'fail-closed is_active check'],
  [/a\.can_login is true/, 'fail-closed can_login check'],
  [/lower\(btrim\(coalesce\(a\.status,''\)\)\)='active'/, 'fail-closed status check'],
  [/get_user_permissions\(v_account\.id\)/, 'permission resolved for the session account'],
  [/whatsapp_customer_journey_sessions/, 'journey membership check'],
  [/story_journey_mismatch/, 'story/journey binding'],
  [
    /dawaa_can_read_conversation_review_row_v2\(v_account\.id,/,
    'source/branch scope for the session account',
  ],
  [/is distinct from p_journey_id/, 'idempotent in-place update'],
];
for (const [re, label] of required)
  if (!re.test(body)) failures.push(`${MIGRATION}: missing ${label}.`);
for (const [re, label] of [
  [/auth\.uid\(\)/, 'auth.uid()'],
  [/x-dawaa-user-id|request\.headers/, 'request header identity'],
  [
    /dawaa_current_actor_can|dawaa_current_staff_account_id_strict|dawaa_current_actor_id/,
    'header-resolved actor helpers',
  ],
  [/\binsert\s+into\b|\bdelete\s+from\b/i, 'row creation/deletion'],
  [
    /coalesce\(a\.(active|is_active|can_login),\s*true\)|coalesce\(a\.status,\s*'active'\)/i,
    'fail-open account-state defaults',
  ],
])
  if (re.test(body)) failures.push(`${MIGRATION}: command must not use ${label}.`);
if (
  !new RegExp(
    `revoke all on function public\\.${COMMAND}\\(text,uuid,uuid,uuid\\[\\]\\)\\s+from public, anon, authenticated, service_role;`
  ).test(sql)
) {
  failures.push(
    `${MIGRATION}: must revoke EXECUTE from public, anon, authenticated, service_role.`
  );
}
if (
  !new RegExp(
    `grant execute on function public\\.${COMMAND}\\(text,uuid,uuid,uuid\\[\\]\\)\\s+to anon, authenticated;`
  ).test(sql)
) {
  failures.push(`${MIGRATION}: must grant EXECUTE only to anon, authenticated.`);
}
// Phase A must not touch the legacy RPC at all: outside comments, the migration may not name it.
const sqlWithoutComments = sql.replace(/--[^\n]*/g, '');
if (/dawaa_link_whatsapp_evidence_journey_v17/i.test(sqlWithoutComments)) {
  failures.push(
    `${MIGRATION}: Phase A must not alter, replace, revoke or drop dawaa_link_whatsapp_evidence_journey_v17 (Production still calls it).`
  );
}

// No later migration may create/replace the legacy RPC (Phase B may only revoke/drop it).
for (const name of fs.readdirSync(path.join(ROOT, 'supabase/migrations'))) {
  if (name <= path.basename(MIGRATION)) continue;
  if (
    /create\s+(or\s+replace\s+)?function\s+public\.dawaa_link_whatsapp_evidence_journey_v17\b/i.test(
      read(`supabase/migrations/${name}`)
    )
  ) {
    failures.push(
      `${name}: must not create or replace the legacy dawaa_link_whatsapp_evidence_journey_v17.`
    );
  }
}

// Browser side: one caller, through the staff-session utility.
const link = read('src/lib/whatsappEvidenceJourneyLinkV17.ts');
if (!link.includes("import { getStaffSessionToken } from '@/lib/auth/staffSession';"))
  failures.push('Evidence link must read the token via getStaffSessionToken.');
if (!link.includes('p_session_token: token'))
  failures.push('Evidence link must pass p_session_token.');
const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
for (const file of walk(path.join(ROOT, 'src'))) {
  if (!/\.(ts|tsx)$/.test(file) || file.includes('__tests__')) continue;
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  if (text.includes('dawaa_link_whatsapp_evidence_journey_v17'))
    failures.push(`${rel}: must not call the legacy V17 RPC; use whatsappEvidenceJourneyLinkV17.`);
  if (text.includes(COMMAND) && rel !== 'src/lib/whatsappEvidenceJourneyLinkV17.ts')
    failures.push(`${rel}: call ${COMMAND} only through whatsappEvidenceJourneyLinkV17.`);
}

if (failures.length) {
  console.error('WhatsApp Evidence link session gate failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('WhatsApp Evidence link session gate passed.');
