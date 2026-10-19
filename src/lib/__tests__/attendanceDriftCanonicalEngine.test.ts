import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('attendance drift uses the approved V2/V3 canonical routing', () => {
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
    expect(migration.match(/dawaa_build_attendance_day_resolution_current_v1\(a.staff_id,a.attendance_date\)/g)).toHaveLength(4);
    expect(migration).not.toMatch(/dawaa_build_attendance_day_resolution_v2\(a.staff_id,a.attendance_date\)/);
  });

  it('preserves explicit authorization of the branch-scoped drift read and all prior return fields', () => {
    expect(migration).toContain('dawaa_current_staff_account_id_strict()');
    expect(migration).toContain('dawaa_can_read_staff_attendance_log(s.id,s.branch)');
    expect(migration).toContain('p_branch');
    expect(migration).toContain('stored_hours numeric, rebuilt_hours numeric, drift_reason text');
    expect(migration).toContain('explained_by_approved_override');
  });

  it('does not treat an out-of-scope route as revocation of historical attendance truth', () => {
    expect(migration.match(/coalesce\(rebuilt.j->>'route',''\) <> 'out_of_scope'/g)).toHaveLength(4);
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
