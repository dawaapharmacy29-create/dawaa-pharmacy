# Release Candidate gate — WhatsApp operations / follow-ups

**Decision: `READY_FOR_PREVIEW`.** Not ready for a main merge or Production until the three blockers in section K are closed.

## A. Git state

| | |
|---|---|
| Repository | `dawaapharmacy29-create/dawaa-pharmacy` |
| Branch | `claude/project-thread-pkg0jt` |
| Starting HEAD | `e0b94e1e44d862e2176dee46ec92c437a87d9af2` (checked on GitHub before any edit; nothing newer existed) |
| New commits | `282b06b` branch protection · `bf0e21d` writer hardening + reconciliation · docs commit carrying this file |

Nothing was reset, rebased or force-pushed. Every push was a fast-forward.

## B. Branch protection

One rule now decides every follow-up branch change. A follow-up with conversation lineage keeps the branch of its conversation source (`whatsapp_review_sources.branch`). Its branch may only be set to that single source branch. Manual follow-ups are unchanged.

- **Lineage** is the existing relation from `20261009103000`, with three paths: action target, original `whatsapp-action:<id>` client key, or a `created`/`request_linked` event. It now lives in one function, `dawaa_followup_conversation_sources_v1`.
- **Rule:** `dawaa_followup_branch_change_allowed_v1(followup, branch)`.
  - No lineage: any branch is allowed.
  - Exactly one source branch: only that branch is allowed.
  - Unknown, blank or conflicting source branches: no change is allowed (fail closed).
- **Backstop:** `zzz_` BEFORE UPDATE triggers on `daily_followups` and on linked `customer_service_daily_queue_items`.
  - They run last, so they see whatever earlier triggers produced.
  - They are SECURITY DEFINER, so RLS cannot hide lineage from the check.
  - They take a fresh snapshot, so they see lineage committed after the writing statement started.
  - They apply to every writer, including the service role and function bodies that exist only in Production.

Migration: `supabase/migrations/20261009170000_followup_branch_provenance_guard_v1.sql`, forward-only, **not applied**.

| Function | Reachable? | Problem found in code | Change | Tests |
|---|---|---|---|---|
| `transfer_customer_followup_branch_v1` → `_legacy_v1` | Yes. Runtime UI (`CustomerBranchTransferPanel`, `CustomerFollowupSingleScreen`), behind a staff-session wrapper (`20261005131000`). Manual, not automatic. | The legacy body moved **every** open follow-up and queue item of the customer (matched by code, id or phone), conversation ones included. It took no row lock. A retry after success failed with an error. | Conversation rows are never swept. A direct transfer of a conversation row is refused unless it realigns the row to its source branch (row and its linked queue items only, audited as `branch_realigned_to_source`, no customer override). The target row is locked `FOR UPDATE`. A same-branch request is an idempotent no-op, answered before the branch-scope check so a branch-scoped retry also succeeds. | T1, T4, T5, T6, T9, C1, C3, C5 |
| `correct_customer_followup_data_v1` → `_legacy_v1` | Yes. Runtime UI (`CustomerFollowupOperationsCompletionPanel`), behind the same wrapper. Manual. | `branch = p_branch` was written to the target **and to all open siblings of the customer**, conversation ones included. | A non-source branch for a conversation row is refused atomically: no half-applied name or code. Conversation siblings keep their branch, and their count is returned. Name, code and phone correction is unchanged. | T3, T5, T6, C2 |
| `repair_customer_followup_duplicates_and_branches()` | Not reachable. Service-only since `20261005131000`. No app or cron caller. It ran once inside its July migration. Maintenance only. | It hid "duplicates" per customer **across branches**, and it re-branched open rows from `customer_metrics_summary`. Both would hit conversation operations. | Conversation rows are excluded from dedupe (as duplicate or keeper) and from re-branching. Manual behavior is unchanged. | T7, T8, T10, T11 |
| Also: `merge_open_followup_duplicates_v1` (UI) | Yes, manual. | It could hide one conversation operation as a duplicate of another operation. | A conversation follow-up may be the surviving canonical row. It is never merged away. | T8, T11 |

Two more side writers were found during the inventory and closed:

