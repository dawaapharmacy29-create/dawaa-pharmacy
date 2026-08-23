#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const failures = [];
const targetFunctions = [
  'add_branch_coverage',
  'end_branch_coverage',
  'list_branch_coverage',
  'get_active_coverage_doctors',
];

const files = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
const latestDefinition = new Map();

for (const file of files) {
  const source = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
  for (const fn of targetFunctions) {
    const marker = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, 'i');
    if (marker.test(source)) latestDefinition.set(fn, { file, source });
  }
}

for (const fn of targetFunctions) {
  const latest = latestDefinition.get(fn);
  if (!latest) {
    failures.push(`missing ${fn} definition`);
    continue;
  }
  if (latest.file !== '20260824025500_harden_review_branch_coverage_rpc_v1.sql') {
    failures.push(`${fn} latest definition is ${latest.file}; re-review authorization before replacing the hardened RPC`);
    continue;
  }
  if (!latest.source.includes('dawaa_current_staff_account_id_strict()')) {
    failures.push(`${fn} migration does not resolve canonical current staff account`);
  }
  if (!latest.source.includes('dawaa_can_access_review_coverage_branch_v1')) {
    failures.push(`${fn} migration does not enforce review coverage branch authorization`);
  }
}

const hardened = latestDefinition.get('add_branch_coverage')?.source || '';
for (const token of [
  "'approve_reviews'",
  "'view_reviews'",
  'user_has_permission',
  'Not authorized to manage review coverage for this branch',
  'Not authorized to view review coverage for this branch',
  'select s.name, s.role, s.branch',
  'created_by_name',
  'ended_by_name',
]) {
  if (!hardened.includes(token)) failures.push(`hardened review coverage migration missing: ${token}`);
}

if (/grant\s+execute[\s\S]*?\bto\s+public\b/i.test(hardened)) {
  failures.push('review coverage RPCs must never grant EXECUTE to PUBLIC');
}

if (failures.length) {
  console.error('Review coverage architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[review-coverage-architecture] PASS: latest coverage RPCs resolve canonical actor and enforce review permission + branch scope.');
