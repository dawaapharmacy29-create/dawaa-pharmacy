#!/usr/bin/env node
const fs = require('node:fs');

const centerPath = 'src/components/attendance/AttendanceResolutionCenter.tsx';
const guardPath = 'scripts/check-attendance-command-center-contract-wiring.cjs';

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`[ui-wiring] missing anchor: ${label}`);
  if (text.indexOf(before, first + before.length) >= 0) throw new Error(`[ui-wiring] duplicate anchor: ${label}`);
  return text.slice(0, first) + after + text.slice(first + before.length);
}

let center = fs.readFileSync(centerPath, 'utf8');

center = replaceOnce(
  center,
  "  getMissingPunchContextV1,\n  listAttendanceExceptionInbox,",
  "  getMissingPunchContextV1,\n  isFormerAttendanceReviewRow,\n  listAttendanceExceptionInbox,",
  'service helper import'
);
center = replaceOnce(
  center,
  "import { useStaffDirectory } from '@/hooks/useStaffDirectory';\n",
  '',
  'remove staff-directory import'
);
center = replaceOnce(
  center,
  "  const { data: staffDirectory = [], isLoading: directoryLoading, isError: directoryError } = useStaffDirectory();\n",
  '',
  'remove staff-directory query'
);
center = replaceOnce(
  center,
  "  }, [branch, end, lane, start]);",
  "  }, [branch, end, start]);",
  'avoid reload on client-only lane change'
);
center = replaceOnce(
  center,
  `  const formerIds = useMemo(() => new Set(staffDirectory\n    .filter((person) => person.source === 'staff' && person.id && !person.active)\n    .map((person) => person.id)), [staffDirectory]);\n  const formerRows = rows.filter((row) => formerIds.has(row.staff_id));\n  const baseRows = showFormer ? rows : rows.filter((row) => !formerIds.has(row.staff_id));`,
  `  const formerRows = useMemo(() => rows.filter(isFormerAttendanceReviewRow), [rows]);\n  const baseRows = useMemo(\n    () => showFormer ? rows : rows.filter((row) => !isFormerAttendanceReviewRow(row)),\n    [rows, showFormer]\n  );\n  const priorityCounts = useMemo(() => ({\n    p1: baseRows.filter((row) => row.queue_lane === 'manager' && row.priority_code === 'P1').length,\n    p2: baseRows.filter((row) => row.queue_lane === 'manager' && row.priority_code === 'P2').length,\n    p3: baseRows.filter((row) => row.queue_lane === 'manager' && row.priority_code === 'P3').length,\n  }), [baseRows]);`,
  'former-staff authority'
);
center = replaceOnce(
  center,
  `        {directoryError && <p className=\"mt-2 text-xs text-[var(--dawaa-status-warning-text)]\">تعذر التحقق من حالة الموظفين؛ تظهر كل الحالات حتى يُعاد تحميل دليل الموظفين.</p>}\n        {formerRows.length > 0 && !showFormer && <p className=\"mt-1 text-xs text-[var(--dawaa-theme-muted)]\">أيام الموظفين السابقين محفوظة للمراجعة التاريخية، ولا تُلغى من جاهزية الرواتب بمجرد إخفائها هنا.</p>}`,
  `        {formerRows.length > 0 && !showFormer && <p className=\"mt-1 text-xs text-[var(--dawaa-theme-muted)]\">أيام الموظفين السابقين محفوظة للمراجعة التاريخية، ولا تُلغى من جاهزية الرواتب بمجرد إخفائها هنا.</p>}\n        <div className=\"mt-2 flex flex-wrap gap-2 text-[10px] font-black\">\n          <span className=\"rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-2 py-1 text-[var(--dawaa-status-warning-text)]\">P1 عاجل: {priorityCounts.p1.toLocaleString('ar-EG')}</span>\n          <span className=\"rounded-full border border-[var(--dawaa-theme-border)] px-2 py-1 text-[var(--dawaa-theme-heading)]\">P2: {priorityCounts.p2.toLocaleString('ar-EG')}</span>\n          <span className=\"rounded-full border border-[var(--dawaa-theme-border)] px-2 py-1 text-[var(--dawaa-theme-muted)]\">P3: {priorityCounts.p3.toLocaleString('ar-EG')}</span>\n          <span className=\"px-1 py-1 text-[var(--dawaa-theme-muted)]\">الترتيب صادر من عقد الأولوية المركزي، والأقدم داخل نفس الأولوية يظهر أولًا.</span>\n        </div>`,
  'priority summary badges'
);
center = replaceOnce(
  center,
  "            {!directoryLoading && displayRows.map((row) => {",
  "            {displayRows.map((row) => {",
  'remove directory loading gate'
);
center = replaceOnce(
  center,
  `                    <div className=\"text-xs text-[var(--dawaa-theme-muted)]\">{row.branch || '-'}</div>\n                    {formerIds.has(row.staff_id) && <div className=\"text-xs text-[var(--dawaa-status-warning-text)]\">موظف سابق — راجع تاريخ آخر يوم عمل</div>}`,
  `                    <div className=\"text-xs text-[var(--dawaa-theme-muted)]\">{row.staff_branch || row.branch || '-'}</div>\n                    {isFormerAttendanceReviewRow(row) && <div className=\"text-xs text-[var(--dawaa-status-warning-text)]\">موظف سابق — مسار تاريخي منفصل</div>}`,
  'row former-staff display'
);
center = replaceOnce(
  center,
  `                    <div className=\"font-black text-[var(--dawaa-theme-heading)]\">{row.issue_label}</div>\n                    <div className=\"mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]\">{row.issue_group}</div>`,
  `                    <div className=\"font-black text-[var(--dawaa-theme-heading)]\">{row.issue_label}</div>\n                    <div className=\"mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]\">{row.issue_group}</div>\n                    {row.queue_lane === 'manager' && row.priority_code && row.priority_code !== 'former_staff' && (\n                      <div className=\"mt-1 flex flex-wrap items-center gap-1 text-[10px] font-black text-[var(--dawaa-theme-muted)]\">\n                        <span className=\"rounded-full border border-[var(--dawaa-theme-border)] px-2 py-0.5 text-[var(--dawaa-theme-heading)]\">{row.priority_code}</span>\n                        {row.age_days != null && <span>انتظار {row.age_days.toLocaleString('ar-EG')} يوم</span>}\n                      </div>\n                    )}`,
  'row priority metadata'
);
center = replaceOnce(
  center,
  `            {!displayRows.length && !loading && !directoryLoading && (\n              <tr>\n                <td colSpan={9} className=\"p-8 text-center font-bold text-[var(--dawaa-theme-muted)]\">\n                  لا توجد حالات في هذا المسار خلال الفترة المحددة.\n                </td>\n              </tr>\n            )}\n            {directoryLoading && <tr><td colSpan={9} className=\"p-8 text-center\">جارٍ التحقق من حالة الموظفين...</td></tr>}`,
  `            {!displayRows.length && !loading && (\n              <tr>\n                <td colSpan={9} className=\"p-8 text-center font-bold text-[var(--dawaa-theme-muted)]\">\n                  لا توجد حالات في هذا المسار خلال الفترة المحددة.\n                </td>\n              </tr>\n            )}`,
  'empty-state directory dependency'
);
center = replaceOnce(
  center,
  "                    {arabicWeekday(selected.attendance_date)} · {selected.attendance_date} · {selected.branch || '-'}",
  "                    {arabicWeekday(selected.attendance_date)} · {selected.attendance_date} · {selected.staff_branch || selected.branch || '-'}",
  'selected branch display'
);

