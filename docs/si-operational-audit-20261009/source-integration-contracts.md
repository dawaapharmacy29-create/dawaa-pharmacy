# Source integration contracts — Phase 1 continuation

Status: **design specified; implementation remains BLOCKED**. These contracts resolve design choices; they do not certify writer retirement, schema parity, or an atomic cutover. No application behavior or live object is changed by this document.

## Evidence found in the existing SI path

`salesIntelligencePipeline.ts` already computes CustomerNeed and UnavailableDemand before invoice attribution, then derives CanonicalSalesOutcome before FollowUpOpportunity. Preserve this dependency order. Request qualification must consume the final commercial outcome, not run immediately after demand extraction.

`UnavailableDemand.demandKey` currently includes `caseId`; unresolved products use a raw product key. This is an analytical identifier, not sufficient proof of a durable operational identity across resegmentation. Keep the analytical field intact and explicitly map a durable operational anchor.

`conversationEvaluationServiceRecovery.ts` currently decides complaint existence with `COMPLAINT_RX`. Its `RESOLUTION_RX` accepts staff messages such as “في الطريق” and “تم التواصل”. An apology, solution offer, and such a staff message can select the `solved` review choice. This is a complaint-state owner outside SI. The existing pipeline explicitly keeps `fulfillmentEvidenceAvailable: false`: staff dispatch intent is not delivery proof. Remove that semantic conflict during the eventual coherent implementation, rather than adding another complaint detector alongside it.

## Canonical complaint contract inside SI

The assessment belongs to the existing SI case analysis and view. It is computed once from attributed evidence before FollowUpOpportunity. No queue, review page, V6 model, journey model, or projector may recompute its state.

Minimum output:

| Field | Contract |
|---|---|
| `state` | `none`, `detected`, `recovery_attempted`, `unresolved`, `resolved`, or `needs_human_review` |
| `complaintAnchor` | Persistent identity of the complaint-origin customer message; never an array offset |
| `evidenceMessageIds` | Complaint, handling, confirmation, contradiction, and reopening evidence |
| `resolutionEvidenceMessageIds` | Explicit customer confirmation or an authorized factual resolution event |
| `recoveryNeeded` | SI conclusion about an outstanding complaint obligation |
| `needsHumanReview` / reasons | Missing attribution, conflicting evidence, uncertain reference, or missing stable anchor |
| confidence | Existing SI confidence convention; no unrelated score scale |

Distributed V32/legacy extractors may emit attributed evidence categories: customer complaint, staff acknowledgement/apology, remedy offered, customer confirms remedy, customer rejects remedy, complaint reopened, factual remedy completed. Extractors preserve message ID, source, role, timestamp, and uncertainty. A matching phrase does not itself determine the assessment state.

| Evidence in chronological order | Canonical state / obligation |
|---|---|
| No complaint evidence | `none`; no complaint recovery |
| Clear customer complaint, insufficient subsequent coverage | `detected`; recovery owed |
| Staff acknowledgement or remedy attempt, no confirmed resolution | `recovery_attempted`; recovery remains owed |
| Customer reports issue persists or rejects remedy | `unresolved`; recovery owed |
| Customer explicitly confirms this issue resolved, with unambiguous linkage | `resolved`; generic complaint recovery suppressed |
| Authorized factual remedy event proves resolution of the same complaint | `resolved` only to the extent the event proves the remedy |
| Staff says “في الطريق”, “تم التواصل”, or merely promises action | Attempt evidence; never sufficient for `resolved` |
| Commercial sale proven but complaint unresolved | Sale remains proven; complaint recovery remains owed |
| Ambiguous complaint attribution or conflicting resolution evidence | `needs_human_review`; do not invent resolution |
| A later complaint reopens an explicitly resolved issue | Reopen from the later evidence; preserve prior resolution history |

An invoice proves a sale, not customer satisfaction, delivery, refund, or complaint resolution. Buying elsewhere can suppress procurement and commercial recovery while leaving a service complaint unresolved.

