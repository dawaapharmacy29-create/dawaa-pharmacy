#!/usr/bin/env node
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/20260824004500_harden_payroll_permission_contract_v1.sql';
const alignmentPath = 'supabase/migrations/20260824004600_align_payroll_permission_contract_v2.sql';
const freezePath = 'supabase/migrations/20260830210000_payroll_freeze_command_v14.sql';
const lockdownPath = 'supabase/migrations/20260830211000_payroll_table_surface_lockdown_v14.sql';
const permissionPath = 'src/lib/core/permissionSystem.ts';
const payrollPagePath = 'src/pages/PayrollManagement.tsx';
const failures = [];

if (!fs.existsSync(migrationPath)) {
  failures.push(`Missing payroll hardening migration: ${migrationPath}`);
} else {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const required = [
    'view_salary_calculator',
    'manage_payroll',
    'dawaa_can_manage_payroll_staff_v1',
    'staff_payroll_profiles_v13',
    'staff_payroll_monthly_v13',
    'staff_payroll_profiles_select_scoped',
    'staff_payroll_profiles_insert_scoped',
    'staff_payroll_profiles_update_scoped',
    'staff_payroll_monthly_select_scoped',
    'staff_payroll_monthly_insert_scoped',
    'staff_payroll_monthly_update_scoped',
  ];
  for (const token of required) if (!sql.includes(token)) failures.push(`Payroll migration missing ${token}`);
  if (!/v_actor_role\s+in\s*\([^)]*general_manager[^)]*executive_manager[^)]*branches_manager/i.test(sql)) failures.push('Payroll helper must preserve senior all-branch access.');
  if (!/v_actor_role\s*<>\s*'branch_manager'/i.test(sql) || !/v_target_branch\s*=\s*v_actor_branch/i.test(sql)) failures.push('Payroll helper must branch-scope branch managers.');
  if (/CREATE\s+POLICY[\s\S]{0,300}\bFOR\s+DELETE\b/i.test(sql)) failures.push('Payroll client DELETE policy must not be introduced.');
  if (/USING\s*\(\s*true\s*\)|WITH\s+CHECK\s*\(\s*true\s*\)/i.test(sql)) failures.push('Payroll RLS must never use unconditional true policies.');
}

if (!fs.existsSync(alignmentPath)) {
  failures.push(`Missing canonical payroll alignment migration: ${alignmentPath}`);
} else {
  const alignmentSql = fs.readFileSync(alignmentPath, 'utf8');
  if (!alignmentSql.includes("v_effective := v_effective - 'manage_salary_calculator'")) failures.push('Payroll alignment must remove the non-canonical manage_salary_calculator key.');
  for (const key of ['view_salary_calculator', 'manage_payroll']) if (!alignmentSql.includes(key)) failures.push(`Payroll alignment missing ${key}`);
}

if (!fs.existsSync(freezePath)) {
  failures.push(`Missing payroll freeze migration: ${freezePath}`);
} else {
  const freezeSql = fs.readFileSync(freezePath, 'utf8').toLowerCase();
  for (const token of ['save_staff_payroll_monthly_v14','approval_snapshot','freeze_version','approved_at','paid_at','approved_payroll_is_frozen','paid_payroll_is_immutable','payroll_must_be_approved_before_paid']) {
    if (!freezeSql.includes(token)) failures.push(`Payroll freeze migration missing ${token}`);
  }
  if (!freezeSql.includes("v_status='paid'")) failures.push('Payroll freeze command must explicitly gate the paid transition.');
  if (!freezeSql.includes("v_status='approved'")) failures.push('Payroll freeze command must explicitly freeze approval.');
}

if (!fs.existsSync(lockdownPath)) {
  failures.push(`Missing payroll table lockdown migration: ${lockdownPath}`);
} else {
  const lockdownSql = fs.readFileSync(lockdownPath, 'utf8').toLowerCase().replace(/\s+/g, ' ');
  if (!lockdownSql.includes('revoke all privileges on table public.staff_payroll_monthly_v13 from anon,authenticated')) failures.push('Payroll browser roles must lose all direct table privileges before SELECT is restored.');
  if (!lockdownSql.includes('grant select on table public.staff_payroll_monthly_v13 to anon,authenticated')) failures.push('Payroll browser roles must retain scoped SELECT access.');
}

const permissionSource = fs.readFileSync(permissionPath, 'utf8');
for (const key of ['view_salary_calculator', 'manage_payroll']) if (!permissionSource.includes(key)) failures.push(`Canonical permission system missing ${key}`);
if (permissionSource.includes('manage_salary_calculator')) failures.push('Non-canonical manage_salary_calculator must not be added to permissionSystem.ts.');
if (!/['"]\/staff-payroll['"]\s*:\s*['"]manage_payroll['"]/.test(permissionSource)) failures.push('staff-payroll route must remain guarded by manage_payroll.');

const payrollPage = fs.readFileSync(payrollPagePath, 'utf8');
for (const table of ['staff_payroll_profiles_v13', 'staff_payroll_monthly_v13']) if (!payrollPage.includes(table)) failures.push(`Payroll page no longer references expected table ${table}`);
if (!payrollPage.includes("supabase.rpc('save_staff_payroll_monthly_v14'")) failures.push('Payroll page must save monthly rows through save_staff_payroll_monthly_v14.');
if (/from\(['"]staff_payroll_monthly_v13['"]\)\.upsert/.test(payrollPage)) failures.push('Payroll page must not reintroduce direct monthly payroll upserts.');
if (!payrollPage.includes('monthlyFrozen') || !payrollPage.includes('monthlyPaid')) failures.push('Payroll page must visibly lock approved/paid rows.');

if (failures.length) {
  console.error('Payroll architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('[payroll-architecture] PASS: canonical payroll permissions, branch scope, command-only monthly writes, approval snapshots, paid-row immutability, and read-only browser table grants are enforced.');
