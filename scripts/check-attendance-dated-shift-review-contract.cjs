#!/usr/bin/env node
// Guard the production regression: a dated correction must remain pending
// until a separate explicit manager finalization.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync('supabase/migrations/20261025160000_attendance_shift_review_no_autoapproval.sql','utf8');
const start = source.indexOf('create or replace function public.resolve_dated_shift_from_attendance_v1(');
assert.ok(start >= 0, 'expected dated-shift function definition');
const body = source.slice(start);
const hold = body.indexOf('insert into public.attendance_inline_review_holds_v1');
const project = body.indexOf('public.dawaa_refresh_inline_attendance_review_v1(p_staff_id,p_date)');
assert.ok(hold >= 0 && project > hold, 'review hold must precede canonical pending-only projection');
assert.ok(body.includes('public.dawaa_session_account_id_v1()'), 'verified manager session required');
assert.ok(body.includes('public.dawaa_time_off_can_decide_staff_v1(p_staff_id)'), 'target employee authorization required');
assert.ok(body.includes("approved_attendance_cannot_be_rewritten"), 'approved days immutable');
assert.ok(body.includes('dated_shift_correction_already_exists_review_first'), 'repeat correction prohibited');
assert.ok(body.includes('attendance_dated_shift_corrections_v1'), 'audit entry required');
assert.ok(!body.includes('public.dawaa_materialize_attendance_day_internal_v2('), 'no auto-finalizing materializer');
assert.ok(!/insert\s+into\s+public\.(staff_payroll|employee_transactions)/i.test(body), 'no direct payroll writes');
console.log('[attendance-dated-shift-review] PASS: hold before review-only projection, authorized/audited correction, no auto-finalization or payroll write');