Reviews consume this assessment for criterion applicability and resolved-state evidence. They may evaluate apology, response, hostility, timeliness, and remedy quality using attributed handling evidence. They cannot promote a remedy attempt into a resolved complaint. Existing order-delay scoring remains independently reviewed for its handling criteria; it cannot publish canonical delivery completion.

The FollowUpOpportunityEngine consumes complaint recovery as an explicit obligation. Its early information-only/no-commercial-opportunity suppression must permit a genuine complaint obligation. Sale-based suppression applies to generic commercial recovery, not unresolved complaint handling. OperationalDisposition maps the resulting obligation without reparsing chat.

## SI request qualification contract

Add qualification to the existing SI case analysis after CanonicalSalesOutcome. Its inputs are the existing CustomerNeed, canonical product lifecycle, UnavailableDemand, attributed intent, and commercial settlement/proof outputs. V6 `unresolved` and a generic follow-up flag are not inputs with independent authority.

Each decision records canonical need anchor, canonical product ID/code, source branch, confidence, evidence IDs, procurement reason, suppression reasons, and whether materialization needs human review. Projection eligibility and final registration approval are separate decisions.

| Condition | Qualification |
|---|---|
| Explicit need plus confirmed shortage/special procurement requirement, still unresolved | Candidate |
| Pending stock check or “هراجع التوفر وأرد” | Follow-up only; no shortage procurement conclusion |
| Ordinary available-product order | No procurement request |
| Product mention or fully answered information/price inquiry | No procurement request |
| Customer or product ambiguous/unresolved | No materialization; identity-review evidence retained |
| Customer declines need or buys elsewhere | Suppress outstanding procurement |
| Proven invoice fully fulfills this exact need | Suppress duplicate procurement |
| Sale exists but product/quantity coverage is partial or unavailable | Never treat whole need as fulfilled; review unresolved coverage |
| Accepted alternative and proven completion fully settle need | Suppress procurement; retain historical shortage analytically |
| Unavailable medicine plus “أول ما يتوفر كلمني” | Request candidate and distinct callback follow-up coexist |

Quantity and coverage come from canonical lifecycle/item matching. Unknown quantity cannot become a guessed full fulfillment. The projector copies verdicts; it does not redo invoice matching or product resolution. Existing explicit human approval remains required before incentive-impact registration.

## One operational projection boundary

The projector accepts persisted SI outputs plus canonical source identity. It cannot accept a V6 outcome as a substitute, resolve names, read Story as truth, or parse raw messages to qualify work. The boundary validates the analysis revision and source provenance and reconciles the complete current proposal set in one transaction.

Required reconciliation behavior:

1. Lock the source/operational identity scope and reject a stale analysis revision.
2. Upsert current candidates by durable semantic identity, preserving approval/materialization/workflow history.
3. Supersede unsupported **unmaterialized** proposals with a reason, including when the new candidate set is empty.
4. Preserve `target_table`/`target_id` of materialized work. Append invoice proof and supersession context separately.
5. Return canonical action IDs and visible review/block reasons; do not disguise failed reads as an empty proposal set.

`whatsapp_conversation_actions` remains the queue. `customer_requests` and `daily_followups` remain final operational records. The existing canonical materialization commands remain the execution core, with source-aware provenance checks.

## Stable identity proof required

Use durable canonical customer and source-message/need anchors plus canonical product identity for requests. Reuse `FollowUpOpportunity.followUpKey` only after its import/resegmentation invariance is demonstrated. Do not rename the analytical case/demand keys to imply a proof that has not been run.

Required fixtures preserve identity through reordered messages, identical retry, reimport under a different source UUID, and changed case segmentation. If original-message identity is absent, ambiguous, or collides, return a review requirement rather than manufacture an anchor from array position, wall clock, staff name, or raw product name. Distinct episodes and two distinct complaints must not collapse merely because text matches.

Action UUID identifies execution lineage. Durable semantic identity must also reach `client_request_id`/source lineage of the operational command; an action recreated under a new UUID must not register the same procurement need twice.

## Source-aware materialization and identity

The server reloads the action and its canonical source. Action branch must equal source branch. Staff ID resolves only through `staff.id`; missing ID stays null. Existing manual/global request branch precedence is left intact.

