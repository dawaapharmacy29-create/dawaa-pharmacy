#!/usr/bin/env node
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/20260824004500_harden_payroll_permission_contract_v1.sql';
const alignmentPath = 'supabase/migrations/20260824004600_align_payroll_permission_contract_v2.sql';
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
  for (const token of required) {
    if (!sql.includes(token)) failures.push(`Payroll migration missing ${token}`);
  }
  if (!/v_actor_role\s+in\s*\([^)]*general_manager[^)]*executive_manager[^)]*branches_manager/i.test(sql)) {
    failures.push('Payroll helper must preserve senior all-branch access.');
  }
  if (!/v_actor_role\s*<>\s*'branch_manager'/i.test(sql) || !/v_target_branch\s*=\s*v_actor_branch/i.test(sql)) {
    failures.push('Payroll helper must branch-scope branch managers.');
  }
  if (/CREATE\s+POLICY[\s\S]{0,300}\bFOR\s+DELETE\b/i.test(sql)) {
    failures.push('Payroll client DELETE policy must not be introduced.');
  }
  if (/USING\s*\(\s*true\s*\)|WITH\s+CHECK\s*\(\s*true\s*\)/i.test(sql)) {
    failures.push('Payroll RLS must never use unconditional true policies.');
  }
}

if (!fs.existsSync(alignmentPath)) {
  failures.push(`Missing canonical payroll alignment migration: ${alignmentPath}`);
} else {
  const alignmentSql = fs.readFileSync(alignmentPath, 'utf8');
  if (!alignmentSql.includes("v_effective := v_effective - 'manage_salary_calculator'")) {
    failures.push('Payroll alignment must remove the non-canonical manage_salary_calculator key.');
  }
  for (const key of ['view_salary_calculator', 'manage_payroll']) {
    if (!alignmentSql.includes(key)) failures.push(`Payroll alignment missing ${key}`);
  }
}

const permissionSource = fs.readFileSync(permissionPath, 'utf8');
for (const key of ['view_salary_calculator', 'manage_payroll']) {
  if (!permissionSource.includes(key)) failures.push(`Canonical permission system missing ${key}`);
}
if (permissionSource.includes('manage_salary_calculator')) {
  failures.push('Non-canonical manage_salary_calculator must not be added to permissionSystem.ts.');
}
if (!/['"]\/staff-payroll['"]\s*:\s*['"]manage_payroll['"]/.test(permissionSource)) {
  failures.push('staff-payroll route must remain guarded by manage_payroll.');
}

const payrollPage = fs.readFileSync(payrollPagePath, 'utf8');
for (const table of ['staff_payroll_profiles_v13', 'staff_payroll_monthly_v13']) {
  if (!payrollPage.includes(table)) failures.push(`Payroll page no longer references expected table ${table}`);
}

if (failures.length) {
  console.error('Payroll architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('[payroll-architecture] PASS: canonical payroll permissions, branch scope, and RLS boundary are present.');
