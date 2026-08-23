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

const directWriters = [];
for (const file of walk(SRC)) {
  const source = fs.readFileSync(file, 'utf8');
  if (!hasDirectWrite(source)) continue;
  directWriters.push(path.relative(ROOT, file).replace(/\\/g, '/'));
}

directWriters.sort();
const unexpected = directWriters.filter((file) => !BASELINED_DIRECT_WRITERS.has(file));
const staleBaseline = [...BASELINED_DIRECT_WRITERS].filter((file) => !directWriters.includes(file));

console.log(`[employee-transaction-write-boundary] direct writers: ${directWriters.length}`);
for (const file of directWriters) console.log(`- ${file}`);

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

console.log('[employee-transaction-write-boundary] PASS: direct writer baseline is exact and no new ledger writer was introduced.');
