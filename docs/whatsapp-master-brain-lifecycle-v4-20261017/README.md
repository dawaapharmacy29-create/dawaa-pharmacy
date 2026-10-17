# WhatsApp Master Brain — Batch 4

BATCH_4_STATUS: READY_FOR_APPROVAL — implementation/rehearsal package only; no approval to apply, merge or deploy is implied.

BRANCH: `fix/whatsapp-master-brain-lifecycle-v4-continuation-20261017`

HEAD: resolve the commit containing this report; its own SHA cannot be embedded in itself. The final response supplies the exact published SHA.

PARENT_BATCH3: `d87f153928b97a9576336efc054f0440f3e8c4ff`

RUNTIME_CHECKPOINT: `ef39ae0b41a553f687cd618ea67781bbc5d7b66c` (direct parent of the SQL/report checkpoint). Branch was verified at the exact Batch 3 baseline before editing. No Batch 1–3 rewrite or broad architecture audit.

BASELINE_FUNCTION: `public.sales_intelligence_reconcile_case_set_v1(uuid,text[])`

BASELINE_MD5: `9fd2f5976e2419ca7154d203b29da5fc`

PRODUCTION_RECONCILE_BASELINE: current v1; no Production v2 existed at baseline inspection. Fresh read-only definition and prosrc hashes matched the user's corrected baseline before editing.

PRODUCTION_V1_MD5: `9fd2f5976e2419ca7154d203b29da5fc`

ANALYSIS_WRITER_MD5: `c6c53c94a20cfdbf2946371398790d98` for `sales_intelligence_write_case_analysis(text,jsonb)`.

TARGET_FUNCTION: `public.sales_intelligence_reconcile_case_set_v2(uuid,text[],jsonb)`; third argument is an explicit case → staged analysis ID map, default empty only for empty/archived sets.

TARGET_MD5: `b1d51222a320d551aeb0034afae74211`

The original v1 and analysis writer are not replaced by the candidate. Exact baseline definitions, owner, ACL/config and relevant column/trigger metadata are preserved in [baseline](baseline). All proposed functions' prosrc hashes are in [candidate-md5.json](candidate-md5.json).

## Runtime and ownership

DIRECT_CLIENT_LIFECYCLE_WRITER: REMOVED. Only the stale-case direct case_analyses UPDATE block was removed from batchPersistenceService; derivation, invoice resolution and valid case/evidence persistence remain.

PARTIAL_FAILURE_FIX: source-scoped staging followed by atomic publication. Merely moving the early return was insufficient: the existing analysis writer changes current flags immediately. Canonical refresh therefore uses a new service-only immutable staging RPC derived from that exact writer; it inserts/reuses an un-superseded matching analysis without changing current flags or published pointers. It deduplicates retries by semantic hash and all existing engine/version keys. Analysis versions advance from the case's actual maximum. The established attribution/match/policy writers were verified read-only to scope their current evaluation to analysis_id; staging a different analysis does not supersede the published analysis's evidence.

New cases are inserted inactive (`is_active=false`) with INSERT ON CONFLICT DO NOTHING, then identity fields are updated separately. A stale reporting pre-read cannot reset an already published case to inactive. No new cleanup cron or browser retirement writer.

SOURCE_SCOPED_RECONCILIATION: PASS. Every derived case must have a successful full persistence outcome and analysis ID. A failed/missing outcome holds that source, while other complete sources publish independently. Zero-case sources reconcile meaningfully to an empty set. Consumed payment followers reconcile only after their assembly anchor(s), and remain pending if publication fails. Only successfully reconciled sources feed proof/evaluation/action followers. Transport exceptions and null/malformed reconcile replies fail closed.

Statuses preserve existing top-level failure contracts and expose per-source `reconciled`, `persistence_failed_pending_retry`, `dependency_pending_retry`, or `rpc_error`/DB rejection. Partial work is never reported as all-success.

RETRY_IDEMPOTENCY: PASS. A staged case from a partial attempt is reused on identical retry; the failed case can complete; reconciliation then promotes the complete explicit case set in one transaction. Current flags, supersession links and published pointers move together. A superseded candidate, foreign case, duplicate case set, missing analysis or candidate older than a later current version is rejected before lifecycle mutation.

RECONCILE_V2: READY as a local candidate; NOT installed in Production.

V2_DELTA_SUMMARY: preserve v1 ownership checks, finer-source retirement, locks, review retirement and owned-proof revocation; accept explicit staged analysis IDs, validate/lock the whole source before promotion, atomically supersede/promote/update pointers, clear operational publication on retirement, and force archived sources to an empty active set. Archived retries cannot reactivate cases. Inactive staging/obsolete pointers of archived sources are aligned too; history is retained and repeat calls keep retirement timestamps stable. No business sale/product/KPI logic was changed.

