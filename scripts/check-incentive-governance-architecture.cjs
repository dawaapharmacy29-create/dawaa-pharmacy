#!/usr/bin/env node
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/20260824010000_align_incentive_governance_permission_contract_v1.sql';
const ruleBoundaryMigrationPath = 'supabase/migrations/20260827020500_harden_incentive_rule_boundaries_v10.sql';
const permissionPath = 'src/lib/core/permissionSystem.ts';
const sidebarPath = 'src/components/layout/SidebarBase.tsx';
const compositeScorePath = 'src/lib/incentives/compositeScoreService.ts';
const failures = [];
const warnings = [];

if (!fs.existsSync(migrationPath)) {
  failures.push(`Missing incentive governance migration: ${migrationPath}`);
} else {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  for (const token of [
    'view_incentives',
    'manage_incentives',
    'view_quarterly_incentives',
    'manage_quarterly_incentives',
    'view_penalty_management',
    'manage_penalty_management',
    'dawaa_can_manage_incentives',
    'get_user_permissions(public.dawaa_current_staff_account_id_strict())',
  ]) {
    if (!sql.includes(token)) failures.push(`Incentive migration missing ${token}`);
  }
  if (!/v_role_key\s+in\s*\([^)]*general_manager[^)]*executive_manager[^)]*branches_manager/i.test(sql)) {
    failures.push('Senior roles must retain incentive governance management.');
  }
  if (!/elsif\s+v_role_key\s*=\s*'branch_manager'[\s\S]{0,350}v_can_view_incentives\s*:=\s*true/i.test(sql)) {
    failures.push('Branch managers must retain incentive visibility.');
  }
  if (/elsif\s+v_role_key\s*=\s*'branch_manager'[\s\S]{0,350}v_can_manage_incentives\s*:=\s*true/i.test(sql)) {
    failures.push('Branch managers must not receive global incentive governance by default.');
  }
  const helperMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.dawaa_can_manage_incentives\(\)[\s\S]*?\$function\$;/i)?.[0] || '';
  if (!helperMatch.includes("->>'manage_incentives'")) {
    failures.push('dawaa_can_manage_incentives must use canonical manage_incentives.');
  }
  if (helperMatch.includes('manage_payroll') || /a\.permissions\s*->>/i.test(helperMatch)) {
    failures.push('Incentive governance must not depend on manage_payroll or raw account permission JSON.');
  }
}

if (!fs.existsSync(ruleBoundaryMigrationPath)) {
  failures.push(`Missing incentive rule boundary migration: ${ruleBoundaryMigrationPath}`);
} else {
  const rulesSql = fs.readFileSync(ruleBoundaryMigrationPath, 'utf8').toLowerCase();
  const requiredTokens = [
    'revoke all privileges on table public.archive_points_log_2026 from anon, authenticated',
    'drop policy if exists archive_points_log_2026_insert_app',
    'drop policy if exists archive_points_log_2026_select_app',
    'drop policy if exists archive_points_log_2026_update_app',
    'drop policy if exists deduction_rules_insert_app',
    'drop policy if exists deduction_rules_select_app',
    'drop policy if exists deduction_rules_update_app',
    'drop policy if exists reward_rules_insert_app',
    'drop policy if exists reward_rules_select_app',
    'drop policy if exists reward_rules_update_app',
    'using (public.dawaa_current_staff_id_v1() is not null)',
    'with check (public.dawaa_can_manage_incentives())',
  ];
  for (const token of requiredTokens) {
    if (!rulesSql.includes(token)) failures.push(`Incentive rule boundary missing: ${token}`);
  }
  if ((rulesSql.match(/using \(public\.dawaa_current_staff_id_v1\(\) is not null\)/g) || []).length < 2) {
    failures.push('Both incentive rule tables must require a valid application actor for reads.');
  }
  if ((rulesSql.match(/with check \(public\.dawaa_can_manage_incentives\(\)\)/g) || []).length < 4) {
    failures.push('Insert/update writes for both incentive rule tables must require manage_incentives.');
  }
  if (/\busing\s*\(\s*true\s*\)|\bwith\s+check\s*\(\s*true\s*\)/i.test(rulesSql)) {
    failures.push('Incentive rule boundary must not reintroduce always-true RLS policies.');
  }
}

const permissions = fs.readFileSync(permissionPath, 'utf8');
for (const key of ['view_incentives', 'manage_incentives']) {
  if (!permissions.includes(key)) failures.push(`permissionSystem.ts missing ${key}`);
}

const routeIsCanonical = /['"]\/incentive-governance['"]\s*:\s*['"]manage_incentives['"]/.test(permissions);
const routeIsKnownLegacy = /['"]\/incentive-governance['"]\s*:\s*['"]manage_payroll['"]/.test(permissions);
if (!routeIsCanonical && !routeIsKnownLegacy) {
  failures.push('incentive-governance route permission changed outside the known/canonical contract.');
} else if (routeIsKnownLegacy) {
  warnings.push('src/lib/core/permissionSystem.ts: /incentive-governance still uses manage_payroll; migrate to manage_incentives with a safe patch.');
}

const sidebar = fs.readFileSync(sidebarPath, 'utf8');
const sidebarIsCanonical = /path:\s*['"]\/incentive-governance['"][\s\S]{0,180}permission:\s*['"]manage_incentives['"]/.test(sidebar);
const sidebarIsKnownLegacy = /path:\s*['"]\/incentive-governance['"][\s\S]{0,180}permission:\s*['"]manage_payroll['"]/.test(sidebar);
if (!sidebarIsCanonical && !sidebarIsKnownLegacy) {
  failures.push('Sidebar incentive governance permission changed outside the known/canonical contract.');
} else if (sidebarIsKnownLegacy) {
  warnings.push(`${sidebarPath}: incentive governance item still uses manage_payroll; migrate to manage_incentives with a safe patch.`);
}

// V3 is the only active source of evaluation weights. Legacy ruleDefinitions may remain
// for historical rule/category decoding, but runtime score services must not import the
// old PERFORMANCE_PILLARS weight table again.
if (!fs.existsSync(compositeScorePath)) {
  failures.push(`Missing composite score service: ${compositeScorePath}`);
} else {
  const composite = fs.readFileSync(compositeScorePath, 'utf8');
  if (/\bPERFORMANCE_PILLARS\b/.test(composite)) {
    failures.push('Composite score service must derive weights from staffEvaluationProfilesV3, not legacy PERFORMANCE_PILLARS.');
  }
  if (!/evaluationProfileForRole/.test(composite) || !/staffEvaluationProfilesV3/.test(composite)) {
    failures.push('Composite score service must use the canonical V3 role evaluation profile.');
  }
}

if (warnings.length) {
  console.log('[incentive-governance] known UI alignment debt:');
  warnings.forEach((warning) => console.log(`- ${warning}`));
}
if (failures.length) {
  console.error('Incentive governance architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('[incentive-governance] PASS: DB governance uses canonical incentive permissions, rule-table RLS is actor/manager scoped, and V3 is the only active performance-weight source.');
