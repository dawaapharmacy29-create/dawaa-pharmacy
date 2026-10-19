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

## Additional finding — drift detection compared different engines

The 2026-10-19 browser screenshots exposed 25 apparent candidate-hour differences and
230 classification-only discrepancies in the old `attendance_resolution_drift_v1`
read. **Do not bulk-reopen the 25 days** based on that output.

Read-only Production SQL audit through 2026-10-18 (approved attendance only):

- Old hard-coded V2 rebuild: 25 candidate-hour differences and 230 classification-only differences.
- Rebuild via canonical `dawaa_build_attendance_day_resolution_current_v1` (excluding explicitly out-of-scope routes): 22 candidate-hour differences and 179 classification-only differences, covering the same approved records and dates.
- Five old-only false positives (V3 flexible attendance misrouted to V2; these
  included Dr Mohamed El-Agouz on 12/13/15 Oct, Dr Alia on 10 Oct and Dr Amira on 4 Oct).
- Two additionally detected differences on 26/27 Sep for Dr Mohamed El-Agouz, which must
  be reconciled against stored manual policies before any action.
- This is a **diagnostic difference between candidate hours**, not evidence by itself
  of an erroneous payroll settlement: compare `payroll_eligible_hours`, manual
  authorization, effective policies, and approved snapshot before reopening.
- No attendance approvals, payroll snapshots, overtime records or statuses were changed.

The proposed `20261019123000_attendance_drift_canonical_engine_route_v1.sql`
migration aligns the four existing drift readers with the central V2/V3 router,
preserving signatures, branch scope and review authorization. It also avoids
treating an out-of-scope current route as evidence that historical approved truth
is invalid.

The UI wording now distinguishes *reinterpreted candidate-hour mismatches* from
proven financial errors. A regression test
`attendanceDriftCanonicalEngine.test.ts` guards the four functions and UI copy.

**Outstanding:** run the migration in an isolated PGlite/Postgres fixture, execute
Vitest/typecheck/build, and compare old and new per-staff drilldowns, particularly
manager-authorized punches and September 26/27. Production still runs the old RPCs.
Do not publish/merge/deploy until these checks pass and the user explicitly approves.
