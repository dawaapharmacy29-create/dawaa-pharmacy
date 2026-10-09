# SI operational consolidation — Phase 1 audit, 2026-10-09

**Decision: BLOCKED for implementation/cutover. Phase 1 has produced a conservative writer inventory and verified live findings; it has not proved an executable single-writer cutover.** No behavior was changed. The four classifications below are future proposals, not claims that paths have been disabled.

Repository: `dawaapharmacy29-create/dawaa-pharmacy`.
Branch: `chatgpt/si-operational-consolidation-20261009`.
Audited HEAD: `2a8e85fce639a04d5562c42e054797584f496a63`.
Database inspected: `dawaa-pharmacy-os`, `jkjqeqkshllustwlzzbf`, SELECT/catalog reads only.
The application was cloned successfully from GitHub after the team Git endpoint required unavailable credentials. No older branch was checked out.

## Phase 1 continuation

[Isolated follow-up proof](isolated-followup-proof.md) now reproduces the existing SQL cores in a synthetic in-memory PostgreSQL fixture: 9 properties hold and 3 contract gaps are reproduced. Persistent action materialization retains a linked target on retry after closure; calling the follow-up core directly does not provide the same guarantee for every linked obligation. This is infrastructure reuse evidence, not a full RLS/concurrency or cutover proof.

[Source integration contracts](source-integration-contracts.md) specify the complaint/request decisions, projection lifecycle, quality retry, and atomic cutover acceptance. [Dynamic caller follow-up](dynamic-caller-followup.md) adds the constant-target review correction command and records its verified absence from the live public catalog. [Writer boundary continuation](writer-boundary-continuation.md) resolves 96/116 nonliteral targets and records the additional offline replay and dynamic customer branch repair paths. The implementation gate remains BLOCKED pending caller coverage, isolated schema/authorization tests, and durable identity proof.

## 1. Architecture discovered

SI already owns CustomerNeedModel, product resolution, UnavailableDemand, LostOpportunity, FollowUpOpportunity, OperationalDisposition and CanonicalSalesOutcome. Its pipeline is pure, composes existing owners, and uses bounded runtime/persistence boundaries. This work must be preserved.

However, operational tasks are still decided outside this pipeline:

* `whatsappAutoIngestPipeline.saveFollowupSignals` invokes `detectFollowupSignals` and inserts `whatsapp_auto_followup_requests`.
* The same ingest then builds V6/V7 and calls `syncWhatsAppOperationalActionsV6`, which qualifies customer requests and follow-ups independently.
* `whatsappCustomerJourneyPersistenceV15.syncWhatsAppCustomerJourneyV15` upserts a recovery action from a separate journey conclusion.
* `WhatsAppRecoverableOpportunitiesV10.createRecoveryTask` scores journey rows locally and directly inserts an action.
* `WhatsAppLostOpportunityAnalyticsV24.createRescueTask` invokes `dawaa_create_case_rescue_task_v24`, which qualifies salvageability from V22/V24 fields and creates a task independently.
* `canonicalRefreshService` reconciles sold request actions and enriches complaint context. It does not provide the one SI operational projector.
* `Reviews.save` inserts a low-score quality task into nonexistent `followups`.

The verified systems of record remain `customer_requests` and `daily_followups`. `whatsapp_conversation_actions` remains the projection/execution queue; no replacement table or queue is needed.

## 2. Ownership matrix

