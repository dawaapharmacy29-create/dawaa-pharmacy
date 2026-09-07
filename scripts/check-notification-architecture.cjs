#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const DOMAIN = 'src/lib/notifications/notificationDomain.ts';
const SERVICE = 'src/lib/notificationService.ts';
const ALLOWED_LEGACY_READERS = new Set([SERVICE]);

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
const legacyReaders = [];
const canonicalReaders = [];
const duplicateDomainLogic = [];

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const source = fs.readFileSync(file, 'utf8');

  if (/\.from\(['"]notifications['"]\)\s*\.(?:insert|update|delete|upsert)\s*\(/s.test(source)) {
    directWriters.push(rel);
  }

  if (/\.from\(['"]notifications['"]\)\s*\.select\s*\(/s.test(source)) {
    legacyReaders.push(rel);
  }

  if (/\.from\((?:['"]notification_events_v2['"]|[A-Z_]*READ_MODEL[A-Z_]*)\)\s*\.select\s*\(/s.test(source)) {
    canonicalReaders.push(rel);
  }

  if (rel !== DOMAIN) {
    const ownsLabels = /const\s+(?:TYPE_AR|PRIORITY_AR|ACTION_AR)\s*:/s.test(source);
    const ownsScoring = /function\s+notificationOperationalScore\s*\(/s.test(source);
    const ownsGrouping = /function\s+notificationGroup\s*\(/s.test(source);
    if (ownsLabels || ownsScoring || ownsGrouping) duplicateDomainLogic.push(rel);
  }
}

const failures = [];
if (directWriters.length) {
  failures.push(`Direct notification table writer(s) are forbidden: ${directWriters.join(', ')}`);
}

const unexpectedLegacyReaders = legacyReaders.filter((file) => !ALLOWED_LEGACY_READERS.has(file));
if (unexpectedLegacyReaders.length) {
  failures.push(`UI/service code must read notification_events_v2 instead of notifications: ${unexpectedLegacyReaders.join(', ')}`);
}

if (duplicateDomainLogic.length) {
  failures.push(`Notification labels/grouping/scoring must live only in ${DOMAIN}: ${duplicateDomainLogic.join(', ')}`);
}

for (const required of [
  DOMAIN,
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

console.log(`[notification-architecture] direct writers: ${directWriters.length}`);
console.log(`[notification-architecture] legacy readers: ${legacyReaders.join(', ') || 'none'}`);
console.log(`[notification-architecture] canonical readers: ${canonicalReaders.join(', ') || 'none'}`);
console.log(`[notification-architecture] duplicate domain logic: ${duplicateDomainLogic.join(', ') || 'none'}`);

if (failures.length) {
  console.error('\nNotification architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[notification-architecture] PASS: command-only writes, canonical read model, and one notification domain owner are enforced.');
