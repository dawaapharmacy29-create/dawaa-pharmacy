# Attendance cycle scope closure — 2026-10-19

Branch: `fix/attendance-truth-cycle-scope-20261019`

## Status (do not infer Production activation)

- GitHub branch only. **No deploy, merge, Production DDL/DML, payroll mutation, or settlement.**
- Source-of-truth `attendance_truth_cycle_v2` fix is a **proposed migration**, not applied.
- Production SQL was read to copy the **current** authorized function definition; the only functional change is the `eligible` CTE's historical visibility condition.
- Current Production period reviewed: 2026-09-26 to 2026-10-19 (Cairo). A read-only selection preview identified nine additional staff with 128 historical days that the former current-visibility gate omitted. The old eligible set has 37 staff, new preview 46; loss from old: **zero**. No duplicate `(staff_id, attendance_date)` rows found. Do not treat this as an executed corrected report.
- Pending overtime read-only audit: 201 total pending, 105 in the reviewed cycle to 2026-10-19, 96 before it.

## Implemented on branch

1. Historical attendance within the selected range includes hidden or former staff with materialized rows, while keeping existing per-actor read scopes and branch filters unchanged.
2. A pure `partitionPendingOvertime` helper separates current period / previous / future / invalid-dated pending rows without editing approval amounts or statuses.
3. HR summary and attendance summary show **current-cycle** overtime separately from outside-cycle cases. Leave requests remain all-period as documented; the source returns at most 200.
4. Overtime manager pane provides explicit cycle, outside-cycle and all-pending scopes, defaulting to the cycle for matching drilldowns.
5. Role aliases `delivery` / `دليفري` / `توصيل`, pharmacy, and assistant are normalized for display only; account roles and permissions unchanged.
6. A failed payroll truth readiness flag cannot be rendered as `Truth مستقرة` just because a direct-blocker count is zero. Pending overtime list fetch errors also fail closed with an explicit retry, and late responses cannot replace newly selected branch results.
7. Date-scoped on-time attendance is not labeled as a real-time live-presence count.

## Verified (branch/source read-only)

- Static contract checks: 9/9 passed on the branch.
- The SQL migration is a byte-for-byte copy of the Production function **except** the documented historical-visibility filter change and SQL statement terminator.
- Existing RPC authorization `dawaa_current_actor_can` and `dawaa_staff_attendance_log_read_scope_v1` checks remain unchanged.
- A Vitest regression file `attendanceTruthCycleScope.test.ts` was committed and extended with failed-request/stale-load UI assertions.
- **Not yet verified:** actual Vitest runner, TypeScript typecheck, Vite build, browser smoke, or migration execution in isolated PGlite/Postgres. GitHub has no CI status on this feature branch yet; static assertions are not a substitute for execution.

## Required before any Production apply

1. Execute unit tests and attendance architectural gates plus TypeScript/Vite build from this branch in an isolated build runner.
2. Validate SQL migration against an isolated PGlite/Postgres fixture, especially the security-definer auth and scoped branch behavior; no new paid Supabase project.
3. Before/after shadow-read the same date range and branch, covering active, hidden-on-leave and former staff, all with authorization scopes.
4. Check old approved attendance/OT sums are preserved, there are no duplicate daily cases and no paid/finalized snapshots are modified.
5. Test the real UI: HR summary → overtime cycle/backlog → one approved attendance case → truth panel → payroll preflight.
6. Do not merge to main, enable automatic Production migrations, or deploy to Vercel until separately approved.

## Notes

- The new historical report will display old cases for employees who are no longer shown on today's shift roster; this is intentional.
- This work does **not** create or approve any open-ended leave request. The leave-period business policy, start date and paid/unpaid nature must be resolved separately through the canonical leave workflow.
- Older branch `main` updates found during development affected invoice/sales scope, with no direct file overlap, but this feature branch may need a clean update before merge.

## Further audit — effective historical engine and manager decisions

The screenshots and a **read-only** Production simulation exposed two competing
interpretations:

1. The deployed drift RPC always uses V2, even for materialized V3 days.
2. The first draft fix used the employee's **current** canonical route, which
   is mutable and can retroactively select V3 for a day saved under V2.

**Use the day-specific `attendance_daily_summary.resolution_version`** to select
the V2 or V3 comparator, rather than the staff's current role/attendance policy.
Unknown versions now produce a review signal in both generic and delivery
financial-drift guards (fail closed, not silently omitted). This is not a
retroactive recalculation or approval edit.

### Verified SQL shadow-read: 26 Sep–18 Oct 2026

| Measure | Deployed forced V2 | Proposed stored-version V2/V3 |
|---|---:|---:|
| Approved days examined | 715 | 715 |
| Candidate-hour differences | 25 | 20 |
| Classification-only differences | 230 | 186 |
| Old false hour alarms removed | — | 5 |
| Newly invented differences | — | 0 |

The 20 remaining candidate-hour differences have saved decision notes.
Nineteen have a non-`system` origin; the one system-origin case still includes
a manager note. Examples: four manager-approved 08:00 check-outs for Dr Omar
Eissa, approved early departures, manual clock adjustments, and schedule changes.
**None should be reopened based solely on this count.** The 20 are not
necessarily financial-payroll defects.

`candidate_hours`, `payroll_eligible_hours` and actual
`base_payable_hours` have different meanings. The canonical
`attendance_payroll_engine_core_v2` derives payable hours from schedule bounds,
deduction audits and approved notes; it does **not** simply sum
`payroll_eligible_hours`. On the same 715 approved rows, 42 have positive
candidate hours but a null `payroll_eligible_hours` value. This is a
**data-quality/reconciliation question**, not evidence that those hours were
unpaid or that the stored salary is incorrect.

### Files on the branch

- `20261019123000_attendance_drift_canonical_engine_route_v1.sql` now uses the
  stored engine version for four existing drift RPCs; no schema/signature,
  authorization or salary formula changes.
- `attendanceDriftCanonicalEngine.test.ts` asserts both engine dispatch
  branches and that unsupported versions are surfaced instead of ignored.
- `AttendancePayrollTruthPanel.tsx` explains candidate-hour divergence without
  instructing automatic undoing of an approved payroll decision.

### Before deployment

Run an isolated PostgreSQL/PGlite replay and Vitest/typecheck/Vite build.
Investigate the 20 evidence-backed deviations, prioritizing changes to actual
payable hours or payroll finalization readiness. Reconcile employee effective
dates independently of today's visible roster. Production RPCs remain unchanged,
and no changes to posted payroll, raw biometric logs or approved manual
decisions have been made. No merge, preview deployment or new Supabase project
was authorized.

### Historical branch attribution (separate, authorization-sensitive)

Read-only Production check on 2026-09-26 to 2026-10-18: 26 daily
attendance rows from 3 staff have an `attendance_daily_summary.branch`
different from their current `staff.branch` (22 warehouse days for
Dr Hoda, 3 Shokry days for Youssef Essam, 1 Shokry day for Dr Wael).
This is *not* evidence of duplicate biometric events or wrong assignment.

The existing Truth V2 branch filter and row `branch` use current staff branch.
The historical-visibility migration deliberately leaves that access policy
unchanged. A future correction should distinguish `current_staff_branch` from
`attendance_branch_on_day` using authorized historical branch assignment and
a tested read-scope rule; silently widening branch-manager access is not
acceptable. Do not change employee branch or historical punch sources to
mask this attribution difference.
