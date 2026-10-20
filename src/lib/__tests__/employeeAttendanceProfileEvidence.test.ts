import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatEmployeeProfileClock } from '@/lib/attendance/profileTime';

const read = (path: string) => readFileSync(resolve(process.cwd(),path),'utf8');

describe('profile attendance evidence and safe time labels', () => {
  const sql=read('supabase/migrations/20261020090000_attendance_profile_processed_evidence_v1.sql');
  const drawer=read('src/components/attendance/EmployeeProfileDrawer.tsx');
  const pdf=read('src/lib/attendance/employeeProfilePdf.ts');

  it('formats plain PostgreSQL TIME values and actual Cairo instants independently',()=>{
    expect(formatEmployeeProfileClock('09:00:00')).toBe('9:00 ص');
    expect(formatEmployeeProfileClock('17:00:00')).toBe('5:00 م');
    expect(formatEmployeeProfileClock('00:00:00')).toBe('12:00 ص');
    expect(formatEmployeeProfileClock('23:45:00')).toBe('11:45 م');
    expect(formatEmployeeProfileClock('not-a-time')).toBe('—');
    expect(formatEmployeeProfileClock('2026-10-19T08:50:00+00:00')).not.toBe('—');
  });
  it('enforces staff session and inherited profile authorization before processed events',()=>{
    expect(sql).toContain('dawaa_current_staff_account_id_strict()');
    expect(sql).toContain('v_profile := public.attendance_employee_profile_v1(p_staff_id,p_days)');
    expect(sql.indexOf('v_profile :=')).toBeLessThan(sql.indexOf('FROM public.staff_attendance_logs'));
    expect(sql).toContain('v_profile->\'staff\'->>\'id\' IS DISTINCT FROM p_staff_id::text');
    expect(sql).toContain("l.status='accepted'");
    expect(sql).toContain('l.shift_date BETWEEN v_from AND v_to');
    expect(sql).toContain('ads.staff_id=p_staff_id AND ads.attendance_date=e.shift_date');
    expect(sql).toContain('d.accepted_count>0 AND NOT d.has_summary');
    expect(sql).toContain("'missing_summary_days',v_missing_summary_days");
    expect(sql).toContain("'summary_covered_days',v_summary_covered_days");
    expect(sql).toContain("'coverage_complete'");
    expect(sql).toContain("'has_summary',(ads.id IS NOT NULL)");
    expect(sql).not.toMatch(/\b(?:DELETE FROM|UPDATE public\.|INSERT INTO public\.)/i);
  });
  it('never states that an unavailable attendance summary means zero lateness or no punches',()=>{
    expect(drawer).toContain('attendance_employee_profile_evidence_v1');
    expect(drawer).toContain('setProfile(null)');
    expect(drawer).toContain("profile.processed_evidence.coverage_complete");
    expect(drawer).toContain("profile.processed_evidence.missing_summary_days");
    expect(drawer).toContain("قبول البصمة");
    expect(drawer).toContain('لا يوجد ملخص حضور');
    expect(drawer).toContain('profile.processed_evidence.accepted_days');
    expect(pdf).toContain('processedEvidence');
    expect(pdf).toContain('coverageMissing ?');
    expect(pdf).toContain('missing_summary_days');
    expect(pdf).toContain('!input.processedEvidence?.coverage_complete');
    expect(pdf).toContain('لا تُعتمد الساعات للمرتب من هذا السجل وحده');
    expect(pdf).toContain('formatEmployeeProfileClock');
  });
  it('is parameterized by staff ID and highlights partial gaps, not a single named employee',()=>{
    expect(sql).toContain('p_staff_id uuid');
    expect(sql).toContain('l.staff_id=p_staff_id');
    expect(sql).toContain('ads.staff_id=p_staff_id');
    expect(sql).not.toContain('e3640642-5c60-4815-8001-1bb93193668f');
    expect(drawer).toContain('p_staff_id: staffId');
    expect(drawer).toContain('profile.rates.evaluated_days > 0');
    expect(drawer).toContain('ملف الحضور متاح جزئيًا فقط');
    expect(drawer).toContain('بلا ملخص حضور لهذا اليوم');
  });
});