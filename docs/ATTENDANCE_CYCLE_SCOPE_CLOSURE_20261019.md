# Attendance cycle scope closure — 2026-10-19

Branch: `fix/attendance-truth-cycle-scope-20261019`

## Status (do not infer Production activation)

- GitHub branch only. **No deploy, merge, Production DDL/DML, payroll mutation, or settlement.**
- Source-of-truth `attendance_truth_cycle_v2` fix is a **proposed migration**, not applied.
- Production SQL was read to copy the **current** authorized function definition; the only functional change is the `eligible` CTE's historical visibility condition.
- Current Production period reviewed: 2026-09-26 to 2026-10-19 (Cairo). A read-only selection preview identified nine additional staff with historical attendance that the former current-visibility gate omitted; do not treat that as an executed corrected report.
- Pending overtime read-only audit: 201 total pending, 105 in the reviewed cycle to 2026-10-19, 96 before it.

## Implemented on branch

1. Historical attendance within the selected range includes hidden or former staff with materialized rows, while keeping existing per-actor read scopes and branch filters unchanged.
2. A pure `partitionPendingOvertime` helper separates current period / previous / future / invalid-dated pending rows without editing approval amounts or statuses.
3. HR summary and attendance summary show **current-cycle** overtime separately from outside-cycle cases. Leave requests remain all-period as documented; the source returns at most 200.
4. Overtime manager pane provides explicit cycle, outside-cycle and all-pending scopes, defaulting to the cycle for matching drilldowns.
5. Role aliases `delivery` / `دليفري` / `توصيل`, pharmacy, and assistant are normalized for display only; account roles and permissions unchanged.
6. A failed payroll truth readiness flag cannot be rendered as `Truth مستقرة` just because a direct-blocker count is zero.
7. Date-scoped on-time attendance is not labeled as a real-time live-presence count.

## Verified (branch/source read-only)

- Static contract checks: 9/9 passed on the branch.
- The SQL migration is a byte-for-byte copy of the Production function **except** the documented historical-visibility filter change and SQL statement terminator.
- Existing RPC authorization `dawaa_current_actor_can` and `dawaa_staff_attendance_log_read_scope_v1` checks remain unchanged.
- A Vitest regression file `attendanceTruthCycleScope.test.ts` was committed.
- **Not yet verified:** full Vitest runner, TypeScript build, Playwright/browser smoke, or migration run in PGlite. There was no authorized branch-specific full development runtime in this session.

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
