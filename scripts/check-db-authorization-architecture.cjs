#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const failures = [];

const editorPath = path.join(ROOT, 'src/components/dashboard/BranchTargetEditor.tsx');
const editor = fs.readFileSync(editorPath, 'utf8');
if (!/\.rpc\(['"]set_branch_sales_target['"]/.test(editor)) {
  failures.push('BranchTargetEditor must write through set_branch_sales_target RPC.');
}
if (/\.from\(['"]branch_sales_targets['"]\)[\s\S]{0,250}\.(?:insert|update|upsert|delete)\s*\(/.test(editor)) {
  failures.push('BranchTargetEditor must not write branch_sales_targets directly.');
}

const authMigrationPath = path.join(ROOT, 'supabase/migrations/20260823184000_harden_db_authorization_permission_truth_v1.sql');
const targetMigrationPath = path.join(ROOT, 'supabase/migrations/20260823184100_harden_branch_target_authorization_v1.sql');
const activeWorkflowRlsPath = path.join(ROOT, 'supabase/migrations/20260823191500_harden_active_reviews_and_shift_notes_rls_v1.sql');
const reviewCeilingPath = path.join(ROOT, 'supabase/migrations/20260823191800_align_db_review_permission_ceiling_v1.sql');
const managerReviewRlsPath = path.join(ROOT, 'supabase/migrations/20260823192200_harden_customer_service_manager_reviews_rls_v1.sql');
for (const file of [authMigrationPath, targetMigrationPath, activeWorkflowRlsPath, reviewCeilingPath, managerReviewRlsPath]) {
  if (!fs.existsSync(file)) failures.push(`Missing authorization migration: ${path.basename(file)}`);
}

if (fs.existsSync(authMigrationPath)) {
  const source = fs.readFileSync(authMigrationPath, 'utf8');
  if (!/dawaa_jsonb_has_true_any/.test(source)) failures.push('Missing boolean permission truth helper.');
  if (/\bstaff_role\b/.test(source)) failures.push('Hardened authorization migration must not use legacy staff_role.');
  if (/\bis_active\b/.test(source)) failures.push('Hardened authorization migration must not use legacy is_active.');
}

if (fs.existsSync(targetMigrationPath)) {
  const source = fs.readFileSync(targetMigrationPath, 'utf8');
  if (!/dawaa_can_manage_branch_targets/.test(source)) failures.push('Missing canonical branch-target authorization helper.');
  if (/\bstaff_role\b/.test(source)) failures.push('Branch-target authorization must not use legacy staff_role.');
  if (/\bis_active\b/.test(source)) failures.push('Branch-target authorization must not use legacy is_active.');
  if (/permissions\s*\?\s*['"]/.test(source)) failures.push('Branch-target authorization must not authorize by JSON key existence.');
}

if (fs.existsSync(activeWorkflowRlsPath)) {
  const source = fs.readFileSync(activeWorkflowRlsPath, 'utf8');
  for (const table of ['conversation_sales_reviews', 'shift_notes', 'shift_note_logs', 'shift_note_occurrences']) {
    if (!source.includes(table)) failures.push(`Active workflow RLS migration must cover ${table}.`);
  }
  for (const permission of ['view_reviews', 'add_reviews', 'edit_reviews', 'approve_reviews']) {
    if (!source.includes(permission)) failures.push(`Review RLS must reference canonical permission ${permission}.`);
  }
  if (!/dawaa_current_staff_account_id_strict\(\)/.test(source)) {
    failures.push('Shift-note RLS must require a canonical active staff actor.');
  }
  if (/\busing\s*\(\s*true\s*\)/i.test(source) || /\bwith\s+check\s*\(\s*true\s*\)/i.test(source)) {
    failures.push('Active review/shift-note RLS must not reintroduce unconditional true write/read policies.');
  }
}

if (fs.existsSync(reviewCeilingPath)) {
  const source = fs.readFileSync(reviewCeilingPath, 'utf8');
  for (const permission of ['view_reviews', 'add_reviews', 'edit_reviews', 'approve_reviews', 'delete_reviews']) {
    if (!source.includes(permission)) failures.push(`DB review ceiling must define ${permission}.`);
  }
  for (const role of ['pharmacist', 'shift_supervisor_morning', 'shift_supervisor_evening', 'branch_manager', 'customer_service_manager']) {
    if (!source.includes(role)) failures.push(`DB review ceiling must cover ${role}.`);
  }
  if (!/v_can_view_reviews\s*:=\s*true/.test(source) || !/v_can_add_reviews\s*:=\s*true/.test(source)) {
    failures.push('DB review ceiling must contain explicit role grants, not legacy key-existence rules.');
  }
  if (/\bstaff_role\b/.test(source) || /\bis_active\b/.test(source)) {
    failures.push('DB review ceiling must use canonical role and active/can_login only.');
  }
}

if (fs.existsSync(managerReviewRlsPath)) {
  const source = fs.readFileSync(managerReviewRlsPath, 'utf8');
  if (!source.includes('customer_service_manager_reviews')) failures.push('Manager review RLS migration must cover customer_service_manager_reviews.');
  if (!source.includes('view_reviews') || !source.includes('approve_reviews')) {
    failures.push('Manager review RLS must use view_reviews for reads and approve_reviews for writes.');
  }
  if (/\busing\s*\(\s*true\s*\)/i.test(source) || /\bwith\s+check\s*\(\s*true\s*\)/i.test(source)) {
    failures.push('Manager review RLS must not use unconditional true policies.');
  }
}

if (failures.length) {
  console.error('\nDB authorization architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[db-authorization-architecture] PASS: protected writes, active workflow RLS, review role ceiling and boolean permission truth remain centralized.');
