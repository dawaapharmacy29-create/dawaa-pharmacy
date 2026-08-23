#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const migrationPath = path.join(ROOT, 'supabase/migrations/20260824002000_harden_shift_notes_scope_ownership_v1.sql');
const failures = [];

if (!fs.existsSync(migrationPath)) {
  failures.push('Missing shift-notes hardening migration.');
} else {
  const source = fs.readFileSync(migrationPath, 'utf8');
  for (const table of ['shift_notes', 'shift_note_logs', 'shift_note_occurrences']) {
    if (!source.includes(table)) failures.push(`Shift-notes hardening must cover ${table}.`);
  }
  for (const helper of ['dawaa_shift_note_can_read_v1', 'dawaa_shift_note_is_admin_v1', 'dawaa_shift_note_can_update_v1', 'dawaa_enforce_shift_note_write_v1']) {
    if (!source.includes(helper)) failures.push(`Shift-notes hardening must include ${helper}.`);
  }
  for (const permission of ['view_schedule', 'view_shift_performance', 'edit_shift_evaluation']) {
    if (!source.includes(permission)) failures.push(`Shift-notes authorization must reference ${permission}.`);
  }
  for (const role of ['general_manager', 'executive_manager', 'branches_manager']) {
    if (!source.includes(role)) failures.push(`Shift-notes scope must cover senior role ${role}.`);
  }
  if (!source.includes('assigned staff may update execution fields only')) {
    failures.push('Assigned staff must remain restricted to execution fields.');
  }
  if (!source.includes("new.author_id := v_account_id::text")) {
    failures.push('Shift-note inserts must canonicalize author_id from the current account.');
  }
  if (!source.includes('shift note must be created inside current branch')) {
    failures.push('Non-senior shift-note creation must remain branch-scoped.');
  }
  if (!source.includes('handover_open_shift_notes_v1')) {
    failures.push('Shift-note hardening must protect handover_open_shift_notes_v1.');
  }
  if (!source.includes('shift note handover requires shift management permission')) {
    failures.push('Bulk handover must require shift management permission.');
  }
  if (!source.includes('actor_id = public.dawaa_current_staff_account_id_strict()::text')) {
    failures.push('Shift-note logs must bind actor_id to the current account.');
  }
  if (/create\s+policy[\s\S]{0,180}\busing\s*\(\s*true\s*\)/i.test(source) || /create\s+policy[\s\S]{0,180}\bwith\s+check\s*\(\s*true\s*\)/i.test(source)) {
    failures.push('Shift-note policies must not use unconditional true authorization.');
  }
  if (/create\s+policy[^;]*shift_note_logs[^;]*for\s+update/i.test(source)) {
    failures.push('Shift-note logs must remain append-only.');
  }
}

if (failures.length) {
  console.error('\nShift notes architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('[shift-notes-architecture] PASS: branch scope, canonical authorship, execution-only assignee updates, append-only logs and manager-only handover are enforced.');