| Concept | Locked future semantic authority | Existing competing decisions | Implementation proof |
|---|---|---|---|
| Customer Need | SI CustomerNeedModel | V6 extraction promotes requests; journey/open-order interpretation | Not yet proved |
| Product Identity | SI canonical product resolution | V6 catalog enrichment; automatic historical request product linking | Source-aware compatibility still required |
| Request Qualification | SI | V6 unresolved request filtering; external order-to-request ingestion | No canonical qualification output/projector yet |
| Follow-up | SI FollowUpOpportunityEngine | detector, V6, journey recovery, V10 UI scoring, V24 rescue RPC | Multiple active paths remain |
| Complaint | Canonical Complaint Assessment inside SI | V6 complaint state, V15 journey complaint, review recovery regex applicability | Canonical complaint state contract absent |
| Sale Outcome | SI CanonicalSalesOutcome; existing canonical proof RPC owns factual proof | Historical/V6 closure hints and legacy recovery paths | Proof writer must remain authoritative |
| Staff Identity | `staff.id` -> canonical name/role snapshot | `attach_review_staff_id` -> name resolver; external source enrichment | DB compatibility proof absent |
| Branch | immutable conversation/source branch | manual request creator prefers staff branch; customer branch sync moves open follow-ups | Source-aware DB materialization required |

Human manual commands are execution/approval boundaries, not permission to infer missing identities or to give another automatic model ownership. Non-conversation campaign generators need an explicit evidence adapter/scope decision before a universal SI follow-up cutover; disabling them wholesale would remove unrelated authorized work.

## 3. Single-writer proof and blocking conditions

The desired owner count is exactly one for all eight concepts. This is a design constraint, **not yet an executable proof**. Implementing a new projector now would leave detector/V6/journey/UI/RPC writers able to create competing tasks.

Remaining blockers before READY:

1. Specify and verify a canonical Complaint Assessment consumed by both operational follow-up and review handling-quality assessment. Review criteria cannot remain the authority for complaint existence.
2. Specify the SI request qualification output; V6 `request.unresolved` is not sufficient procurement qualification.
3. Establish one source-authorized projector and an atomic activation boundary shared by ingest, refresh, maintenance, journey recovery, V10 UI and V24 RPC. Independent browser switches are insufficient.
4. Prove source-aware materialization through the existing canonical commands without changing manual/global request branch behavior. A materialized task must not later move with `customers.branch`.
5. Prove durable idempotency and retry for a review quality action keyed by current review/version, including ambiguous/missing customer identity.
6. Reconcile the relevant live-only definitions into an isolated harness first. Literal repo-name matches alone do not establish executable schema parity. The current audit extractor also does not prove absence of dynamic SQL/alias writers; these require the final call-graph pass before claiming every writer has been accounted for.

These blockers do not request deployment approval. They prevent claiming READY or introducing another semantic layer under the supplied Phase 1 rule.

## 4. Writer inventory and proposed classifications

Machine-readable inventories accompany this report:

* `app-writers.json`: 66 direct write/RPC call sites (61 initial literal-target sites, one constant-target correction RPC, and four conditional offline replay paths), including review writes and command/lifecycle adapters. This is not 61 independent engines.
* `database-writers.json`: 98 live functions with direct or transitively detected writes to the audited tables, including guards, triggers and command wrappers. This is a conservative catalog closure, not a runtime execution count.
* `historical-migration-writes.json`: mutation occurrences in historical SQL definitions. Historical definitions are LEGACY READ ONLY for this analysis; do not execute them to reproduce current behavior blindly.
* `schema-drift.json`: 218 catalog functions and 181 catalog objects (including four relevant triggers attached outside the initial table set), hashes and closest migration-name candidates.

Every inventoried entry has a proposed classification. The inventory does not substitute for the final dynamic caller/production bundle audit.