- **Auto-ingest re-import re-decided the source branch.** `persistOperationalJourneyIntelligence` wrote `whatsapp_review_sources.branch = <fresh hint>` on every re-import of an existing source, NULL included, and passed that hint to the action, invoice and signal writers.
  - Now the stored branch is kept. A re-import only fills a missing branch, which matches the V4 fill-only rule.
  - Downstream writers use the stored branch.
- **The positional V6 action writer** (`writeWhatsAppOperationalActionsV6` without identity context) upserted on `source_id + request:<index>`.
  - That upsert could overwrite another operation's row.
  - It had no remaining caller. It now fails closed with `followup_identity_context_required`.

## C. Writer inventory (scope: actions, follow-ups, customer and branch association, proof, lineage, targets, identity)

Classes used below:
- **AC**: Active + compliant
- **AF**: Active + fixed this round
- **LG**: Legacy, reachable, guarded
- **DU**: Dead or unreachable (proven)
- **MO**: Migration-only
- **TO**: Test-only

| Writer | Where | Reachable from | Writes | Canonical contract | Direct SQL | Class | Close before RC? |
|---|---|---|---|---|---|---|---|
| `syncActionsWithStableIdentity` (V6) | `whatsappOperationalIntelligenceV6.ts` | auto-ingest, Smart Folder, V22 backfill, Journey V15 | actions | Stable Operation Identity + owner resolver | client upsert/insert under the action truth guard | AC | – |
| `writeWhatsAppOperationalActionsV6` without identity | same | none | – | – | – | AF (closed) | done |
| `persistOperationalJourneyIntelligence` source update | `whatsappAutoIngestPipeline.ts` | every file ingest | sources.branch / analysis | fill-only provenance | client update | AF | done |
| `saveSessionReview` | same | ingest | sources insert | source_hash unique | client insert | AC | – |
| `saveFollowupSignals` | same | ingest | `whatsapp_auto_followup_requests` | stable identity + attribution command | client insert/adopt | AC | – |
| `correctOperationAttribution` → `dawaa_correct_whatsapp_operation_attribution_session_v1` | `whatsappOperationAttribution.ts` + `20261009130016` | ingest owner reuse | actions/signals customer only | checked command (session, CAS, source truth) | RPC | AC (not yet installed: fails closed) | activation |
| V4 reanalysis / invoice verification / queue confirm | `whatsappReviewPersistenceV4.ts` | review flows | sources (fill-only identity, invoice fields) | fill-only groups | client update | AC | – |
| `persistAutomaticWhatsAppReview` | `whatsappAutomaticReviewPersistence.ts` | ingest | reviews, `official_review_id` | automatic review writer guard v2 | client | AC | – |
| V22 backfill analysis write | `whatsappProductDemandBackfillV22.ts` | SI QA page | `sources.analysis_json` + V6 | stable identity | client | AC | – |
| `reconcileSoldCustomerRequestActions` | `canonicalRefreshService.ts` (server bundle) | SI refresh | action status/outcome (never target) | SI sale proof; target preserved (`feca225`) | service update | AC | – |
| `enrichComplaintFollowupContext` | same | SI refresh | `action.payload.delivery_context` | row id | service update | AC | – |
| `WhatsAppRecoverableOpportunitiesV10` insert, `RecoveryWorkQueueV11` update, `LostOpportunityAnalyticsV24` | components | **not imported anywhere** | actions | – | – | DU | – |
| `saveCustomerBranchOverride` | `customerBranchOverrides.ts` | **no caller** | overrides | – | – | DU | – |
| `transfer_customer_followup_branch_v1/_legacy_v1` | SQL | UI | follow-ups, queue, overrides, audit | branch rule | RPC | AF | done (migration) |
| `correct_customer_followup_data_v1/_legacy_v1` | SQL | UI | follow-ups, customers, events | branch rule | RPC | AF | done (migration) |
| `merge_open_followup_duplicates_v1` | SQL | UI | follow-ups | branch rule + same-branch | RPC | AF | done (migration) |
| `repair_customer_followup_duplicates_and_branches` | SQL | service only | follow-ups | branch rule | – | LG (service-only) + fixed | done (migration) |
| `sync_customer_branch_to_open_followups_and_daily_queue` | trigger on customers | every `customers.branch` change | follow-ups, queue | lineage exclusion (`20261009103000`) + backstop | trigger | AC (prepared) | activation |
| `find_or_create_open_customer_followup` / `dawaa_create_or_link_customer_followup_v1` | SQL | UI, materialization core | follow-ups, events | client_request_id + advisory lock + scope replay (`20261009100000`) | RPC | AC (prepared) | unique-index decision |
| `dawaa_materialize_whatsapp_action_v1` → `_core_v2` (body prod-only) | SQL | action execution UI | action target, follow-up | guarded wrapper (`20261005141000`); backstop covers later branch moves | RPC | LG | body must enter the repo before activation |
| `dawaa_approve_whatsapp_customer_request_action_v2` | SQL | approval | action status/payload | source/customer/branch match checks | RPC | AC | – |
| `dawaa_guard_whatsapp_conversation_action_v2` | trigger | every client action write | identity, branch, target, proof frozen for clients | – | trigger | AC | – |
| `dawaa_revoke_whatsapp_canonical_sale_proof_v46`, `dawaa_capture_whatsapp_canonical_purchase_v36`, SI case reconcile | SQL | SI | actions (proof fields) | SI proof boundary | RPC/trigger | AC (SI-owned) | – |
| `dawaa_create_case_rescue_task_v24`, `dawaa_capture_whatsapp_verified_purchase_v16`, `dawaa_sync_whatsapp_recovery_invoice_v11` | SQL | no UI caller (V24 component dead) | actions | – | – | DU (retire after cutover) | – |
| signal RPCs `whatsapp_auto_followup_update_status_v1/v2`, `_confirm_sale_v1`, `_revoke_sale_v1` | SQL | `WhatsAppAutoFollowupRequests` page | signal status/sale | row id | RPC | LG (retire after cutover) | no |
| imports `import_customer_followup_results_v1`, `import_customer_service_queue_results_v4`, `import_historical_followup_v1` | SQL | Excel import UI | follow-ups | session wrapper; backstop for branch | RPC | LG | no |
| lifecycle `dawaa_save/complete/cancel/archive/restore/postpone_*_v1`, `dawaa_execute_customer_followup_command_v1` | SQL | UI | follow-up state | session wrappers; backstop for branch | RPC | AC | – |
| cron `reconcile_followup_purchases`, `escalate_stale_risk_followups`, points/metrics triggers | SQL | schedule/trigger | follow-up state/metrics | backstop for branch | – | LG | no |
| `normalize_customer_service_branch_owner`, `daily_followups_set_identity_key`, dedupe/guard triggers | triggers | every follow-up write | owner, identity_key | run before the zzz_ backstop | – | AC | – |
| Historical DML in `20261005133000`, `20261005141000` | migrations | migration apply | reviews, actions | – | – | MO | exclude on replay |
| Synthetic fixtures and harnesses | `supabase/tests`, `scripts/test-*` | tests | throwaway DBs | – | – | TO | – |

