import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const code = (path: string) => readFileSync(resolve(process.cwd(),path),'utf8');
const drawer = code('src/components/attendance/EmployeeProfileDrawer.tsx');
const inbox = code('src/components/attendance/AttendanceResolutionCenter.tsx');
const rows = code('src/components/attendance/CrossBranchPunchesPanel.tsx');

describe('single-window staff review workflow',()=>{
  it('keeps the modal large, centered, accessible, and dismissible',()=>{
    expect(drawer).toContain('max-w-[1060px]');
    expect(drawer).toContain('items-center justify-center');
    expect(drawer).toContain("event.key === 'Escape'");
    expect(drawer).toContain('onClick={onClose}');
    expect(drawer).toContain('onClick={(e) => e.stopPropagation()}');
  });
  it('opens the existing guarded manager workflow inside the same employee profile',()=>{
    expect(drawer).toContain('REVIEW_ROLES.has(user?.role');
    expect(drawer).toContain('setShowReviews(true)');
    expect(drawer).toContain('initialStaffId={staffId} initialCurrentCycle embedded');
    expect(drawer).toContain('onDecisionSaved={() => setReloadVersion');
    expect(drawer).not.toContain('navigate(');
    expect(inbox).toContain('initialStaffId?: string | null');
    expect(inbox).toContain('embedded?: boolean');
    expect(inbox).toContain('row.staff_id === initialStaffId');
    expect(inbox).toContain('startOfMonth(cairoToday())');
    expect(inbox).toContain("setBranch('الكل')");
    expect(inbox).toContain("setLane('all')");
    expect(inbox).toContain('onDecisionSaved?.()');
  });
  it('shows only relevant case actions and retains note and validation paths',()=>{
    expect(inbox).toContain('embedded ? (');
    expect(inbox).toContain('مراجعة الحالة');
    expect(inbox).toContain('عرض السبب');
    expect(inbox).toContain('مطلوب: اكتب سبب القرار والدليل');
    expect(inbox).toContain("['custom', 'outside_work'].includes(decision.id) && !note.trim()");
    expect(inbox).toContain('resolveMissingPunchIncidentV1({');
    expect(inbox).toContain('approveAttendanceFullDayTimeOffV1({');
    expect(inbox).toContain('resolveAnnualLeaveFromAttendanceV1({');
    expect(inbox).toContain('approveAttendanceResolution({');
    expect(inbox).toContain('مشكلة نظام — أصلح السبب أولًا');
    expect(inbox).toContain('onDecisionSaved?.()');
    expect(inbox).toContain('لا خصم أو اعتماد تلقائي');
  });
  it('allows click anywhere on staff row or day card, without nested buttons',()=>{
    expect(rows).toContain('role="button" tabIndex={0}');
    expect(rows).toContain("event.key === 'Enter' || event.key === ' '");
    expect(rows).toContain('onClick={() => setProfileStaffId(day.staffId)}');
    expect(rows).toContain('onClick={() => setProfileStaffId(row.staff_id)}');
  });
});
