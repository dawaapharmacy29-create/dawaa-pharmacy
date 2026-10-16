import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('overtime review — stale approvals reach a manager decision and block payroll visibly', () => {
  it('the review service calls the session-authorized RPCs and surfaces errors', () => {
    const service = read('src/lib/attendance/attendanceBreakdownService.ts');
    expect(service).toMatch(/rpc\('list_stale_overtime_approvals_v1'/);
    expect(service).toMatch(/rpc\('review_stale_overtime_approval_v1'/);
    expect(service).toMatch(/StaleOvertimeDecision = 'confirm' \| 'adjust' \| 'reject' \| 'recalculate'/);
    // decisions on pending rows stay on the canonical v3 RPC
    expect(service).toMatch(/rpc\('decide_overtime_approval_v3'/);
  });

  it('the overtime center shows the stale review panel with all four decisions and a required note', () => {
    const center = read('src/components/attendance/OvertimeApprovalCenter.tsx');
    expect(center).toMatch(/<StaleOvertimeReviewPanel branch=\{branch\} onDecided=/);
    const panel = read('src/components/attendance/StaleOvertimeReviewPanel.tsx');
    for (const decision of ['confirm', 'adjust', 'reject', 'recalculate']) {
      expect(panel).toMatch(new RegExp(`decide\\(row, '${decision}'\\)`));
    }
    expect(panel).toMatch(/if \(!note\) \{/);
    // a failed load is an error state, never "nothing to review" and never zero counts
    expect(panel).toMatch(/loadError \? \(/);
    expect(panel).toMatch(/\{!loadError && \(/);
    // missing amounts stay explicit and are never shown as 0
    expect(panel).toMatch(/row\.amount_missing\s*\?\s*<span/);
    expect(panel).not.toMatch(/overtime_amount \|\| 0|overtime_amount \?\? 0/);
    // recalculation only where v3 can recalculate from current truth
    expect(panel).toMatch(/disabled=\{decidingId === row\.id \|\| !row\.recalculate_available\}/);
  });

  it('payroll readiness shows the stale-overtime blocker, links to the review and keeps finalization closed', () => {
    const gate = read('src/components/attendance/PayrollAttendanceSafetyGate.tsx');
    expect(gate).toMatch(/listStaleOvertimeApprovals\(\{ monthCycle \}\)/);
    expect(gate).toMatch(/row\.staff_id === staffId/);
    // fail closed: an unreadable check blocks like a stale approval
    expect(gate).toMatch(/const overtimeBlocked = staleOvertimeError !== null \|\| \(staleOvertime\?\.count \?\? 0\) > 0/);
    expect(gate).toMatch(/const ready = gate\.ready && !overtimeBlocked/);
    expect(gate).toMatch(/disabled=\{loading \|\| !row\.finalization_ready \|\| overtimeBlocked\}/);
    expect(gate).toMatch(/disabled=\{loading \|\| overtimeBlocked \|\| !!finalized\.length/);
    expect(gate).toMatch(/<Link to=\{OVERTIME_REVIEW_ROUTE\}/);
    expect(gate).toMatch(/const OVERTIME_REVIEW_ROUTE = '\/attendance-report\?tab=overtime'/);
    // the review route exists
    const page = read('src/pages/AttendanceReport.tsx');
    expect(page).toMatch(/overtime: \{ tab: 'decisions', decisionSub: 'overtime' \}/);
  });
});