if (center.includes('useStaffDirectory') || center.includes('formerIds') || center.includes('directoryLoading') || center.includes('directoryError')) {
  throw new Error('[ui-wiring] legacy directory authority remains in AttendanceResolutionCenter');
}
fs.writeFileSync(centerPath, center);

let guard = fs.readFileSync(guardPath, 'utf8');
guard = replaceOnce(
  guard,
  "  service: 'src/lib/attendance/attendanceResolutionService.ts',\n  reviews: 'src/pages/Reviews.tsx',",
  "  service: 'src/lib/attendance/attendanceResolutionService.ts',\n  center: 'src/components/attendance/AttendanceResolutionCenter.tsx',\n  reviews: 'src/pages/Reviews.tsx',",
  'guard file registry'
);
guard = replaceOnce(
  guard,
  "  const service = fs.readFileSync(files.service, 'utf8');\n  const reviews = fs.readFileSync(files.reviews, 'utf8');",
  "  const service = fs.readFileSync(files.service, 'utf8');\n  const center = fs.readFileSync(files.center, 'utf8');\n  const reviews = fs.readFileSync(files.reviews, 'utf8');",
  'guard center read'
);
guard = replaceOnce(
  guard,
  `  if (/when\\s+coalesce\\(\\(b\\.preview->>'finalizable'\\)::boolean,false\\)=false\\s+then\\s+'system'/i.test(wiring)) {`,
  `  requireTokens('attendance UI canonical priority consumption', center, [\n    'isFormerAttendanceReviewRow',\n    'row.priority_code',\n    'row.age_days',\n    'row.staff_branch || row.branch',\n    'const [showFormer, setShowFormer] = useState(false);',\n  ]);\n\n  if (center.includes('useStaffDirectory') || center.includes('formerIds') || center.includes('directoryLoading') || center.includes('directoryError')) {\n    failures.push('AttendanceResolutionCenter must use bundle staff_active/priority metadata, not staff-directory authority');\n  }\n\n  if (/when\\s+coalesce\\(\\(b\\.preview->>'finalizable'\\)::boolean,false\\)=false\\s+then\\s+'system'/i.test(wiring)) {`,
  'guard UI checks'
);
guard = replaceOnce(
  guard,
  "console.log('[attendance-command-center-contract] PASS: command center consumes canonical triage + priority contracts; service preserves contract metadata and sorts from contract ranks only; Reviews has explicit points persistence wiring.');",
  "console.log('[attendance-command-center-contract] PASS: command center consumes canonical triage + priority contracts; service preserves/sorts contract metadata; UI uses bundle former-staff + priority metadata without directory reclassification; Reviews points persistence is wired.');",
  'guard success message'
);
fs.writeFileSync(guardPath, guard);

console.log('[ui-wiring] applied exact AttendanceResolutionCenter + guard patch');
