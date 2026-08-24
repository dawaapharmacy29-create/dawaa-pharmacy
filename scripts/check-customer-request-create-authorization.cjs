#!/usr/bin/env node
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/20260824201500_harden_customer_request_create_authorization_v2.sql';
const createClientPath = 'src/features/customer-requests/create/createCanonicalCustomerRequest.ts';
const failures = [];

if (!fs.existsSync(migrationPath)) {
  failures.push(`Missing ${migrationPath}`);
} else {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  for (const token of [
    'create_customer_request_canonical_v2',
    'dawaa_current_staff_account_id_strict()',
    "dawaa_can_access_customer_request_branch('manage_customer_requests'",
    'create_customer_request_canonical_v1',
    'set search_path = public, pg_catalog',
    'revoke all on function public.create_customer_request_canonical_v2',
  ]) {
    if (!migration.includes(token)) failures.push(`Create authorization migration must include ${token}`);
  }
  if (/v_role\s*:|general_manager.*branch_manager/s.test(migration)) {
    failures.push('V2 create authorization must not reintroduce a role-only permission decision before the canonical permission helper.');
  }
}

if (!fs.existsSync(createClientPath)) {
  failures.push(`Missing ${createClientPath}`);
} else {
  const client = fs.readFileSync(createClientPath, 'utf8');
  if (!client.includes("supabase.rpc('create_customer_request_canonical_v2'")) {
    failures.push('Canonical create client must call create_customer_request_canonical_v2.');
  }
  if (client.includes("supabase.rpc('create_customer_request_canonical_v1'")) {
    failures.push('Frontend must never bypass V2 create authorization by calling V1 directly.');
  }
}

if (failures.length) {
  console.error('\nCustomer Request create authorization boundary failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[customer-request-create-authorization] PASS: canonical create requires strict actor identity and canonical manage permission/branch scope before V1 transactional creation.');