ARCHIVE_LIFECYCLE_DESIGN: one non-recursive AFTER UPDATE OF review_status trigger routes future archive transitions to canonical v2 with an empty case set. It never updates the source recursively and aborts the source archive transaction if reconciliation fails. This central routing covers both explicit and bulk archival paths without trusting every client to call a second writer. Existing invoice-evidence trigger remains intact.

A targeted read-only inspection found the existing `dawaa_archive_superseded_whatsapp_source_v35` deletes SI cases before marking the source archived. A trigger alone would be too late. Its separate minimal candidate removes only that SI-case DELETE; the existing authorization checks and other behavior remain. Baseline archive body MD5: `fd7b5e40f631e4633049147cb2933ee7`; candidate MD5: `5209146fa7e69c228de39ca7cfc0c9e9`. It preserves SI case/analysis history; the new archive trigger owns retirement. This does not claim that unrelated legacy V22/derived cleanup has been redesigned.

## Final classification of the 14 missing-current cases

[classification.json](classification.json) contains full source/case IDs, old and new boundaries, all source-wide sibling boundaries, latest historical analysis IDs/versions, engine versions, supersession times, dependency and coverage evidence, and one final classification per missing case. No customer message text is committed.

| Source ID | Missing case suffix | Final classification |
|---|---|---|
| `063030d2-1f64-4fb9-ba2b-30de4146e22c` | `interaction:3` | NEEDS_RESEGMENTATION |
| `0d1e5874-d1d6-427a-9b35-7ce8fb70c5f7` | `interaction:1` | NEEDS_RESEGMENTATION |
| `4e63af46-6bfe-4fa8-b12b-af50513d4489` | `interaction:1` | NEEDS_RESEGMENTATION |
| `66fe13b7-7ebc-48a9-8180-033bfb34cd4b` | `interaction:1` | NEEDS_RESEGMENTATION |
| `6a8fee97-8d7a-4a42-a525-e3768b8f714f` | `interaction:3` | SHOULD_BE_RETIRED |
| `74b0b726-ce78-49b7-a80d-8eba809f5b2d` | `interaction:1` | NEEDS_RESEGMENTATION |
| `83a34d22-8c27-44a5-8052-380040a72656` | `interaction:1` | SHOULD_BE_RETIRED |
| `8c63fef4-40b9-4f2b-b027-4699ca6155c0` | `interaction:1` | NEEDS_RESEGMENTATION |
| `9a59338b-f1ca-4b68-bd3b-c081fee914a8` | `interaction:1` | SHOULD_BE_RETIRED |
| `a2b52b43-ff49-4ed8-a967-48133e18691e` | `interaction:1` | SHOULD_BE_RETIRED |
| `bb4aac31-6a21-45bb-87ba-5d3a72d8e95a` | `interaction:1` | SHOULD_BE_RETIRED |
| `c835bd69-5996-42ae-9a3a-34120b5bbe94` | `interaction:1` | NEEDS_RESEGMENTATION |
| `d564c02c-0b79-4bee-b5e8-9254fea1291b` | `interaction:1` | NEEDS_REANALYSIS |
| `f35c5632-991f-489e-98fa-f237cb592b87` | `interaction:1` | NEEDS_REANALYSIS |

| Classification | Count |
|---|---:|
| SAFE_TO_REPUBLISH_EXISTING | 0 |
| NEEDS_REANALYSIS | 2 |
| NEEDS_RESEGMENTATION | 7 |
| SHOULD_BE_RETIRED | 5 |
| HUMAN_REVIEW_REQUIRED | 0 |
| TOTAL_CLASSIFIED | 14 |

SAFE_TO_REPUBLISH_EXISTING: 0

NEEDS_REANALYSIS: 2

NEEDS_RESEGMENTATION: 7

SHOULD_BE_RETIRED: 5

HUMAN_REVIEW_REQUIRED: 0

TOTAL_CLASSIFIED: 14

All 14 had one V22 dependency, historical analyses, no published pointer and no current flags. All latest histories were superseded and used older segmentation/commercial engine versions; their snapshots do not contain today's complete canonical semantic contract. There is no proof that blind republishing is safe. Code proves the two lifecycle hazards; durable per-row actor/failure logs do not prove which hazard caused each individual row.

Complete persisted raw_text was processed locally, without truncation, through the current shared segmentation adapter/engine with trusted timestamps and canonical staff/alias mapping. For every source, parsed message count exactly matched recorded message_count, and first/last message times matched the persisted source bounds. The two reanalysis cases have matching complete source case sets; seven have a source-wide boundary/ID difference even when the missing case itself survives; five missing case IDs no longer exist in the derived replacement set. The latter means retire those obsolete CASE IDs after successful replacement publication, not delete/archive the non-archived source.

