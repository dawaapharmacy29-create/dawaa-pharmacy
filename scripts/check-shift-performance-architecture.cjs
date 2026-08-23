#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const migrationPath = path.join(
  ROOT,
  'supabase/migrations/20260823233000_align_and_harden_shift_performance_authorization_v1.sql'
);
const failures = [];

if (!fs.existsSync(migrationPath)) {
  failures.push('Missing shift-performance authorization migration.');
} else {
  const source = fs.readFileSync(migrationPath, 'utf8');

  for (const table of ['shift_performance_reviews', 'shift_performance_review_members']) {
    if (!source.includes(table)) failures.push(`Shift-performance migration must cover ${table}.`);
  }

  for (const permission of [
    'view_shift_performance',
    'create_shift_evaluation',
    'edit_shift_evaluation',
    'approve_shift_evaluation',
    'delete_shift_evaluation',
  ]) {
    if (!source.includes(permission)) failures.push(`Shift-performance ceiling must define ${permission}.`);
  }

  for (const role of [
    'general_manager',
    'executive_manager',
    'branches_manager',
    'branch_manager',
    'shift_supervisor_morning',
    'shift_supervisor_evening',
  ]) {
    if (!source.includes(role)) failures.push(`Shift-performance authorization must cover ${role}.`);
  }

  for (const helper of [
    'dawaa_can_shift_performance',
    'dawaa_can_shift_performance_member',
    'dawaa_current_staff_account_id_strict',
  ]) {
    if (!source.includes(helper)) failures.push(`Shift-performance migration must include ${helper}.`);
  }

  for (const legacyPolicy of [
    'Allow anon insert shift performance reviews',
    'Allow anon read shift performance reviews',
    'Allow anon update shift performance reviews',
    'Allow anon insert shift performance members',
    'Allow anon read shift performance members',
    'Allow anon update shift performance members',
  ]) {
    if (!source.includes(`drop policy if exists "${legacyPolicy}"`)) {
      failures.push(`Shift-performance hardening must remove legacy policy: ${legacyPolicy}.`);
    }
  }

  if (!/reviewed_by\s*=\s*public\.dawaa_current_staff_account_id_strict\(\)/i.test(source)) {
    failures.push('Shift-performance inserts must bind reviewed_by to the canonical current account.');
  }
  if (!/approved_by\s+is\s+null\s+or\s+approved_by\s*=\s*public\.dawaa_current_staff_account_id_strict\(\)/i.test(source)) {
    failures.push('Shift-performance writes must bind approved_by to the canonical current account.');
  }

  if (/\busing\s*\(\s*true\s*\)/i.test(source) || /\bwith\s+check\s*\(\s*true\s*\)/i.test(source)) {
    failures.push('Shift-performance RLS must not use unconditional true policies.');
  }

  const supervisorBlock = source.match(/elsif v_role_key in \('shift_supervisor_morning','shift_supervisor_evening'\) then([\s\S]*?)end if;/i)?.[1] || '';
  if (!/v_can_view_shift_performance\s*:=\s*true/i.test(supervisorBlock) ||
      !/v_can_create_shift_evaluation\s*:=\s*true/i.test(supervisorBlock) ||
      !/v_can_edit_shift_evaluation\s*:=\s*true/i.test(supervisorBlock)) {
    failures.push('Shift supervisors must retain view/create/edit shift-evaluation permissions.');
  }
  if (/v_can_approve_shift_evaluation\s*:=\s*true/i.test(supervisorBlock) ||
      /v_can_delete_shift_evaluation\s*:=\s*true/i.test(supervisorBlock)) {
    failures.push('Shift supervisors must not receive approve/delete shift-evaluation permissions.');
  }

  const branchManagerBlock = source.match(/elsif v_role_key = 'branch_manager' then([\s\S]*?)elsif v_role_key in \('shift_supervisor_morning'/i)?.[1] || '';
  if (!/v_can_approve_shift_evaluation\s*:=\s*true/i.test(branchManagerBlock)) {
    failures.push('Branch managers must retain approve_shift_evaluation.');
  }
  if (/v_can_delete_shift_evaluation\s*:=\s*true/i.test(branchManagerBlock)) {
    failures.push('Branch managers must not receive delete_shift_evaluation by default.');
  }

  if (!/trim\(coalesce\(p_branch,''\)\)\s*=\s*v_branch/i.test(source)) {
    failures.push('Branch managers and shift supervisors must remain branch-scoped in the DB helper.');
  }
  if (!/p_status[\s\S]{0,250}approved[\s\S]{0,300}approve_shift_evaluation/i.test(source)) {
    failures.push('Approved shift evaluations must require approve_shift_evaluation.');
  }
}

if (failures.length) {
  console.error('\nShift-performance architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[shift-performance-architecture] PASS: canonical role ceiling, branch scope, author binding, approval separation, and non-public RLS remain enforced.');
