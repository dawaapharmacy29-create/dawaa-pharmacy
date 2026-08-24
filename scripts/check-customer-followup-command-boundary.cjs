#!/usr/bin/env node
const fs = require('node:fs');

const required = [
  'src/lib/customerService/followupCommandService.ts',
  'supabase/migrations/20260824170000_customer_followup_atomic_command_v1.sql',
  'supabase/migrations/20260824173000_customer_followup_atomic_command_v2.sql',
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
  if (/\.from\(['"]daily_followups['"]\)\s*\.update\s*\(/s.test(source)) failures.push(`Direct follow-up update escaped command boundary: ${file}`);
  if (/\.from\(['"]customer_followup_audit_log['"]\)\s*\.insert\s*\(/s.test(source)) failures.push(`Direct audit insert escaped atomic command: ${file}`);
  if (!source.includes('executeFollowupCommand')) failures.push(`Canonical command service is not used by ${file}`);
}
if (failures.length) {
  console.error('\nCustomer follow-up command boundary failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('[customer-followup-command-boundary] PASS: execution, continuation, review, branch assignment and contact attempts use one atomic audited command.');
