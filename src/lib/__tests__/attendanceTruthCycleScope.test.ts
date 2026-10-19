import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { partitionPendingOvertime } from '@/lib/attendance/attendanceBreakdownService';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('attendance cycle consistency closure (2026-10-19)', () => {
  it('retains old attendance truth when a worker is hidden or archived', () => {
    const migration = read('supabase/migrations/20261019090000_attendance_truth_historical_visibility_v1.sql');
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.attendance_truth_cycle_v2/);
    expect(migration).toMatch(/coalesce\(s\.active,s\.is_active,true\) and coalesce\(s\.visible_in_schedule,true\)/);
    expect(migration).toMatch(/or exists \(\s*select 1\s*from public\.attendance_daily_summary history/);
    expect(migration).toMatch(/history\.attendance_date between p_start and p_end/);
    expect(migration).toMatch(/not public\.dawaa_current_actor_can/);
    expect(migration).toMatch(/dawaa_staff_attendance_log_read_scope_v1/);
    expect(migration).not.toMatch(/\b(insert into|delete from|update public\.staff|grant execute)\b/i);
  });

  it('puts a record in exactly one period bucket, without guessing dates', () => {
    const rows = [
      { id: 'old', attendance_date: '2026-09-25' },
      { id: 'first', attendance_date: '2026-09-26' },
      { id: 'latest', attendance_date: '2026-10-19' },
      { id: 'future', attendance_date: '2026-10-20' },
      { id: 'bad', attendance_date: '' },
    ];
    const result = partitionPendingOvertime(rows, '2026-09-26', '2026-10-19');
    expect(result.current.map((r) => r.id)).toEqual(['first', 'latest']);
    expect(result.previous.map((r) => r.id)).toEqual(['old']);
    expect(result.future.map((r) => r.id)).toEqual(['future']);
    expect(result.undated.map((r) => r.id)).toEqual(['bad']);
    expect(Object.values(result).flat()).toHaveLength(rows.length);
  });

  it('does not pass mixed-period overtime as a current-cycle total', () => {
    const hr = read('src/pages/HRWorkforceCenter.tsx');
    const page = read('src/pages/AttendanceReport.tsx');
    const overtime = read('src/components/attendance/OvertimeApprovalCenter.tsx');
    expect(hr).toMatch(/partitionPendingOvertime\(overtimeResult\.value \|\| \[\], cycleStart, today\)/);
    expect(page).toMatch(/partitionPendingOvertime\(overtimeResult\.value, cycle\.start, today\)/);
    expect(overtime).toMatch(/aria-pressed=\{pendingScope === item\.id\}/);
    expect(overtime).toMatch(/visiblePending\.map\(\(row\)/);
    // Failed or late requests must never present a false zero or stale branch's list.
    expect(overtime).toMatch(/if \(sequence !== requestSequence\.current\) return/);
    expect(overtime).toMatch(/setLoadError\(message\)/);
    expect(overtime).toMatch(/\{!loadError && <div/);
    expect(overtime).toMatch(/لا تعتبر الأعداد صفرًا/);
    expect(hr).not.toMatch(/const interventionCount = review\.needsManager \+ pendingOvertime \+ pendingTimeOff/);
  });

  it('keeps salary readiness authoritative and daily role groups canonical', () => {
    const truth = read('src/components/attendance/AttendancePayrollTruthPanel.tsx');
    const daily = read('src/components/attendance/SmartDailyCommandTable.tsx');
    expect(truth).toMatch(/summary\?\.ready_for_payroll_truth && blockers === 0/);
    expect(truth).toMatch(/'حالة غير جاهزة — راجع الإجراءات المعلقة'/);
    expect(daily).toMatch(/\['توصيل', 'دليفري', 'delivery'\]/);
    expect(daily).toMatch(/visibleRoleLabel\(row\.role\)/);
  });
});
