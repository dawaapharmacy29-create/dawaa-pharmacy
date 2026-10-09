#!/usr/bin/env node
const fs = require('node:fs');

const files = {
  contract: 'supabase/migrations/20261009064147_attendance_review_triage_contract_v1.sql',
  diagnostic: 'supabase/migrations/20261009064241_attendance_diagnostic_use_canonical_triage_v1.sql',
  inbox: 'supabase/migrations/20261009064357_attendance_inbox_use_canonical_triage_v1.sql',
  summary: 'supabase/migrations/20261009064504_attendance_summary_use_canonical_triage_v1.sql',
  health: 'supabase/migrations/20261009064621_attendance_health_use_canonical_triage_v1.sql',
};

const failures = [];
for (const [name, path] of Object.entries(files)) {
  if (!fs.existsSync(path)) failures.push(`Missing ${name}: ${path}`);
}

if (!failures.length) {
  const contract = fs.readFileSync(files.contract, 'utf8');
  const diagnostic = fs.readFileSync(files.diagnostic, 'utf8');
  const inbox = fs.readFileSync(files.inbox, 'utf8');
  const summary = fs.readFileSync(files.summary, 'utf8');
  const health = fs.readFileSync(files.health, 'utf8');

  for (const token of [
    'dawaa_attendance_review_triage_v1',
    "'waiting'",
    "'auto'",
    "'manager'",
    "'system_repair'",
    "'needs_event_review'",
    "'accepted_events'",
  ]) {
    if (!contract.includes(token)) failures.push(`Triage contract missing ${token}`);
  }

  for (const [label, text] of [
    ['diagnostic', diagnostic],
    ['inbox', inbox],
    ['summary', summary],
    ['health', health],
  ]) {
    if (!text.includes('dawaa_attendance_review_triage_v1')) {
      failures.push(`${label} must use canonical attendance triage contract`);
    }
  }

  if (!/revoke all on function public\.dawaa_attendance_review_triage_v1\(text,jsonb\)/i.test(contract)) {
    failures.push('Triage contract must revoke browser roles.');
  }
  if (!/grant execute on function public\.dawaa_attendance_review_triage_v1\(text,jsonb\)[\s\S]*to service_role/i.test(contract)) {
    failures.push('Triage contract must be service_role only.');
  }
}

if (failures.length) {
  console.error('\nAttendance review triage contract check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[attendance-triage] PASS: diagnostic, inbox, summary, and health share one canonical review-lane contract.');
