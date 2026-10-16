# Attendance deduction ledger — V1 vs V2 decision review (2026-10-16)

Read-only review of `supabase/migrations/20260925141000_attendance_points_ledger_cutover_v2.sql` (V2) against the
attendance points-deduction engine live in Production (`jkjqeqkshllustwlzzbf`). No Production object or row was
changed; no migration was applied.

## 1. The three things called "V1/V2"

| Name | What it is | Exists in Production |
|---|---|---|
| **V1 deduction engine** | `dawaa_sync_attendance_points_deduction_v1` (hourly cron `attendance-points-deduction-sync`), writes `employee_transactions.source='attendance_deduction_v1'`, reviewed via `attendance_deduction_pending_review_v1` / `_review_decide_v1` / `_adjust_v1` | Yes, live |
| **V2 deduction ledger** | Repo migration `20260925141000`: `dawaa_sync_attendance_points_deduction_v2`, `dawaa_upsert_attendance_deduction_event_v2`, `attendance_deduction_pending_review_v2` / `_review_decide_v2` / `_adjust_v2`, source `attendance_deduction_v2`; turns V1 APIs into wrappers and switches the cron | **No** (no ledger row, no function) |
| Attendance impact ledger | `attendance_impact_ledger` + `get_attendance_impact_ledger_v2`: classified-day evidence only (no money, no points) | Yes — unrelated to deductions |

## 2. Data (Production, read-only)

| Measure | Current cycle 2026-10 | Previous cycle 2026-09 | All history |
|---|---|---|---|
| V1 rows (`attendance_deduction_v1`, any status) | 0 | 0 | 0 |
| V2 rows (`attendance_deduction_v2`, any status) | 0 | 0 | 0 |
| Matched / only-V1 / only-V2 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Amount / minute / employee / date / reason mismatches | n/a (no rows) | n/a | n/a |
| Duplicates V1 / V2 | 0 / 0 | 0 / 0 | 0 / 0 |
| Cancelled or reversed | — | — | 18 audit entries `attendance_deduction_v1_reversal` (2026-09-15 erroneous batch reversal); 13 manual deduction adjustments in `attendance_manual_actions_audit` |

Why both are empty: of 39 active staff, 12 have no compensation profile, 2 have no incentive base, and **25 are on
`salary_calculation_mode='attendance_hours_v1'`** (since 2026-08-26). Both engines skip hours-based staff by design
(Production fix `20260915205741_prevent_double_deduction_for_hours_based_staff`): their pay already counts only the
hours worked, so a points deduction would deduct twice. **0 active staff are eligible**, so the hourly V1 run
(167 runs in 7 days, 1 failure) produces nothing. Attendance money effects today come from hours-based pay and from
manual `attendance_manual_deduction` rows (approved), not from either deduction engine. No payroll cycle is finalized
(`payroll_finalized_snapshots_v2` is empty).

## 3. Business meaning, V1 vs V2

| Question | V1 (Production) | V2 (repo, never applied) |
|---|---|---|
| What is a deduction | One pending `penalty` row per staff per cycle, aggregated from **approved** attendance days; manager approves/rejects/adjusts | Same aggregation, one event per staff per cycle with deterministic `source_id` |
| Evidence | Description text only | Description + metadata + calculation fingerprint |
| Manual approval | `attendance_deduction_review_decide_v1` (GM/exec/branches manager) | `_review_decide_v2` |
| Replacement | Hourly **delete + reinsert of pending rows only**; approved rows are never touched | Recalculates by fingerprint; if inputs change it **cancels an already-approved row** and re-proposes (unless payroll is finalized) |
| Idempotency | None for pending (delete/reinsert); approved rows have no `source_id` | Yes (`source_id`, fingerprint) |
| Overtime netting input | `last_out − scheduled_end` (Production fix chain 2026-09-16) | `candidate_hours − scheduled_hours` (different input → different minutes) |
| `final_points` sign | `+points` | `−points` (payroll reads `points_delta`, which is `−points` in both, so payroll is not affected by this) |
| Canonical today | **Yes** (only live engine) | No — not deployed; client already calls it |

V2 is not "the same engine with better plumbing": it changes netting input and allows automatic cancellation of
manager-approved deductions. Those are business-semantic changes and need an explicit decision and a shadow period
before any cutover.

## 4. Consumers (Production schema + repo source)

**V1** — `dawaa_sync_attendance_points_deduction_v1` (cron), the three V1 review functions, `attendance_unified_approvals_v1`
(reads `pending_review_v1`; no client caller), `attendance_unified_approval_decide_v1` (calls `review_decide_v1`; no
client caller), `hr_canonical_architecture_health_v1` (only checks privileges). No view references either source.
No client code (branch or `main`) calls any V1 deduction API; `scripts/check-hr-domain-boundary-v1.cjs` forbids it.

**V2** — client only: `/attendance-report` tile (`listPendingAttendanceDeductions` → `attendance_deduction_pending_review_v2`)
and two unused service functions (`decideAttendanceDeductionV2`, `adjustAttendanceDeductionV2`). No page calls them.
No Production object exists for V2.

