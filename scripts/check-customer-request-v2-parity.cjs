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

requireTokens('src/pages/CustomerRequestsV2.tsx', [
  'useNavigate',
  "params.get('workspace')",
  "selectTab('operations')",
  "selectTab('sourcing')",
  "selectTab('analytics')",
  "selectTab('quality')",
  'canSeeAllBranches',
  'getUserBranch',
  'effectiveAnalyticsBranch',
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
  'canSeeAllBranches',
  'getUserBranch',
  'scopedBranchKey',
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
  'record_customer_request_contact_v2',
]);

requireTokens('src/features/customer-requests/data/customerRequestsRepository.ts', [
  'followupDueOrFilter',
  'next_action_at.lte',
  'next_action_at.is.null',
  'due_date.lte',
]);

requireTokens('supabase/migrations/20260824153500_customer_request_next_action_at_v1.sql', [
  'next_action_at timestamptz',
  'idx_customer_requests_next_action_at_open',
]);

requireTokens('supabase/migrations/20260824170000_customer_request_atomic_transition_v2.sql', [
  'advance_customer_request_v2',
  'for update',
  "dawaa_can_access_customer_request_branch('manage_customer_requests'",
  'customer_request_transition_invalid',
  'customer_request_events',
  'sourcing_available',
  'deliver',
  'cancel',
]);

requireTokens('supabase/migrations/20260824164500_create_customer_request_canonical_v2.sql', [
  'create_customer_request_canonical_v2',
  'create_customer_request_canonical_v1',
  'registration_credit',
  'request_registered',
  'settled',
]);

requireTokens('src/features/customer-requests/create/createCanonicalCustomerRequest.ts', [
  'create_customer_request_canonical_v2',
  'registrationCredit',
  'creditRow.settled',
]);

requireTokens('src/features/customer-requests/workspace/CanonicalCreateRequestDialog.tsx', [
  'result.registrationCredit.settled',
  'تم اعتماد نقاط التسجيل',
  'لم تُحتسب نقاط تسجيل جديدة',
]);

requireTokens('supabase/migrations/20260824163000_retire_customer_request_legacy_refresh_v1.sql', [
  'revoke all on function public.settle_doctor_self_logged_request',
  'create or replace function public.refresh_doctor_customer_request_points',
  'return 0',
  'revoke all on function public.refresh_doctor_customer_request_points',
]);

requireTokens('supabase/migrations/20260824162000_customer_request_single_points_ledger_v1.sql', [
  'drop trigger if exists request_self_log_settlement',
  'drop trigger if exists trg_set_customer_request_points_tier',
  'customer_request_incentive_events',
  "employee_transactions(source='customer_request_incentive')",
]);

requireTokens('supabase/migrations/20260824154500_record_customer_request_contact_v2.sql', [
  'record_customer_request_contact_v2',
  'security definer',
  "dawaa_can_access_customer_request_branch('manage_customer_requests'",
  'next_action_at',
  'customer_request_events',
  'customer_request_followup_must_be_future',
]);

requireTokens('src/features/customer-requests/domain/__tests__/customerRequestsDomain.test.ts', [
  "customerRequestTierPoints('tier_1', 'request_registered')).toBe(2)",
  "customerRequestTierPoints('tier_2', 'request_registered')).toBe(1)",
  "customerRequestTierPoints('tier_3', 'request_registered')).toBe(0.5)",
  "customerRequestTierPoints('tier_1', 'request_achieved')).toBe(4)",
  "customerRequestTierPoints('tier_2', 'request_achieved')).toBe(2)",
  "customerRequestTierPoints('tier_3', 'request_achieved')).toBe(1)",
]);

const permissionSystem = read('src/lib/core/permissionSystem.ts');
const shiftSupervisorBlock = permissionSystem.match(/const SHIFT_SUPERVISOR_BASE = \[([\s\S]*?)\];/)?.[1] || '';
for (const requiredPermission of ['view_customer_requests', 'manage_customer_requests']) {
  if (!shiftSupervisorBlock.includes(requiredPermission)) {
    failures.push(`shift supervisors must retain ${requiredPermission} because they are doctor-role request operators`);
  }
}

const authSource = read('src/hooks/useAuth.ts');
const doctorWorkspaceBlock = authSource.match(/const DOCTOR_WORKSPACE_PERMISSIONS = \[([\s\S]*?)\];/)?.[1] || '';
for (const requiredPermission of ['view_customer_requests', 'manage_customer_requests']) {
  if (!doctorWorkspaceBlock.includes(requiredPermission)) {
    failures.push(`doctor workspace permission cap must preserve ${requiredPermission}`);
  }
}

const v2Page = read('src/pages/CustomerRequestsV2.tsx');
if (/window\.location\.(?:href|assign|replace)/i.test(v2Page)) {
  failures.push('Customer Requests V2 workspace navigation must stay inside React Router and avoid full-page reloads');
}

const drawer = read('src/features/customer-requests/workspace/CustomerRequestDetailsDrawer.tsx');
if (/medicine_name:\s*edit/i.test(drawer)) {
  failures.push('V2 edit flow must not mutate medicine_name independently from canonical product identity');
}

const contactMigration = read('supabase/migrations/20260824154500_record_customer_request_contact_v2.sql');
if (/p_(?:actor|user|staff|created_by)(?:_id|_name)?\s+/i.test(contactMigration)) {
  failures.push('atomic contact command must derive actor identity from the app staff context');
}

const pointSettlementMigration = read('supabase/migrations/20260824162000_customer_request_single_points_ledger_v1.sql');
if (!pointSettlementMigration.includes('drop trigger if exists request_self_log_settlement') ||
    !pointSettlementMigration.includes('drop trigger if exists trg_set_customer_request_points_tier')) {
  failures.push('legacy Customer Request point writers must remain retired so the versioned incentive ledger is the only active point source');
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

console.log('[customer-request-v2-parity] PASS: V2 preserves branch-scoped SPA navigation, canonical create, atomic exact follow-up timing, operational filters, edit/contact/sourcing/cancel/reopen/shortage actions, legacy fallback, and approved doctor point schedule.');
