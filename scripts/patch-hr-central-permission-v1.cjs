const fs = require('fs');
const p = 'src/lib/core/permissionSystem.ts';
let s = fs.readFileSync(p, 'utf8');

function addAfter(anchor, line) {
  if (s.includes(line.trim())) return;
  if (!s.includes(anchor)) throw new Error(`anchor not found: ${anchor}`);
  s = s.replace(anchor, `${anchor}\n${line}`);
}

addAfter(
  "      { key: 'view_attendance_leaves',    label: 'الحضور والإجازات' },",
  "      { key: 'view_hr_compliance',        label: 'مركز الموارد البشرية والالتزام', sensitive: true },"
);

// Executive manager preset.
const managerAnchor = "  'view_attendance_leaves',\n  'approve_leave_request',";
if (!s.includes("  'view_hr_compliance',\n  'approve_leave_request',")) {
  if (!s.includes(managerAnchor)) throw new Error('MANAGER_BASE attendance anchor not found');
  s = s.replace(managerAnchor, "  'view_attendance_leaves',\n  'view_hr_compliance',\n  'approve_leave_request',");
}

// Branch manager preset (first remaining occurrence after MANAGER_BASE is now unique with create_leave_request).
const branchAnchor = "  'view_attendance_leaves',\n  'create_leave_request',\n  'approve_leave_request',";
if (!s.includes("  'view_attendance_leaves',\n  'view_hr_compliance',\n  'create_leave_request',\n  'approve_leave_request',")) {
  if (!s.includes(branchAnchor)) throw new Error('BRANCH_MANAGER_BASE attendance anchor not found');
  s = s.replace(branchAnchor, "  'view_attendance_leaves',\n  'view_hr_compliance',\n  'create_leave_request',\n  'approve_leave_request',");
}

addAfter(
  "  '/attendance-report': ['view_attendance_leaves', 'record_attendance'],",
  "  '/hr-compliance': 'view_hr_compliance',"
);

fs.writeFileSync(p, s);
console.log('patched central HR compliance permission');
