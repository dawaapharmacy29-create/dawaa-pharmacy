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
  'src/lib/__tests__/invoiceImporter.test.ts',
  'src/lib/__tests__/staffIdentityResolver.live.test.ts',
  'src/lib/__tests__/unifiedEmployeeCore.regression.test.ts',
  'src/lib/readModels/__tests__/staffDirectoryCompleteness.test.ts',
  'src/lib/__tests__/whatsappStaffIdentityResolver.test.ts',
  'src/lib/evaluations/__tests__/doctorPerformanceEye.test.ts',
  'src/components/salesIntelligence/__tests__/SalesIntelligenceManagementOverviewV1.test.ts',
];
const ZONES = ['Africa/Cairo', 'UTC'];
// These files assert wall-clock budgets/cold-load deadlines. Execute them without
// concurrent PGlite/catalog suites competing for the same CPU; keep every test
// and every original deadline/threshold, in both zones.
const TIMING_SUITES = [
  'src/lib/salesIntelligence/basketV2/__tests__/performance.ib3_1.test.ts',
  'src/lib/salesIntelligence/persistence/__tests__/refreshSourceCanonicalGate.test.ts',
];

const vitest = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
let failed = false;
for (const zone of ZONES) {
  console.log(`\n[si-regression-gate] TZ=${zone}`);
  const phases = [
    ['regression', [...SUITES, ...TIMING_SUITES.flatMap(file => ['--exclude', file])]],
    ['isolated timing', ['--maxWorkers', '1', '--minWorkers', '1', '--no-file-parallelism', ...TIMING_SUITES]],
  ];
  for (const [label, args] of phases) {
    console.log(`[si-regression-gate] ${label}`);
    const run = spawnSync(process.execPath, [vitest, 'run', '--reporter=dot', ...args], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, TZ: zone },
    });
    if (run.status !== 0) {
      failed = true;
      console.error(`[si-regression-gate] FAILED ${label} under TZ=${zone}`);
    }
  }
}
if (failed) process.exit(1);
console.log('\n[si-regression-gate] PASS');
