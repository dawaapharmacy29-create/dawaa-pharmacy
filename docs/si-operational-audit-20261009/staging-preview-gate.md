# Staging / Preview gate — Release Candidate validation

Branch `claude/project-thread-pkg0jt`. Date 2026-10-09. Phase: Release Validation (no new features).

## Decision: `BLOCKED_BEFORE_PREVIEW`

Everything that can be proven without a staging Supabase project is done and green. The Preview itself was **not** deployed, because three things only the owner can provide are missing:

1. **No staging Supabase project exists.** The account has `dawaa-pharmacy-os` (Production, `jkjqeqkshllustwlzzbf`) and `dawaa-delivery-os` (another app). Creating a project is a billing decision.
2. **A faithful staging schema needs a schema-only export of Production** (`pg_dump --schema-only`, no rows). The repository cannot build it: replaying all 743 repo migrations from zero fails 454 of them, because core tables (`conversation_sales_reviews`, `whatsapp_conversation_actions`, `daily_followups`, `customer_requests`, ...) were created outside migrations, and several Production triggers on `daily_followups` have no repo body. Reading the Production catalog was out of scope for this phase.
3. **Vercel access.** The Vercel connector's sign-in has expired, and `vercel.json` disables deployments for this branch.

## A. Git

| | |
|---|---|
| Starting HEAD | `6310dbb` (verified on origin; nothing newer) |
| Final HEAD | see the last commit on the branch |
| Commits this phase | `e077380` contract A; `0e05f21` fail-closed staging guard; `a1dd277` from-zero staging run; this report |
| main | untouched (`0b9bead`); no merge, no push to main |

## B. Unique index: contract A

Owner decision: **one open follow-up per customer + branch, whatever its request_type.**

| Writer | Before | After (migration `20261009180000`, not applied) |
|---|---|---|
| `find_or_create_open_customer_followup` (manual, Excel import, WhatsApp materialize via `dawaa_create_or_link_customer_followup_v1`) | looked up and locked per (customer, branch, request_type); a second type hit the Production index and raised a raw `unique_violation` | looks up and locks per (customer, branch). A different type is linked to the open case as a `request_linked` event recording its own `request_type` and the case's type. A `unique_violation` from a writer outside the lock is converted into the same link, or a named `followup_open_case_conflict` when the open case is hidden or merged |
| `dawaa_create_exceptional_followup_v2` | inserted without any open-case check | same lock and lookup; reuses the open case and logs `request_linked` with the exceptional details (priority, time, doctor, notes) |
| `list_open_followup_duplicate_groups_v1` | grouped per request_type | grouped per customer + branch |
| Client (`followupWriteErrors.ts`) | showed the raw database message | maps 23505 / `duplicate key` / the named conflicts to Arabic messages on every follow-up creation path |

The Production index is not created, dropped or widened. Retry semantics are unchanged: a reused client key with another type is still `followup_client_request_scope_conflict`.

Tests (`npm run test:db:followup-contract-a`, native PostgreSQL 16, Production index modelled with the broadest open predicate): **15 checks pass.**

| Case | Result |
|---|---|
| 0 predecessor body raises a raw unique_violation (bug reproduced) | PASS |
| 1 customer A + Shokry, first request creates the open case | PASS |
| 2 another request_type: no new row, no exception, linked, type recorded; exceptional also reuses | PASS |
| 2' same with the index absent (the application alone holds the contract) | PASS |
| 3 same customer, other branch: independent row | PASS |
| 4 closed case, then a new request opens a new case | PASS |
| 5 retries return the same case, including a linked request's retry | PASS |
| 6 concurrent general + complaint + exceptional, 5 rounds, with and without the index: one open row | PASS |
| 6b writer outside the lock commits first: converted into a link, no raw error | PASS |
| 6c a direct second open row is still rejected by the database index (final safety net) | PASS |
| 7 hidden open case: named error, never a raw unique_violation; client mapping unit tests | PASS |
| Security: core not client-callable, wrapper needs a staff session and branch scope, search_path pinned | PASS |

