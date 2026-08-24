#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const migrationPath = path.join(
  ROOT,
  'supabase/migrations/20260824143000_secure_customer_request_to_shortage_command_v1.sql'
);
const failures = [];

if (!fs.existsSync(migrationPath)) {
  failures.push('missing secure Customer Request -> Shortage command migration');
} else {
  const source = fs.readFileSync(migrationPath, 'utf8');
  const required = [
    'move_customer_request_to_shortage_v1',
    'security definer',
    'dawaa_current_staff_account_id_strict()',
    "dawaa_can_access_customer_request_branch('manage_customer_requests'",
    'dawaa_current_staff_subject_uuid_v1()',
    'uq_shortage_items_customer_request_source',
    'source_customer_request_id',
    'on conflict (source_customer_request_id)',
    'customer_request_events',
    'revoke all on function public.move_customer_request_to_shortage_v1(uuid) from public',
  ];
  for (const token of required) {
    if (!source.toLowerCase().includes(token.toLowerCase())) {
      failures.push(`secure shortage command missing required contract token: ${token}`);
    }
  }

  if (/p_(?:actor|user|staff|created_by)(?:_id|_name)?\s+/i.test(source)) {
    failures.push('secure shortage command must not accept caller-supplied actor identity parameters');
  }
  if (/grant\s+(?:insert|update|delete|all)[\s\S]{0,80}shortage_items/i.test(source)) {
    failures.push('Customer Request -> Shortage command must not broaden direct shortage_items write grants');
  }
}

if (failures.length) {
  console.error('Customer Request shortage command architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[customer-request-shortage-command] PASS: request actors use one strict, branch-scoped, idempotent command without broad shortage-table privileges.');
