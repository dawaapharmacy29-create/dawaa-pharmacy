#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

// Transitional direct writers that still exist today. Keep shrinking this set as
// writers move behind a canonical authorization-aware service/RPC. New direct
// writers are forbidden.
const BASELINED_DIRECT_WRITERS = new Set([
  'src/lib/pointsPersistence.ts',
  'src/services/employeeTransactionService.ts',
  'src/pages/BranchInspection.tsx',
  'src/pages/Points.tsx',
  'src/pages/PenaltyIncentiveManagement.tsx',
  'src/lib/api/shiftPerformanceReviewService.ts',
]);

// `staff.points` is a transitional mutable snapshot, not the canonical ledger.
// Keep the current compatibility writer isolated while the balance projection is
// migrated to ledger-derived/server-side truth. Any new direct writer is a hard
// architecture regression.
const BASELINED_STAFF_POINTS_WRITERS = new Set([
  'src/lib/pointsPersistence.ts',
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

function hasDirectWrite(source) {
  const starts = [
    /\.from\(\s*TABLES\.employeeTransactions\s*\)/g,
    /\.from\(\s*['"]employee_transactions['"]\s*\)/g,
  ];
  for (const pattern of starts) {
    for (const match of source.matchAll(pattern)) {
      const tail = source.slice(match.index, match.index + 900);
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
for (const file of walk(SRC)) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(ROOT, file).replace(/\\/g, '/');
  if (hasDirectWrite(source)) directWriters.push(relative);
  if (hasDirectStaffPointsWrite(source)) staffPointsWriters.push(relative);
}

directWriters.sort();
staffPointsWriters.sort();
const unexpected = directWriters.filter((file) => !BASELINED_DIRECT_WRITERS.has(file));
const staleBaseline = [...BASELINED_DIRECT_WRITERS].filter((file) => !directWriters.includes(file));
const unexpectedStaffPointsWriters = staffPointsWriters.filter(
  (file) => !BASELINED_STAFF_POINTS_WRITERS.has(file)
);
const staleStaffPointsBaseline = [...BASELINED_STAFF_POINTS_WRITERS].filter(
  (file) => !staffPointsWriters.includes(file)
);

console.log(`[employee-transaction-write-boundary] direct writers: ${directWriters.length}`);
for (const file of directWriters) console.log(`- ${file}`);
console.log(`[employee-transaction-write-boundary] direct staff.points writers: ${staffPointsWriters.length}`);
for (const file of staffPointsWriters) console.log(`- ${file}`);

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

console.log('[employee-transaction-write-boundary] PASS: direct ledger writers and staff.points snapshot writers match the exact transitional baselines.');
