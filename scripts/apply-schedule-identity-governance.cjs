const fs = require('fs');
const path = 'src/pages/Schedule.tsx';
let s = fs.readFileSync(path, 'utf8');

const anchor = "import { listStaffTimeOffRequests, type StaffTimeOffRequest } from '@/lib/timeOffService';";
const addition = "import ScheduleIdentityGovernance from '@/components/attendance/ScheduleIdentityGovernance';";
if (!s.includes(addition)) {
  if (!s.includes(anchor)) throw new Error('schedule import anchor not found');
  s = s.replace(anchor, `${anchor}\n${addition}`);
}

const desktopAnchor = '      {/* Desktop Table */}';
const block = '      {managerView && <ScheduleIdentityGovernance />}\n\n';
if (!s.includes('<ScheduleIdentityGovernance />')) {
  if (!s.includes(desktopAnchor)) throw new Error('schedule render anchor not found');
  s = s.replace(desktopAnchor, block + desktopAnchor);
}

s = s.replace(
  'الحفظ يستخدم الجداول الموجودة فقط. لو shift_schedules أو shift_exceptions غير موجودة\n                سيظهر ذلك في التقرير.',
  'الحفظ يكتب الجدول التشغيلي فقط. أي سجل قديم بلا staff_id يظهر في قسم جودة الهوية ولا يدخل قرار الحضور المالي حتى تتم مراجعته.'
);

fs.writeFileSync(path, s);
console.log('Schedule identity governance integrated.');
