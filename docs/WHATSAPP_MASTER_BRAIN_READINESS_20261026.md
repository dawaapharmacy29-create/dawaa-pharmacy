# WhatsApp Master Brain — Final Readiness Report (2026-10-26)

Branch `fix/whatsapp-distinct-service-complaint-case-20261025`, base `f98ca8ef` (also what Vercel
production serves). **Nothing was written to production**: no migration, reanalysis, delete,
restore, deploy or merge. Production was read with SELECT queries only. Real-PostgreSQL tests ran
in a throw-away local container (`dawaa-mb-verify-pg`, PostgreSQL 17.6, `--network none`).

> Correction of the first-pass report: it defined an "officially approved" review as
> `impact_status='approved'` (1,845 rows). That was wrong. `impact_status` is the approval of a
> review's **points effect** (`conversationReviews.ts`: any deduction or severe error is saved
> `pending`), not of the review. Using it for scores would have dropped every review with a
> deduction (production: average 98.8 instead of 96.7). The contract now separates the two
> questions — see Gate 2.

## 1. Starting state and Phase-A evidence (unchanged from the first pass)

* GitHub HEAD `f98ca8ef`; local `5bafa9aa` exists in no clone on this machine; all branch
  migrations through `20261025114500` are applied; Vercel production deployment `7313238540` = `f98ca8ef`.
* Dr. Omar `a48730df…:interaction:0`: invoice 74857 matched code 7661, name, branch, time (+8 min)
  and the canonical line (47797 ×1) but was refused because another pharmacist keyed it; identity
  was double-counted; header evidence was blocked by the missing announced total.
* Dr. Donia `62f56d32…`: two `ready` actions without target are correct proposals; the live
  analysis predates this branch's segmentation (reanalysis needed, not run).

## 2. The four final gates

### Gate 1 — Single Canonical Truth

**Inventory (enforced, not just listed):** `scripts/check-whatsapp-canonical-consumers.cjs` (added
to `prebuild`) finds every source file that reads conversation reviews, WhatsApp sale truth or
WhatsApp actions and requires a registered role. Current register: 51 files —
11 `official_scored`, 12 `canonical_si`, 10 `writer`, 7 `record_view`, 5 `operational`, 5 `config`,
1 `transitional`. It fails on an unregistered reader, a stale entry, an `official_scored` file that
does not import the official contract, or a new reader of the legacy `converted_to_sale` flag.

**SQL side:** one fix point. `conversation_sales_reviews_official_v1` is read by 13 functions and
one view — including the two money paths `calculate_weekly_manager_metrics(_v2)` →
`manager_weekly_evaluations` → incentive settlement, and `get_doctor_incentive_breakdown`. It
filtered only canonical-source membership. Migration `20261026094000` makes it truly official
(same predicate as the TS contract); production read: 2,083 → 2,081 rows (the 2 unapproved
automatic analyses leave; the 232 human reviews with pending points stay). Column list is
verified identical against production, so all 13 dependents keep compiling.

**Divergent paths removed (TS):** each now uses the official contract and the Cairo
conversation date:

| Path | Divergence found |
| --- | --- |
| `doctorCompetitionMetrics.ts` and its duplicate in `DoctorCompetition.tsx` | counted pending/automatic reviews in the 15-point competition score; UTC day bound |
| `monthlyPerformance360Service.ts` | `created_at` dating; scores ≤ 5 multiplied by 20 (a real 4/100 became 80) |
| `WhatsappAnalytics.tsx` | dated by `review_date` (typing day); missing scores averaged as 0 |
| `ReportsCenter.tsx`, `ReviewsInsightsHub.tsx` | staff rankings over unapproved rows; `review_date` dating |
| `DoctorDashboardStable.tsx`, `DoctorReviewDetails.tsx` | averages over pending/automatic rows; `0` when none; points summed from unpaid rows |
| `staffPerformanceProfileService.ts`, `employeeMonthlyEvidenceService.ts` | (first pass) |

**Transitional, documented (not fixed):** Doctor-eye conversion
(`doctorPerformanceIntelligenceService` → `get_doctor_sales_reconciliation_v1`) defines a sale from
review "sold" claims and excludes invoices keyed by another seller. The canonical KPI uses Sales
Intelligence `sale_proven` + closer credit. It is an insight panel, not on the payroll path;
replacing the RPC is an owner decision. `loadStaffDetailSections` (unfiltered reviews) has no
callers. `DailyCommand` low-score alerts intentionally include reviews awaiting approval.

