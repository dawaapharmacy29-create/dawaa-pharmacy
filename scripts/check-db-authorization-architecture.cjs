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
for (const file of [authMigrationPath, targetMigrationPath]) {
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

if (failures.length) {
  console.error('\nDB authorization architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[db-authorization-architecture] PASS: protected writes and boolean permission truth remain centralized.');
