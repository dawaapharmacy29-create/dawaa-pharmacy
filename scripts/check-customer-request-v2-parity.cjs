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
  'return <CustomerRequestsV2 />',
]);

if (fs.existsSync(path.join(ROOT, 'src/pages/CustomerRequestsLegacy.tsx'))) {
  failures.push('retired CustomerRequestsLegacy.tsx must not return as a second routed write surface');
}

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
  'lazy(() => import',
  'Suspense',
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
  'customerFollowupHref',
  "params.set('quickFollowup', '1')",
  'customer-service?',
  '/staff/',
]);

requireTokens('src/features/customer-requests/commands/customerRequestCommands.ts', [
  'assertCustomerRequestTransition',
  'startCustomerRequestSearch',
  'recordCustomerRequestSourcing',
  'confirmCustomerRequest',
  'contactCustomerForRequest',
  'startCustomerRequestSourcing',
  'markCustomerRequestArrived',
  'deliverCustomerRequest',
  'closeCustomerRequest',
  'cancelCustomerRequest',
  'reopenCustomerRequestSearch',
  'sendCustomerRequestToShortages',
  'record_customer_request_contact_v2',
  'updateCustomerRequestDetailsV2',
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

requireTokens('supabase/migrations/20260824174000_customer_request_search_indexes_v2.sql', [
  'gin_trgm_ops',
  'customer_name',
  'medicine_name',
  'doctor_name',
  'product_code',
]);

requireTokens('supabase/migrations/20260824182000_customer_request_transition_matrix_complete_v2.sql', [
  'advance_customer_request_v2',
  "'start_sourcing'",
  "'mark_arrived'",
  "'close'",
  "'customer_request_transition_invalid'",
]);

requireTokens('supabase/migrations/20260824181000_customer_request_shortage_alignment_v2.sql', [
  'move_customer_request_to_shortage_v1',
  "'purchasing_review'",
  "'searching_suppliers'",
  "'request',to_jsonb(v_updated)",
  'source_customer_request_id',
]);

requireTokens('src/features/customer-requests/commands/moveCustomerRequestToShortageSecure.ts', [
  'payload.request',
  'الطلب المحدث من العملية الذرية',
]);

requireTokens('supabase/migrations/20260824180000_customer_request_summary_alignment_v2.sql', [
  "'attention'",
  "'ready'",
  'dawaa_customer_request_sla_hours',
  "'followup_due'",
  "'fulfillment_rate'",
]);

requireTokens('src/features/customer-requests/workspace/CustomerRequestQueueStrip.tsx', [
  'summary.attention',
]);

requireTokens('supabase/migrations/20260824175000_customer_request_operational_indexes_v2.sql', [
  'requested_at desc',
  'branch, requested_at desc',
  'doctor_id, requested_at desc',
  'status, requested_at desc',
]);

requireTokens('supabase/migrations/20260824183000_customer_request_summary_v2.sql', [
  'get_customer_requests_command_center_summary_v2',
  'get_customer_requests_command_center_summary',
  'followup_due',
  'next_action_at',
]);

requireTokens('supabase/migrations/20260824172000_customer_request_product_metrics_v2.sql', [
  'get_customer_request_product_metrics_v2',
  'p_product_codes text[]',
  "dawaa_can_access_customer_request_branch('view_customer_requests'",
  'fulfilled_count',
  'fulfillment_rate',
]);

requireTokens('src/features/customer-requests/data/customerRequestProductMetrics.ts', [
  'get_customer_request_product_metrics_v2',
  'new Set',
  'slice(0, 100)',
]);

requireTokens('supabase/migrations/20260824171000_customer_request_details_command_v2.sql', [
  'update_customer_request_details_v2',
  'for update',
  "dawaa_can_access_customer_request_branch('manage_customer_requests'",
  'customer_request_events',
  'canonical request identity remains immutable',
]);

requireTokens('supabase/migrations/20260824182500_customer_request_atomic_transition_v2.sql', [
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

const exportExcelSource = read('src/lib/exportExcel.ts');
if (/^\s*import\s+\*\s+as\s+XLSX\s+from\s+['"]xlsx['"]/m.test(exportExcelSource)) {
  failures.push('XLSX must stay dynamically imported so Customer Requests operations do not pay the spreadsheet bundle cost on first load');
}
if (!exportExcelSource.includes("await import('xlsx')")) {
  failures.push('Excel export must preserve lazy XLSX loading');
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

const legacyRequestApi = read('src/lib/api/customerRequests.ts');
if (/insertResilient\(\s*['"]customer_requests['"]/.test(legacyRequestApi) ||
    /updateResilient\(\s*['"]customer_requests['"]/.test(legacyRequestApi) ||
    /\.from\(\s*['"]customer_requests['"]\s*\)\s*\.\s*(?:insert|update|delete|upsert)\b/.test(legacyRequestApi)) {
  failures.push('legacy customer request API must not mutate customer_requests directly; all state writes belong to canonical atomic commands');
}
if (!legacyRequestApi.includes('getCustomerRequestsPage')) {
  failures.push('legacy request list reader should delegate to the canonical repository');
}
if (!legacyRequestApi.includes('تم إيقاف مسار إنشاء طلبات العملاء القديم')) {
  failures.push('legacy non-canonical request creation must remain explicitly retired');
}
if (!legacyRequestApi.includes('تم إيقاف الكتابة المباشرة في سجل أحداث طلبات العملاء')) {
  failures.push('direct client-side Customer Request event writing must remain retired');
}

function walkSourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(full);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}
for (const full of walkSourceFiles(path.join(ROOT, 'src'))) {
  if (full.endsWith(path.join('lib', 'api', 'customerRequests.ts'))) continue;
  const source = fs.readFileSync(full, 'utf8');
  const retiredCompatibilityCalls = [
    'createCustomerRequest',
    'addCustomerRequestEvent',
    'updateCustomerRequestStatus',
    'recordCustomerRequestContactAttempt',
    'updateCustomerRequestDetails',
    'moveCustomerRequestToShortage',
  ];
  for (const name of retiredCompatibilityCalls) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(source)) {
      failures.push(`retired ${name} compatibility API is still called by ${path.relative(ROOT, full)}`);
    }
  }
  if (/\.from\(\s*['"]customer_requests['"]\s*\)\s*\.(?:insert|update|delete|upsert)\b/.test(source)) {
    failures.push(`direct client mutation of customer_requests is forbidden outside atomic RPC commands: ${path.relative(ROOT, full)}`);
  }
}

const queueRepository = read('src/features/customer-requests/data/customerRequestsRepository.ts');
if (!/quick === 'urgent'[\s\S]{0,220}not\('status', 'in'/.test(queueRepository) ||
    !/quick === 'unassigned'[\s\S]{0,220}not\('status', 'in'/.test(queueRepository)) {
  failures.push('urgent and unassigned queues should exclude final statuses to match their summary counters');
}

const requestRepository = read('src/features/customer-requests/data/customerRequestsRepository.ts');
if (!requestRepository.includes('CUSTOMER_REQUEST_OPERATIONAL_SELECT')) {
  failures.push('operations list must use an explicit lean select instead of loading the full customer_requests row');
}
if (/\.select\(\s*['"]\*['"]\s*,\s*\{\s*count:\s*['"]exact['"]/.test(requestRepository)) {
  failures.push('operations list must not select source_payload and other full-row baggage on every page');
}
if (!requestRepository.includes('get_customer_requests_command_center_summary_v2')) {
  failures.push('operations summary should use the one-round-trip V2 RPC');
}
if (!requestRepository.includes('includeCount?: boolean')) {
  failures.push('bulk export should be able to skip repeated exact counts after the first page');
}

if (!requestRepository.includes('customerSegmentCache')) {
  failures.push('canonical customer segment enrichment should be cached across request pages');
}

const requestWorkspace = read('src/features/customer-requests/workspace/CustomerRequestsWorkspace.tsx');
if (requestWorkspace.includes('getCustomerRequestOperationalInsights')) {
  failures.push('operations workspace must not load the full analytics payload just to show visible product fulfillment rates');
}
if (!requestWorkspace.includes('getCustomerRequestProductMetrics')) {
  failures.push('operations workspace must request focused fulfillment metrics for visible products');
}

const requestExport = read('src/features/customer-requests/data/customerRequestExport.ts');
if (!requestExport.includes('includeCount: page === 1')) {
  failures.push('request export must only request an exact count on the first page');
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

console.log('[customer-request-v2-parity] PASS: V2 is the single routed Customer Requests surface with branch-scoped SPA navigation, canonical create, atomic lifecycle commands, exact follow-up timing, operational filters, sourcing/contact/shortage actions, and approved doctor point schedule.');