| Path | Runs when | Current decision | Destination / identity | Future classification |
|---|---|---|---|---|
| `saveFollowupSignals` | ingest | detector decides task exists | auto follow-up queue; `fu1` signal key | RETIRE AFTER CUTOVER; detector evidence only |
| `syncWhatsAppOperationalActionsV6` | ingest/backfill | request/follow-up/complaint decisions | actions; source/key + optional stable identity | RETIRE AFTER CUTOVER |
| V6 `enrichWhatsAppOperationalProductsV6` | ingest/backfill | resolves/promotes product requests | model consumed by V6 writer | PROJECT ONLY for evidence; no independent operational qualification |
| V15 journey recovery upsert | journey sync | unresolved complaint/order requires recovery | actions; source/key | RETIRE AFTER CUTOVER; journey remains history/evidence |
| V10 recovery UI insert | manual UI | local rescue score and follow-up qualification | actions; `recovery:<code/name>` | RETIRE AFTER CUTOVER; UI executes SI proposal |
| V24 rescue RPC | manual UI/RPC | V22 state and rescue score qualify task | actions; `case-rescue:<id>` | RETIRE AFTER CUTOVER; route to SI proposal |
| Refresh sold-request reconciliation | canonical refresh | canonical-proven sold need reconciliation | actions; currently legacy index grouping | PROJECT ONLY; preserve operational target lineage |
| Complaint invoice-context enrichment | refresh | context-only invoice linkage | action payload | PROJECT ONLY; must not prove sale or blame |
| Low-score review `insertSafe('followups')` | review save | quality follow-up | nonexistent table; no durable key | RETIRE AFTER CUTOVER to server command |
| Manual request canonical v2/v1 | explicit approved creation | authorized registration/incentive execution | customer_requests | RETAIN; add separate source-aware conversation boundary |
| `dawaa_create_or_link_customer_followup_v1` / core | explicit execution | create/link command, not chat interpretation | daily_followups; client_request_id + open-case lock | RETAIN |
| Follow-up lifecycle/import/correction commands | explicit UI/import | authorized lifecycle/history | daily_followups | RETAIN; preserve non-chat workflows |
| Automatic review persistence | refresh/ingest | review projection | conversation_sales_reviews | PROJECT ONLY; keep immutability guard |
| `attach_review_staff_id` / resolver | review INSERT/UPDATE | infer staff from name | NEW.staff_id | RETIRE AFTER CUTOVER; separate compatibility migration |
| Customer branch sync trigger | customer branch change | moves all open work to customer branch | daily_followups, daily queue | RETAIN global/manual workflow only; source-aware exclusion required |
| External `process_dawaawael_customer_order` | external ingestion | order/request conversion | customer_requests | PROJECT ONLY for automatic sourcing qualification; preserve external lineage |
| Historical product auto-linking | catalog import/manual repair | automatic product matching | customer_requests | PROJECT ONLY for candidates; explicit canonical confirmation for ambiguity |

Canonical sale-proof writers, RLS/session guards, incentive event projections and audit/event history must be RETAINED. Renamed legacy implementations can remain callable by their authorized wrapper for non-chat lifecycle work; their existence alone does not make them another chat semantic owner.

## 5. Semantic overlap matrix

`D` = currently decides; `E` = evidence/context; `P` = intended projection; `—` = no authority. Legacy semantics are not trusted by the future projector.

| System | Need | Product | Request | Follow-up | Complaint | Sale | Staff | Branch |
|---|---|---|---|---|---|---|---|---|
| SI pipeline | D | D | qualification missing | D | assessment missing | D | canonical input | canonical input |
| V6/V7 | D | D | D | D | D | chat hints | context/text | context |
| Signal detector/auto queue | E | text | E | D | complaint signals | legacy queue state | name snapshot | supplied branch |
| V15 journey | open-order state | E | E | D | D | historical state | supplied | context/root fallback |
| V10 recoverable UI | journey hints | code/name | — | D | — | excludes verified hint | supplied | supplied |
| V24 rescue RPC | case state | — | — | D | case history | V22 closure gate | actor metadata | case branch |
| Review quality/recovery | — | — | — | low-score task | regex applicability | no factual authority | app ID + legacy trigger | review/source branch |
| Intended one projector | P | P | P | P | P | P only | P | P |

## 6. Customer Request contract

Track an unresolved **procurement/product need**, not a mention, answered inquiry, ordinary order or merely open conversation. SI must provide canonical need/demand anchor, explicit need evidence, unresolved sourcing reason and suppression verdict. Confirmed shortage/special sourcing can qualify; a pending availability check alone does not.

Ambiguous customer/product identity, final decline, bought elsewhere, completed informational inquiry, fully fulfilling invoice-backed sale, fully settled accepted alternative and absence of procurement need suppress materialization. Historical unavailable demand remains analytical evidence after settlement.