**Payroll / incentives / evaluation** — `dawaa_staff_points_truth_v2` → `dawaa_employee_points_ledger_v2` (approved,
any source, signed by `points_delta`) and pending `points_delta`; `get_payroll_incentive_truth_v2` uses that truth;
the payroll engine/gate do not read deduction sources by name. Both V1 and V2 penalties would reduce the points
incentive identically once approved.

## 5. Root cause of /attendance-report

**Stale client RPC against a never-deployed migration** (deploy drift since 2026-09-25): the tile calls
`attendance_deduction_pending_review_v2`, which does not exist in Production (404), so it shows "unavailable".
It is not a UI bug, permission problem or aggregation bug, and the data has no V1/V2 conflict (both ledgers are empty).
The page does **not** need the V2 cutover: it only needs a session-authorized read of pending attendance deductions
from the live ledger.

## 6. Payroll safety of a V2 cutover

| Question | Answer |
|---|---|
| Payroll semantics change | **YES** (approved-row auto-cancellation; different netting input) |
| Historical payroll change | NO today (no V1 rows, no finalized cycles), but yes in principle for re-calculated open cycles |
| Double-deduction risk | Low today (0 eligible staff); real if V1 and V2 both produce rows for the same cycle (V1 rows have no `source_id`, so the points ledger would count both) |
| Missing-deduction risk | Yes if V1 pending rows existed at cutover: V2 wrappers only see `attendance_deduction_v2` (stranded V1 rows); 0 today |

## 7. Decision

**D — V1_REMAINS_CANONICAL; fix the page without the cutover.** The V2 cutover is not ready (semantic changes,
no shadow evidence) and not needed for the page. Keep `20260925141000` unapplied; if V2 is wanted later, it needs its
own reviewed migration rebuilt from Production's current V1 rules (netting input, approved-row handling) and a
dual-read shadow period (option C) first.

## 7a. Update after the no-resurrection review (same day) — section 8 is WITHDRAWN

Decision D means only "do not cut over to the undeployed V2 ledger now"; it does not mean reviving V1.
The follow-up review shows the V1 deduction engine is **superseded**, not current canonical:

- 2026-09-15 `544d76e9` introduced attendance-based pending points deductions (V1 engine + review panel);
  2026-09-20 `58bc117b` added the "خصومات حضور بانتظار اعتمادك" tile.
- 2026-09-24 `0f6eaf4a` redefined the model in the canonical resolution center: attendance proves operational truth;
  general deductions go through the payroll/penalties path; the only attendance-side deduction is the fixed 50 EGP
  missing-punch penalty; financial resolution decisions only record a proposed multiplier "for financial review — no
  deduction applied".
- Since 2026-08-26 every profiled staff member is on hours-based pay (`attendance_hours_v1`), so attendance money
  effects flow through the hours-based payroll engine; both deduction engines skip all of them.
- The 2026-10-09 canonical attendance architecture series contains no deduction ledger; the HR boundary gate and
  `hr_canonical_architecture_health_v1` list the V1 deduction APIs as legacy.

Therefore the section 8 proposal (a reader over `attendance_deduction_v1` rows) would revive a legacy reader and is
withdrawn. There is **no current canonical reader** for "pending attendance deductions"; the tile belongs to the
superseded concept. The remaining decision is a product one (see the closure report): retire the tile, or define and
build a canonical "financial proposals awaiting review" queue (new capability, out of closure scope).

## 8. Minimal page fix (proposal, not implemented) — WITHDRAWN, see 7a

1. DB (local migration): define `public.attendance_deduction_pending_review_v2()` — the name the client already calls —
   as a reader of the **live** ledger: `source in ('attendance_deduction_v1','attendance_deduction_v2') and
   status='pending'`, same columns as the committed V2 reader, `STABLE SECURITY DEFINER`, authorized and scoped by
   `dawaa_staff_attendance_log_read_scope_v1()` (42501 without a verified actor), EXECUTE for anon/authenticated
   (session-verified inside). Reading both sources means the tile stays correct before and after any future V2
   cutover and can never hide pending rows of either engine.
2. Client: none (it already calls this name). Leave `decide/adjustAttendanceDeductionV2` unused; deciding stays on
   the existing V1 review path until a V2 decision is taken.
3. Repo hygiene: mark `20260925141000` as superseded for the reader (comment in the new migration) so it is not
   applied as-is.
4. Tests (PGlite): pending V1 row counted; approved/cancelled excluded; no deduction → 0; V2 row counted; no
   duplicate across sources; cycle boundary 25/26 unaffected (reader is cycle-agnostic, rows carry `month_cycle`);
   employee scope and branch scope; no-session 42501; payroll truth and historical rows unchanged (reader only).
5. No backfill, no recalculation, no cron change, no change to any deduction amount.

## 9. Local migration `20261016110000_attendance_v1_deduction_readers_revoke_client_v1`

Revokes client EXECUTE (PUBLIC, anon, authenticated) on `attendance_deduction_pending_review_v1()` and
`attendance_unified_approvals_v1()`; service_role keeps it; definitions unchanged. Today both are anon-callable with
no authorization (any anon-key holder can read every pending deduction). No client calls either; no payroll path
uses them; internal callers run as the function owner and are unaffected; rollback is a re-GRANT. It is a security
fix, not a cutover, and is safe independently of this decision.
