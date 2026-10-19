import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('attendance review design closure', () => {
  const report = read('src/pages/AttendanceReport.tsx');
  const truth = read('src/components/attendance/AttendancePayrollTruthPanel.tsx');
  const employee = read('src/components/attendance/EmployeeAttendanceBreakdown.tsx');

  it('removes the obsolete 21-code bulk mutation but preserves reviewed one-at-a-time mapping', () => {
    expect(report).not.toContain('اعتماد ٢١ كود مؤكّد');
    expect(report).not.toContain('applyConfirmedBiometricBatch');
    expect(report).toContain('assignBiometricStaffMapping(');
    expect(report).toContain('الأكواد المعروضة للمراجعة');
    expect(report).toContain('BiometricMappingQueue');
  });

  it('fails closed when report scope changes or fetch fails, with no stale previous branch numbers', () => {
    expect(truth).toContain('const requestSequence = useRef(0)');
    expect(truth).toContain('const sequence = ++requestSequence.current');
    expect(truth).toContain('if (sequence !== requestSequence.current) return');
    expect(truth).toContain('setTruth(null)');
    expect(truth).toContain('setDriftRows([])');
    expect(truth).toContain('setReopenTarget(null)');
    expect(truth).toContain('return () => { requestSequence.current += 1; }');
    expect(truth).toContain('value={truth ? financialDriftRows.length :');
  });

  it('never treats candidate drift as proof of a financial error or reopens a day without confirmation', () => {
    expect(truth).toContain('ليس دليلًا وحده على خطأ مالي');
    expect(truth).toContain('مراجعة الاختلاف');
    expect(truth).toContain('reopenReviewed');
    expect(truth).toContain('!reopenReviewed || reopenNote.trim().length < 10');
    expect(truth).toContain('disabled={reopening || !reopenReviewed || reopenNote.trim().length < 10}');
    expect(truth).toContain('reopenAttendanceResolution(');
    expect(employee).toContain('لا تعِد الاعتماد لمجرد ظهور اختلاف');
  });

  it('labels the employee branch as current, without mislabeling it historical', () => {
    expect(truth).toContain('الفرع الحالي</th>');
    expect(truth).toContain('ليس إثباتًا لفرع البصمة');
    expect(employee).toContain('الفرع الحالي:');
    expect(employee).toContain('لا يُعد مخالفة تلقائيًا');
  });
});
