# WhatsApp Master Brain / Source Attribution — Release Readiness (V36)

Branch: `fix/whatsapp-master-brain-lifecycle-v4-continuation-20261017`.
Migration `20261020153000_whatsapp_source_attribution_correction_v1.sql` is **NOT APPLIED**.
No Production write, Preview deployment, merge or Production deployment was made.

## 1. Production read-only snapshot (2026-10-20 04:40 UTC, before any activation)

| Item | Value |
|---|---|
| Source `753b38b2…` | branch `كل الفروع`, staff `303f15a8…` (د/ معاذ, general manager, account-wide), customer `17fd9821…` (customer_code 17, legacy `code` 13204), review_status `ready_detailed`, no human/official confirmation |
| Source hash | stored `30cb3306…` = SHA-256 recomputed inside the database from stored times + text |
| Case | 1 active case `…:interaction:0`, published = current = `768aded0…` (pipeline v35), 1 analysis version |
| Proposal `5728c227` | customer_request, `proposed`, not auto-eligible, `كل الفروع`, staff GM, confidence 80, no target |
| Proposal `f5a9eb93` | customer_followup, `ready`, `كل الفروع`, no target |
| Real customer_requests for customer+product | 0 |
| Materialized targets for the source | 0 |
| Audit rows for the source | 2 (ingest/analysis history) |
| Proposals in a non-operating branch (all sources) | 2 (exactly the two above) |
| Legacy request proposals (`created_by='د معاذ'`) | 37 proposed, 0 materialized |
| Migration objects present | 0 |
| Staff | د دنيا `0afe27ce…` active, فرع شكري. د/ دنيا `e6b0dfe1…` inactive, المخزن |

**Customer 17 is a real customer** (`is_test=false`, 22 invoices). A Production end-to-end
cycle would create a real `customer_requests` row for a real customer. This needs a separate
owner decision before the final cycle.

## 2. Closed risks and their evidence

| Requirement | Change | Evidence |
|---|---|---|
| Approved operating branches, not only «كل الفروع» | `isOperatingBranch` (TS) and `dawaa_is_transaction_branch_v1` (DB) accept only فرع شكري / فرع الشامي. The warehouse, markers and unknown text are refused | projector/followup tests; DB parity test (12 values) |
| Home branch vs operation branch | Correction allows another-home-branch doctor only with explicit `p_cross_branch_cover`, recorded as `cross_branch_cover` and `staff_home_branch` in the audit. Account-wide management may serve any branch | `allows a doctor from another home branch only with an audited human cover confirmation` |
| staff_id alone is not proof | Projector skips `staff_evidence_conflict`. Approve and execute refuse when the current analysis resolved another doctor from the conversation | projector and DB tests |
| No approval without a provable owner/branch | Missing, inactive, conflicting or unconfirmed cross-branch staff, and non-operating branches, are refused in the DB | contract tests |
| Server-side text/hash integrity | Correction recomputes SHA-256 from stored times + submitted text and refuses a mismatch, a shifted timeline, or another source's text | `hash of other text`, `hash with shifted timeline`, `text of another source` |
| No RPC bypass | `approve_reviews` plus review-row access to old and new attribution. A trigger forbids direct client overwrite of stored text/hash/customer/staff/branch | guard trigger test (as `authenticated`) |
| No duplicates after correction + two refreshes | Identity retirement plus unique keys. Request projector `existing`; followup reconcile `existing` | `sourceAttributionCycle.test.ts` (real pipeline/projectors) |
| Concurrent corrections/approvals/executions | Row locks + optimistic hash + idempotent approval/execution + stale-projection insert guard | `scripts/staging/test-source-attribution-concurrency.py` (native PG17, CI job `source-attribution-concurrency`) |
| No partial success | Correction is one transaction (forced late failure leaves no trace). UI treats a 200 without `ok` + target as failure | `rolls back the whole correction…`; result-parser tests |
| 37 legacy proposals | Not modified. **Correction (closure review):** the earlier "8 remain eligible" meant only "not affected by the branch rule". Against every approval condition, **0 of 37 are approvable** (35 without product, 28 without staff, 1 inactive, 1 staff mismatch, 1 without customer, 1 non-canonical source). See CLOSURE_ACCEPTANCE_V36.md | read-only SQL on Production |
| `5728c227` stays unapprovable | Exact live shape refused by approve and execute after activation; UI hides its approve button | `keeps the live 5728c227 shape unapprovable and unexecutable` |
| Safe stop | `emergency_stop_20261020153000.sql` revokes client EXECUTE on approve/execute/correct, with no older behavior reopened; `resume_…` restores grants | stop/resume test |
| Rollback | `rollback_safe_…` removes only the correction command and new triggers (keeps hardened guards). `rollback_exact_…_REOPENS_PREVIOUS_APPROVAL.sql` only with the stop in force | rollback tests (data unchanged, re-apply clean) |