No writer is classified "unknown". The two DB bodies that exist only in Production (`dawaa_materialize_whatsapp_action_core_v2`, `dawaa_create_customer_followup_request_legacy_v1`) are reachable and guarded: the backstop and the action truth guard cover them. Their bodies must still be captured into the repo before activation (H).

## D. Stable invariants

| Invariant | Holds | Proof |
|---|---|---|
| Immutable operation/action row id | Yes | stableOperationIdentity 40 tests; T4/T9 |
| Stable identity | Yes | 40 tests; T9 (actions byte-identical) |
| Customer correction safety | Yes | attribution command SQL suite (PGlite); T3 |
| Stale import safety | Yes | `e0b94e1` source-truth guard; stale A/NULL tests |
| Branch safety | Yes | 85 native PG assertions; re-import branch fix |
| Lineage safety | Yes | T9 (lineage relation unchanged), T7, T8 |
| Target safety (`target_table`/`target_id`) | Yes | action guard; re-import test; T9 |
| Sale Proof safety | Yes | `recovered_invoice_*` unchanged in T9 and in the re-import test; SI proof boundary untouched |
| Follow-up Proof safety | Yes, for its persisted parts: the lineage paths, follow-up row id and client key. The repository has no separate column named "follow-up proof". | T4, T9 |

## E. Unique index (open follow-ups)

