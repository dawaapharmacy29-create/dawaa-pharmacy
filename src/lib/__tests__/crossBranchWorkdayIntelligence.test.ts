import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path),'utf8');

describe('cross-branch punch reconciliation', () => {
  const migration = read('supabase/migrations/20261020070000_cross_branch_biometric_workday_v3.sql');
  const anonFix = read('supabase/migrations/20261020070001_cross_branch_v3_explicit_anon_revoke.sql');
  const sessionRepair = read('supabase/migrations/20261020071000_cross_branch_v3_staff_session_acl_v1.sql');
  const panel = read('src/components/attendance/CrossBranchPunchesPanel.tsx');
  const service = read('src/lib/attendance/attendanceOperationsService.ts');

  it('reads the approved shift day, never deciding by the clock date alone', () => {
    expect(migration).toContain('sal.biometric_source_log_id=n.raw_event_id');
    expect(migration).toContain('linked.shift_date');
    expect(migration).toContain('COALESCE(linked.shift_date,');
    expect(migration).toContain('p_start-1 AND p_end+1');
    expect(migration).toContain('linked_attendance_shift_date');
    expect(migration).toContain('raw_calendar_day_fallback');
    expect(service).toContain("supabase.rpc('list_cross_branch_biometric_events_v3'");
    expect(service).not.toContain("supabase.rpc('list_cross_branch_biometric_events_v2'");
  });

  it('does not broaden the ability to view another employee across branches', () => {
    expect(migration).toContain('dawaa_current_staff_account_id_strict()');
    expect(migration).toContain('dawaa_can_read_staff_attendance_log(r.person_id,r.schedule_branch)');
    expect(migration).toContain('coalesce(sa.can_login,false)=true');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.list_cross_branch_biometric_events_v3');
    expect(migration).toContain('FROM anon;');
    expect(anonFix).toContain('FROM anon;');
    expect(anonFix).toContain("has_function_privilege('anon'");
    expect(sessionRepair).toContain('TO anon;');
    expect(sessionRepair).toContain('dawaa_current_staff_account_id_strict()');
    expect(sessionRepair).toContain('dawaa_can_read_staff_attendance_log(r.person_id,r.schedule_branch)');
    expect(sessionRepair).toContain('staff_login_sessions');
    expect(sessionRepair).toContain('expires_at > now()');
    expect(sessionRepair).toContain('revoked_at is null');
    expect(migration).not.toMatch(/\b(update public\.|delete from public\.|insert into public\.)/i);
  });

  it('shows audit evidence and never matches people from biometric codes alone', () => {
    expect(migration).toContain('b.staff_id IS NOT NULL');
    expect(migration).toContain('sal.staff_id=n.raw_staff_id');
    expect(panel).toContain('هوية الموظف واحدة على الجهازين بعد تأكيد ربط كوده بكل جهاز');
    expect(panel).toContain('processing_status');
    expect(panel).toContain('attendance_type');
    expect(panel).toContain('ملخص الموظف حسب يوم الشيفت');
    expect(panel).toContain('لا نعتبر تعدد الأجهزة حضورًا مكررًا');
    expect(panel).toContain('requestId !== requestSequence.current');
    expect(panel).toContain('setRows([])');
    expect(panel).toContain('فرع الموظف الحالي');
  });
});
