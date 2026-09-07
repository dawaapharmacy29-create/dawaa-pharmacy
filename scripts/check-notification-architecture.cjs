#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const DOMAIN = 'src/lib/notifications/notificationDomain.ts';
const SERVICE = 'src/lib/notificationService.ts';

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
const rawReaders = [];
const canonicalReaders = [];
const duplicateDomainLogic = [];
const adHocRoutes = [];

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const source = fs.readFileSync(file, 'utf8');

  if (/\.from\(['"]notifications['"]\)\s*\.(?:insert|update|delete|upsert)\s*\(/s.test(source)) {
    directWriters.push(rel);
  }

  if (/\.from\(['"]notifications['"]\)\s*\.select\s*\(/s.test(source)) {
    rawReaders.push(rel);
  }

  if (/\.from\((?:['"]notification_events_v2['"]|[A-Z_]*READ_MODEL[A-Z_]*)\)\s*\.select\s*\(/s.test(source)) {
    canonicalReaders.push(rel);
  }

  if (rel !== DOMAIN) {
    const ownsLabels = /const\s+(?:TYPE_AR|PRIORITY_AR|ACTION_AR)\s*:/s.test(source);
    const ownsScoring = /function\s+notificationOperationalScore\s*\(/s.test(source);
    const ownsGrouping = /function\s+notificationGroup\s*\(/s.test(source);
    const ownsPreferenceRouting = /function\s+notificationPreferenceCategory\s*\(/s.test(source);
    if (ownsLabels || ownsScoring || ownsGrouping || ownsPreferenceRouting) duplicateDomainLogic.push(rel);
  }

  if (rel !== DOMAIN && /(?:customer_data_review|welcome_task)\s*===|rawType\s*===\s*['"][^'"]+['"]\s*\)\s*return\s*['"]\//s.test(source)) {
    adHocRoutes.push(rel);
  }
}

const failures = [];
if (directWriters.length) {
  failures.push(`Direct notification table writer(s) are forbidden: ${directWriters.join(', ')}`);
}
if (rawReaders.length) {
  failures.push(`All application notification reads must use notification_events_v2: ${rawReaders.join(', ')}`);
}
if (duplicateDomainLogic.length) {
  failures.push(`Notification labels/grouping/scoring/preferences must live only in ${DOMAIN}: ${duplicateDomainLogic.join(', ')}`);
}
if (adHocRoutes.length) {
  failures.push(`Notification route exceptions must live only in ${DOMAIN}: ${adHocRoutes.join(', ')}`);
}

for (const required of [
  DOMAIN,
  SERVICE,
  'src/lib/notifications/notificationActionService.ts',
  'src/lib/notifications/notificationWorkflowService.ts',
]) {
  if (!fs.existsSync(path.join(ROOT, required))) failures.push(`Missing canonical notification boundary: ${required}`);
}

const serviceSource = fs.readFileSync(path.join(ROOT, SERVICE), 'utf8');
if (!serviceSource.includes('notification_events_v2')) {
  failures.push(`${SERVICE} must own the canonical notification_events_v2 read boundary.`);
}
if (!serviceSource.includes('create_notification_audience_v1')) {
  failures.push(`${SERVICE} must keep notification creation behind create_notification_audience_v1.`);
}
if (/using legacy compatibility reader|\.from\(['"]notifications['"]\)\s*\.select/s.test(serviceSource)) {
  failures.push(`${SERVICE} must fail closed when the canonical read model is unavailable; legacy raw-read fallback is forbidden.`);
}

console.log(`[notification-architecture] direct writers: ${directWriters.length}`);
console.log(`[notification-architecture] raw readers: ${rawReaders.join(', ') || 'none'}`);
console.log(`[notification-architecture] canonical readers: ${canonicalReaders.join(', ') || 'none'}`);
console.log(`[notification-architecture] duplicate domain logic: ${duplicateDomainLogic.join(', ') || 'none'}`);
console.log(`[notification-architecture] ad-hoc routes: ${adHocRoutes.join(', ') || 'none'}`);

if (failures.length) {
  console.error('\nNotification architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[notification-architecture] PASS: one command boundary, one canonical read model, one domain owner, no compatibility read debt.');
