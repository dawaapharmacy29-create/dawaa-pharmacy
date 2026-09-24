const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const hardening = path.join(root, 'supabase/migrations/20260924120000_hr_canonical_hardening_v1.sql');
const backfill = path.join(root, 'supabase/migrations/20260924121000_overtime_stale_cutover_backfill_v1.sql');
const attendanceService = path.join(root, 'src/lib/attendance/attendanceBreakdownService.ts');
const timeOffService = path.join(root, 'src/lib/timeOffService.ts');

function fail(message) {
  console.error('[hr-canonical-hardening] ' + message);
  process.exit(1);
}
function read(file) {
  if (!fs.existsSync(file)) fail('missing file: ' + path.relative(root, file));
  return fs.readFileSync(file, 'utf8');
}
function assertContains(text, needle, label) {
  if (!text.includes(needle)) fail(label + ' is missing: ' + needle);
}

const migration = read(hardening);
const backfillSql = read(backfill);
const attendance = read(attendanceService);
const timeOff = read(timeOffService);

assertContains(migration, 'return public.decide_overtime_approval_v3(p_id,p_decision,p_note);', 'V1 overtime compatibility wrapper');
assertContains(migration, 'dawaa_can_manage_payroll_staff_v1(v_target_username)', 'branch-scoped overtime authorization');
assertContains(migration, 'trg_hr_invalidate_overtime_on_attendance_change_v1', 'attendance->overtime invalidation trigger');
assertContains(migration, 'dawaa-detect-pending-overtime-v2', 'V2 detector cron');
assertContains(migration, 'dawaa-sync-attendance-overtime-reward-v2', 'V2 reward cron');
assertContains(migration, 'overtime_no_longer_eligible', 'approval-time overtime recalculation guard');
assertContains(backfillSql, "status='pending'", 'stale approved overtime backfill');
assertContains(attendance, "supabase.rpc('decide_overtime_approval_v3'", 'frontend overtime decision path');
assertContains(timeOff, "supabase.rpc('decide_staff_time_off_request_v3'", 'frontend time-off decision path');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const legacyFrontendCalls = [];
for (const file of walk(path.join(root, 'src'))) {
  const text = fs.readFileSync(file, 'utf8');
  if (/rpc\(\s*['"]decide_overtime_approval_v1['"]/.test(text)) {
    legacyFrontendCalls.push(path.relative(root, file));
  }
}

if (legacyFrontendCalls.length) {
  fail('legacy overtime V1 RPC is still called from app source: ' + legacyFrontendCalls.join(', '));
}

console.log('[hr-canonical-hardening] OK');
console.log('  - overtime decisions use V3');
console.log('  - V1 remains compatibility-only');
console.log('  - attendance changes invalidate prior approved overtime');
console.log('  - scheduled detector/reward cutover targets V2');
console.log('  - stale approved overtime backfill is present');