Projection may be automatic; final registration remains explicit allowed human approval because it may grant incentive credit. The existing action approval RPC and materialization wrapper enforce this today; do not bypass them.

## 7. Follow-up contract

Track the action still owed: stock check, staff promise, callback, waiting for availability, unresolved delivery/complaint, missing prescription, open alternative choice or unanswered request. Consume SI FollowUpOpportunity status, reason, scope, priority, deterministic due policy, role, known canonical staff, goal and next action. Suppressed/weak evidence is not a task.

Request and follow-up can coexist. A sourcing request plus `أول ما يتوفر كلمني` yields both, with separate semantic identities. Explicit obligations may survive commercial sale settlement; generic recovery may not.

The live core locks `identity_key|branch|request_type` using an advisory transaction lock and links to an existing open case. `client_request_id` replay is checked separately. Preserve this infrastructure and keep obligation lineage in its events; do not create a `followups` table.

## 8. Complaint contract

One SI assessment must distinguish no complaint, detected, recovery attempted, unresolved, resolved and insufficient evidence/manual review. Distributed detectors extract evidence only. Review scoring consumes that assessment to evaluate employee handling quality. The currently separate V6/V15/regex conclusions are a blocking overlap, not an implementation-ready canonical state.

## 9. Staff identity and compatibility

Authority is `staff.id`; canonical name/role snapshot comes from that record. No name -> ID inference; null stays null. Legacy doctor_id cannot override a non-null staff_id.

Verified aggregate audit: 1,896 reviews; 54 null staff_id; zero invalid non-null staff_id; zero doctor-only rows; zero conflicting non-null staff/doctor IDs; 69 staff-name snapshots differing from current canonical name; 133 branch strings differing from current employee branch.

Snapshot differences and cross-branch work are not proof of corruption. Do not rewrite them or blind-backfill null IDs. `trg_attach_review_staff_id` is enabled and still calls the name-based resolver. Forward hardening needs writer compatibility and historical ambiguity tests first.

## 10. Branch provenance

Verified 239 actions: one action/source branch string mismatch; two follow-up actions with null customer_id. Zero mismatched branches in the queried created customer-request/follow-up links. Counts are a snapshot; zero mismatch does not prove the future command is safe.

`create_customer_request_canonical_v1` chooses staff.branch before p_branch; v2 authorizes the staff-derived branch then delegates. The conversation materializer passes source branch but cannot prevent v1 from replacing it. Do not fix the global manual command by changing its branch precedence without compatibility proof.

An enabled trigger on `customers`, `trg_sync_customer_branch_to_followups`, updates the branch of all noncompleted/noncancelled/nonarchived customer follow-ups, with no conversation-source exclusion. This hidden post-materialization writer must be made source-aware.

## 11. Stable identities

Reuse `FollowUpOpportunity.followUpKey` as semantic follow-up identity. Existing `fu1` keys use customer anchor, episode start, type and reason; the shared helper still uses a raw 120-minute episode gap. Its stability across the required semantic resegmentation/import changes must be proved, not assumed from comments.

V6 `request:<index>:<name>` and recommendation index keys are not business identity. Request identity must use durable canonical customer/case or episode + canonical need/demand anchor + canonical product, never array position or raw product name alone. Action UUID is execution lineage.

Quality follow-up identity: `conversation-review-quality:<current review/version id>`. Missing canonical customer identity means no guessed customer task; a visible retry/manual-review result remains necessary.

## 12. Reanalysis lifecycle and target preservation

Same truth must converge to the same semantic identity. Unmaterialized unsupported proposals are dismissed/superseded with reason and retained history. Approved/materialized records never disappear merely because analysis changes.

Current V6 same-source upserts may refresh workflow fields, and an empty candidate set returns without superseding old proposals. Refresh sold reconciliation queries created actions and rewrites `target_table/target_id` to an invoice. Future reconciliation must preserve the original operational target and add canonical proof lineage separately; it must not detach an existing customer request.

## 13. Live schema drift and security

