#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const LEGACY_PERMISSION_FILE = 'src/lib/staffPermissions.ts';
const failures = [];

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

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const source = fs.readFileSync(file, 'utf8');

  if (rel !== LEGACY_PERMISSION_FILE && /(?:from\s+['\"]@\/lib\/staffPermissions['\"]|require\(['\"]\.?.*staffPermissions['\"]\))/s.test(source)) {
    failures.push(`Legacy permission system imported by ${rel}`);
  }

  if (rel !== 'src/lib/core/permissionSystem.ts' && rel !== LEGACY_PERMISSION_FILE) {
    if (/export\s+const\s+ROLE_PERMISSIONS\b/.test(source) || /export\s+const\s+ROLE_SCREENS\b/.test(source)) {
      failures.push(`Parallel role/screen permission map defined in ${rel}`);
    }
  }
}

const requiredCoreConsumers = [
  ['src/App.tsx', /getRoutePermissions/],
  ['src/components/layout/Sidebar.tsx', /getRoutePermissions/],
  ['src/hooks/useAuth.ts', /@\/lib\/core\/permissionSystem/],
  ['src/lib/permissionMatrix.ts', /@\/lib\/core\/permissionSystem/],
  ['src/lib/rolePermissionPresets.ts', /@\/lib\/core\/permissionSystem/],
];

for (const [rel, pattern] of requiredCoreConsumers) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    failures.push(`Missing canonical permission consumer: ${rel}`);
    continue;
  }
  const source = fs.readFileSync(full, 'utf8');
  if (!pattern.test(source)) failures.push(`${rel} is not wired to the canonical permission system`);
}

if (failures.length) {
  console.error('\nPermission architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[permission-architecture] PASS: core permission system remains the single decision source.');
