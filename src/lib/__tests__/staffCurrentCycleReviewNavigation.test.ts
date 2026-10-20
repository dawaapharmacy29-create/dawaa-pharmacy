import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startOfMonth } from '@/lib/attendance/period';
const resolution=readFileSync(resolve(process.cwd(),'src/components/attendance/AttendanceResolutionCenter.tsx'),'utf8');
const report=readFileSync(resolve(process.cwd(),'src/pages/AttendanceReport.tsx'),'utf8');
describe('current payroll cycle staff review deep-link routing',()=>{
  it('computes the real 26→25 attendance payroll cycle, including rollover',()=>{
    expect(startOfMonth('2026-10-20')).toBe('2026-09-26');
    expect(startOfMonth('2026-10-26')).toBe('2026-10-26');
    expect(startOfMonth('2026-01-03')).toBe('2025-12-26');
  });
  it('routes staff UUID into the existing manager-only resolution inbox',()=>{
    expect(report).toContain("searchParams.get('review_period') === 'current-cycle'");
    expect(report).toContain("searchParams.get('review_staff')");
    expect(report).toContain("decisionSubTab === 'resolution' && isOperationalManager");
    expect(report).toContain('initialStaffId={scopedReviewStaff}');
    expect(report).toContain("scopedReviewStaff ? 'الكل' : effectiveBranch");
  });
  it('filters to exact staff ID and current-cycle dates, without showing other employees',()=>{
    expect(resolution).toContain('row.staff_id === initialStaffId');
    expect(resolution).toContain('row.attendance_date >= startOfMonth(cairoToday())');
    expect(resolution).toContain('row.attendance_date <= cairoToday()');
    expect(resolution).toContain('initialCurrentCycle ? startOfMonth(cairoToday())');
    expect(resolution).toContain("initialCurrentCycle ? cairoToday()");
    expect(resolution).toContain("setLane('all')");
    expect(resolution).toContain("setBranch('الكل')");
    expect(resolution).toContain('!initialStaffId && <button onClick={() => void runMaterialization()}');
    expect(resolution).toContain('showFormer || initialStaffId ? scopedRows');
    expect(resolution).toContain('مراجعات الموظف المحدد فقط');
  });
});