#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const migrationPath = path.join(ROOT, 'supabase/migrations/20260823201000_employee_transactions_source_authorization_v1.sql');
const readMigrationPath = path.join(ROOT, 'supabase/migrations/20260823202000_harden_employee_transactions_reads_active_actor_v1.sql');
const tightenedSourcesPath = path.join(ROOT, 'supabase/migrations/20260823204000_tighten_employee_transaction_transitional_sources_v1.sql');
const failures = [];

if (!fs.existsSync(migrationPath)) {
  failures.push('Missing employee transaction source-authorization migration.');
} else {
  const source = fs.readFileSync(migrationPath, 'utf8');
  if (!source.includes('dawaa_can_write_employee_transaction')) failures.push('Missing canonical employee-transaction source authorization helper.');
  if (!source.includes('dawaa_current_staff_account_id_strict')) failures.push('Ledger source authorization must require a canonical active staff actor.');

  const requiredSources = [
    'conversation_evaluation',
    'branch_visit',
    'shift_review',
    'time_off',
    'manual_admin',
    'stagnant_medicine_dispense',
    'incentive_medicines',
  ];
  for (const item of requiredSources) {
    if (!source.includes(`'${item}'`)) failures.push(`Ledger source authorization must classify ${item}.`);
  }

  const requiredPermissions = [
    'add_reviews',
    'create_shift_evaluation',
    'approve_leave_request',
    'manage_time_off',
    'create_reward',
    'create_deduction',
    'approve_points',
    'edit_points_transaction',
    'view_stagnant_medicines',
    'view_incentive_medicines',
  ];
  for (const permission of requiredPermissions) {
    if (!source.includes(permission)) failures.push(`Ledger source authorization must reference ${permission}.`);
  }

  if (!/v_source\s*=\s*'branch_visit'[\s\S]{0,180}dawaa_can_branch_inspection\s*\(\s*true\s*\)/.test(source)) {
    failures.push('branch_visit ledger effects must delegate to canonical branch-inspection management authorization.');
  }
  if (!/return\s+false\s*;[\s\S]*end\s*;/i.test(source)) failures.push('Unknown ledger sources must fail closed.');
  if (!/employee_transactions_insert_source_authorized/.test(source) || !/employee_transactions_update_source_authorized/.test(source)) {
    failures.push('Employee transaction INSERT and UPDATE must use source-aware RLS policies.');
  }
  if (/with\s+check\s*\(\s*true\s*\)/i.test(source) || /using\s*\(\s*true\s*\)/i.test(source)) {
    failures.push('Source-aware ledger write policies must not be unconditional true.');
  }
}

if (!fs.existsSync(readMigrationPath)) {
  failures.push('Missing employee transaction read-hardening migration.');
} else {
  const source = fs.readFileSync(readMigrationPath, 'utf8');
  if (!/employee_transactions_select_active_actor/.test(source)) failures.push('Ledger SELECT must use the active-actor policy.');
  if (!/dawaa_current_staff_account_id_strict\(\)/.test(source)) failures.push('Ledger reads must require a canonical active staff actor.');
  if (/using\s*\(\s*true\s*\)/i.test(source)) failures.push('Ledger read policy must not be unconditional true.');
  if (!source.includes('Allow read employee transactions') || !source.includes('employee_transactions_select_app')) {
    failures.push('Ledger read hardening must explicitly remove both legacy public SELECT policies.');
  }
}

if (!fs.existsSync(tightenedSourcesPath)) {
  failures.push('Missing tightened employee transaction transitional-source migration.');
} else {
  const source = fs.readFileSync(tightenedSourcesPath, 'utf8');
  const remainingTransitional = [
    'followup_activity_pillar',
    'followup_expire_auto',
    'invoice_quality_vs_branch_baseline',
    'assistant_checklist_settlement',
    'target_achievement_settlement',
  ];
  for (const item of remainingTransitional) {
    if (!source.includes(`'${item}'`)) failures.push(`Tightened ledger migration must preserve active transitional source ${item}.`);
  }

  const removedSources = [
    'delivery',
    'delivery_deduction',
    'delivery_evaluation',
    'penalty_incentive',
    'penalty_management',
    'point_records_migration',
  ];
  for (const item of removedSources) {
    if (source.includes(`'${item}'`)) failures.push(`Obsolete ledger source ${item} must not remain allowlisted.`);
  }

  if (!/return\s+false\s*;[\s\S]*end\s*;/i.test(source)) failures.push('Tightened ledger migration must keep unknown sources fail-closed.');
}

if (failures.length) {
  console.error('\nEmployee transaction source authorization check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[employee-transaction-source-authorization] PASS: ledger writes are source-authorized, obsolete transitional sources cannot return, unknown sources fail closed, and reads require an active staff actor.');
