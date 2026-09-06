const fs = require('fs');

const failures = [];
const timeOff = fs.readFileSync('src/pages/TimeOff.tsx', 'utf8');
const schedule = fs.readFileSync('src/pages/Schedule.tsx', 'utf8');
const staffDetail = fs.readFileSync('src/lib/staffDetailLoader.ts', 'utf8');
const shiftMemberLoader = fs.readFileSync('src/lib/api/shiftMemberLoader.ts', 'utf8');
const permissionPolicy = fs.readFileSync('src/lib/permissionPolicyService.ts', 'utf8');
const service = fs.readFileSync('src/lib/timeOffService.ts', 'utf8');

if (/from\(['\"]shift_exceptions['\"]\)/.test(timeOff)) {
  failures.push('TimeOff page must not read/write legacy shift_exceptions directly.');
}
if (/table:\s*['\"]shift_exceptions['\"]/.test(schedule)) {
  failures.push('Schedule page must not read active leave decisions from legacy shift_exceptions.');
}
if (/from\(['\"]shift_exceptions['\"]\)/.test(staffDetail)) {
  failures.push('Staff detail must not read active time-off from legacy shift_exceptions.');
}
if (/from\(['\"]shift_exceptions['\"]\)/.test(shiftMemberLoader)) {
  failures.push('Shift-member resolution must not read active time-off from legacy shift_exceptions.');
}
if (/from\(['\"]time_off['\"]\)/.test(permissionPolicy)) {
  failures.push('Permission policy must not depend on the nonexistent legacy time_off table.');
}
if (/persistPointsTransaction|pointsPersistence/.test(timeOff)) {
  failures.push('TimeOff page must not create points deductions directly.');
}
if (/\.delete\(/.test(timeOff)) {
  failures.push('TimeOff records must be cancelled/reversed, never hard-deleted from the page.');
}
for (const rpc of ['list_staff_time_off_requests_v1','create_staff_time_off_request_v1','decide_staff_time_off_request_v1','cancel_staff_time_off_request_v1']) {
  if (!service.includes(rpc)) failures.push(`Canonical time-off service is missing RPC ${rpc}.`);
}
for (const source of [timeOff, schedule, staffDetail, shiftMemberLoader]) {
  if (!source.includes("@/lib/timeOffService")) {
    failures.push('Every active time-off reader must use the canonical timeOffService boundary.');
    break;
  }
}

if (failures.length) {
  console.error('Canonical time-off architecture check failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('Canonical time-off architecture check passed.');