Conversation materialization needs a source-aware path inside the existing request command boundary because v1 currently prefers staff home branch. It must preserve the existing actor/session/permission checks and authorization for the source branch. Supplying a branch argument to v1 is not a proof of preservation.

The customer-branch sync trigger must exclude conversation-derived work using verifiable immutable source lineage. A free-text name or a mutable client payload is insufficient. Manual/customer-service work keeps its separately authorized branch behavior.

Staff hardening is a separate forward-only compatibility change. Audit every caller before removing name resolution; keep historical nulls and validate canonical snapshots without blindly rewriting historical names. Do not change the protected `20261008160000` migration.

## Review-quality command and retry

The server command reloads the saved **current** review/version, its score, canonical customer, and source branch. It rejects or supersedes stale-version proposals. Its identity is `conversation-review-quality:<current review/version id>`.

Reuse the existing action queue for a durable pending quality obligation if its type/status constraints and RLS can support it. The server then calls the canonical daily-follow-up command with that same stable identity. A repeated or concurrent command produces at most one logical quality obligation, including when it links to an existing open follow-up.

Review save remains successful after a quality-command failure. UI displays the failure and offers an explicit retry using the saved version ID. Do not rely on console-only `Promise.allSettled` reporting. Durability must be proved for a lost client response and a closed tab; a new outbox is not authorized until the existing queue's feasibility has been ruled out.

## Atomic cutover acceptance

A client feature flag cannot block stale clients, service-role writers, database RPCs, and cron jobs together. A server-enforced mode/authorization boundary must govern both legacy writers and the SI projector. No existing suitable shared mode was established by the source search; do not assert reuse of an unverified settings table.

During inert expansion, SI projections may be calculated in isolated fixtures but cannot create live canonical work. During activation, the same database transaction must disable legacy automatic creation and enable the authorized SI projection boundary. All legacy entry points must return a visible retired/redirected result rather than silently claim success.

| Entry point | Future behavior |
|---|---|
| Auto ingest `saveFollowupSignals` | Evidence/history only; no independent automatic queue proposal |
| V6 action sync, including demand backfill callers | No request/follow-up semantic write after activation |
| V15 journey recovery upsert | History/context only; canonical obligation comes from SI |
| V10 recovery UI insert | Execute an existing SI proposal through authorized boundary |
| V24 rescue RPC | Execute/route an existing SI proposal; retire independent qualification |
| Refresh sold reconciliation | Canonical proven coverage; preserve existing operational target lineage |
| Review low-score path | Server-owned current-version quality command |
| Existing manual and non-chat lifecycle commands | Retain authorized behavior; no guessed conversation identities |

DB guards must cover direct INSERT/UPDATE, callable RPCs, security-definer trigger paths, and actual service-role/server entry points. Payload fields such as `origin: si` are not authorization. Define trusted roles/wrapper grants and prove stale legacy clients cannot spoof canonical origin. If the transaction/authorization mechanism cannot be demonstrated, stay BLOCKED.

The follow-up caller pass also identified persisted `offlineQueue.runItem` replay and the dynamic customer branch repair RPC. Include stored legacy browser operations and the indirect customer-update trigger edge in the isolated proof. A lack of current queue producers does not establish empty historical browser queues. See `writer-boundary-continuation.md` for the verified scope and authorization findings.

## Acceptance status

Design specifications now exist for complaint state, request qualification, projection/reanalysis, source-aware materialization, and quality retry. Remaining proofs are concrete:

* Complete alias/dynamic caller and actual deployed-bundle coverage.
* Verify queue constraints/ACLs and a shared atomic writer authorization mechanism in an isolated DB.
* Demonstrate durable anchors across imports/resegmentation.
* Compare live-only schema definitions against executable isolated schema, including trigger order and ACLs.
* Run the supplied 20 scenarios plus stale-writer, stale-analysis, lost-response, and closed-tab retry fixtures.

The supplied instruction is explicit: “Only after Phase 1 returns READY” may implementation start. Phase 1 remains BLOCKED; this continuation changes audit documentation only. No migration prepared/applied, no Vercel operation, and no Production mutation.