The drift inventory records normalized live MD5 plus whitespace/comment-normalized SHA256 and migration-name candidates. A name match is not signature/body parity; an absent literal CREATE FUNCTION may be an ALTER/rename/dynamic definition, not proof of absence from all migrations. Relevant examples requiring explicit reconciliation: materialize core v2, customer branch sync, recovery workflow V12, V24 rescue, invoice/action evidence V17, daily identity/guard/dedupe infrastructure.

Core materialize v2 and core follow-up find-or-create are **not executable** by anon/authenticated directly. The public wrappers are executable and check the app's strict staff/session/permissions; these ACLs alone are not an authorization bypass. Keep strict session checks and scoped permission checks.

Five name-filtered cron entries were found. Relevant jobs: stale-risk follow-up escalation (`0 11,17 * * *`), missing-generation notification (`0 10 * * *`), purchase reconciliation (`30 5 * * *`), doctor follow-up points refresh (`20 4 * * *`). The fifth is attendance backlog reconciliation, out of scope. No cron was changed. Schedules are literal catalog values, not converted to Cairo time.

Do not repair old migration files. Capture forward reconciliation only after comparing signatures/bodies/ACLs/trigger order with an isolated harness. No new migration was prepared or applied.

## 14. Cutover design required before implementation

EXPAND -> APP CUTOVER -> ACTIVATE -> OBSERVE -> RETIRE -> CLEANUP.

EXPAND must be backward compatible and inert. APP CUTOVER must consume the existing SI owners and retain safe legacy behavior until activation. ACTIVATE must atomically choose one semantic projector across server/browser/maintenance/RPC entry points; never allow old/new independent creators simultaneously. OBSERVE compares missing/duplicate obligations and lineage against fixed read-only fixtures. RETIRE disables old creators only after evidence, retaining historical read access. CLEANUP follows runtime proof.

Reuse the existing action queue for quality retry if its status/types/security/current-version rules can support it. Do not introduce an outbox just because the current review background Promise fails. The saved review must remain successful while failure is visible and safely retryable.

## 15. Files changed

Audit documents/inventories only under `docs/si-operational-audit-20261009/`. No application, API, script, dependency, lockfile or migration was changed. Re-running prebuild/verify left application sources and generated API clean.

## 16. Migrations

Prepared: zero. Applied: zero. `20261008160000_conversation_review_manager_correction_versioning_v1.sql` untouched. Future staff hardening/source-aware materialization/schema reconciliation must be forward-only and remain repo-only until explicit final approval.

## 17. Validation and performance

Baseline `npm ci --legacy-peer-deps --no-audit --no-fund` succeeded. Runtime environment Node 24.19.0/npm 11.9.0 differs from repo-declared Node 22/npm 10.9.2; rerun final implementation gates under declared versions.

Baseline `npm run verify` exited 0: doctor/architecture gates, test runner **643 passed / 0 failed**, TypeScript, production build, generated refresh API consistency and performance budget passed. Build completed in 27.56 seconds; initial static JavaScript **92.2 KiB gzip / 3 chunks**. No runtime behavior changed, so these are baseline values, not claimed improvements.

No isolated database regression harness or browser flow was run. No live task-creation mutation was used to test the contract. The required 20 consolidation scenarios remain implementation acceptance criteria; the passing existing baseline is not a claim they all passed the future cutover.

## 18. Remaining risks / next coherent work

Finish the dynamic caller/deployed-bundle audit and source integration contracts, then produce an executable single-writer cutover design. Resolve complaint/request qualification ownership inside SI first; prove stable identities and source-aware canonical command compatibility in an isolated DB. Only then return READY and start implementation on this same branch. Do not add a projector over still-active semantic writers.

## 19. Final state

Final branch remains `chatgpt/si-operational-consolidation-20261009`.
Baseline application SHA remains `2a8e85fce639a04d5562c42e054797584f496a63`; audit documentation may be committed separately without altering behavior.

**No live migration applied. `20261008160000` untouched. No Vercel Production deploy. No Preview created. Production application and data untouched.**
