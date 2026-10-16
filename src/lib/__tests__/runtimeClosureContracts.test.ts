import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

// Regressions found by the authenticated Production route sweep (2026-10-16).
describe('runtime closure — links, error states and identity context', () => {
  it('the executive invoices card opens the routed invoices page with the dashboard period', () => {
    const page = read('src/pages/ExecutiveDashboard2027.tsx');
    expect(page).not.toMatch(/\/invoice-import/);
    expect(page).toMatch(/navigate\(`\/invoices\?\$\{new URLSearchParams\(\{ from: startDate, to: endDate \}\)/);
    // /invoices reads exactly these keys
    const invoices = read('src/pages/Invoices.tsx');
    expect(invoices).toMatch(/searchParams\.get\('from'\)/);
    expect(invoices).toMatch(/searchParams\.get\('to'\)/);
  });

  it('pending lifecycle/assignment panels show a failed load, never "no pending requests"', () => {
    for (const file of ['src/components/hr/StaffLifecycleApprovalPanelV2.tsx', 'src/components/hr/StaffAssignmentApprovalPanelV2.tsx']) {
      const panel = read(file);
      expect(panel).toMatch(/setLoadError\(error instanceof Error \? error\.message/);
      expect(panel).toMatch(/\{loadError && /);
      expect(panel).toMatch(/!loading && !loadError && rows\.length === 0/);
    }
  });

  it('the manager live incentive never turns a failed checklist or history read into 0% or an empty history', () => {
    const service = read('src/lib/evaluations/managerLiveIncentiveService.ts');
    expect(service).not.toMatch(/fetchWeeklyChecklistCompletion\([^)]*\)\.catch/);
    expect(service).not.toMatch(/fetchEvaluationHistory\([^)]*\)\.catch/);
  });

  it('doctor dashboard personal sections report failed reads instead of rendering "none"', () => {
    const page = read('src/pages/DoctorDashboardStable.tsx');
    for (const part of ['reviews', 'requirements', 'payroll', 'offers']) {
      expect(page).toMatch(new RegExp(`setPart\\('${part}', 'error'\\)`));
      expect(page).toMatch(new RegExp(`personalState\\.${part} === 'error' \\? <PartError`));
    }
    for (const source of ['conversation_sales_reviews', 'stagnant_medicines', 'incentive_medicines', 'staff_payroll_summary', 'offers', 'whatsapp_stories']) {
      expect(page).not.toMatch(new RegExp(`safeRows\\(\\s*supabase\\s*\\.from\\('${source}'\\)`));
    }
    // a failed ledger/profile read never becomes a live incentive built from zero points
    expect(page).toMatch(/if \(txResult\.error \|\| profileResult\.error\) throw/);
  });

  it('/quarterly-incentives data checks use canonical sources and report unreadable checks as unavailable', () => {
    const service = read('src/lib/dataIntegrityService.ts');
    expect(service).not.toMatch(/duplicate_count/);
    expect(service).toMatch(/await findStaffDuplicates\(\)/);
    for (const check of ['duplicate_staff', 'cash_as_points', 'no_staff_id']) {
      expect(service).toMatch(new RegExp(`unavailableChecks\\.push\\(\\{ type: '${check}'`));
    }
    expect(service).not.toMatch(/if \(!\w+\.error && /);
    const page = read('src/pages/QuarterlyIncentives2027.tsx');
    expect(page).toMatch(/dataHealth\?\.unavailableChecks\?\.length > 0/);
  });

  it('/daily-command reads canonical sources with exact counts and never shows a failed read as 0', () => {
    const page = read('src/pages/DailyCommand.tsx');
    expect(page).not.toMatch(/'shortages'|'time_off_requests'|safeRows/);
    // pending points come from the same domain source and rule as /penalty-incentive, not a page-level table scan
    expect(page).not.toMatch(/from\('employee_transactions'\)/);
    expect(page).toMatch(/countPendingEmployeeTransactionsForCycle\(/);
    const transactions = read('src/services/employeeTransactionService.ts');
    expect(transactions).toMatch(/rpc\('get_employee_transactions_for_cycle_v1'[\s\S]*pointRecordStatus\(row\) === 'pending'/);
    expect(page).toMatch(/\.eq\('is_current', true\)/);
    expect(page).toMatch(/listStaffTimeOffRequests\(\{ status: 'pending', limit: 200 \}\)/);
    expect(page).toMatch(/value === null \? 'غير متاح' : String\(value\)/);
    expect(page).not.toMatch(/dataHealth\?\.error \? 1 : 0/);
    expect(page).toMatch(/setTeamAlphaError\(teamAlphaRes\.error/);
    expect(page).toMatch(/atRiskError \? 'غير متاح'/);
    // the page does not render customer intelligence, so it skips the ~10 s customer cards read
    expect(page).toMatch(/includeCustomerIntelligence: false/);
    const service = read('src/lib/dashboardSummaryService.ts');
    expect(service).toMatch(/params\.includeCustomerIntelligence === false\s*\?\s*Promise\.resolve<CustomerIntelligence>\(\{ \.\.\.CUSTOMER_INTELLIGENCE_EMPTY, error:/);
  });

  it('/attendance-report has no pending-deduction tile and reads no deduction ledger (no canonical source)', () => {
    const page = read('src/pages/AttendanceReport.tsx');
    expect(page).not.toMatch(/خصومات حضور بانتظار اعتمادك/);
    expect(page).not.toMatch(/pendingDeductions|listPendingAttendanceDeductions/);
    expect(page).not.toMatch(/attendance_deduction_/);
    const operations = read('src/lib/attendance/attendanceOperationsService.ts');
    expect(operations).not.toMatch(/attendance_deduction_pending_review/);
    // neighbouring decision tiles show unavailable, never 0, when the triage read failed
    expect(page).toMatch(/approvalsSummary\?\.pendingResolutions == null \? 'غير متاح'/);
    expect(page).toMatch(/systemInterpretationCount == null \? 'غير متاح'/);
    expect(page).not.toMatch(/\(approvalsSummary\?\.systemPairable \|\| 0\) \+ \(approvalsSummary\?\.systemInterpretation \|\| 0\)/);
  });

  it('/points?staff_id= focuses one employee by id (Team page badges)', () => {
    const page = read('src/pages/Points.tsx');
    expect(page).toMatch(/searchParams\.get\('staff_id'\)/);
    expect(page).toMatch(/!focusStaffId \|\| staff\.id === focusStaffId/);
    const team = read('src/pages/Team.tsx');
    expect(team).toMatch(/to=\{`\/points\?staff_id=\$\{emp\.id\}`\}/);
  });
});