### Gate 2 — Evaluation Fairness

**Contract (corrected):** `src/lib/evaluations/officialConversationReview.ts`

| Question | Rule |
| --- | --- |
| Official evidence (scores, rankings, monthly) | current, not superseded, not reversed; a human review by an authorized reviewer counts as written (customer-service team included, no general-manager review); an automatic analysis only after explicit manager approval |
| Payable points | official **and** `impact_status='approved'` |

Production impact: 232 official human reviews have pending points — they count in scores, their
points stay unpaid. 2 automatic analyses are excluded until a manager approves them. Approved
customer-service reviews are kept as they are (nothing is re-scored or demoted).

**19-criteria audit — reference set** `masterBrainHardening.evaluationFairness.test.ts`
(service, sale, complaint resolved, complaint at export end, kept promise, media-only, thanks-only,
"مفيش مشكلة"). Invariants on every criterion: unassessed ⇒ no points; every deduction cites
messages/records and a reason; clinical items never auto-scored; no evidence ⇒ score null.
It found and the branch fixes:

| Finding (before) | Cause | Fix |
| --- | --- | --- |
| Customer's "وصلت الحمد لله المشكلة اتحلت شكرا" 40 min later became its own case, scored greeting 0, name 0, "missed sale", "ignored complaint"; the real complaint lost its resolution (5/10) | segmentation kept delayed staff courtesy but not a delayed customer confirmation | `whatsappConversationUnderstandingV32.ts`: a pure arrival/resolution confirmation within the 6-h continuation window stays in the case (new problems/requests do not) |
| A case with no pharmacy message was penalised (greeting/name/closing 0) | absence treated as behaviour | `conversationEvaluation.ts`: staff-behaviour criteria → `insufficient_evidence` with a human-review reason |
| Delivery-status question ("الطلب وصل فين؟") scored on selling (4/10 passive) | no product/basket, typed as sales opportunity | `salesCriteriaApplicable`: order-status-only cases are not a sales test |
| "هنبعت العلبة الناقصة حالا" not recognised as a remedy | remedy vocabulary | `complaintAssessmentEngine.ts` REMEDY_RX |