REMAINING_3_DRY_RUNS: COMPLETE in coverage: the corrected instruction authorized reconstructing all 14, and all 14 were checked. The prior handoff did not name Claude's three remaining IDs, so their historical identity cannot be asserted. The three longest sources are explicitly accounted for: `6a8fee97` (95 messages, missing interaction:3 → retire), `0d1e5874` (77 messages → source resegmentation), `bb4aac31` (62 messages, missing interaction:1 → retire). None remains unclassified. No claim is made that these were necessarily Claude's exact unnamed three.

Production raw message content was held only in temporary files outside the repository and deleted after classification. Local dry-run means local segmentation/evidence inspection, not Production reanalysis or canonical RPC invocation.

## Historical plan, separate from runtime repair

ARCHIVED_39_PLAN: READY, untouched. [archived-plan-manifest.json](archived-plan-manifest.json) identifies 13 archived sources containing exactly 39 retained SI case rows, all active at inspection (37 Shokry / 2 Shamy per accepted Batch 3 diagnosis). They are not fresh analysis work. After separate historical approval, validate the manifest against fresh read-only evidence, capture case/analysis/review/proof before-images and identifiers, and invoke the canonical empty-set reconciliation for only the approved archived source IDs. Expect inactive cases, retirement metadata, null operational publication, non-current retired analyses/reviews, and owned-proof revocation only where applicable. Keep every case/analysis row; never delete or reanalyze archived sources.

ACTIVE_14_PLAN: READY. For the two stable case sets, run a separately approved fresh canonical source refresh; for seven changed sets, derive/review the complete replacement source set before a separately approved refresh. For five obsolete missing IDs, analyze/publish their replacement source sets first and let canonical reconciliation retire the obsolete IDs. No historical analysis ID is blindly promoted, no direct row patch, and no partial case-set publication. Recheck customer/source/V22 coverage before each treatment. If evidence drifts, hold that source for review instead of forcing this classification.

PRODUCTION_HISTORICAL_REPAIR_PLAN: READY as the plan above. No executable historical Production repair/backfill was run or bundled invisibly with the function installation. Future historical work needs its own precise source/case/analysis before/after manifest and explicit approval.

UI_EXCEPTION_STATES: PASS. A read-only panel in the existing management surface lists active non-archived cases whose current flags/publication do not agree, using CURRENT_ANALYSIS_AVAILABLE, ANALYSIS_PENDING, ANALYSIS_FAILED, NOT_ANALYZED, HISTORICAL_ONLY and ARCHIVED_SOURCE semantics. Archived sources stay outside operational work. Failure requires persisted failure evidence; no readable history means only that none appears to this viewer. Errors/row caps are explicit, not zero results, and viewer changes cannot display stale account data. This panel does not create sale/loss/staff credit or trigger analysis. Newly staged inactive cases remain reflected in refresh source-status results, not relabelled as published active cases.

## SQL controls and rollback

PRECHECK_SQL: READY — [sql/precheck.sql](sql/precheck.sql). Read only; verifies PostgreSQL 17/current role, exact signatures/hashes, schema fingerprint, owner/ACL, trigger inventory, absent candidate functions, duplicate-current count, current missing cohort, archived cohort and published-superseded baseline. Inspection values: 53 active-flag cases absent from current view, 39 active archived cases, zero duplicate currents, 16 pointer mismatches / published-superseded pointers. Unexpected drift aborts future application. The existing published read view synthesizes is_current=true from its published pointer; raw current flags must therefore be checked separately.

POSTCHECK_SQL: READY — [Phase A postcheck](sql/postcheck-phase-a.sql) and [post-repair postcheck](sql/postcheck-after-approved-repair.sql). Phase A compares fresh preflight case/analysis fingerprints to prove function installation did not repair data invisibly. Its existing 39/14 and 16 mismatches must remain unchanged until the separately approved historical repair; claiming they are already zero would be false. After historical repair, require zero active archived cases, duplicate currents/cases, superseded-published pointers and pointer/current mismatches; report remaining active exceptions explicitly. Baseline case/analysis ID manifests verify no history deletion or unrelated case changes.

ROLLBACK: PASS — [sql/rollback.sql](sql/rollback.sql). Restores exact v1, original analysis writer and original archive v35 bodies, owner, grants, security attributes and search_path/config; removes only candidate functions/trigger. Raw body MD5 and owner/ACL/config were checked locally. Runtime must be quiesced/reverted first. Function rollback does not undo a future separately approved historical data repair or delete staged history; keep the legacy archival path paused during rollback because its baseline SI deletion behavior is restored intentionally.

REAPPLY: PASS — rollback → exact baseline verified → candidate reapply → critical matrix repeated. The [single-transaction release candidate](sql/phase-a-release-candidate.sql) atomically installs staging, reconciliation, archive-writer correction and archive routing. Individual component files are for review/rehearsal; use the atomic bundle for any later separately approved installation.

