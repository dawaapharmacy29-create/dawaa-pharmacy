# Customer correction: prepared, not deployed

Repository: dawaapharmacy29-create/dawaa-pharmacy. Branch: claude/project-thread-pkg0jt.
Verified starting GitHub HEAD: 62b47a15739e3cb9a4cecfa0c40a1575b112ed34 (unchanged on final pre-commit check).

## Trace and proven cause

Import -> parse -> sessions/intelligence -> existing stableOperationIdentity() -> resolveOperationOwner()/legacyAliasMatches() -> canonical V6 action writer (also used by V15). Followup signals use the same identity/owner contract in saveFollowupSignals().

The existing identity generator already excludes customer resolution. The persistence failures were different:

- A current stable-key action on another import reused the row but its refresh omitted customer attribution.
- Existing followup signals were counted as duplicates and skipped without correcting attribution.
- Legacy customer-key discovery used the new customer anchor/customer filter and could miss the old owner after A -> B, creating another row.
- The existing v2 action truth guard rejects a direct browser UPDATE of customer fields. An ordinary UPDATE would not fix the real authorized persistence path.
- The old followup trigger re-resolves NULL attribution by phone/name. It must not undo an explicitly authorized unresolved correction.

Three additional diagnostic persistence scenarios failed before implementation (A -> B, A -> NULL and old customer-key A -> B). The original 25 stable identity tests passed; one original expectation explicitly accepted a duplicate legacy row after correction and was replaced with the required business contract.

## Narrow change

Identity generation, parser normalization, new-key aliases, V15 routing and scoring are unchanged. The existing owner resolver and evidence guards remain canonical. Historical discovery reproduces stored legacy customer keys using their original stored anchor, not the mutable customer_id. Only exact message evidence or the existing evidence guard plus a matching stable fingerprint from saved raw source permits cross-customer reuse. Bounded historical reads fail closed above 100 candidates. No fuzzy matching or identity migration is introduced.

Confirmed owners call one shared attribution helper, which calls a staff-session-authorized database command. That command locks the row, checks the stored identity/source, validates staff session, canonical review permissions, source/target customer scope, customer/code consistency and compare-and-set prior customer, then updates only attribution. It records the existing review audit. It never inserts or selects an operation owner. Errors fail closed with no insert/direct-write fallback.

The existing signal resolver body remains unchanged. Its trigger WHEN clause checks the command marker and effective UPDATE privilege before entering the SECURITY DEFINER trigger. A marker spoofed by anon does not bypass legacy resolution. This preserves explicit unresolved corrections issued by the checked command.

Correction retains workflow, materialized target, original source/evidence and unrelated approval payload. A cross-export import does not replace original evidence with message IDs belonging to another source. Ordinary same-source reanalysis of uncorrected/unmaterialized rows retains existing refresh behavior and merges payload. NULL-key history is adopted under the existing null-key guard; stored nonnull identities are never rekeyed.

## Files

- src/lib/whatsappOperationalIntelligenceV6.ts: confirmed owner attribution and evidence-guarded historical discovery.
- src/lib/whatsappAutoIngestPipeline.ts: corresponding signal persistence behavior.
- src/lib/whatsappOperationAttribution.ts: shared checked command adapter.
- src/lib/__tests__/stableOperationIdentity.test.ts: persistence, history, V15 and conservative nonmerge regressions.
- supabase/migrations/20261009130016_whatsapp_operation_attribution_session_v1.sql: prepared command and narrowly adjusted trigger condition; NOT APPLIED.
- supabase/tests/whatsapp_operation_attribution_session_v1.fixture.sql and .test.sql: synthetic isolated SQL fixtures/assertions.
- scripts/test-whatsapp-operation-attribution-db.mjs: actual canonical TypeScript writer against isolated PostgreSQL/WASM.
- vercel.json: disables automatic Git deployment for this branch only. This is necessary to honor the explicit no-Preview requirement when pushing; unspecified branches are enabled by default in Vercel. Other branch rules/build commands remain unchanged.
- This handoff.

## Verification

- StableOperationIdentity suite: 25 -> 38 tests, all passing.
- npm run verify: 686 passed, 0 failed; doctor, architecture guards, TypeScript, production build and performance budget passed. Initial JS 92.2 KiB gzip.
- Isolated PostgreSQL test: passed with actual canonical writer, actual action truth guard, original legacy signal resolver, prepared command and native constraints/RLS. Tests include A -> NULL -> B -> A, legacy key retention, workflow/provenance retention, invalid/expired/disabled sessions, permission/source/branch/customer/code denials, stale compare-and-set, lost-response retry, audit and spoofed marker denial.
- Authorization dependency fixtures are synthetic: this is not a claim that the complete production policy/schema has been replayed. No live simultaneous multi-session concurrency test was performed. Existing unique-key retry behavior is retained; stale correction and idempotent retry are tested.

To reproduce the isolated test without adding repository dependencies:

```sh
npm install --prefix /tmp/dawaa-correction-db --no-audit --no-fund @electric-sql/pglite@0.5.8
DAWAA_PGLITE_MODULE=/tmp/dawaa-correction-db/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-whatsapp-operation-attribution-db.mjs
```

unresolved -> A, A -> B, B -> unresolved, A -> B -> A and repeated import retain one operation, row ID and stored identity while attribution changes. V15 reprocessing through the same writer is covered on same and different sources. Two confirmed legacy owners remain ambiguous with no automatic write/merge. Unresolved contact name vs bare number stays separate. Existing phone/staff/system/media identity regressions pass.

## Activation and safety

This is a repository preparation, not a production closure or activation. The checked command is not installed in Production. Until a separately reviewed migration and deployment occur, a changed attribution requiring the new command will fail closed. Production Supabase received no queries/writes, migration application, schema change, cleanup or backfill. No Preview/Production deployment is authorized. main and the delivery project are untouched. No historical reconciliation was started.

A future read-only reconciliation report should show each row ID and candidate duplicate ID, stable/legacy evidence, timestamps/source, old/current customer attribution, deterministic reason, confidence/ambiguity and proposed action. This round neither runs that report nor executes its proposals.

Reversal before activation: revert this focused commit. Any future database activation/reversal requires a separate review, including restoring the original trigger condition and removing the new command; it is not part of this round.

## Follow-up review above e7a3f07: fresh-read stale imports

The remote branch advanced to `e7a3f074d497d3891cf9178ee08e0e2659f55201` during review.
That implementation is retained. An additional native PostgreSQL regression exposed a gap in
customer-only CAS: an old import can first read corrected B, pass expected B, then request old A
or NULL. The former command accepted this fresh-read stale request. The new regression failed
without the guard, and passed after the narrow guard was restored.

The prepared command now takes a SHARE lock on the original durable source and requires its
current customer_id to equal the requested association before mutation. Incoming import
snapshots are not correction authority. This covers actions and signals; SQL tests assert both
stale A and stale NULL after a fresh B read and confirm neither changes association nor audit.
Authorized source corrections still allow A -> NULL -> B -> A on the original operation.
The isolated canonical-writer harness explicitly corrects the original source before each
intended association transition. A missing/unresolved source cannot authorize a resolved
association overwrite; the command fails closed. Correcting the original source itself remains
outside this command and outside this delivery.

This modifies the already prepared migration definition only; nothing has been applied to a
live database. No alternate server endpoint, additional correction helper, tables or columns
are added to the implementation. The SQL fixture merely models the existing source customer_id.
