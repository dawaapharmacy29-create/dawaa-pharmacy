#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const migrationPath = path.join(ROOT, 'supabase/migrations/20260823201000_employee_transactions_source_authorization_v1.sql');
const readMigrationPath = path.join(ROOT, 'supabase/migrations/20260823202000_harden_employee_transactions_reads_active_actor_v1.sql');
const tightenedSourcesPath = path.join(ROOT, 'supabase/migrations/20260823204000_tighten_employee_transaction_transitional_sources_v1.sql');
const scopedReadPath = path.join(ROOT, 'supabase/migrations/20260823205000_scope_employee_transaction_reads_v1.sql');
const finalSourcesPath = path.join(ROOT, 'supabase/migrations/20260823206000_remove_employee_transaction_transitional_sources_v1.sql');
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
  if (!/employee_transactions_select_active_actor/.test(source)) failures.push('First-stage ledger SELECT hardening must create the active-actor policy.');
  if (!/dawaa_current_staff_account_id_strict\(\)/.test(source)) failures.push('First-stage ledger reads must require a canonical active staff actor.');
  if (/using\s*\(\s*true\s*\)/i.test(source)) failures.push('Ledger read policy must not be unconditional true.');
  if (!source.includes('Allow read employee transactions') || !source.includes('employee_transactions_select_app')) {
    failures.push('Ledger read hardening must explicitly remove both legacy public SELECT policies.');
  }
}

if (!fs.existsSync(tightenedSourcesPath)) {
  failures.push('Missing tightened employee transaction transitional-source migration.');
}

if (!fs.existsSync(scopedReadPath)) {
  failures.push('Missing row-scoped employee transaction read migration.');
} else {
  const source = fs.readFileSync(scopedReadPath, 'utf8');
  if (!source.includes('dawaa_can_read_employee_transaction')) failures.push('Ledger reads must use the canonical row-scope helper.');
  if (!source.includes("array['view_points']")) failures.push('Ledger row scope must require view_points.');
  for (const role of ['general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening','pharmacist']) {
    if (!source.includes(`'${role}'`)) failures.push(`Ledger row scope must classify ${role}.`);
  }
  if (!/v_role\s*=\s*'pharmacist'[\s\S]{0,260}p_staff_id::text\s*=\s*trim\(v_staff_id\)/.test(source)) {
    failures.push('Pharmacist ledger reads must be restricted to the canonical staff id.');
  }
  if (!/employee_transactions_select_scoped_actor/.test(source)) failures.push('Ledger SELECT must use the scoped-actor policy.');
  if (!/dawaa_can_read_employee_transaction\(staff_id,\s*branch\)/.test(source)) failures.push('Ledger SELECT policy must delegate row decisions to the scope helper.');
  if (/using\s*\(\s*true\s*\)/i.test(source)) failures.push('Scoped ledger read policy must not be unconditional true.');
}

if (!fs.existsSync(finalSourcesPath)) {
  failures.push('Missing final employee transaction source-lockdown migration.');
} else {
  const source = fs.readFileSync(finalSourcesPath, 'utf8');
  const classifiedSources = [
    'conversation_evaluation','conversation_review','conversation_sales_reviews',
    'branch_visit','shift_review','time_off','manual_admin','manual',
    'stagnant_medicine_dispense','incentive_medicines',
  ];
  for (const item of classifiedSources) {
    if (!source.includes(`'${item}'`)) failures.push(`Final ledger source lockdown must preserve classified source ${item}.`);
  }

  const forbiddenClientFallbacks = [
    'delivery','delivery_deduction','delivery_evaluation',
    'penalty_incentive','penalty_management','point_records_migration',
    'followup_activity_pillar','followup_expire_auto',
    'invoice_quality_vs_branch_baseline','assistant_checklist_settlement','target_achievement_settlement',
  ];
  for (const item of forbiddenClientFallbacks) {
    if (source.includes(`'${item}'`)) failures.push(`Final ledger source lockdown must not allow client source ${item}.`);
  }

  if (!source.includes('SECURITY DEFINER') || !source.includes('BYPASSRLS')) {
    failures.push('Final source-lockdown migration must document why automated settlements do not need client RLS exceptions.');
  }
  if (!/return\s+false\s*;[\s\S]*end\s*;/i.test(source)) failures.push('Final ledger source lockdown must fail closed.');
}

if (failures.length) {
  console.error('\nEmployee transaction source authorization check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[employee-transaction-source-authorization] PASS: ledger writes have no transitional client fallback, unknown sources fail closed, and reads are permission/role/branch/staff scoped.');
