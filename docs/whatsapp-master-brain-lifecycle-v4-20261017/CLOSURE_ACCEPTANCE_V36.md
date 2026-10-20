# WhatsApp Master Brain / Source Attribution — Closure Acceptance (V36)

Branch `fix/whatsapp-master-brain-lifecycle-v4-continuation-20261017`. Migration
`20261020153000_whatsapp_source_attribution_correction_v1.sql` is **NOT APPLIED**. No Production
write, operational action, Preview/Production deployment or merge was made. Customer 17 is real
(`is_test=false`) and was never used for any test write.

## 1. End-to-end chain and single source of truth

```
upload (manual / auto ingest)
  -> canonical segmentation -> exact session hash (current or retired via the alias registry)
  -> one whatsapp_review_sources row (customer identity, doctor, transaction branch)
  -> explicit refresh: canonical pipeline (Need, Unavailable Demand, Request qualification, Follow-up)
  -> projectors publish proposals (no re-interpretation) -> human review in the case page
  -> audited correction when attribution is wrong
  -> approve RPC (DB-enforced) -> materialize RPC (DB-enforced) -> customer_requests / daily_followups
```

| Requirement | Where it is enforced |
|---|---|
| Every operation tied to its source | Proposals carry `source_id`, `caseId`, `requestKey`/`followUpKey`. Execution re-checks the current published analysis of the same source |
| Customer and doctor are independent | Customer from the canonical customer resolver. Doctor from canonical staff. Correction refuses a customer id as staff and never changes customer identity |
| No doctor from a name or staff_id alone when evidence conflicts | Projector skips `staff_evidence_conflict`; approve and execute raise `customer_request_action_staff_evidence_conflict` |
| Operation branch ≠ doctor home branch | Only operating branches (فرع شكري / فرع الشامي) own new work. Cross-branch cover needs an audited `cross_branch_cover` correction; account-wide management may serve any branch |
| Product identity | Approve requires the catalog product and the exact catalog `product_code`. Strength-level discrimination is covered by existing tests (`stockRequestNaturalPack`) |
| No sale/invoice/payment from approval | Approval only sets `ready`; execution creates a request or follow-up only. The synthetic cycle asserts `isSaleCountable=false` (pipeline) and no invoice table is touched |
| One source of truth | One source row per conversation, including corrected ones. One identity per operation (unique `followup_identity`, `(source_id, action_key)`). Retired proposals stay as evidence with suffixed identity |

Proof: `sourceAttributionCycle.test.ts` runs the real pipeline, projectors, UI correction model and
migration in isolated PostgreSQL. It goes from a wrong legacy proposal (refused) through correction,
re-analysis, approval and execution, then a second re-analysis, ending with exactly one request and
one follow-up.

## 2. Duplicate prevention

| Scenario | Result | Evidence |
|---|---|---|
| 1 first upload / 2 same file again | one source; duplicate | `whatsappSourceHashSupersession.test.ts`, existing reanalysis tests |
| 3 correct doctor/branch/text | audited, server-verified SHA-256, old proposals retired | DB contract tests |
| 4 re-analysis | one request + one follow-up | cycle test |
| 5 re-upload pre-correction export | resolves to the same corrected source through `whatsapp_review_source_hash_aliases`; ingest and reanalyze modes never revert the correction; corrected branch provenance kept | supersession tests; DB refuses a new source for a retired hash |
| 6 re-upload corrected export | plain duplicate | supersession test |
| 7 both exports concurrently | one source | supersession test (parallel); native PG17 scenario 6 (upload during correction waits on the shared hash lock, then refused) |
| 8 repeated analysis/approval/execution | `existing`; `already_approved`; `already_created` | cycle test, native PG17 scenarios 3–4 |
| 9 new analysis version, same conversation | same case id and operation identities; no new proposal | cycle test (two analysis ids) |

Matching is by exact hash only, never by names or similar text (test: a near-identical conversation
is a different source).

## 3. Legacy data (read-only, Production, 2026-10-20)

All 38 open request proposals (the 37 legacy ones plus `5728c227`) were evaluated against **every**
approval condition. **0 are approvable.**

| Reason | Count |
|---|---|
| missing product | 35 |
| missing staff | 28 |
| inactive staff | 1 |
| staff ≠ source staff | 1 |
| missing customer | 1 |
| source not canonical | 1 |
| non-operating branch (`5728c227` only) | 1 |

- The earlier statement "8 remain eligible" was wrong. It meant only that those 8 were not affected
  by the branch rule.
- No proposal was modified. The case page now lists the reasons for every request proposal and
  shows no approve button when any known condition fails.
- **`5728c227`**: its only failing condition is the operating branch. With the migration, approve and
  execute refuse it even by direct RPC (tested with its exact shape). **Until then, the deployed approve
  function would accept it via a direct RPC call.** No UI in Production calls that RPC.

## 4. Security, audit and rollback

- Correction: requires `approve_reviews` plus review-row access to the old and new attribution. The
  database recomputes the hash from the stored times and submitted text. It is one transaction (a
  forced late failure leaves no trace) and writes one audit row with the full before-state. An exact
  replay is a no-op.
- Clients cannot overwrite stored text, hash, customer, staff or branch (trigger). They cannot
  write the alias registry. The internal helpers are `service_role` only.
- Emergency stop/resume revoke and restore client EXECUTE without reopening older behavior.
- Safe rollback keeps the hardened guards **and** the alias registry. Exact rollback is marked as
  reopening previous approval behavior. All of these are tested in PGlite, including data
  unchanged and clean re-apply.
- Production compatibility, read-only:
  - PG 17.6; none of the new objects exists; every dependency is present with the expected
    signatures;
  - 0 sources with a null hash or null times;
  - the 4 migrations applied today touch none of these objects;
  - the only existing row the new insert guard would reject is `5728c227`, and the guard applies
    to inserts only.

## 5. Pages and performance

- Measured statically: opening the case-page operations panel goes from 6 reads to 2. The staff
  directory, conversation text and audit load on demand, with audit in pages of 10. Loading, empty,
  error-with-retry and approval-blocker states are distinct, and a 200 without a real target is a
  failure. Bundle budget: PASS.
- **Not measured:** live cold/warm load, request timings and browser/network errors for Login,
  Smart Folder Watcher, QA list, Case Detail, correction, and approval/execution. This needs an
  approved Preview deployment of the final SHA plus an owner sign-in. A push to this branch does not
  deploy a Preview.

## 6. Remaining operational risks

1. Until the migration is applied, `5728c227` (and any future proposal in «كل الفروع») is approvable
   by a direct RPC call against Production. Mitigation: apply the migration, or apply
   `emergency_stop_20261020153000.sql` as an interim measure (each needs approval).
2. Runtime performance and browser behavior on Preview are unverified.
3. Real customer 17: the final operational cycle would create a real request. It needs an explicit
   owner decision, or a synthetic test customer.
4. The source hash is computed in the browser and verified in the database. Older sources stored
   with a `fallback-` hash can still be corrected; the corrected hash is always SHA-256.

## 7. Decisions

| Gate | Decision |
|---|---|
| Code and tests complete | **GO**, subject to the final verify and CI on the pushed SHA |
| Preview trial | **GO for an approval request** (needs your deployment approval and sign-in) |
| Apply migration on Production | **GO for an approval request** (pre/post checks in RELEASE_READINESS_V36.md §4, plus: alias table absent before, present and empty after) |
| Operational trial | **NO-GO** until the migration is applied and post-checked, the Preview is measured, and the customer-17 decision is made |
