# First scoped repair: linked follow-up retry lineage

The user explicitly requested starting repairs after the audit. This bounded repair is prepared locally; the full SI writer cutover remains BLOCKED and is not activated. It does not introduce a semantic projector or replace global/manual branch rules.

## Problem and result

When request B linked an existing follow-up A, the core recorded B in event metadata but did not consult that history on retry. Repeated B appended duplicate events, and repeating B after A was completed could create a new follow-up. Reusing a client key with a different customer/branch also returned the old target without checking scope.

`20261009100000_customer_followup_linked_retry_lineage_v1.sql` updates the existing `find_or_create_open_customer_followup` boundary:

* Serialize a supplied client request key before checking replay.
* Check both the original row key and existing created/request-linked event lineage.
* Return the original linked target even after completion; append no duplicate link event.
* Reject mismatched customer identity, branch, or request type, ambiguous historical target lineage, and missing recorded targets.
* Preserve existing actor checks, customer identity helper, manual branch behavior, open-case linking, scheduling, event history, and function signature/owner/ACL.

One partial expression index supports the event-key lookup. There is no new table, queue, data backfill, or deletion. The guard requires the existing core before replacement, avoiding accidental creation with default PUBLIC privileges. Existing function EXECUTE grants remain unchanged by CREATE OR REPLACE.

## Verification

The isolated harness applies this new migration twice to its synthetic in-memory PostgreSQL fixture. **16 properties hold; zero of the three previously reproduced gaps remain in those scenarios.** It checks ordinary creation/replay, shared open-case linking, retry after completion, scope rejection, historical ambiguity, missing targets, materialization rollback, and preservation of restricted core EXECUTE ACL on reapplication.

This is one embedded backend with fixture tables and stub actor/public-wrapper/access functions. It does not prove native multi-connection concurrency, full Production RLS, trigger interactions, or schema parity. No protected migration is loaded.

`npm run verify` exits 0: existing 643 tests pass, typecheck/build/architecture checks pass, and initial JavaScript remains 92.2 KiB gzip across 3 chunks. Build time in this run is 30.37 seconds. The runtime still differs from the repository's declared Node/npm versions, as recorded in the baseline audit.

## Review and deployment limits

The application/UI remains unchanged; this is a repo-only database repair. Existing callers keep the same signature and ordinary open-case behavior. The intended observable difference is that an already-linked retry cannot create fresh work and conflicting keys fail visibly.

Before any live application, verify against a faithful isolated schema with real wrapper authorization, native parallel sessions, and actual trigger order. Index construction takes a table lock during this transactional migration; rollout requires an explicit lock/traffic plan. Do not apply it merely because the fixture passes.

Rollback restores the captured original core definition and optionally drops the new lookup index in a forward rollback migration. No historical event or operational record is rewritten by this repair. Restoring the original function also restores the old retry defect, so rollback is a deliberate operational decision.

No live migration applied. Production untouched. `20261008160000` and `vercel.json` untouched. No Vercel operation requested. The full complaint/request/projector/staff/branch consolidation remains separate pending work.

## Fixture type correction

The next batch discovered that the synthetic follow-up ID was UUID while the real column and event foreign key are text. The fixture and draft replay array now use text; all 16 repair properties pass again. No live application occurred before this correction.

## Review correction: replay scope is the recorded scope, not the current row

Independent review found that the scope check compared a retry with the follow-up row's *current* identity and branch. The existing customer-branch sync trigger (and customer-data correction) can legitimately move that row after creation, so the same logical retry would then fail with `followup_client_request_scope_conflict` instead of converging. Reproduced in the harness against the previous draft.

The draft now records `identity_key` and `branch` in the `created` / `request_linked` event metadata (next to the existing `request_type` and `client_request_id`) and compares a replay with the scope recorded for that key. Events written before this change have no recorded scope and fall back to the row, which is the previous behavior. A genuinely different scope for the same key still fails. The `unique_violation` handler uses the same rule.

The harness now has 17 repair properties, including "retry after the row moved branch/identity replays against the recorded scope", and all hold. Still repo-only and not applied live.
