#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const failures = [];
const warnings = [];

// Role checks are valid for data scoping, role-specific workspace shape and copy.
// This gate only targets *authorization guard declarations* for sensitive actions.
// Existing debt is explicitly baselined while it is migrated to canonical permissions.
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

const guardDeclarationPattern = /\bconst\s+(can(?:Manage|Edit|Delete|Approve|Save|Create|Update|Disable|Reset|Assign|Import|Export)\w*)\s*=\s*([^;]+);/gi;
const roleOnlyPattern = /(?:\brole\b|\.role\b|normalizeRole\s*\(|isGeneralManager\s*\(|isAdminRole\s*\(|getRoleLevel\s*\()/i;
const canonicalPermissionPattern = /(?:checkPermission\s*\(|hasPermission\s*\()/i;

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (!rel.startsWith('src/pages/') && !rel.startsWith('src/components/')) continue;
  const source = fs.readFileSync(file, 'utf8');
  const offenders = [];

  for (const match of source.matchAll(guardDeclarationPattern)) {
    const guardName = match[1];
    const expression = match[2];
    if (!roleOnlyPattern.test(expression)) continue;
    if (canonicalPermissionPattern.test(expression)) continue;
    offenders.push(guardName);
  }

  if (!offenders.length) continue;
  if (BASELINED_ACTION_ROLE_DEBT.has(rel)) {
    warnings.push(`${rel}: ${offenders.join(', ')}`);
    continue;
  }
  failures.push(`${rel}: role-only sensitive guard(s): ${offenders.join(', ')}`);
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