| | |
|---|---|
| **Production** | `daily_followups_one_open_case_per_customer_branch_uidx` on (`identity_key`, `branch`), open rows only. Its definition exists only in Production, not in the repo (recorded in `schema-drift.csv`). |
| **Code** | `find_or_create_open_customer_followup`, its lookup index and `list_open_followup_duplicate_groups_v1` all key on (`identity_key`, `branch`, `request_type`). |
| **Actual behavior** | A second open request of another type for the same customer and branch misses the lookup, then hits the unique index. The command re-raises `unique_violation`, so the user sees an error. No duplicate is written. |
| **Evidence for A** | The index name. The command's own "link to the open case" path, which records each extra request as a `request_linked` event with its `request_type`. The repair function's stated intent ("one canonical open case per real customer"). |
| **Evidence for B** | The type-filtered lookup and the duplicate grouping. |
| **Recommendation: A** | One open follow-up per customer and branch. Make the command link a different-type request to the open case, instead of erroring, and bring the Production index into a repo migration. Option B would let one customer hold several parallel open calls, against the anti-spam intent. |

Not changed: there is no data proof without a Production read, which was out of scope. Reconciliation section 8 measures it.

**Blocker before Production activation of follow-up creation changes. Not a blocker for Preview.**

## F. Tests

| Suite | Result |
|---|---|
| `npm run verify` | exit 0: doctor PASS, **695 passed, 0 failed**, typecheck clean, build OK (35 s), perf budget PASS (92.2 KiB gzip, 3 initial chunks) |
| Branch provenance (native PostgreSQL 16, throwaway cluster) | **85 passed**: 80 sequential + 5 multi-session races |
| Conversation review correction (native PG) | 118 passed |
| Evidence V17 link (native PG) | 40 passed |
| Operation attribution (PGlite, actual TS writer) | PASS |
| Quality Gate workflow | All 26 node checks pass, including `audit-fix-semantic-lint` (leaves `src` unchanged). InvoiceImporter Vitest 27 pass. Semantic eslint exit 0. Node 22.22 (CI uses 22). |
| Hosted CI | **Not run.** There is no PR from this branch; the Quality Gate triggers on PRs to main. |

The only skips are the existing `Supabase not configured` integration skips.

**Mutation checks:** each of these was switched off in turn, and each time a named test failed:
- the backstop trigger;
- the repair exclusion;
- the merge rule;
- the correction refusal;
- the wrapper no-op.

## G. Security

- **Wrappers and authorization:** every new or changed client entry point is behind `dawaa_current_followup_actor_v2`, which needs a staff session, an active account, and a claimed id equal to the session. Role lists and branch scope are unchanged.
- **Helpers and maintenance:** the helper functions and the trigger function have no `anon` or `authenticated` EXECUTE. The repair function is `service_role` only.
- **SECURITY DEFINER:** all six touched SECURITY DEFINER functions pin `search_path`.
- **No dynamic SQL, and no RLS bypass except the trigger's documented read.**
- **Negative tests pass for:**
  - no session (anon);
  - an inactive account;
  - a claimed foreign staff id;
  - a wrong branch;
  - a wrong role;
  - a wrong operation id;
  - an unknown branch;
  - legacy bodies called directly;
  - helpers called directly;
  - a direct table write.

## H. Migrations (none applied by this work)

