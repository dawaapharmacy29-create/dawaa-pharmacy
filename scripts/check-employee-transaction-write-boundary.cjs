#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const POINTS_PERSISTENCE = path.join(SRC, 'lib/pointsPersistence.ts');
const EMPLOYEE_TRANSACTION_SERVICE = path.join(SRC, 'services/employeeTransactionService.ts');
const APPEAL_MIGRATION = path.join(
  ROOT,
  'supabase/migrations/20260824151100_point_appeal_atomic_reversal_v1.sql'
);
const TRANSITION_MIGRATION = path.join(
  ROOT,
  'supabase/migrations/20260827011500_retire_legacy_rules_and_guard_point_transitions_v4.sql'
);

// Transitional direct writers that still exist today. Keep shrinking this set as
// lifecycle mutations move behind canonical authorization-aware RPCs. New direct
// writers are forbidden.
const BASELINED_DIRECT_WRITERS = new Set([
  'src/services/employeeTransactionService.ts',
]);

// `staff.points` is a transitional mutable snapshot, not the canonical ledger.
// Any new direct writer is a hard architecture regression.
const BASELINED_STAFF_POINTS_WRITERS = new Set();
const BASELINED_STAFF_DELTA_CALLERS = new Set();

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

function hasDirectWrite(source) {
  const starts = [
    /\.from\(\s*TABLES\.employeeTransactions\s*\)/g,
    /\.from\(\s*['"]employee_transactions['"]\s*\)/g,
  ];
  for (const pattern of starts) {
    for (const match of source.matchAll(pattern)) {
      const candidate = source.slice(match.index, match.index + 900);
      const tail = candidate.slice(0, candidate.indexOf(';') >= 0 ? candidate.indexOf(';') : candidate.length);
      if (/\.(?:insert|update|upsert|delete)\s*\(/.test(tail)) return true;
    }
  }
  return false;
}

function hasDirectStaffPointsWrite(source) {
  const starts = [
    /\.from\(\s*TABLES\.staff\s*\)/g,
    /\.from\(\s*['"]staff['"]\s*\)/g,
  ];
  for (const pattern of starts) {
    for (const match of source.matchAll(pattern)) {
      const tail = source.slice(match.index, match.index + 1000);
      const mutation = tail.match(/\.(?:update|upsert)\s*\(\s*\{[\s\S]{0,700}?\}\s*\)/);
      if (mutation && /\bpoints\s*:/.test(mutation[0])) return true;
    }
  }
  return false;
}

const directWriters = [];
const staffPointsWriters = [];
const staffDeltaCallers = [];
for (const file of walk(SRC)) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(ROOT, file).replace(/\\/g, '/');
  if (hasDirectWrite(source)) directWriters.push(relative);
  if (hasDirectStaffPointsWrite(source)) staffPointsWriters.push(relative);
  if (relative !== 'src/lib/pointsPersistence.ts' && /\bapplyStaffDelta\s*\(/.test(source)) {
    staffDeltaCallers.push(relative);
  }
}

directWriters.sort();
staffPointsWriters.sort();
staffDeltaCallers.sort();
const unexpected = directWriters.filter((file) => !BASELINED_DIRECT_WRITERS.has(file));
const staleBaseline = [...BASELINED_DIRECT_WRITERS].filter((file) => !directWriters.includes(file));
const unexpectedStaffPointsWriters = staffPointsWriters.filter(
  (file) => !BASELINED_STAFF_POINTS_WRITERS.has(file)
);
const staleStaffPointsBaseline = [...BASELINED_STAFF_POINTS_WRITERS].filter(
  (file) => !staffPointsWriters.includes(file)
);
const unexpectedStaffDeltaCallers = staffDeltaCallers.filter(
  (file) => !BASELINED_STAFF_DELTA_CALLERS.has(file)
);
const staleStaffDeltaBaseline = [...BASELINED_STAFF_DELTA_CALLERS].filter(
  (file) => !staffDeltaCallers.includes(file)
);

console.log(`[employee-transaction-write-boundary] direct writers: ${directWriters.length}`);
for (const file of directWriters) console.log(`- ${file}`);
console.log(`[employee-transaction-write-boundary] direct staff.points writers: ${staffPointsWriters.length}`);
for (const file of staffPointsWriters) console.log(`- ${file}`);
console.log(`[employee-transaction-write-boundary] direct staff delta callers: ${staffDeltaCallers.length}`);
for (const file of staffDeltaCallers) console.log(`- ${file}`);

if (staleBaseline.length) {
  console.error('\nEmployee transaction write boundary failed:');
  for (const file of staleBaseline) {
    console.error(`- ${file} no longer writes employee_transactions directly; remove it from the transitional baseline`);
  }
  process.exit(1);
}

if (unexpected.length) {
  console.error('\nEmployee transaction write boundary failed:');
  for (const file of unexpected) {
    console.error(`- ${file} writes employee_transactions directly but is not an approved transitional writer`);
  }
  process.exit(1);
}

if (staleStaffPointsBaseline.length) {
  console.error('\nEmployee points snapshot write boundary failed:');
  for (const file of staleStaffPointsBaseline) {
    console.error(`- ${file} no longer writes staff.points directly; remove it from the transitional baseline`);
  }
  process.exit(1);
}

if (unexpectedStaffPointsWriters.length) {
  console.error('\nEmployee points snapshot write boundary failed:');
  console.error('staff.points is a transitional projection only; new code must write an auditable employee event/settlement instead.');
  for (const file of unexpectedStaffPointsWriters) {
    console.error(`- ${file} writes staff.points directly outside the approved compatibility boundary`);
  }
  process.exit(1);
}

if (staleStaffDeltaBaseline.length || unexpectedStaffDeltaCallers.length) {
  console.error('\nEmployee points snapshot caller boundary failed:');
  for (const file of staleStaffDeltaBaseline) {
    console.error(`- ${file} no longer calls applyStaffDelta; remove it from the transitional baseline`);
  }
  for (const file of unexpectedStaffDeltaCallers) {
    console.error(`- ${file} calls retired applyStaffDelta instead of writing an auditable ledger event`);
  }
  process.exit(1);
}

// V3 is now deployed and merged. The application must fail closed when the canonical
// command is unavailable instead of silently writing through an older client path.
const pointsPersistence = fs.readFileSync(POINTS_PERSISTENCE, 'utf8');
if (!/\.rpc\(\s*['"]record_employee_points_transaction_v3['"]/.test(pointsPersistence)) {
  console.error('\nEmployee points command boundary failed: pointsPersistence must use record_employee_points_transaction_v3.');
  process.exit(1);
}
for (const forbidden of [
  /createEmployeeTransaction\s*\(/,
  /updateEmployeeTransaction\s*\(/,
  /temporary legacy persistence fallback/i,
  /V3 command unavailable; using/i,
]) {
  if (forbidden.test(pointsPersistence)) {
    console.error('\nEmployee points command boundary failed: legacy client persistence fallback returned.');
    process.exit(1);
  }
}

// Lifecycle status changes are also authorization-sensitive and must stay behind the
// server-side V4 transition command. This protects branch scope and row locking.
if (!fs.existsSync(TRANSITION_MIGRATION)) {
  console.error('\nEmployee points transition boundary failed: guarded transition migration is missing.');
  process.exit(1);
}
const transactionService = fs.readFileSync(EMPLOYEE_TRANSACTION_SERVICE, 'utf8');
const transitionFunction = transactionService.match(/export async function transitionEmployeeTransaction[\s\S]*?\n}\n/)?.[0] || '';
if (!/\.rpc\(\s*['"]transition_employee_points_transaction_v4['"]/.test(transitionFunction)) {
  console.error('\nEmployee points transition boundary failed: lifecycle transition must use transition_employee_points_transaction_v4.');
  process.exit(1);
}
if (/\.from\(\s*(?:TABLES\.employeeTransactions|['"]employee_transactions['"])\s*\)[\s\S]*?\.update\s*\(/.test(transitionFunction)) {
  console.error('\nEmployee points transition boundary failed: direct lifecycle UPDATE returned.');
  process.exit(1);
}
const transitionMigration = fs.readFileSync(TRANSITION_MIGRATION, 'utf8');
for (const token of [
  'transition_employee_points_transaction_v4',
  'employee_operating_can_manage()',
  'for update',
  "p_status not in ('pending', 'active', 'cancelled')",
  'revoke all on function public.transition_employee_points_transaction_v4',
]) {
  if (!transitionMigration.toLowerCase().includes(token.toLowerCase())) {
    console.error(`\nEmployee points transition boundary failed: migration missing ${token}.`);
    process.exit(1);
  }
}

if (!fs.existsSync(APPEAL_MIGRATION)) {
  console.error('\nEmployee points appeal boundary failed: canonical reversal migration is missing.');
  process.exit(1);
}
const appealMigration = fs.readFileSync(APPEAL_MIGRATION, 'utf8');
for (const token of [
  'review_point_appeal_v1',
  'point_appeal_reversal',
  'for update',
  'uq_employee_transactions_point_appeal_reversal_v1',
  "p_decision not in ('upheld','overturned')",
]) {
  if (!appealMigration.toLowerCase().includes(token.toLowerCase())) {
    console.error(`\nEmployee points appeal boundary failed: migration missing ${token}.`);
    process.exit(1);
  }
}

const appealPage = fs.readFileSync(path.join(SRC, 'pages/PointAppeals.tsx'), 'utf8');
if (!/\.rpc\(\s*['"]review_point_appeal_v1['"]/.test(appealPage)) {
  console.error('\nEmployee points appeal boundary failed: UI must use the atomic review RPC.');
  process.exit(1);
}

console.log('[employee-transaction-write-boundary] PASS: canonical V3 write and V4 lifecycle commands are fail-closed; direct ledger/snapshot writers match the exact transitional baselines.');
