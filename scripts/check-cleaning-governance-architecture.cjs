#!/usr/bin/env node
const fs = require('node:fs');

const schemaPath = 'supabase/migrations/20260830212000_cleaning_historical_governance_snapshot_v3.sql';
const runtimePath = 'supabase/migrations/20260830213000_cleaning_snapshot_sync_and_history_lock_v3.sql';
const failures = [];

if (!fs.existsSync(schemaPath)) {
  failures.push(`Missing cleaning snapshot schema migration: ${schemaPath}`);
} else {
  const sql = fs.readFileSync(schemaPath, 'utf8').toLowerCase().replace(/\s+/g, ' ');
  for (const token of [
    'cleaning_daily_governance_snapshots',
    'governance_version',
    'required_items',
    'reviewed_items',
    'max_stars',
    'checklist_snapshot',
    'governance_snapshot_id',
    'required_items_snapshot',
    'max_stars_snapshot',
    'enable row level security',
    'revoke all privileges on table public.cleaning_daily_governance_snapshots from anon,authenticated',
  ]) {
    if (!sql.includes(token)) failures.push(`Cleaning snapshot schema missing ${token}`);
  }
}

if (!fs.existsSync(runtimePath)) {
  failures.push(`Missing cleaning snapshot runtime migration: ${runtimePath}`);
} else {
  const raw = fs.readFileSync(runtimePath, 'utf8');
  const sql = raw.toLowerCase();
  for (const token of [
    'sync_cleaning_day_governance_snapshot_v3',
    'cleaning_day_already_rated',
    'governance_snapshot_id',
    'clean-daily-star-v3',
    'get_cleaning_cycle_rating_summary_v1',
    'get_cleaning_cycle_manager_summary_v1',
  ]) {
    if (!sql.includes(token)) failures.push(`Cleaning snapshot runtime missing ${token}`);
  }

  const submitFn = raw.match(/create or replace function public\.submit_my_staff_daily_checklist_v1[\s\S]*?\$function\$;/i)?.[0] || '';
  const reviewFn = raw.match(/create or replace function public\.review_staff_daily_checklist_v1[\s\S]*?\$function\$;/i)?.[0] || '';
  const ratingFn = raw.match(/create or replace function public\.rate_cleaning_staff_day_v1[\s\S]*?\$function\$;/i)?.[0] || '';
  const cycleFn = raw.match(/create or replace function public\.get_cleaning_cycle_rating_summary_v1[\s\S]*?\$function\$;/i)?.[0] || '';
  const managerFn = raw.match(/create or replace function public\.get_cleaning_cycle_manager_summary_v1[\s\S]*?\$function\$;/i)?.[0] || '';

  if (!submitFn.includes('cleaning_day_already_rated') || !submitFn.includes('sync_cleaning_day_governance_snapshot_v3')) {
    failures.push('Cleaning submission must sync the day snapshot and lock resubmission after rating.');
  }
  if (!reviewFn.includes('cleaning_day_already_rated') || !reviewFn.includes('sync_cleaning_day_governance_snapshot_v3')) {
    failures.push('Cleaning review must sync the day snapshot and lock review changes after rating.');
  }
  if (!ratingFn.includes('governance_snapshot_id') || !ratingFn.includes('CLEAN-DAILY-STAR-V3')) {
    failures.push('Cleaning rating must persist the governance snapshot identity and V3 rule metadata.');
  }
  for (const [name, fn] of [['cycle rating summary', cycleFn], ['manager cycle summary', managerFn]]) {
    if (!fn.includes('cleaning_daily_governance_snapshots')) failures.push(`${name} must read durable governance snapshots.`);
    if (fn.includes('staff_daily_checklist_items')) failures.push(`${name} must not reinterpret history using the current active checklist configuration.`);
  }
  if (!/revoke all on function public\.sync_cleaning_day_governance_snapshot_v3\(uuid,date\) from public,anon,authenticated/i.test(raw)) {
    failures.push('Internal cleaning snapshot sync function must not be browser-executable.');
  }
}

if (failures.length) {
  console.error('Cleaning governance architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('[cleaning-governance] PASS: daily cleaning history is snapshot-based, rated days are immutable, and cycle summaries cannot drift with future task configuration changes.');