Checked and fair as is: `angry_customer` scoring uses the canonical complaint assessment (a
pharmacist's "مفيش مشكلة" does not trigger it); multi-staff conversations are refused at
persistence (`multiple_staff_ids_in_case`) so nobody is charged for another's messages;
insufficient evidence never deducts; consultation/dosage are manual-only.

Rubric policy (not changed, owner's call): a promised return after 5–10 minutes earns 5/10.

**Automatic vs approved human reviews:** production has **0** conversations with both an
automatic and a human review (2 automatic rows in total), so a per-case comparison is not
possible yet. Distribution (90 days): approved human reviews average 98.8–99.3 per reviewer with
80–90 % exactly 100 and 0 % below 70; reviews with pending points average 76–84. The automatic
analyses scored 86 and 94 (coverage 88 %). Neither side is treated as correct: the ceiling effect
in approved human reviews and the small automatic sample are recorded as open calibration
questions.

### Gate 3 — Independent follow-up obligations

Migration `20261026092000` adds `customer_followup_obligations` (one per business request key:
identity, type, due date, status, outcome, who/when closed; RLS = task visibility; writes only
through SECURITY DEFINER functions).

* A linked request no longer overwrites the task due date; the task due date = earliest open obligation.
* `dawaa_close_customer_followup_obligation_v1` closes ONE obligation with its own outcome.
* A table trigger covers all 14 existing completion paths (manual, Excel import, purchase
  reconciliation, duplicate repair, branch transfer): with two or more open obligations the task
  cannot be closed (`followup_task_has_open_obligations`); with one, that one closes with the
  task's outcome; a duplicate merge moves open obligations to the surviving task.
* Production has 0 linked requests today, so existing tasks are unaffected.

Native PostgreSQL evidence (Donia model): one task, two obligations (complaint due 27/09,
callback due 28/09); closing the complaint leaves the callback open and moves the task due date
to 28/09; retries and concurrent execution create no duplicate; a task close racing a new
linked request is refused and the request kept; two sessions closing one obligation record one
outcome; a stale complaint after reanalysis cannot be executed.

### Gate 4 — End-to-end financial safety

* TS chain (`masterBrainHardening.endToEndFinancial.test.ts`, Cairo and UTC): WhatsApp text →
  one case → branch from the conversation → closer = chat pharmacist → invoice proven by code +
  name + time + item/qty although another employee keyed it → `sale_proven` countable; without
  line evidence nothing is countable; the automatic evaluation has zero points and is not official
  until a manager approves it; the 00:30-Cairo conversation on the 26th belongs to cycle 2026-10,
  never 2026-09; "no approved review" is null, not 0.
* No circular proof: trusted invoices come only from `dawaa_confirm_whatsapp_invoice_link_v1`
  (human id + who + when); `matched_invoice_id` alone never proves; the reanalysis writer never
  touches confirmation fields; production has 0 confirmed links. Legacy V17 matches carry weight
  only and are excluded from corroboration.
* **Financial leak found in production:** 7 `conversation_evaluation` transactions (45 points)
  are payable while their review's points are `pending` (5 since the 2026-08-21 recalculation).
  The live-only guard `dawaa_guard_conversation_review_points_v53` (now committed) did not check
  approval and nothing synced review approval to the ledger. Migration `20261026093000`: payable
  status requires a payable review; the review row is locked `FOR SHARE` (proven necessary: without
  it the race test leaks 1 payable row, with it 0); a trigger moves points to pending/cancelled when
  approval is revoked/superseded and back to approved on re-approval. The 7 existing rows are **not**
  repaired: `supabase/sql/REPAIR_20261026_conversation_points_follow_review_approval.sql` needs your
  per-row decision (approve the review, or move the points to pending).
* **Additional read-only audit on 2026-10-26:** the seven rows have a total *absolute* magnitude
  of 45 points, comprising six deductions (-39) and one reward (+6), not 45 deductions; their
  direct transaction `amount` is 0. The reward's attached review has a **-20** official points
  impact although the transaction carries **+6** and a stale 100/100 description. The pending
  migration now rejects payable `conversation_evaluation` deltas different from the review's
  `doctor_points_impact`, refuses to re-promote mismatched pending rows, and demotes an older
  payable row if the review's approved impact changes. This prevents a later approval from
  accidentally activating the inconsistent reward; its history is still untouched. Two more
  native PostgreSQL scenarios cover the mismatched reward and an approved-impact correction.
  A separate real-SQL PGlite regression (`npm run test:whatsapp-review-points`) now installs
  all five pending migrations into an isolated, disposable local database and verifies these
  transitions, including approval revocation and matching re-approval. This is included in
  `npm run verify`; it does not replace native PostgreSQL concurrency coverage.
* **Owner-approved historic protection:** automatic review-to-points status sync is bounded to
  ledger cycles `2026-10` and newer. Earlier cycles can have manually paid payroll without formal
  snapshot rows, so a later edit of a historical review must not rewrite the older ledger.
  The seven old anomalies remain visible and unresolved; any compensating settlement is separate.
* Incentive settlement (`settle_manager_evaluation_incentive`) uses only submitted human manager
  evaluations; its review metrics come through the corrected `official_v1`.

## 3. Closing criteria

| Criterion | Status and evidence |
| --- | --- |
| All official paths agree | **Met for scored/financial paths**: TS register gate + `official_v1` single SQL fix point. Manager metrics base/v2 now use the Cairo conversation day in the same pending migration `20261026094000` (verified via PGlite). `get_doctor_cycle_reviews_v1` was already correct in Production. **Open (documented):** doctor-eye conversion RPC; the non-payroll `get_manager_doctor_alerts` repeat-error alert still uses `created_at` for its rolling window. |
| No unapproved score is financially effective | **Met in code** (guard + sync + FOR SHARE, native tests). **Production still holds 7 payable rows (45 pts)** until the repair is approved. |
| No lost or duplicate follow-up | **Met** in native PostgreSQL (retry, concurrency, close race, merge). |
| No invoice proven by circular evidence or guesswork | **Met** (human confirmation or independent code+name+time+line; competing invoices abstain). |
| Approved human reviews preserved | **Met**: none demoted; customer-service reviews count without GM review; only their unapproved *points* wait. |
| Comprehensive tests pass | See §6. |
| Remaining differences documented, no open critical gap | Remaining items below; the only critical one (7 payable rows) needs your approval to repair. |

## 4. Remaining (documented, not fixed)

1. 7 payable points rows on pending reviews — repair script ready, needs approval.
2. Doctor-eye conversion definition (RPC) differs from canonical KPI — owner decision.
3. `get_manager_doctor_alerts` still scopes repeat-error notifications using review-entry time. Manager weekly score readers have been corrected to Cairo conversation date in the pending migration; `get_doctor_cycle_reviews_v1` was already correct.
4. Automatic vs human calibration: no paired data yet; approved human reviews show a strong
   ceiling (80–90 % at 100).
5. Obligations are enforced in the database; the follow-up screens do not yet list obligations
   individually (the task screen still shows the task).
6. Dr. Omar / Dr. Donia live rows change only after an approved reanalysis.
7. `staff.role` for the customer-service team is inconsistent (analysis uses `type`, correct).

## 5. Migration plan and rollback

Apply in order after approval (none applied):

| # | Migration | Production effect | Rollback |
| --- | --- | --- | --- |
| 1 | `20261026090000_whatsapp_action_materialization_lifecycle_v1` | 2 actions, 0 `created`; CHECK validates instantly | re-run materializer from `20261020153000`; drop CHECK |
| 2 | `20261026091000_monthly_official_conversation_reviews_v1` | server evidence counts official reviews by Cairo day | restore previous RPC (md5 `813fc34b…`); drop view |
| 3 | `20261026092000_customer_followup_obligations_v1` | new table; no existing task affected | drop trigger + close function; re-run `find_or_create…` from `20261009180000`; drop table after export |
| 4 | `20261026093000_conversation_review_points_follow_approval_v1` | guard + sync; existing rows untouched | drop sync trigger/function; restore the previous guard (production body embedded in the migration's rollback comment) |
| 5 | `20261026094000_conversation_reviews_official_view_truth_v1` | `official_v1` 2,083 → 2,081 rows | recreate view with only the canonical-source predicate |
| — | `supabase/sql/REPAIR_20261026_…` | 7 rows → pending | manual, per-row approval |

Then deploy the app build, then an approved reanalysis of the audited sources.

## 6. Verification

Final run on the finished tree (Windows, 2026-10-26):

| Check | Result |
| --- | --- |
| `doctor`, refresh-API bundle check | pass |
| timezone independence (UTC, Cairo, Tokyo, New York) | pass — 42 fixtures + golden case identical |
| `run-tests.cjs` | **1068 passed, 0 failed** |
| SI regression gate, TZ=UTC | **1753 passed, 0 failed** (1 skipped) |
| SI regression gate, TZ=Africa/Cairo | 1751 passed, 2 failed — both timing: `performance.ib3_1` (10.6 s budget test) and one refresh-gate test that hit the 5 s timeout at 5,065 ms. Rerun alone under Cairo: **44/44 passed**. |
| Wider vitest (evaluations, staff, components, pages, lib tests, reports), Cairo and UTC | 1107 passed, 3 failed in both — attendance source-text tests (`attendanceDriftCanonicalEngine`, `employeeAttendanceProfileEvidence`) asserting strings in `AttendancePayrollTruthPanel.tsx` / `EmployeeProfileDrawer.tsx`; those files are untouched here (pre-existing on this branch; outside `npm run verify`). |
| `typecheck` | pass |
| `build` incl. all prebuild gates + new `check-whatsapp-canonical-consumers` | pass (51 consumers registered) |
| `perf:budget` | pass |
| Native PostgreSQL 17.6 (`npm run test:db:master-brain:native`, container `--network none`) | **13/13 scenarios** |
| Race-test sanity | same race without `FOR SHARE` → 1 payable row leaked; with it → 0 |

New test files: `masterBrainHardening.saleProof` (12), `.segmentation` (5), `.followups` (10),
`.kpi` (5), `.evaluationFairness` (16), `.endToEndFinancial` (6), `officialConversationReview` (8),
plus the native suite (13).
