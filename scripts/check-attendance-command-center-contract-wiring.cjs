#!/usr/bin/env node
const fs = require('node:fs');

const files = {
  triage: 'supabase/migrations/20261009104500_attendance_review_triage_contract_v1.sql',
  priority: 'supabase/migrations/20261009113500_attendance_manager_review_priority_v1.sql',
  wiring: 'supabase/migrations/20261009114500_attendance_command_center_contract_wiring_v1.sql',
  reviews: 'src/pages/Reviews.tsx',
};

const failures = [];
for (const [name, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) failures.push(`missing ${name}: ${file}`);
}

function requireTokens(label, text, tokens) {
  for (const token of tokens) {
    if (!text.includes(token)) failures.push(`${label} missing token: ${token}`);
  }
}

if (!failures.length) {
  const triage = fs.readFileSync(files.triage, 'utf8');
  const priority = fs.readFileSync(files.priority, 'utf8');
  const wiring = fs.readFileSync(files.wiring, 'utf8');
  const reviews = fs.readFileSync(files.reviews, 'utf8');

  requireTokens('triage contract', triage, [
    'dawaa_attendance_review_triage_v1',
    "='needs_event_review'",
    "accepted_events')::int,0)<2",
  ]);

  requireTokens('priority contract', priority, [
    'dawaa_attendance_manager_review_priority_v1',
    "then 'former_staff'",
    "then 'P1'",
    "then 'P2'",
    "'sort_rank'",
    "'age_days'",
    "'priority_reason'",
  ]);

  requireTokens('command-center wiring', wiring, [
    'get_attendance_command_center_bundle_v1',
    'dawaa_attendance_review_triage_v1',
    'dawaa_attendance_manager_review_priority_v1',
    'triage_code',
    "when p.triage_code='manager' and p.staff_active then 0",
    'priority_sort_rank',
    'priority_age_days desc',
    'attendance_date asc',
    "'priority_code'",
    "'sort_rank'",
    "'age_days'",
    "'age_bucket'",
    "'priority_reason'",
    "'manager_required_former_staff'",
  ]);

  if (/when\s+coalesce\(\(b\.preview->>'finalizable'\)::boolean,false\)=false\s+then\s+'system'/i.test(wiring)) {
    failures.push('command-center wiring must not reimplement triage from preview flags');
  }
  if (!reviews.includes("import { persistPointsTransaction } from '@/lib/pointsPersistence';")) {
    failures.push('Reviews.tsx must import persistPointsTransaction explicitly');
  }
}

if (failures.length) {
  console.error('[attendance-command-center-contract] FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('[attendance-command-center-contract] PASS: command center consumes canonical triage + priority contracts, preserves former-staff lane metadata, orders oldest manager cases first within priority, and Reviews has explicit points persistence wiring.');
