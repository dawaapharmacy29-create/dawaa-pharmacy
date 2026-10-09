# Isolated follow-up boundary proof

This continuation tests existing captured SQL bodies rather than implementing a new application writer. Phase 1 remains BLOCKED. The result narrows the design: preserve the existing persistent action materializer as the retry boundary; do not call the follow-up core alone and assume every linked obligation is durably idempotent.

## Reproduction

`followup-core-harness.mjs` runs with an explicitly supplied absolute PGlite module path. It creates an in-memory PostgreSQL database with synthetic tables and fixture actor/access functions, then loads `followup-core-live-definitions.json`:

* `dawaa_normalize_egyptian_mobile_v1`
* `dawaa_customer_identity_key_v1`
* `find_or_create_open_customer_followup`
* `dawaa_materialize_whatsapp_action_core_v2`

These are captured definitions, not modified copies of the commands. Fixture table shapes, actor/access functions, and the public follow-up wrapper are explicitly simplified. The source/action uniqueness constraints model the inspected live indexes. No application migration, including the protected migration, is loaded. No network/database client or environment database URL is used.

Example invocation after installing PGlite in a separate temporary runtime:

```sh
node docs/si-operational-audit-20261009/followup-core-harness.mjs /absolute/runtime/node_modules/@electric-sql/pglite/dist/index.js
```

The PostgreSQL WASM runtime was installed outside the repository; application dependencies and lockfile remain unchanged. Native PostgreSQL setup was unavailable under the execution environment's account-switch permissions, so the test uses one embedded backend. It cannot prove multi-connection concurrency.

## Observed results

The final reproduction exits successfully and records **9 existing properties holding, 3 contract gaps reproduced**. Successful reproduction is not a claim that the three desired invariants pass.

| Boundary / scenario | Observed behavior | Implication |
|---|---|---|
| Core creation with key A, retry A | Same follow-up ID; idempotent replay | Existing creation retry works |
| Core request B while A is open | Links B to A | Preserve existing open-case linking |
| Retry linked B | Two `request_linked` events for B | Core does not dedupe linked-obligation lineage |
| Close A, then retry B directly | Creates another follow-up | Linked B was not stored in A's `client_request_id` |
| Replay key A with a different customer/branch | Returns A's old target without comparing scope | Upstream trusted boundary must enforce replay scope |
| Missing/unknown actor or missing branch | Rejects | These existing core checks hold within the fixture |
| Distinct persisted actions A/B materialized | Link to one open case | Existing materializer supports shared target lineage |
| Close shared target, retry created action B | Returns original target; no new follow-up | Persisted action state protects this retry |
| Duplicate `followup_identity` | Unique constraint rejects | Existing queue can enforce one stable semantic key |
| Audit insert deliberately fails during materialization | Target creation and action state roll back together | Existing function transaction avoids partial materialization in this fixture |

## Design consequence

The canonical projector should preserve one durable action identity and its original target. Quality-follow-up retries should reuse that existing persistent execution boundary if the review's canonical source/type/security contracts fit it. Do not regenerate a new action UUID on retry and rely solely on `whatsapp-action:<UUID>`.

The existing queue already has a unique `followup_identity` index, while materialization locks the action and returns an already-created target. This gives a concrete infrastructure reuse path without a new queue/table. It does not supply a durable obligation key by itself: the earlier resegmentation counterexample still applies.

Scope checks must verify canonical customer/source branch, including replay, before returning a target. The fixture's access function deliberately returns true, so its success is **not** an authorization proof. Manual/global follow-up behavior is not changed by this audit. Any future fix to the global core needs separate compatibility coverage; source-aware action validation is the narrower conversation path.

A review without a valid canonical source must not acquire a fabricated source row to fit this queue. Prove the saved-review/source relationship and current-version checks before adopting the quality path. The existing browser offline queue is not a substitute for a server-owned durable review obligation.

## Remaining proof

* Actual public-wrapper session/permission checks, effective RLS, function grants, and live trigger ordering in an isolated schema.
* Concurrent requests from independent native PostgreSQL connections.
* Stable obligation identity across import/resegmentation, including collisions and legacy identity lineage.
* Atomic legacy-writer exclusion, stale browser replay, and service-role paths.
* Source branch retention after customer/staff branch changes.

No Production data changed. No live migration applied. No protected migration modified/applied. No Vercel operation or branch ref update was requested.