## 3. Page performance (static evidence only)

- Case page, operations panel on open: **6 → 2 requests**. It no longer reads the conversation
  text, the up-to-800-row staff list, the account directory RPC, the up-to-2000-row alias list, or 20
  audit rows with jsonb states. Text and directory load only when correction is opened; audit loads
  only when expanded, in pages of 10 with "عرض أحداث أقدم".
- Loading, error with retry, and empty states are distinct. A failed read is never shown as "no proposals".
- Bundle budget gate: PASS. No index was added or changed.
- **Not measured:** live cold/warm load times, request timings and browser/network errors for
  login, WhatsApp monitor, QA list, case detail and the panel. This needs an approved Preview
  deployment of the final SHA plus an owner sign-in. `npm run verify` is not runtime proof.

## 4. Activation plan — migration only (needs separate approval)

Pre-checks (read-only, stop on any difference):
1. `supabase_migrations` has no `20261020153000`; none of the 8 new or replaced function
   signatures has a v36 body yet.
2. The live approve/materialize bodies still contain the markers of 20261005141100/20261019093000
   (`customer_request_created_target_mismatch`, `canonical_followup_requires_current_projection`).
3. Snapshot section 1 is unchanged: `5728c227`/`f5a9eb93` unchanged, 0 customer_requests, 37 legacy proposals.
4. No refresh, approval or materialization is running (quiet window).

Apply: the exact committed file, once, through the migration tool (atomic).

Post-checks (read-only, no operational execution):
1. All 8 functions and 3 triggers exist. ACLs:
   - correct: `authenticated` + `service_role`, no `anon`/PUBLIC;
   - helpers: `service_role` only;
   - approve/materialize: unchanged grants.
2. `dawaa_is_transaction_branch_v1` returns true only for the two operating branches.
3. The snapshot is byte-identical, since the migration has no business DML. The source hash is still
   reproducible in the database.
4. Read-only predicate checks: `5728c227` fails the branch rule; legacy eligibility counts are unchanged (0/28/1/1/8).

On any failure: run `emergency_stop_20261020153000.sql` first, then `rollback_safe_…`, then
investigate. Use the exact rollback only with the stop in force.

After a clean post-check, a separate approval is needed for the final cycle:
1. Update the Preview for the final SHA.
2. Run the correction from the screen.
3. Run the explicit re-analysis.
4. Approve and execute.
5. Read-only verification.

## 5. Go / No-Go

- **Source and tests: GO**, subject to the final `npm run verify` and the CI jobs (including native concurrency) on the pushed SHA.
- **Migration activation: GO for an approval request.** All blocking risks above have isolated
  evidence. Production compatibility is limited to the read-only checks listed.
- **Final operational cycle: NO-GO until** the migration is applied and post-checked, a Preview is
  approved, runtime is measured with an owner sign-in, and the owner decides about creating a
  request for real customer 17.
