#!/usr/bin/env node
const fs = require('node:fs');

const required = [
  'src/lib/customerService/followupCommandService.ts',
  'supabase/migrations/20260824170000_customer_followup_atomic_command_v1.sql',
  'supabase/migrations/20260824173000_customer_followup_atomic_command_v2.sql',
  'supabase/migrations/20260824180000_customer_followup_lifecycle_commands_v1.sql',
  'supabase/migrations/20260824190000_customer_service_queue_command_boundary_v1.sql',
];
const failures = required.filter((file) => !fs.existsSync(file)).map((file) => `Missing ${file}`);
const protectedFiles = [
  'src/components/customerService/CustomerFollowupCockpitPanel.tsx',
  'src/components/customerService/WaitingCustomerRepliesPanel.tsx',
  'src/components/customerService/ContinueFollowupModal.tsx',
  'src/components/customerService/CustomerFollowupRecordsAndPerformance.tsx',
  'src/components/customerService/CustomerFollowupBranchReviewPanel.tsx',
  'src/lib/customerServiceAttempts.ts',
];
for (const file of protectedFiles) {
  const source = fs.readFileSync(file, 'utf8');
  if (/\.from\(['"]daily_followups['"]\)\s*\.update\s*\(/s.test(source))
    failures.push(`Direct follow-up update escaped command boundary: ${file}`);
  if (/\.from\(['"]customer_followup_audit_log['"]\)\s*\.insert\s*\(/s.test(source))
    failures.push(`Direct audit insert escaped atomic command: ${file}`);
  if (!source.includes('executeFollowupCommand'))
    failures.push(`Canonical command service is not used by ${file}`);
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}
for (const file of walk('src')) {
  const source = fs.readFileSync(file, 'utf8');
  if (
    /\.from\(['"]daily_followups['"]\)[\s\S]{0,500}?\.(?:insert|update|upsert|delete)\s*\(/.test(
      source
    )
  ) {
    failures.push(`Direct daily_followups mutation is forbidden: ${file}`);
  }
}
const lifecycleMigration = fs.readFileSync(
  'supabase/migrations/20260824180000_customer_followup_lifecycle_commands_v1.sql',
  'utf8'
);
for (const token of [
  'dawaa_create_or_link_customer_followup_v1',
  'dawaa_save_customer_followup_result_v1',
  'dawaa_archive_today_trial_followups_v1',
  'revoke all on function public.create_or_link_customer_followup',
]) {
  if (!lifecycleMigration.includes(token))
    failures.push(`Lifecycle migration must include ${token}`);
}
const queueMigration = fs.readFileSync(
  'supabase/migrations/20260824190000_customer_service_queue_command_boundary_v1.sql',
  'utf8'
);
for (const token of [
  'dawaa_replace_customer_service_daily_queue_v1',
  'dawaa_update_customer_service_queue_item_v1',
  'dawaa_append_customer_service_followup_event_v1',
  'dawaa_can_read_customer_service_branch_v1',
  'revoke insert,update,delete',
]) {
  if (!queueMigration.includes(token))
    failures.push(`Queue command migration must include ${token}`);
}
for (const file of walk('src')) {
  const source = fs.readFileSync(file, 'utf8');
  if (
    /\.from\(['"]customer_service_daily_queue['"]\)|\.rpc\(['"](?:generate_customer_service_daily_queue|get_customer_service_queue_summary)['"]/.test(
      source
    )
  )
    failures.push(`Legacy customer-service queue contract is forbidden: ${file}`);
  if (/customer_service_manager_cases|customerServiceManagerCases|ManagerCasesPanel/.test(source))
    failures.push(`Orphan customer-service manager-case contract is forbidden: ${file}`);
  if (/customer_service_daily_reviews|customerServiceDailyReview/.test(source))
    failures.push(`Unused customer-service daily-review contract is forbidden: ${file}`);
  if (
    /\.from\(['"](?:customer_service_daily_queue_items|customer_service_followup_events)['"]\)[\s\S]{0,500}?\.(?:insert|update|upsert|delete)\s*\(/.test(
      source
    )
  )
    failures.push(`Direct customer-service queue mutation is forbidden: ${file}`);
}
if (failures.length) {
  console.error('\nCustomer follow-up command boundary failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(
  '[customer-followup-command-boundary] PASS: customer follow-up creation, execution, review, result saving and trial cleanup use authorized lifecycle commands.'
);
