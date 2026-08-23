#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const failures = [];
const warnings = [];

// Role checks are still valid for data scoping / role-specific workspace shape.
// This gate targets page/component code where a role list is used as the decision
// for sensitive actions such as edit/delete/approve/manage. Existing debt is
// explicitly baselined so new copies cannot spread while we migrate it safely.
const BASELINED_ACTION_ROLE_DEBT = new Set([
  'src/pages/Reviews.tsx',
]);

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const roleDecisionPattern = /(?:includes\s*\(\s*normalizeRole\([^)]*role[^)]*\)\s*\)|includes\s*\(\s*[^)]*\.role\s*\)|normalizeRole\([^)]*role[^)]*\)\s*===|\.role\s*===|role\s*===|isGeneralManager\s*\()/s;
const sensitiveActionPattern = /\b(?:canManage|canEdit|canDelete|canApprove|canSave|saveEdit|saveManager|approve|delete|manage|edit)\w*\b/i;

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (!rel.startsWith('src/pages/') && !rel.startsWith('src/components/')) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (!roleDecisionPattern.test(source) || !sensitiveActionPattern.test(source)) continue;

  if (BASELINED_ACTION_ROLE_DEBT.has(rel)) {
    warnings.push(rel);
    continue;
  }

  // Canonical permission consumers are allowed when the role check is only for
  // scope/UI shape and the sensitive action itself is permission-backed.
  const usesCanonicalPermission = /checkPermission\s*\(|hasPermission\s*\(/.test(source);
  if (!usesCanonicalPermission) {
    failures.push(`${rel} contains a role-only sensitive action decision without checkPermission/hasPermission`);
  }
}

if (warnings.length) {
  console.log('[action-permission-boundary] baselined debt:');
  warnings.forEach((item) => console.log(`- ${item}`));
}

if (failures.length) {
  console.error('\nAction permission architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[action-permission-boundary] PASS: no new role-only sensitive action guards detected.');
