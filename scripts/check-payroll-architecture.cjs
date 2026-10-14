#!/usr/bin/env node
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/20260824004500_harden_payroll_permission_contract_v1.sql';
const alignmentPath = 'supabase/migrations/20260824004600_align_payroll_permission_contract_v2.sql';
const freezePath = 'supabase/migrations/20260830210000_payroll_freeze_command_v14.sql';
const lockdownPath = 'supabase/migrations/20260830211000_payroll_table_surface_lockdown_v14.sql';
const currentEnginePath = 'supabase/migrations/20260921043120_attendance_payroll_engine_v2_and_readiness_v19.sql';
const permissionPath = 'src/lib/core/permissionSystem.ts';
const payrollEntryPath = 'src/pages/PayrollManagement.tsx';
const payrollWorkspacePath = 'src/pages/PayrollManagementV2.tsx';
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

if (!fs.existsSync(currentEnginePath)) {
  failures.push(`Missing current payroll engine/readiness migration: ${currentEnginePath}`);
} else {
  const currentEngineSql = fs.readFileSync(currentEnginePath, 'utf8').toLowerCase().replace(/\s+/g, ' ');
  if (!currentEngineSql.includes('attendance_payroll_engine_v2')) failures.push('Current payroll contract must keep attendance_payroll_engine_v2.');
  if (!/['"]engine_version['"]\s*,\s*19/.test(currentEngineSql)) failures.push('Current payroll readiness contract must identify engine version 19.');
}

const permissionSource = fs.readFileSync(permissionPath, 'utf8');
for (const key of ['view_salary_calculator', 'manage_payroll']) if (!permissionSource.includes(key)) failures.push(`Canonical permission system missing ${key}`);
if (permissionSource.includes('manage_salary_calculator')) failures.push('Non-canonical manage_salary_calculator must not be added to permissionSystem.ts.');
if (!/['"]\/staff-payroll['"]\s*:\s*['"]manage_payroll['"]/.test(permissionSource)) failures.push('staff-payroll route must remain guarded by manage_payroll.');

if (!fs.existsSync(payrollEntryPath)) {
  failures.push(`Missing payroll compatibility entrypoint: ${payrollEntryPath}`);
} else {
  const payrollEntry = fs.readFileSync(payrollEntryPath, 'utf8');
  if (!payrollEntry.includes("export { default } from './PayrollManagementV2';")) {
    failures.push('Live PayrollManagement entrypoint must route to PayrollManagementV2.');
  }
}

if (!fs.existsSync(payrollWorkspacePath)) {
  failures.push(`Missing live payroll workspace: ${payrollWorkspacePath}`);
} else {
  const payrollPage = fs.readFileSync(payrollWorkspacePath, 'utf8');

  // PayrollManagement is now only a compatibility entrypoint. The live Workspace V2
  // owns the read-model/ledger integrations, so validate the actual routed page rather
  // than requiring stale implementation tokens from the wrapper or an old V18 label.
  for (const boundary of [
    '@/lib/payroll/payrollFinalizedSnapshotService',
    '@/lib/payroll/payrollCompensationService',
    '@/lib/payroll/attendancePayrollReadinessService',
    '@/components/attendance/PayrollAttendanceSafetyGate',
    '@/components/payroll/PayrollManualEntriesPanel',
  ]) {
    if (!payrollPage.includes(boundary)) failures.push(`Payroll Workspace V2 missing current canonical boundary ${boundary}`);
  }
  if (/\.from\(['"]staff_payroll_(?:profiles|monthly)_v13['"]\)[\s\S]{0,350}\.(?:insert|update|upsert|delete)\s*\(/.test(payrollPage)) {
    failures.push('Payroll Workspace V2 must not write legacy V13 payroll tables directly.');
  }
  if (/save_staff_payroll_monthly_v14/.test(payrollPage)) {
    failures.push('Current Payroll Workspace V2 must not reintroduce the legacy V14 monthly save command.');
  }
}

if (failures.length) {
  console.error('Payroll architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('[payroll-architecture] PASS: canonical payroll permissions, branch scope, historical freeze/lockdown invariants, live Workspace V2 boundaries, current V19 engine/readiness contract, and no legacy payroll writes are enforced.');