| # | File | Purpose | Depends on | Additive | Destructive / DML | Reversal | Preflight | Post-apply check |
|---|---|---|---|---|---|---|---|---|
| 1 | 20261005123000 SI truth boundary | SI guards | prod SI tables | mostly | drops/recreates triggers; 2 alters | restore previous trigger defs | catalog shows applied? | guard triggers present |
| 2 | 20261005124500 / 135500 review writer guard + order | review guard | 1 | yes | trigger rename | drop new trigger | same | trigger order |
| 3 | 20261005131000 follow-up writer hardening | session-bound wrappers | staff session | yes | renames legacy bodies | rename back | `*_legacy_v1` present in prod catalog → likely applied | wrappers ACL |
| 4 | 20261005133000 monthly evidence reads | reads | – | yes | **top-level UPDATE of review current flags** | none (data) | **exclude DML on replay** | – |
| 5 | 20261005134500 / 150000 / 153000 | request guard, attendance fix, RLS | – | yes | RLS enable | disable | – | policies |
| 6 | 20261005141000 action truth guard | client action guard | – | yes | **top-level UPDATE demoting ready requests** | none (data) | **exclude DML on replay** | guard trigger |
| 7 | 20261008073930 story V16 policy | – | – | yes | – | drop policy | recorded applied | – |
| 8 | 20261008104059 evidence link | staff-session command | – | yes | 2 inserts inside body | drop fn | recorded applied | – |
| 9 | 20261008160000 review correction versioning | versions | reviews | yes | **rebuilds 3 unique indexes** | recreate old | duplicate check on review keys | indexes valid |
| 10 | 20261009100000 linked retry lineage | retry scope | F1 core | yes | – | restore captured body | `find_or_create` signature | replay test |
| 11 | 20261009103000 preserve conversation branch | sync exclusion | sync trigger | yes | 2 indexes (transactional; plan for locks) | restore captured trigger body | trigger exists | lineage helper ACL |
| 12 | 20261009130016 attribution command | customer correction | staff session, review perms | yes | trigger WHEN change | restore WHEN; drop fn | prerequisites list in its handoff | SQL suite |
| 13 | **20261009170000 branch provenance guard (new)** | branch rule | 3, 11 | yes | 2 new triggers; replaces 5 bodies | `create or replace` previous bodies (from 3/20260721/20260720/20260726) and drop triggers/helpers | prerequisite guard block inside; reconciliation §5b/§9 | `test:db:followup-branch` on staging copy |

Order: as listed (timestamp order). On migration history:
- No migration was edited in this round.
- The earlier edits to 10 and 12 happened before any application, according to their handoffs.
- 7 and 8 are recorded as applied, and their files are unchanged since then.
- The live ledger was not read. **Do not run an unconditional `db push`.** The historical DML in 4 and 6 must not be replayed.

**Redesign needed before activation:** the Production-only bodies must be captured into migrations. These are the materialize core, the legacy create-request body, the unique indexes and the `followup_identity` unique keys. Then the order has to be validated on a faithful staging copy.

## I. Reconciliation (read-only)

`supabase/readonly/release_candidate_reconciliation_v1.sql` runs in a `READ ONLY` transaction and ends with `ROLLBACK`. It was dry-run against the fixture. It reports:

- duplicate operation candidates;
- conflicting identities (one episode under two anchors);
- legacy alias collisions;
- customer attribution different from source truth;
- action and follow-up branch vs source branch;
- orphaned targets, client keys and sources;
- rows newly protected by the RC migrations;
- open-case counts per type (input to E);
- ambiguous multi-source follow-ups.

Rows in §5b (`single_source_realign_candidate`), §4 (`different_customer`) and all of §9 need **manual review before migration 13**. Nothing is repaired automatically.

## J. main readiness

| Check | Result |
|---|---|
| Ahead / behind | `origin/main` `0b9bead` is an ancestor. 0 behind, 139 ahead. |
| Conflicts | None. `git merge-tree` result tree equals the branch tree (`74a7b903…`), so `npm run verify` on the branch is the merge-result test. |
| Risky files | 186 files. `vercel.json`, `package.json`, the `api/` server bundle, 16 new migrations. |
| Migration conflicts | None. Numbering is monotonic after main's last migration. |
| API / types | New RPC results add fields only. `transfer` returns `noop` instead of raising on a same-branch request; the UI already blocks that case client-side. |
| Merge test | Passes. |

## K. Release decision: `READY_FOR_PREVIEW`

Blockers before merge to main or Production (nothing else):

1. **Unique-index contract (E):** pick A or B. Recommended: A.
2. **Activation order:** capture the Production-only bodies and indexes into migrations. Validate 1–13 on a faithful staging copy, without replaying the historical DML in 4 and 6. Install command 12 before code that calls it reaches users; until then, customer corrections from ingest fail closed.
3. **main auto-deploys on Vercel:** `vercel.json` disables only this branch. A merge to main deploys Production. A no-deploy or activation plan for main is needed first.

Preview caveat: a Preview build uses whatever Supabase project its env vars point to. If that is Production, trying the app writes real data. Point Preview at a staging project, or test read-only.

## L. Safety confirmation

- Production database untouched: no query, no write, no migration applied.
- No migrations applied anywhere except throwaway local PostgreSQL clusters.
- Vercel untouched: no deploy and no Preview. The branch stays deploy-disabled.
- `main` untouched. No force push, no history rewrite. No real customer data read or modified.
