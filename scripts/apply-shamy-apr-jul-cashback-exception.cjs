const fs = require('node:fs');

/**
 * Validation-only script to ensure Shamy Exception cashback logic is present in source.
 * This script NO LONGER applies patches; it only validates that required safeguards exist.
 * The cashback business logic (branch scope, SHAMY_EXCEPTION dates, and RPC calls) must be
 * present in source files already.
 */

function ensurePattern(path, predicate, message) {
  const source = fs.readFileSync(path, 'utf8');
  if (!predicate(source)) {
    throw new Error(`${message} (${path})`);
  }
}

const validations = [
  {
    file: 'src/pages/CustomerCashback.tsx',
    checks: [
      (source) => source.includes('SHAMY_EXCEPTION_BRANCH'),
      (source) => source.includes('currentBoundsForBranch'),
      (source) => source.includes('2026-04-01'),
      (source) => source.includes('2026-07-31'),
    ],
    message: 'CustomerCashback.tsx must have Shamy Exception constants and bounds function',
  },
  {
    file: 'src/lib/customerEngagement.ts',
    checks: [
      (source) => source.includes('run_quarterly_cashback_batch_for_branch_v1'),
      (source) => source.includes('p_branch'),
      (source) => source.includes('p_period_start'),
      (source) => source.includes('p_period_end'),
    ],
    message: 'customerEngagement.ts must use branch-scoped RPC call',
  },
  {
    file: 'src/pages/CustomerPointsLedger.tsx',
    checks: [
      (source) => source.includes('SHAMY_EXCEPTION_BRANCH'),
      (source) => source.includes('effectiveQuarterBounds'),
      (source) => source.includes('2026-04-01'),
    ],
    message: 'CustomerPointsLedger.tsx must have Shamy Exception support and effective bounds',
  },
];

for (const validation of validations) {
  const source = fs.readFileSync(validation.file, 'utf8');
  for (const check of validation.checks) {
    if (!check(source)) {
      throw new Error(`[shamy-cashback-guard] ${validation.message}`);
    }
  }
}

console.log('[shamy-cashback-guard] ✓ All Shamy Exception cashback safeguards validated in source. No source files were modified.');