## Verification

LOCAL_REHEARSAL: 53 / 53 PASS. Reproduce after installing the pinned repository dependencies with `node scripts/test-si-lifecycle-batch4.mjs`; the optional DAWAA_PGLITE_MODULE points to an existing local PGlite installation. See [local-rehearsal-results.txt](local-rehearsal-results.txt) and [verification.json](verification.json).

The rehearsal executes exact baseline function bodies, then candidate scenarios, rollback hash checks, reapply and critical scenarios again. It includes source/new case/first publish, reanalysis, supersession, full/partial source sets, retry/no-duplicate retry, reconcile rejection/transport failure, published read stability while staging, pointer/current drift, missing/superseded historical analysis, foreign/duplicate/malformed candidates, zero cases, stale retirement, archived source/retry/inactive staging, real archive v35, rollback on proof revocation failure, automatic-review retirement with human-review/history preservation, exact ACL/config rollback, atomic release bundle, postcheck SQL and strict version-precheck rejection.

Local engine: PostgreSQL 18.3 via existing PGlite 0.5.8, using captured columns/defaults/nullability and a unique-current index plus isolated fixture dependencies; Production is PostgreSQL 17.6. This is not a native PostgreSQL 17 multi-connection concurrency/RLS/security rehearsal. Mock interleavings additionally cover a stale pre-read versus concurrent case publication. The strict Production precheck correctly rejects the local major version; it is not weakened to claim parity. No new Supabase project, staging instance, package purchase or paid resource was created.

NPM_TEST: PASS — custom runner 1047 passed / zero failed; SI gate below.

SI_REGRESSION: PASS — Cairo and UTC, each 115 test files passed / one existing skip; 1189 tests passed / one existing skip.

GOLDEN_CASE: PASS

SOURCE_GATE: PASS

INTEGRITY_ENGINE: PASS

Batch 1/2/3 selected-case A/B/C and same-customer isolation, canonical product truth, canonical KPI, conversion/lost truth and polite-response regressions remain green. Normal selected-window fixture remains 17 reads, 2 product reads, 0 fuzzy queries and 0 pipeline runs. No selected-window hot path changed.

GENERATED_API_PARITY: PASS — canonical generator run, generated API committed, parity test passed for server and generated transport.

TYPESCRIPT: PASS

BUILD: PASS — production bundle; existing chunk-size advisory remains. Performance budget PASS, initial static JS 202.1 KiB gzip / six chunks.

QUALITY_GATES: PASS — 29 workflow script checks; semantic ESLint zero errors. No gate disabled.

Local Node: 24.19.0; Node 22/native PostgreSQL 17 and hosted CI/browser smoke were not run for this batch. Accepted Batch 3 hosted verification is not repeated or claimed as a Batch 4 hosted run. READY_FOR_APPROVAL means the candidate is reviewable; it is not a Production readiness or deployment claim.

PRODUCTION_WRITES: 0

PRODUCTION_DATA_CHANGES: 0

PRODUCTION_REANALYSIS: 0

PRODUCTION_HISTORICAL_REPAIR: 0

ARCHIVED_39_UNTOUCHED: YES

MAIN_CHANGES: 0

SECURITY_BRANCH_CHANGES: 0; PR #512 untouched, independent dependency.

BATCH3_BRANCH_CHANGES: 0

PRODUCTION_DEPLOY: 0

MERGE: 0

Branch automatic Vercel deployment is disabled. Only the authorized private continuation branch is published. Final protected-ref verification is performed after publishing.

## Future controlled order — not executed

1. Fresh Production read-only preflight; stop on any hash/schema/trigger/cohort drift and capture current fingerprints. Pause ingest/refresh/archival writers for a separately approved release window.
2. Prepare/review the exact runtime release candidate. Keep it inactive: it depends on v2/staging RPCs and deliberately has no fallback to the legacy auto-current path. A native PG17/Node22 deployment-environment verification can be performed before approval without a paid project.
3. After separate explicit SQL approval, install the atomic reconcile-v2/staging/archive candidate bundle.
4. Immediate read-only Phase A postcheck: exact function metadata/hashes, unchanged data fingerprints and no added integrity drift. Only then consider separately approved runtime activation; no deployment is authorized by Batch 4 preparation.
5. Obtain separate historical repair approval for fresh, exact 39/14 manifests; no blind republish.
6. Execute only that approved historical treatment via canonical source-scoped writers.
7. Post-repair verification: history retention, no unrelated changes, duplicate/pointer/archive checks and visible exceptions.
8. Browser smoke with the approved runtime/database state, including complete source, failed source/retry, archive and normal selected-window truth.
9. Final integrated WhatsApp Master Brain readiness review.

STOP. No merge, deploy or Production apply was performed.
