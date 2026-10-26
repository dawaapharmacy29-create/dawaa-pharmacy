#!/usr/bin/env node
// Sales Intelligence / WhatsApp Master Brain regression gate.
//
// scripts/run-tests.cjs runs a curated list without `vi`, so the Sales Intelligence suites that
// need module mocks (Source Gate transport, canonical backfill, review persistence) and the
// deterministic Golden Case 1 replay never ran in CI. This gate runs them through Vitest in two
// time zones, so timestamp handling cannot silently depend on the machine's zone.
//
// Every suite listed here must be green. A failure is classified and fixed at its source; it is
// never removed from this list to make the gate pass.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SUITES = [
  // Whole Sales Intelligence tree: engines, Golden Case 1, Source Gate, integrity, QA window.
  'src/lib/salesIntelligence',
  // WhatsApp automatic review persistence (needs module mocks, so it cannot run in run-tests.cjs).
  'src/lib/__tests__/whatsappAutomaticReviewPersistence.test.ts',
  'src/lib/__tests__/whatsappConversationJourneyClassifier.test.ts',
  // Shared alias authorization/fail-closed identity protects import and WhatsApp attribution.
  'src/lib/__tests__/staffIdentityMapping.failClosed.test.ts',
  'src/lib/__tests__/unifiedEmployeeCore.regression.test.ts',
  'src/lib/readModels/__tests__/staffDirectoryCompleteness.test.ts',
  'src/lib/__tests__/whatsappStaffIdentityResolver.test.ts',
  'src/lib/evaluations/__tests__/doctorPerformanceEye.test.ts',
  'src/components/salesIntelligence/__tests__/SalesIntelligenceManagementOverviewV1.test.ts',
];
const ZONES = ['Africa/Cairo', 'UTC'];

const vitest = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
let failed = false;
for (const zone of ZONES) {
  console.log(`\n[si-regression-gate] TZ=${zone}`);
  const run = spawnSync(process.execPath, [vitest, 'run', '--reporter=dot', ...SUITES], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, TZ: zone },
  });
  if (run.status !== 0) {
    failed = true;
    console.error(`[si-regression-gate] FAILED under TZ=${zone}`);
  }
}
if (failed) process.exit(1);
console.log('\n[si-regression-gate] PASS');