Mutation checks: reverting the lookup to request_type, the lock key to per-type, removing the unique_violation handler, and removing the exceptional open-case check each make a named check fail (4 of 4 caught).

## C. Staging safety

| Variable | Read by | Must point to |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | browser bundle (`src/lib/supabase.ts`) | the environment's own project |
| `SUPABASE_URL` (falls back to `VITE_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY` | `api/sales-intelligence-refresh-source.js` (server) | the environment's own project |
| `DAWAA_STAGING_SUPABASE_REF` | build gate and server guard | the staging project ref (Preview / development only) |
| `SUPABASE_DB_URL` / backup secrets | `.github/workflows/supabase-backup.yml` | Production only (GitHub secret; never a Vercel Preview variable) |

Fixed: the server transport fell back to the **Production URL** when no URL was configured. It now fails closed (`missing_supabase_url`) and refuses any preview/development runtime whose URL or key is not the declared staging project (`deploy_environment_isolation_failed`).

Added: `scripts/check-deploy-environment.cjs`, first step of `prebuild`, so every Vercel build runs it. A **Preview or development build fails** unless `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `DAWAA_STAGING_SUPABASE_REF` are set, every URL and JWT key belongs to that project, and none belongs to Production. Production builds and unflagged local runs only report. It prints project refs, never keys. 6 unit tests.

Env matrix:

| Environment | Database | Enforced by |
|---|---|---|
| Production | Production project | report only (no change to the Production pipeline) |
| Preview | staging project ONLY | build gate (fail closed) + server runtime guard |
| Local | local / test database | `DAWAA_DEPLOY_ENV=local` enforces; the DB test scripts refuse any non-local host and any Supabase URL in the environment |

Manual preflight before the first Preview (in Vercel → Project → Settings → Environment Variables): Production-scoped variables must not be shared with Preview; set the three staging variables for Preview only.

## D. Staging bootstrap (`supabase/staging/`, `scripts/staging/`)

Reproducible from zero on a throwaway native PostgreSQL. It stands in for a staging project until a schema-only export exists; it is not a substitute for one.

| Layer | File / source | Classification |
|---|---|---|
| 1 platform | `00_platform_shim.sql` | roles, auth/extension schemas (skip on real Supabase) |
| 2 tables | `10_production_tables.sql` | table dependency; columns from live-mirrored repo fixtures (read from Production 2026-10-08), `supabase-setup.sql`, migration references |
| 3 Production-only | `20_production_only_objects.sql` | index: open-case uidx (predicate modelled, broadest), client_request uidx, two followup_identity uks; function: 18 signature stubs (only renamed/revoked by the RC migrations; raise if called) |
| 3 captured bodies | `followup-core-live-definitions.json`, `branch-sync-live-definition.json` | function: identity key, mobile normalizer, materialize core v2, branch sync (Production bodies) |
| 4 repo prerequisites | listed in `run-fresh-staging.mjs` (`PREREQUISITES`) | function bodies sliced from their historical migrations, without their one-time DML |
| 4 session helpers | `30_session_helpers.sql` | function, reduced to the header path like the live-mirrored fixtures |
| 5 seed | `40_synthetic_seed.sql` | synthetic only (SYN- codes, 0100000xxxx phones); includes rows the old DML would rewrite |

Where an old migration and Production differ, Production's captured body wins for the four captured functions (they are what Production runs); for everything else the latest repo body wins, and the drift list (`schema-drift.csv`) stays the authority on what differs.

Not reproduced (definition unknown): `daily_followups_unique_customer_per_day_v14`, `daily_followups_one_visible_open_case_uidx`, `daily_followups_import_fingerprint_uidx`, and the Production-only `daily_followups` triggers (`trg_daily_followups_identity_key`, `_dedupe`, `_guard_insert`, `validate_daily_followup_write`). Risk to watch on real staging: if `unique_customer_per_day_v14` is unconditional on (customer_code, followup_date), a same-day follow-up for the same customer in the other branch would still be refused there; the client now shows a clear message instead of the raw error.

## E. Historical DML

`scripts/staging/historical-dml.mjs` pins the three one-time UPDATEs by sha256 and removes only them; it fails if any of them changes or if any other top-level DML remains.

| Migration | Statement | Staging |
|---|---|---|
| 20261005133000 | 2 × UPDATE `conversation_sales_reviews.is_current` | excluded |
| 20261005141000 | UPDATE ready `customer_request` actions → `proposed` | excluded |

Proof: the seeded rows those UPDATEs target are unchanged after the full chain (2 ready requests kept, review flags unchanged); a negative control applying the unsplit files on the same seed does change them.

Production plan (forward-only, no history rewrite): never run these two files as they are. Before activation, read the ledger (`supabase_migrations.schema_migrations`) once, read-only. If they are recorded applied, nothing to do. If not, apply their DDL through new forward migrations that contain only the DDL, and keep the old files out of any `db push` (they are the only two with top-level DML in the set). No unconditional `db push`.

## F. Migration order (18 files, deterministic, dependency-checked)

| # | Migration | Needs | Objects | Mutates data | Lock risk | Reversal | Checks | Staging |
|---|---|---|---|---|---|---|---|---|
| 1 | `20261005123000_sales_intelligence_truth_boundary_v2` | – | retires 5 legacy client writers (EXECUTE to service_role only); SI sale-truth and product-opportunity guard triggers; invoice-item reconcile trigger; review supersede trigger; view conversation_sales_reviews_canonical_v2; CHECK on whatsapp_sales_opportunities_v17.current_stage | no (DDL only; the CHECK constraint validates existing rows) | medium: ADD CONSTRAINT CHECK scans whatsapp_sales_opportunities_v17 under ACCESS EXCLUSIVE; triggers take brief SHARE ROW EXCLUSIVE locks | restore the previous trigger set and grants from the Production catalog snapshot; drop the new triggers, view and constraint | 6 | PASS |
| 2 | `20261005124500_automatic_review_writer_guard_v2` | – | automatic conversation-review writer guard function and trigger | no | low: one CREATE TRIGGER on conversation_sales_reviews | drop trigger automatic_conversation_review_writer_guard_v2 and its function | 1 | PASS |
| 3 | `20261005131000_followup_writer_surface_hardening_v2` | – | dawaa_current_followup_actor_v2; renames correct/merge/transfer/import writers to *_legacy_* (service-only) and installs session-bound wrappers; revokes client EXECUTE on 9 maintenance functions | no | none (catalog only) | drop the wrappers and rename the *_legacy_* bodies back; re-grant the previous EXECUTE list (apply once) | 5 | PASS |
| 4 | `20261005133000_monthly_evidence_canonical_reads_v2` | 1 | dawaa_monthly_evaluation_server_evidence_v5 reads canonical reviews | HISTORICAL DML: two one-time UPDATEs of conversation_sales_reviews.is_current. EXCLUDED from staging (scripts/staging/historical-dml.mjs) and must never be replayed | none for the DDL part | restore the previous function body (20260930155500) | 1 | PASS |
| 5 | `20261005134500_customer_followup_request_writer_guard_v2` | – | renames dawaa_create_customer_followup_request_v1 to *_legacy_v1 and installs a guarded v1 | no | none (catalog only) | drop the new v1 and rename the legacy body back (apply once) | 2 | PASS |
| 6 | `20261005135500_automatic_review_guard_order_v2` | 2 | moves the review writer guard to zzzz_ so it runs last | no | low: trigger drop/create on conversation_sales_reviews | recreate automatic_conversation_review_writer_guard_v2 and drop the zzzz_ trigger | 2 | PASS |
| 7 | `20261005141000_whatsapp_action_truth_guard_v2` | – | action truth guard trigger; approve-customer-request command; materialize v1 becomes a session-bound wrapper over the service-only core_v2 | HISTORICAL DML: one-time UPDATE demoting ready customer_request actions to proposed. EXCLUDED from staging and must never be replayed | low: one CREATE TRIGGER on whatsapp_conversation_actions | drop the guard trigger and the approve command; restore the previous materialize ACL | 3 | PASS |
| 8 | `20261005150000_monthly_evidence_attendance_type_fix_v2` | 4 | dawaa_monthly_evaluation_server_evidence_v5 attendance type fix | no | none | restore the order-4 body | 1 | PASS |
| 9 | `20261005153000_public_rls_surface_hardening_v2` | – | RLS on notification_sla_policies (with an authenticated read policy), sales_import_bridge_tokens_20260908, task_activity_log | no | low: ALTER TABLE ENABLE RLS takes a brief ACCESS EXCLUSIVE lock per table | disable RLS on the three tables and drop the policy | 4 | PASS |
| 10 | `20261005170000_conversation_review_points_staff_session_v1` | – | record_conversation_review_points_v1 bound to the staff session | no | none | restore the previous body | 1 | PASS |
| 11 | `20261008073930_whatsapp_story_events_update_policy_v16` | – | UPDATE policy on whatsapp_customer_story_events | no | low: CREATE POLICY | drop policy whatsapp_customer_story_events_update_v16 (recorded applied in Production; do not replay there) | 1 | PASS |
| 12 | `20261008104059_whatsapp_evidence_journey_link_staff_session_v1` | – | dawaa_link_whatsapp_evidence_journey_session_v1 staff-session command | no (the command body writes when called) | none | drop the function (recorded applied in Production; do not replay there) | 1 | PASS |
| 13 | `20261008160000_conversation_review_manager_correction_versioning_v1` | 1, 2, 6, 10 | correction lineage columns + CHECK on conversation_sales_reviews; rebuilds 3 unique indexes and adds 4; freeze trigger; case lifecycle trigger; correction command; official/canonical views | no row writes; ALTER TABLE adds columns | HIGH: ADD CONSTRAINT validates every row and the index rebuilds are not CONCURRENTLY, so writes to conversation_sales_reviews block for the build; run off-hours after the duplicate pre-check | drop the new indexes/triggers/views/command, recreate the 3 previous unique indexes, drop the added columns only if unused | 4 | PASS |
| 14 | `20261009100000_customer_followup_linked_retry_lineage_v1` | – | find_or_create_open_customer_followup replay scope from event lineage; replay lookup index | no | medium: CREATE INDEX (not CONCURRENTLY) on customer_service_followup_events blocks writes while it builds | restore the captured previous body (followup-core-live-definitions.json); drop the index | 2 | PASS |
| 15 | `20261009103000_preserve_conversation_followup_branch_v1` | – | conversation lineage predicate; customer branch sync skips conversation follow-ups; 2 lineage indexes | no | medium: two CREATE INDEX (not CONCURRENTLY) block writes to the two tables while they build | restore the captured sync body (branch-sync-live-definition.json); drop the predicate and indexes | 3 | PASS |
| 16 | `20261009130016_whatsapp_operation_attribution_session_v1` | 7 | customer attribution command for an operation; auto-followup identity trigger WHEN clause | no | low: trigger replace on whatsapp_auto_followup_requests | restore the previous trigger WHEN; drop the command | 1 | PASS |
| 17 | `20261009170000_followup_branch_provenance_guard_v1` | 3, 15 | source-owned branch rule: 3 helpers, guard trigger function, transfer/correct/repair/merge bodies, 2 zzz_ backstop triggers | no | low: two CREATE TRIGGER (daily_followups, customer_service_daily_queue_items) | drop the two triggers and the helpers; CREATE OR REPLACE the previous bodies (order 3, 20260721, 20260720, 20260726232000) | 3 | PASS |
| 18 | `20261009180000_customer_followup_one_open_case_contract_a_v1` | 14 | contract A: find_or_create, exceptional create and duplicate listing key on customer + branch | no | none (function bodies only) | CREATE OR REPLACE the order-14 find_or_create body, the 20260719 exceptional body and the 20260720 listing body | 3 | PASS |

Apply-once: orders 3 and 5 rename functions and fail if re-applied; all others re-apply cleanly (checked).

## G. Tests (final numbers)

| Suite | Result |
|---|---|
| `npm run verify` | exit 0: doctor PASS, **706 passed, 0 failed**, typecheck clean, build OK, perf PASS (92.2 KiB gzip, 3 initial chunks) |
| TypeScript | clean |
| Semantic lint (Quality Gate command) | exit 0; `audit-fix-semantic-lint` leaves `src` unchanged |
| Full `npm run lint` | 28,993 Prettier-format findings, all pre-existing across the repo; the Quality Gate disables that rule. New files are Prettier-formatted |
| Fresh staging from zero (`npm run test:db:fresh-staging`) | **24 steps pass**: bootstrap, 18 migrations with 44 post-checks, idempotency, no historical DML, negative control, reconciliation, contract A smoke |
| Contract A (`npm run test:db:followup-contract-a`) | **15 pass** incl. concurrency; 4/4 mutations caught |
| Branch provenance (`npm run test:db:followup-branch`) | 85 pass (80 + 5 races) |
| Conversation review correction (native PG) | 118 pass |
| Evidence V17 link (native PG) | pass (`ALL_EVIDENCE_LINK_DB_TESTS_PASSED`) |
| Operation attribution (PGlite, actual TS writer) | pass |
| Reconciliation on the migrated staging DB | ran read-only; wrote nothing; all anomaly sections 0 on the synthetic seed |
| Hosted CI | not run (no PR; the Quality Gate triggers on PRs to main) |

## H. Preview

Not deployed (see the decision). URL: none. No Vercel deployment of any kind was made.

## I. Smoke workflows (22)

Not run against a Preview. Automated evidence that exists today:

| # | Workflow | Automated evidence | Needs Preview |
|---|---|---|---|
| 1 | login/auth | staff session guards in all PG suites | yes |
| 2–6 | WhatsApp import, action creation, retry, re-import, reordered conversation | stableOperationIdentity (40 unit tests), attribution suite | yes |
| 7–8 | unresolved / unresolved→resolved customer | attribution suite | yes |
| 9–10 | A→B correction, stale import after correction | attribution suite, re-import tests | yes |
| 11–12 | follow-up creation, second request_type | contract A suite + staging smoke | yes |
| 13–14 | branch protection, authorized branch | provenance suite (85) | yes |
| 15–16 | Sale Proof, Follow-up Proof | provenance T4/T9, re-import test | yes |
| 17–18 | V15, Smart Folder | unit tests in `npm run test` | yes |
| 19–20 | duplicates, ambiguity | reconciliation §1–§3, §9; provenance T-ambiguous | yes |
| 21 | UI error handling | follow-up error mapping tests | yes |
| 22 | page performance | perf budget PASS | yes |

## J. Bugs fixed this phase

1. Second request_type for a customer with an open case surfaced a raw unique-violation (contract mismatch). Fixed by contract A.
2. Exceptional follow-up ignored the open case (contract mismatch). Fixed.
3. Server transport fell back to the Production database (staging safety). Fixed, fail closed.

## K. main and Vercel

A merge to `main` **does still deploy Production**: `vercel.json` leaves main enabled and Vercel builds main as Production.

Recommendation (one plan): before merging, in Vercel → Project → Settings → Environments → Production, turn **off "Auto-assign Custom Production Domains"**. A main build then becomes a staged Production deployment that serves no traffic until someone promotes it (Deployments → Promote, or `vercel promote`). Merge only after the database activation plan (section F, in staging first) is approved, because the merged frontend expects RPCs from these migrations; promote after the Production migrations are applied and checked. No `vercel.json` change.

## L. Safety confirmations

- Production database untouched: no SQL, no migration, no repair, no read of the live database. The only Supabase call was a project list (account metadata) to check whether a staging project exists.
- No Production migration applied.
- No real customer data: all fixtures and seeds are synthetic.
- main untouched; no merge, no force push, no history rewrite; no migration file edited.
- No Vercel deployment (Production or Preview).

## Owner actions to unblock the Preview

1. Approve creating a staging Supabase project (separate billing).
2. Approve a one-time schema-only export of Production (no rows) to seed it, or provide one.
3. Reconnect Vercel and set the Preview-only variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DAWAA_STAGING_SUPABASE_REF`) to the staging project, and allow Preview for this branch.
