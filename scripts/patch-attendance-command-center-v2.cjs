const fs = require('fs');
const path = 'src/pages/AttendanceReport.tsx';
let source = fs.readFileSync(path, 'utf8');

const importNeedle = "import { fetchAttendanceReportRows, type AttendanceReportRow } from '@/lib/attendance/attendanceReportRows';";
const importLine = "import AttendanceSyncCommandCenter from '@/components/attendance/AttendanceSyncCommandCenter';";
if (!source.includes(importLine)) {
  if (!source.includes(importNeedle)) throw new Error('attendance report import anchor not found');
  source = source.replace(importNeedle, `${importNeedle}\n${importLine}`);
}

const syncNeedle = "      {tab === 'sync' && <><div className=\"flex items-center justify-between gap-3 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm\"><div><h2 className=\"font-black text-[var(--dawaa-theme-heading)]\">صحة مزامنة جهاز البصمة</h2>";
const syncReplacement = "      {tab === 'sync' && <><AttendanceSyncCommandCenter branches={branches} defaultBranch={effectiveBranch} /><div className=\"flex items-center justify-between gap-3 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm\"><div><h2 className=\"font-black text-[var(--dawaa-theme-heading)]\">صحة مزامنة جهاز البصمة</h2>";
if (!source.includes('AttendanceSyncCommandCenter branches={branches}')) {
  if (!source.includes(syncNeedle)) throw new Error('sync tab anchor not found');
  source = source.replace(syncNeedle, syncReplacement);
}

fs.writeFileSync(path, source);
console.log('Attendance sync command center wired into AttendanceReport.tsx');
