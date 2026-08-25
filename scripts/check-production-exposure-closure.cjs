#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const migrationPath = path.join(root, 'supabase/migrations/20260825095017_close_production_exposure_and_checklist_commands_v1.sql');
const failures = [];
if (!fs.existsSync(migrationPath)) failures.push('Missing production exposure closure migration.');
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

for (const table of [
  'sales_invoices_cycle_backup_20260825_final',
  'sales_invoices_reconcile_stage_20260825_final',
  'app_refresh_flags',
  'doctor_voucher_allocations',
  'pillar_competition_bonuses',
  'staff_daily_checklist_items',
  'staff_daily_checklist_submissions',
]) {
  if (!migration.includes(`'${table}'`)) failures.push(`Missing protected table: ${table}`);
}

for (const fragment of [
  "alter table public.%I enable row level security",
  "revoke all on table public.%I from public, anon, authenticated",
  'doctor_id = public.dawaa_current_staff_subject_uuid_v1()',
  'where id=p_voucher_id and doctor_id=v_subject_id for update',
  'review_staff_daily_checklist_v1',
  'submit_my_staff_daily_checklist_v1',
  'revoke all on function public.refresh_pillar_competitions',
  'revoke all on function public.settle_checklist_review',
]) {
  if (!migration.includes(fragment)) failures.push(`Missing security contract: ${fragment}`);
}

function walk(dir) {
  return fs.readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return fs.statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const directChecklistWriters = [];
for (const file of walk(path.join(root, 'src'))) {
  const source = fs.readFileSync(file, 'utf8');
  if (/\.from\(['"]staff_daily_checklist_submissions['"]\)\s*\.(?:insert|upsert|update|delete)\s*\(/s.test(source)) {
    directChecklistWriters.push(path.relative(root, file).replace(/\\/g, '/'));
  }
}
if (directChecklistWriters.length) failures.push(`Direct checklist writer(s): ${directChecklistWriters.join(', ')}`);

if (failures.length) {
  console.error('[production-exposure-closure] FAIL');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('[production-exposure-closure] PASS: exposed tables are RLS-locked, internal definer entry points are revoked, voucher ownership is canonical, and checklist writes are command-only.');
