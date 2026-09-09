#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const DOMAIN = 'src/lib/notifications/notificationDomain.ts';
const METADATA = 'src/lib/notifications/notificationMetadata.ts';
const SERVICE = 'src/lib/notificationService.ts';
const OPERATIONS_CENTER = 'src/pages/OperationsCenter2027.tsx';
const SLA_MIGRATION = 'supabase/migrations/20260908164500_notification_sla_engine_v1.sql';
const SLA_READ_MODEL_MIGRATION = 'supabase/migrations/20260908172000_notification_sla_metadata_surface_v1.sql';
const SLA_REFERENCE_MIGRATION = 'supabase/migrations/20260908205500_sla_escalations_reference_only_v2.sql';
const SLA_INTEGRITY_MIGRATION = 'supabase/migrations/20260908211500_notification_sla_integrity_audit_v1.sql';
const LIFECYCLE_MIGRATION = 'supabase/migrations/20260908192500_notification_lifecycle_state_machine_v1.sql';

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

  if (/\.from\(['"]notifications['"]\)\s*\.(?:insert|update|delete|upsert)\s*\(/s.test(source)) directWriters.push(rel);
  if (/\.from\(['"]notifications['"]\)\s*\.select\s*\(/s.test(source)) rawReaders.push(rel);
  if (/\.from\((?:['"]notification_events_v2['"]|[A-Z_]*READ_MODEL[A-Z_]*)\)\s*\.select\s*\(/s.test(source)) canonicalReaders.push(rel);

  if (rel !== DOMAIN) {
    const ownsLabels = /const\s+(?:TYPE_AR|PRIORITY_AR|ACTION_AR)\s*:/s.test(source);
    const ownsScoring = /function\s+notificationOperationalScore\s*\(/s.test(source);
    const ownsGrouping = /function\s+notificationGroup\s*\(/s.test(source);
    const ownsPreferenceRouting = /function\s+notificationPreferenceCategory\s*\(/s.test(source);
    const ownsLifecycle = /function\s+(?:notificationLifecycleState|notificationTransitionAllowed|notificationRequiresOutcomeNote)\s*\(/s.test(source);
    if (ownsLabels || ownsScoring || ownsGrouping || ownsPreferenceRouting || ownsLifecycle) duplicateDomainLogic.push(rel);
  }

  if (rel !== DOMAIN && /(?:customer_data_review|welcome_task)\s*===|rawType\s*===\s*['"][^'"]+['"]\s*\)\s*return\s*['"]\//s.test(source)) adHocRoutes.push(rel);
}

const failures = [];
if (directWriters.length) failures.push(`Direct notification table writer(s) are forbidden: ${directWriters.join(', ')}`);
if (rawReaders.length) failures.push(`All application notification reads must use notification_events_v2: ${rawReaders.join(', ')}`);
if (duplicateDomainLogic.length) failures.push(`Notification labels/grouping/scoring/preferences/lifecycle must live only in ${DOMAIN}: ${duplicateDomainLogic.join(', ')}`);
if (adHocRoutes.length) failures.push(`Notification route exceptions must live only in ${DOMAIN}: ${adHocRoutes.join(', ')}`);

for (const required of [
  DOMAIN,
  METADATA,
  SERVICE,
  OPERATIONS_CENTER,
  'src/lib/notifications/notificationActionService.ts',
  'src/lib/notifications/notificationWorkflowService.ts',
  SLA_MIGRATION,
  SLA_READ_MODEL_MIGRATION,
  SLA_REFERENCE_MIGRATION,
  SLA_INTEGRITY_MIGRATION,
  LIFECYCLE_MIGRATION,
]) {
  if (!fs.existsSync(path.join(ROOT, required))) failures.push(`Missing canonical notification boundary: ${required}`);
}

const serviceSource = fs.readFileSync(path.join(ROOT, SERVICE), 'utf8');
if (!serviceSource.includes('notification_events_v2')) failures.push(`${SERVICE} must own the canonical notification_events_v2 read boundary.`);
if (!serviceSource.includes('create_notification_audience_v1')) failures.push(`${SERVICE} must keep notification creation behind create_notification_audience_v1.`);
if (!serviceSource.includes('normalizeNotificationMetadata')) failures.push(`${SERVICE} must normalize metadata through ${METADATA}.`);
if (!serviceSource.includes('getNotificationById')) failures.push(`${SERVICE} must expose canonical notification lookup for deep links and SLA source resolution.`);
if (/using legacy compatibility reader|\.from\(['"]notifications['"]\)\s*\.select/s.test(serviceSource)) failures.push(`${SERVICE} must fail closed when the canonical read model is unavailable; legacy raw-read fallback is forbidden.`);

const domainSource = fs.readFileSync(path.join(ROOT, DOMAIN), 'utf8');
for (const requiredToken of [
  'notificationLifecycleState',
  'notificationTransitionAllowed',
  'notificationRequiresOutcomeNote',
  "nextState === 'completed'",
  "'dismissed'",
  'NOTE_REQUIRED_TYPES',
]) {
  if (!domainSource.includes(requiredToken)) failures.push(`${DOMAIN} is missing lifecycle parity token: ${requiredToken}`);
}

const operationsSource = fs.readFileSync(path.join(ROOT, OPERATIONS_CENTER), 'utf8');
for (const requiredToken of [
  'notificationLifecycleState',
  'notificationTransitionAllowed',
  "notificationRequiresOutcomeNote(item, 'dismissed')",
  'ابدأ المتابعة أولًا',
]) {
  if (!operationsSource.includes(requiredToken)) failures.push(`${OPERATIONS_CENTER} must render only lifecycle-valid actions: ${requiredToken}`);
}

const metadataSource = fs.readFileSync(path.join(ROOT, METADATA), 'utf8');
for (const requiredToken of ['schemaVersion: 2', 'canonicalType', 'notificationMetadataContractIssues']) {
  if (!metadataSource.includes(requiredToken)) failures.push(`${METADATA} is missing required contract token: ${requiredToken}`);
}

if (fs.existsSync(path.join(ROOT, SLA_MIGRATION))) {
  const slaSource = fs.readFileSync(path.join(ROOT, SLA_MIGRATION), 'utf8');
  for (const requiredToken of ['notification_sla_policies','notification_sla_events','evaluate_notification_sla_v1','evaluate_operational_notification_rules_v1','emit_system_notification_v2',"coalesce(n.metadata->>'schemaVersion','')='2'","coalesce(n.metadata->>'slaGenerated','false') <> 'true'"]) {
    if (!slaSource.includes(requiredToken)) failures.push(`${SLA_MIGRATION} is missing SLA boundary token: ${requiredToken}`);
  }
  if (/cron\.schedule\s*\(/i.test(slaSource)) failures.push(`${SLA_MIGRATION} must reuse evaluate_operational_notification_rules_v1; a parallel SLA cron is forbidden.`);
}

if (fs.existsSync(path.join(ROOT, SLA_READ_MODEL_MIGRATION))) {
  const readModelSource = fs.readFileSync(path.join(ROOT, SLA_READ_MODEL_MIGRATION), 'utf8');
  for (const requiredToken of ['notification_events_v2','notification_sla_policies','notification_sla_events',"'slaPolicyKey'","'slaAckDeadlineAt'","'slaResolutionDeadlineAt'","'slaAckBreached'","'slaResolutionBreached'","'slaGenerated'"]) {
    if (!readModelSource.includes(requiredToken)) failures.push(`${SLA_READ_MODEL_MIGRATION} is missing SLA read-model token: ${requiredToken}`);
  }
}

if (fs.existsSync(path.join(ROOT, SLA_REFERENCE_MIGRATION))) {
  const referenceSource = fs.readFileSync(path.join(ROOT, SLA_REFERENCE_MIGRATION), 'utf8');
  for (const requiredToken of ['emit_system_notification_v2','v_requires_action',"v_metadata->>'slaGenerated'",'then false']) {
    if (!referenceSource.includes(requiredToken)) failures.push(`${SLA_REFERENCE_MIGRATION} is missing SLA reference-only invariant token: ${requiredToken}`);
  }
}

if (fs.existsSync(path.join(ROOT, SLA_INTEGRITY_MIGRATION))) {
  const integritySource = fs.readFileSync(path.join(ROOT, SLA_INTEGRITY_MIGRATION), 'utf8');
  for (const requiredToken of ['notification_sla_integrity_audit_v1','notification_sla_integrity_health_v1','orphan_source','duplicate_workflow','missing_sla_event_link']) {
    if (!integritySource.includes(requiredToken)) failures.push(`${SLA_INTEGRITY_MIGRATION} is missing SLA integrity token: ${requiredToken}`);
  }
}

if (fs.existsSync(path.join(ROOT, LIFECYCLE_MIGRATION))) {
  const lifecycleSource = fs.readFileSync(path.join(ROOT, LIFECYCLE_MIGRATION), 'utf8');
  for (const requiredToken of [
    'notification_transition_allowed_v1',
    'notification_transition_requires_note_v1',
    'transition_notification_action_with_note_v1',
    'notification_lifecycle_audit_v1',
    'SLA escalation is reference-only',
    'v_current_state = p_next_state',
    'actionPreviousState',
    'invalid notification lifecycle transition',
  ]) {
    if (!lifecycleSource.includes(requiredToken)) failures.push(`${LIFECYCLE_MIGRATION} is missing lifecycle invariant token: ${requiredToken}`);
  }
}

console.log(`[notification-architecture] direct writers: ${directWriters.length}`);
console.log(`[notification-architecture] raw readers: ${rawReaders.join(', ') || 'none'}`);
console.log(`[notification-architecture] canonical readers: ${canonicalReaders.join(', ') || 'none'}`);
console.log(`[notification-architecture] duplicate domain logic: ${duplicateDomainLogic.join(', ') || 'none'}`);
console.log(`[notification-architecture] ad-hoc routes: ${adHocRoutes.join(', ') || 'none'}`);
console.log(`[notification-architecture] metadata boundary: ${METADATA}`);
console.log(`[notification-architecture] SLA boundary: ${SLA_MIGRATION}`);
console.log(`[notification-architecture] SLA read model: ${SLA_READ_MODEL_MIGRATION}`);
console.log(`[notification-architecture] SLA escalation invariant: ${SLA_REFERENCE_MIGRATION}`);
console.log(`[notification-architecture] SLA integrity audit: ${SLA_INTEGRITY_MIGRATION}`);
console.log(`[notification-architecture] lifecycle state machine: ${LIFECYCLE_MIGRATION}`);
console.log(`[notification-architecture] lifecycle UI parity: ${DOMAIN} -> ${OPERATIONS_CENTER}`);

if (failures.length) {
  console.error('\nNotification architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[notification-architecture] PASS: one command boundary, one canonical read model, one domain owner, one metadata contract, one SLA scheduler path, SLA escalation is reference-only, lifecycle transitions are DB-enforced and UI-aligned, no compatibility read debt.');
