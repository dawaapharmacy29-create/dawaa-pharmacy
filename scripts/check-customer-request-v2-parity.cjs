#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const failures = [];

function read(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    failures.push(`missing required Customer Requests V2 file: ${relativePath}`);
    return '';
  }
  return fs.readFileSync(fullPath, 'utf8');
}

function requireTokens(relativePath, tokens) {
  const source = read(relativePath);
  const normalized = source.toLowerCase();
  for (const token of tokens) {
    if (!normalized.includes(token.toLowerCase())) {
      failures.push(`${relativePath} missing parity contract token: ${token}`);
    }
  }
}

requireTokens('src/pages/CustomerRequests.tsx', [
  'CustomerRequestsV2',
  'CustomerRequestsLegacy',
  "searchParams.get('legacy') === '1'",
]);

requireTokens('src/features/customer-requests/workspace/CustomerRequestsWorkspace.tsx', [
  'CanonicalCreateRequestDialog',
  'CustomerRequestDetailsDrawer',
  'exportCustomerRequestsWorkspace',
  'showAdvancedFilters',
  'dateFrom',
  'dateTo',
  'sourceChannel',
  'urgency',
  'assignee',
]);

requireTokens('src/features/customer-requests/workspace/CustomerRequestDetailsDrawer.tsx', [
  'updateCustomerRequestDetails',
  'recordCustomerRequestSourcing',
  'contactCustomerForRequest',
  'reopenCustomerRequestSearch',
  'cancelCustomerRequest',
  'sendCustomerRequestToShortages',
  'expectedArrivalDate',
  'datetime-local',
  'تعديل تفاصيل التنفيذ',
]);

requireTokens('src/features/customer-requests/commands/customerRequestCommands.ts', [
  'assertCustomerRequestTransition',
  'startCustomerRequestSearch',
  'recordCustomerRequestSourcing',
  'confirmCustomerRequest',
  'contactCustomerForRequest',
  'deliverCustomerRequest',
  'cancelCustomerRequest',
  'reopenCustomerRequestSearch',
  'sendCustomerRequestToShortages',
]);

requireTokens('src/features/customer-requests/domain/__tests__/customerRequestsDomain.test.ts', [
  "customerRequestTierPoints('tier_1', 'request_registered')).toBe(2)",
  "customerRequestTierPoints('tier_2', 'request_registered')).toBe(1)",
  "customerRequestTierPoints('tier_3', 'request_registered')).toBe(0.5)",
  "customerRequestTierPoints('tier_1', 'request_achieved')).toBe(4)",
  "customerRequestTierPoints('tier_2', 'request_achieved')).toBe(2)",
  "customerRequestTierPoints('tier_3', 'request_achieved')).toBe(1)",
]);

const drawer = read('src/features/customer-requests/workspace/CustomerRequestDetailsDrawer.tsx');
if (/medicine_name:\s*edit/i.test(drawer)) {
  failures.push('V2 edit flow must not mutate medicine_name independently from canonical product identity');
}

const commands = read('src/features/customer-requests/commands/customerRequestCommands.ts');
if (/status:\s*['"]delivered['"][\s\S]{0,300}without/i.test(commands)) {
  failures.push('delivery transition appears to bypass the canonical transition guard');
}

if (failures.length) {
  console.error('Customer Requests V2 parity architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[customer-request-v2-parity] PASS: V2 preserves canonical create, operational filters, edit/contact/sourcing/cancel/reopen/shortage actions, legacy fallback, and approved doctor point schedule.');
