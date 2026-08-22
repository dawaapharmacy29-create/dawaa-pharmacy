#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const ALLOWED_DIRECT_WRITERS = new Set([
  'src/lib/notificationService.ts',
  'src/lib/staffNotificationService.ts',
  // Transitional legacy writers. This list may only shrink in count; paths may move during consolidation.
  'src/lib/api/shiftPerformanceLegacy.ts',
  'src/pages/MedicineExpiryTracker.tsx',
  'src/pages/StaffMonthlyEvaluation.tsx',
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

const directWriters = [];
const rawRouteMaps = [];
for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const source = fs.readFileSync(file, 'utf8');
  if (/\.from\(['"]notifications['"]\)\s*\.insert\s*\(/s.test(source)) directWriters.push(rel);
  if (rel !== 'src/hooks/useNotifications.ts' && /notificationRoute\s*\(|routes\s*:\s*Record<.*notification/si.test(source)) rawRouteMaps.push(rel);
}

const unexpected = directWriters.filter((file) => !ALLOWED_DIRECT_WRITERS.has(file));
const staleAllowlist = [...ALLOWED_DIRECT_WRITERS].filter((file) => !directWriters.includes(file));
const failures = [];
if (unexpected.length) failures.push(`New direct notification writer(s): ${unexpected.join(', ')}`);
if (staleAllowlist.length) failures.push(`Notification writer debt decreased; remove stale allowlist entry(s): ${staleAllowlist.join(', ')}`);

for (const required of [
  'src/lib/notifications/notificationDomain.ts',
  'src/lib/notifications/notificationActionService.ts',
]) {
  if (!fs.existsSync(path.join(ROOT, required))) failures.push(`Missing canonical notification boundary: ${required}`);
}

console.log(`[notification-architecture] direct writers: ${directWriters.length}`);
console.log(`[notification-architecture] ${directWriters.join(', ') || 'none'}`);
if (rawRouteMaps.length) console.log(`[notification-architecture] additional route-like implementations for review: ${rawRouteMaps.join(', ')}`);

if (failures.length) {
  console.error('\nNotification architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('[notification-architecture] PASS: no new direct notification writer was introduced.');
