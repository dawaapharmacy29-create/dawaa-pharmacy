#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const LEGACY_PERMISSION_FILE = 'src/lib/staffPermissions.ts';
const CORE_PERMISSION_FILE = 'src/lib/core/permissionSystem.ts';
const SIDEBAR_ENTRY_FILE = 'src/components/layout/Sidebar.tsx';
const SIDEBAR_IMPLEMENTATION_FILE = 'src/components/layout/SidebarBase.tsx';
const PERMISSION_KEY_MIGRATION = 'supabase/migrations/20260824154000_migrate_active_dot_permission_keys_v1.sql';
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

  if (rel !== CORE_PERMISSION_FILE && rel !== LEGACY_PERMISSION_FILE) {
    if (/export\s+const\s+ROLE_PERMISSIONS\b/.test(source) || /export\s+const\s+ROLE_SCREENS\b/.test(source)) {
      failures.push(`Parallel role/screen permission map defined in ${rel}`);
    }
  }

  const legacyUserPermissionWrite =
    /\.from\(\s*(?:TABLES\.userPermissions|['\"]user_permissions['\"])\s*\)[\s\S]{0,500}\.(?:insert|update|upsert|delete)\s*\(/s;
  if (legacyUserPermissionWrite.test(source)) {
    failures.push(`Legacy user_permissions write path found in ${rel}; write staff_accounts.permissions only.`);
  }
}

const requiredCoreConsumers = [
  ['src/App.tsx', /getRoutePermissions/],
  [SIDEBAR_IMPLEMENTATION_FILE, /getRoutePermissions/],
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

const sidebarEntryPath = path.join(ROOT, SIDEBAR_ENTRY_FILE);
if (!fs.existsSync(sidebarEntryPath)) {
  failures.push(`Missing sidebar entry point: ${SIDEBAR_ENTRY_FILE}`);
} else {
  const sidebarEntry = fs.readFileSync(sidebarEntryPath, 'utf8');
  if (!sidebarEntry.includes("@/components/layout/SidebarBase")) {
    failures.push(`${SIDEBAR_ENTRY_FILE} must delegate to the canonical SidebarBase implementation`);
  }
}

const coreSource = fs.readFileSync(path.join(ROOT, CORE_PERMISSION_FILE), 'utf8');
const sidebarSource = fs.readFileSync(path.join(ROOT, SIDEBAR_IMPLEMENTATION_FILE), 'utf8');

const permissionMigrationPath = path.join(ROOT, PERMISSION_KEY_MIGRATION);
if (!fs.existsSync(permissionMigrationPath)) {
  failures.push(`Missing canonical permission-key migration: ${PERMISSION_KEY_MIGRATION}`);
} else {
  const migration = fs.readFileSync(permissionMigrationPath, 'utf8');
  for (const key of [
    'customer_welcome_messages_view',
    'customer_welcome_messages_create',
    'customer_welcome_messages_update',
    'employee_operating_system_view',
    'employee_operating_system_manage',
  ]) {
    if (!migration.includes(key)) failures.push(`Permission-key migration missing ${key}`);
    if (!coreSource.includes(key)) failures.push(`Canonical permission system missing ${key}`);
  }
}
const routeMapBlock = coreSource.match(/export const ROUTE_PERMISSION_MAP[\s\S]*?\n};/s)?.[0] || '';
const mappedRoutes = new Set([...routeMapBlock.matchAll(/['\"](\/[^'\"]*)['\"]\s*:/g)].map((match) => match[1]));
const sidebarRoutes = new Set([...sidebarSource.matchAll(/\bpath\s*:\s*['\"](\/[^'\"]*)['\"]/g)].map((match) => match[1].split('?')[0]));

function isCentrallyCovered(route) {
  if (mappedRoutes.has(route)) return true;
  if (route.startsWith('/weekly-evaluation/') && mappedRoutes.has('/weekly-evaluation')) return true;
  if (route.startsWith('/staff/') && mappedRoutes.has('/staff')) return true;
  if (route.startsWith('/customers/') && mappedRoutes.has('/customers')) return true;
  if (route.startsWith('/customer-health/') && mappedRoutes.has('/customer-health')) return true;
  return false;
}

for (const route of sidebarRoutes) {
  if (!isCentrallyCovered(route)) failures.push(`Sidebar route has no central route permission: ${route}`);
}

if (failures.length) {
  console.error('\nPermission architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`[permission-architecture] sidebar routes checked: ${sidebarRoutes.size}`);
console.log('[permission-architecture] PASS: core permission system remains the single decision and write source.');
