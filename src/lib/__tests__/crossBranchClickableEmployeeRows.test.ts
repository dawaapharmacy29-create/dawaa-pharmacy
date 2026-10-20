import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const src = readFileSync(resolve(process.cwd(),'src/components/attendance/CrossBranchPunchesPanel.tsx'),'utf8');
describe('cross-branch actionable employee rows',()=>{
  it('opens entire staff-day summary as accessible button, not name-only nested button',()=>{
    expect(src).toContain('onClick={() => setProfileStaffId(day.staffId)}');
    expect(src).toContain('aria-label={`عرض تفاصيل ${day.name}');
    expect(src).toContain('block w-full cursor-pointer');
  });
  it('makes all punch table cells open staff details, including keyboard Enter and Space',()=>{
    expect(src).toContain('role="button" tabIndex={0}');
    expect(src).toContain('onClick={() => setProfileStaffId(row.staff_id)}');
    expect(src).toContain("event.key === 'Enter' || event.key === ' '");
    expect(src).not.toContain('<button onClick={() => setProfileStaffId(row.staff_id)}');
  });
});