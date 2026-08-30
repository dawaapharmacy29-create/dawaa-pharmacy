#!/usr/bin/env node
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/20260830122537_payroll_atomic_next_payroll_settlement_v1.sql';
const failures = [];

if (!fs.existsSync(migrationPath)) {
  failures.push(`Missing atomic payroll settlement migration: ${migrationPath}`);
} else {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const lower = sql.toLowerCase();

  for (const token of [
    'staff_payroll_adjustment_applications_v1_adjustment_uidx',
    'post_paid_adjustments_total',
    'save_staff_payroll_monthly_v16',
    "a.apply_mode='next_payroll'",
    'a.source_payroll_month < p_payroll_month',
    'not exists',
    'for update',
    'manual_adjustment_input',
    'effective_manual_adjustment',
    'post_paid_adjustments',
    "'settlement_mode','next_payroll_atomic_v1'",
    'freeze_version=16',
  ]) {
    if (!lower.includes(token.toLowerCase())) failures.push(`Atomic settlement migration missing ${token}.`);
  }

  if (!/create\s+unique\s+index[\s\S]*staff_payroll_adjustment_applications_v1\s*\(adjustment_id\)/i.test(sql)) {
    failures.push('Exactly-once settlement requires a unique application index on adjustment_id.');
  }
  if (!/if\s+found\s+and\s+coalesce\(v_existing\.status,'draft'\)\s+in\s*\('approved','paid'\)[\s\S]*return\s+v_existing/i.test(sql)) {
    failures.push('Approved/Paid payroll must remain frozen and idempotent before consuming new adjustments.');
  }
  if (!/insert\s+into\s+public\.staff_payroll_adjustment_applications_v1/i.test(sql)) {
    failures.push('Settlement must persist immutable application records.');
  }
  if (!/create\s+or\s+replace\s+function\s+public\.save_staff_payroll_monthly_v14[\s\S]*select\s+public\.save_staff_payroll_monthly_v16/i.test(sql)) {
    failures.push('v14 compatibility facade must route through v16 so clients cannot bypass settlement.');
  }
  if (!/revoke\s+all\s+on\s+function\s+public\.save_staff_payroll_monthly_v15[\s\S]*from\s+public,anon,authenticated/i.test(sql)) {
    failures.push('v15 must be internal after v16 becomes the settlement gate.');
  }
  if (!/revoke\s+all\s+on\s+function\s+public\.save_staff_payroll_monthly_v16[\s\S]*from\s+public,anon,authenticated/i.test(sql)) {
    failures.push('v16 must be internal; clients use the gated v14 facade.');
  }
}

if (failures.length) {
  console.error('\nPayroll atomic settlement architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[payroll-atomic-settlement] PASS: post-paid adjustments settle exactly once into a later frozen payroll snapshot.');
