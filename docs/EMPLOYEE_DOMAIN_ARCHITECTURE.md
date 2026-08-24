# Employee Performance Domain Architecture

This document defines the canonical flow for employee-related data: identity, points, evaluations, incentives, attendance, tasks, and payroll.

The goal is to prevent each page/service from independently resolving a staff member or recalculating the same financial/performance outcome from different sources.

## 1. Canonical identity

Canonical employee identifier: `staff.id`.

Allowed identity fallbacks are migration-only:

- linked `staff_accounts.staff_id`;
- active aliases in `staff_identity_aliases`;
- normalized name matching only when no canonical id exists and the match is unambiguous.

New operational records must persist `staff_id`. Employee names are display/audit fields and must not be used as the primary relationship for new data.

Canonical flow:

`staff / safe account directory / aliases -> staffDirectoryReadModel -> EmployeeIdentity`

All downstream domains consume the canonical staff id.

## 2. Employee event / points ledger

`employee_transactions` is the canonical event ledger for approved employee point and money movements that are intended to affect employee performance/payroll history.

It must not become a generic dumping table for unrelated feature state.

Required rules for new records:

- canonical `staff_id`;
- explicit `source` / `source_type`;
- stable `source_id` when the event originates from another entity;
- canonical lifecycle status: `pending`, `active`, or `cancelled`; legacy
  `approved`/`rejected` values are read-compatible only;
- cycle/date metadata derived from one pharmacy-cycle implementation;
- money (`amount`) and performance points (`points_delta`) are distinct dimensions.

The ledger is append/audit oriented. Derived totals belong in projections/services, not duplicated snapshot columns across pages.

Browser code does not mutate the table directly. All current client mutations go
through `employeeTransactionService`; database policies remain the authorization
boundary. Physical deletion is not part of the lifecycle: invalidated records
move to `cancelled`, and financial corrections must be appended as reversals.

`staff.points` is a compatibility snapshot only. It is refreshed by the database
from active ledger rows for the current pharmacy cycle; pages must never update
it after writing a transaction.

## 3. Monthly points projection

`pointsLedger.ts` owns normalization semantics for legacy point records during migration.

Target flow:

`Employee Event Ledger -> Monthly Points Projection -> UI / incentive calculation`

Rules:

- approved records only affect final points;
- pending records are visible but not payable;
- duplicate source events are detected before aggregation;
- quarterly cash rewards do not mutate monthly performance points;
- a database/read failure must never be represented as a legitimate zero-point result.

Name/alias matching in the ledger is compatibility debt and should disappear as historical records are backfilled with canonical `staff_id`.

## 4. Evaluations

Canonical manager evaluation record: `manager_weekly_evaluations`, keyed by canonical `subject_staff_id` + evaluation type + week + branch context.

Evaluation calculation must consume approved domain projections, not query feature tables independently from UI components.

Target flow:

`Sales / Tasks / Attendance / Customer-service evidence`
`-> Evaluation Metrics Projection`
`-> Weekly Evaluation`
`-> Performance Incentive Settlement`

The current RPC chains (`v5 -> v4 -> v3 -> v2 -> legacy`) are compatibility debt. The target is one versioned canonical RPC/read projection with parity tests before retiring older versions.

An evaluation produces a score/evidence record. It must not directly alter the employee's payroll balance from browser code.

## 5. Incentives

Performance incentive and target-achievement bonus are separate financial components.

Canonical financial flow:

`Approved evaluations -> performance settlement -> employee_transactions`

`Closed sales cycle / target rules -> target settlement -> employee_transactions`

`employee_transactions -> staff_payroll_incentive_truth_v1 -> Payroll`

`staff_payroll_incentive_truth_v1` is the canonical automated incentive projection for payroll while the current settlement design remains active.

Rules:

- target achievement must not be mixed into the performance evaluation score;
- settlement is server-side and idempotent per employee/cycle/source;
- payroll reads settled truth, not live UI estimates;
- live estimates are explicitly labelled estimates and must not be treated as final payroll values.

## 6. Attendance and schedule

Canonical relationship key for schedule and attendance is `staff_id`.

Target flow:

`Shift schedule assignments (staff_id)`
`+ attendance events (staff_id)`
`-> Attendance Daily Projection`
`-> Current Presence / Monthly Attendance / Evaluation Evidence`

Name matching is compatibility-only for historical unlinked rows.

Attendance states must distinguish at least:

- scheduled and present;
- scheduled and absent;
- late;
- checked out;
- not scheduled;
- data unavailable / incomplete.

A failed attendance query must not silently mean "absent" or "zero attendance".

`currentShiftPresenceService` should evolve into a consumer of canonical staff + schedule + attendance projections rather than performing independent identity reconciliation.

## 7. Tasks and checklists

Task definition, assignment, completion evidence, and evaluation contribution are separate concepts.

Target flow:

`Task Definition + Cadence`
`-> Assignment / Expected Completion`
`-> Completion Evidence (staff_id, task_key, date, branch)`
`-> Task Completion Projection`
`-> Evaluation Metrics`

Historical task aliases may be resolved in one compatibility boundary only. Pages must not independently interpret old task keys.

Task completion can influence an evaluation only through the canonical evaluation metrics projection; it must not directly write financial incentive amounts from UI code.

## 8. Staff performance profile

`staffPerformanceProfileService` is transitional orchestration debt.

Target structure:

`Staff Performance Profile`
`-> Employee Identity`
`-> Sales Projection`
`-> Points Projection`
`-> Evaluation Projection`
`-> Incentive Projection`
`-> Attendance Projection`
`-> Task Completion Projection`
`-> Customer/Conversation projections`

The profile service should combine section results, data freshness, and health states only. It should not contain direct shared-table queries or its own identity/matching algorithms.

## 9. Payroll boundary

Payroll must consume settled, auditable projections only.

Final payroll must never be calculated by summing arbitrary browser-visible transactions or live estimates.

At minimum the payroll boundary should distinguish:

- base salary inputs;
- monthly performance incentive;
- target achievement bonus;
- approved manual rewards/deductions;
- quarterly cash incentives;
- attendance/absence financial effects;
- pending/unsettled values (display only, excluded from final pay).

## 10. Database reproducibility

Production database behavior must be reproducible from repository migrations.

A migration file that only documents functions applied manually to the live database is not sufficient as a durable architecture state.

Any live-only function/trigger/cron behavior must be captured in a real idempotent migration before the historical documentation-only migration can be considered retired.

## 11. Architecture gates

During migration CI should progressively enforce:

- no new UI direct reads from `staff`;
- no new UI direct reads from `employee_transactions`;
- no new UI direct reads from `attendance`;
- legacy UI direct-reader registers can only shrink;
- no new employee-domain relationship based only on employee name when a canonical `staff_id` is available;
- no new financial final-value calculation in pages/components;
- exactly one client-side employee-ledger writer boundary;
- no new `staff.points` writer or `applyStaffDelta` caller;
- employee ledger records are cancelled/reversed, never physically deleted;
- compatibility RPC/version chains must be isolated behind one domain boundary.

## 12. Migration order

1. Canonical staff identity everywhere.
2. Freeze new direct employee ledger / attendance UI access.
3. Move Staff Performance Profile base identity to Staff Directory.
4. Introduce canonical points/employee-event repository boundary.
5. Introduce attendance projection boundary and backfill missing `staff_id` links.
6. Consolidate task completion keys and canonical evaluation metrics RPC.
7. Retire evaluation RPC version chains after parity tests.
8. Make payroll consume only settled projections.
9. Capture live-only database functions in real migrations.
10. Remove legacy name matching and direct table readers after backfill/parity verification.
