# SI consolidation: test and main merge readiness

As of 2026-10-09, **full application trial and main merge are NOT READY**. Scoped repairs are prepared and tested; no live activation, branch push, deployment, or merge has occurred. Current remote main observed read-only: `0b9bead8df7c39373e297a47f75fc9eaba03af18`. Recheck before integration.

| Boundary | Current evidence | Remaining acceptance |
| --- | --- | --- |
| Linked follow-up retry | Existing core repaired; 16 isolated properties, real text ID types | Native concurrent sessions, faithful authorization/RLS/schema |
| Conversation follow-up branch | Existing trigger filtered by action/source/event lineage; 34 isolated properties | Native materialization/customer-change race; historical mismatch review |
| Sale action lineage | Canonical refresh leaves execution target untouched, invoice remains canonical_sale | DB-side writers/older clients must share the invariant |
| Durable operational identities | Resegmentation counterexample reproduced | Import/order/resegmentation invariance; fail closed on missing anchor |
| Complaint ownership | Canonical SI contract specified | Implement assessment once in SI; retire external state decisions |
| Request qualification/branch | Contracts specified; live canonical request prefers staff home branch | Canonical need/coverage qualification and source-aware existing command |
| Proposal reconciliation | Current queue retained | Atomic current revision, empty proposal supersession, materialized history |
| Review quality retry | Current review/version contract specified | Durable server command, visible retry, lost response/closed tab proof |
| Automatic writer cutover | 66 app sites, 98 DB functions audited | Single server-enforced atomic authorization; retire old clients/RPC/cron/offline writes |
| Application trial | Source/bundle local checks | Faithful isolated DB and supplied 20 operational scenarios before preview authorization |
| Main integration | Remote head inspected | Conflict review, integrated gates and final consolidated review before merge |

Implementation order: durable identity and immutable execution lineage; canonical complaint/request outputs; one atomic projector and source-aware commands; quality retry; server-enforced writer retirement; isolated end-to-end trial; integrated main gates. No new semantic engine, queue, or parallel operational table is authorized.

The sale-lineage fix only removes target replacement from the existing proven-sale follower. It does not change invoice matching, quantity-coverage decisions, status/payload reconciliation concurrency, or revive historical targets that were already overwritten. These are separate pending acceptance items. The mock race proves omitted target columns cannot overwrite the concurrent target in that patch, not full database serializability.

Permissions remain at the existing authenticated server transport/service-role/RLS boundary; exporting the existing follower for focused tests introduces no route or browser caller. Reads retain source/action-type/status and invoice-ID scope; no extra query or columns are added. Reversal restores the two removed target assignments, which reintroduces the lineage defect.

## Current verification

Full `npm run verify` exits 0: 648 tests pass (five new sale-lineage regressions), typecheck/architecture pass, canonical API regenerated and matches source, build 33.36 seconds, performance budget 92.2 KiB gzip across 3 initial chunks. Runtime Node 24/npm 11 differs from declared Node 22/npm 10.9.2.

After deepening the initially shallow checkout, merge-base equals the observed main SHA: main is already an ancestor of this branch. Local merge-tree simulation has no conflicts; it creates no branch update or working-tree merge. The current patch only removes target assignments and adds tests/docs; final committed-tree simulation is recorded in the handoff. This does not establish full operational readiness or authorize a merge. Protected migration and vercel.json remain unchanged.
