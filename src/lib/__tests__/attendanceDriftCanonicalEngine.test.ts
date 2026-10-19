import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('attendance drift is pinned to each approved day engine version', () => {
  const migration = read('supabase/migrations/20261019123000_attendance_drift_canonical_engine_route_v1.sql');

  it('upgrades each of the four financial drift readers without changing their API names', () => {
    for (const fn of [
      'attendance_resolution_drift_v1',
      'attendance_resolution_drift_count_v1',
      'attendance_resolution_financial_drift_count_v1',
      'delivery_attendance_financial_drift_guard_v1',
    ]) {
      expect(migration).toContain('CREATE OR REPLACE FUNCTION public.' + fn + '(');
    }
    expect(migration.match(/when a.resolution_version = 2 then public.dawaa_build_attendance_day_resolution_v2\(a.staff_id,a.attendance_date\)/g)).toHaveLength(4);
    expect(migration.match(/when a.resolution_version = 3 then public.dawaa_build_attendance_day_resolution_v3\(a.staff_id,a.attendance_date\)/g)).toHaveLength(4);
    expect(migration).not.toMatch(/dawaa_build_attendance_day_resolution_current_v1\(a.staff_id,a.attendance_date\)/);
  });

  it('preserves explicit authorization of the branch-scoped drift read and all prior return fields', () => {
    expect(migration).toContain('dawaa_current_staff_account_id_strict()');
    expect(migration).toContain('dawaa_can_read_staff_attendance_log(s.id,s.branch)');
    expect(migration).toContain('p_branch');
    expect(migration).toContain('stored_hours numeric, rebuilt_hours numeric, drift_reason text');
    expect(migration).toContain('explained_by_approved_override');
  });

  it('preserves the historical engine even if current staff policy changed', () => {
    expect(migration).not.toContain("coalesce(rebuilt.j->>'route','') <> 'out_of_scope'");
    expect(migration.match(/'unverifiable_resolution_version'/g)?.length).toBeGreaterThanOrEqual(4);
    // Unknown versions must trigger a real review, never be treated as clean.
    expect(migration.match(/coalesce\(a.resolution_version,0\) not in \(2,3\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration).toContain("coalesce(a.resolution_version,0) in (2,3)");
  });

  it('does not mutate employee, approval, or salary data', () => {
    expect(migration).not.toMatch(/\b(insert into|delete from|update public\.|grant execute|revoke execute)\b/i);
    expect(migration).not.toMatch(/\b(drop function|drop table|truncate table)\b/i);
  });

  it('warns the reviewer that rebuilt candidate hours are not automatically a payroll correction', () => {
    const ui = read('src/components/attendance/AttendancePayrollTruthPanel.tsx');
    expect(ui).toContain('اختلاف ساعات إعادة التفسير');
    expect(ui).toContain('ليس دليلًا وحده على خطأ مالي');
    expect(ui).toContain('تأكد من القرار السابق قبل المتابعة');
  });
});
