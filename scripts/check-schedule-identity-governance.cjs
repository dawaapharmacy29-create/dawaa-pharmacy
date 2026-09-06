#!/usr/bin/env node
const fs = require('node:fs');
const failures = [];
const migrationPath = 'supabase/migrations/20260906173500_shift_schedule_identity_governance_v1.sql';
const servicePath = 'src/lib/scheduleIdentityService.ts';
const componentPath = 'src/components/attendance/ScheduleIdentityGovernance.tsx';
const schedulePath = 'src/pages/Schedule.tsx';
for (const path of [migrationPath, servicePath, componentPath, schedulePath]) {
  if (!fs.existsSync(path)) failures.push(`Missing ${path}`);
}
if (!failures.length) {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const service = fs.readFileSync(servicePath, 'utf8');
  const component = fs.readFileSync(componentPath, 'utf8');
  const schedule = fs.readFileSync(schedulePath, 'utf8');
  for (const token of ['shift_schedule_identity_audit','list_unmapped_shift_schedule_groups_v1','assign_shift_schedule_staff_identity_v1','schedule_identity_cross_branch_mapping_blocked']) {
    if (!migration.includes(token)) failures.push(`Migration missing ${token}`);
  }
  if (!/where\s+ss\.staff_id\s+is\s+null/i.test(migration)) failures.push('Mapping command must only touch unlinked legacy rows.');
  if (!/not public\.dawaa_actor_is_top_management_v1\(\)/i.test(migration)) failures.push('Mapping must require top management.');
  if (!/schedule_identity_mapping_requires_note/i.test(migration)) failures.push('Mapping must require an audit note.');
  for (const rpc of ['get_shift_schedule_identity_health_v1','list_unmapped_shift_schedule_groups_v1','list_schedule_identity_staff_candidates_v1','assign_shift_schedule_staff_identity_v1']) {
    if (!service.includes(rpc)) failures.push(`Service missing RPC ${rpc}`);
  }
  if (/\.from\(['"]shift_schedules['"]\)/.test(component)) failures.push('Governance UI must use RPC boundary, not direct schedule writes.');
  if (!component.includes("@/lib/scheduleIdentityService")) failures.push('Governance UI must use scheduleIdentityService.');
  if (!schedule.includes('ScheduleIdentityGovernance')) failures.push('Schedule page must expose identity governance to managers.');
}
if (failures.length) {
  console.error('Schedule Identity Governance check failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('[schedule-identity-governance] PASS: explicit same-branch mapping, staff_id truth, audit note, and no automatic cross-branch repair.');
