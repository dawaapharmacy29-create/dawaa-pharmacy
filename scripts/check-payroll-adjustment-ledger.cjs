#!/usr/bin/env node
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/20260830224500_payroll_post_paid_adjustment_ledger_v1.sql';
const failures = [];

if (!fs.existsSync(migrationPath)) {
  failures.push(`Missing payroll adjustment ledger migration: ${migrationPath}`);
} else {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const lower = sql.toLowerCase();
  for (const token of [
    'staff_payroll_adjustments_v1',
    'staff_payroll_adjustment_applications_v1',
    'payroll_adjustment_ledger_is_immutable',
    'create_staff_payroll_adjustment_v1',
    'reverse_staff_payroll_adjustment_v1',
    'get_staff_payroll_adjustment_balance_v1',
    "v_payroll.status<>'paid'",
    'reversal_of',
    'outstanding_balance',
  ]) {
    if (!lower.includes(token.toLowerCase())) failures.push(`Payroll adjustment migration missing ${token}.`);
  }

  for (const table of ['staff_payroll_adjustments_v1', 'staff_payroll_adjustment_applications_v1']) {
    const re = new RegExp(`revoke\\s+all\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+public,anon,authenticated`, 'i');
    if (!re.test(sql)) failures.push(`${table} must not expose browser table writes/reads.`);
  }
  if (!/before\s+update\s+or\s+delete[\s\S]*dawaa_block_payroll_adjustment_mutation_v1/i.test(sql)) {
    failures.push('Adjustment ledger must block UPDATE/DELETE with an immutable trigger.');
  }
  if (/update\s+public\.staff_payroll_monthly_v13/i.test(sql)) {
    failures.push('Adjustment foundation must not reopen or mutate paid payroll rows.');
  }
  if (!/insert\s+into\s+public\.staff_payroll_adjustments_v1/i.test(sql)) {
    failures.push('Corrections and reversals must be append-only ledger entries.');
  }
}

if (failures.length) {
  console.error('\nPayroll adjustment ledger architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[payroll-adjustment-ledger] PASS: post-paid corrections are append-only, reversible by entry, and isolated from frozen payroll rows.');
