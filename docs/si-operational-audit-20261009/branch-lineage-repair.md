# Second scoped repair: preserve conversation follow-up branch

Repo-only draft; full SI cutover remains BLOCKED. No live migration or deployment.

The existing customer branch synchronization trigger moves all open follow-ups and future non-completed daily queue items when customers.branch changes. This includes conversation-derived work whose source branch must remain immutable.

The new migration retains that trigger and its manual behavior, adding an existing-lineage predicate. A follow-up is protected only when an action with an actual review source identifies its target, its original client request key identifies that action, or a created/request_linked event identifies that action. Row/event lineage also survives the action target being reconciled to an invoice. Malformed keys and missing action/source records do not invent provenance. Linked queue items receive the same protection, including unchanged queue metadata. Unlinked queue items retain existing behavior.

No semantic classification, new table, queue, historical backfill, or protected migration change. Two partial indexes support target/event lookups. The predicate is security invoker with no anonymous/authenticated EXECUTE; the existing security-definer trigger can invoke it. CREATE OR REPLACE preserves existing trigger-function ownership and ACL. Transactional index creation needs a lock/traffic plan before live application.

## Isolated verification

`branch-lineage-harness.mjs` first reproduces the defect using the captured actual trigger function. It applies the draft twice and verifies 34 properties: direct, original-key, and linked-event lineage; invalid/missing provenance; manual follow-ups; completed/cancelled/archived exclusions; linked/unlinked/past/completed queue items; preserved metadata; blank branch and helper ACL. Actual relevant column types are used, including text follow-up IDs.

The first repair fixture previously used UUID follow-up IDs incorrectly. This batch corrects both fixture and replay array to text, matching the read-only catalog. Its 16 properties pass again. That draft was never applied live.

PGlite uses one backend and synthetic tables. These tests do not prove real RLS/wrapper authorization, full schema parity, native parallel customer-change/materialization races, or historical source-branch correction. Those checks remain required before rollout. Future source-only branch enforcement and full writer consolidation remain pending.

Rollback requires restoring the captured original trigger function and optionally dropping the new helper/indexes; that restores the original branch-moving defect. No data was rewritten by this draft.

Full `npm run verify` exits 0: 643 tests pass, typecheck and architecture checks pass, build completes in 32.04 seconds, and performance budget passes at 92.2 KiB gzip / 3 initial chunks. Node 24/npm 11 differ from declared Node 22/npm 10.9.2; production-runtime parity remains unproven.
