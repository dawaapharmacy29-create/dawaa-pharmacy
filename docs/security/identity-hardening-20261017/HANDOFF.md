# HANDOFF — verified identity hardening checkpoint (2026-10-17)

**Status: CANDIDATE ONLY. Production is NOT fixed.** None of these migrations has been applied to Production.
Production reads performed during review were catalog-only SELECTs; business-row writes/changes = 0.

## What is in this checkpoint

- `supabase/migrations/20261017090000` … `090700`: 8 candidate migrations.
  - Remove trust in the client-chosen `x-dawaa-user-id` header from 3 identity functions.
  - Harden the 15 direct header-reading RLS policies with exact PRE/POST catalog metadata guards; partial/mixed state now aborts.
  - Bind `p_actor_id` to the verified session in 15 functions, grouped by domain.
  - Revoke client EXECUTE on 7 internal actor-trusting writers.
  - Change **postgres-owned future public-function defaults only** so PUBLIC/anon/authenticated do not receive EXECUTE implicitly; service_role remains explicit.
  - The default-privilege migration deliberately does **not** alter managed `supabase_admin` defaults and does not require role escalation.
- `supabase/sql/ROLLBACK_20261017_security_identity_hardening_v1.sql`: emergency rollback for the original 090000–090600 identity hardening set. It re-opens the exposure; use only for an outage and re-apply forward hardening afterward.
- `supabase/tests/identity_contract_live_v1.sql`: read-only live catalog contract.
  - Adds exact hardened metadata checks for the 15 reviewed RLS policies.
  - Adds postgres/public function-default ACL and ownership-boundary checks.
- `scripts/check-verified-session-identity.cjs`: upgraded CI gate.
  - Checks effective definitions, hardened RLS metadata guards, actor binding, internal writer revokes, and the fail-closed postgres/public function-default migration.
  - Rejects attempts to alter managed `supabase_admin` default privileges from repository migrations.
- `src/lib/supabase.ts`: the browser no longer sends the `x-dawaa-user-id` hint.
  - **Deploy only after the DB migrations.**
- `api/sales-intelligence-refresh-source.js`: regenerated; its application diff is the removed hint lines and generated parity passed in the original rehearsal.
- `scripts/security/identity-rehearsal/`: isolated rehearsal tooling and synthetic seed.
- `docs/security/identity-hardening-20261017/`: original rehearsal evidence, per-function classification, synthetic results, and `FOLLOWUP_REVIEW.md` documenting the corrective review.

## Production read-only facts confirmed during the follow-up review

- Production PostgreSQL: **17.6**.
- Production SQL executor exposed by the Supabase connector: `current_user=postgres`, `session_user=postgres`.
- `postgres` is **not** a member of `supabase_admin`.
- Public functions: 1299 postgres-owned; 31 supabase_admin-owned.
- All 31 supabase_admin-owned public functions are `pg_trgm` extension members and **0 are SECURITY DEFINER**.
- This is why `090700` uses a narrow postgres/public creator boundary instead of trying to modify `supabase_admin` defaults.

## Original isolated rehearsal evidence (before the 090100 metadata strengthening + new 090700 default-ACL migration)

| Check | Result |
|---|---|
| Native PostgreSQL | 17.6 local Docker Supabase Postgres |
| Security suite | 58/58 pass (forged header, forged `p_actor_id`, no session, cross-branch, manager, staff, server passthrough) |
| Differential legitimate calls | 150/150 identical to the pre-fix baseline |
| Live contract | 48 → 0 violations under the original contract |
| Rollback | restores the baseline catalog |
| apply → rollback → re-apply | pass |
| Drift guards | D1–D6 pass |
| `run-tests` | 1048 passed / 0 failed |
| Timezone gate, generated-API parity, TypeScript | pass |
| `p_actor_id` classification | 70 functions, UNKNOWN = 0 |

**Important:** those 58/58 and 150/150 results prove the original 090000–090600 candidate. After strengthening 090100 and adding 090700, the isolated security rehearsal must be re-run before any Production apply decision.

## Current repository / CI state

- Draft PR: `#512` — review only, do not merge.
- Build, Quality Gate, Time Off Architecture, and Runtime Sensitive Finalization Guards passed on the corrected code head before the final documentation-only commits.
- CI success does **not** replace the required isolated SQL rehearsal of the updated 8-migration set.

## Not done / open

1. Re-run the isolated PostgreSQL 17.6 security rehearsal on the updated 8-migration candidate, including exact RLS POST hashes and default-ACL post-conditions.
2. Re-run legitimate differential flows after `090700` to prove no app regression.
3. Production-volume EXPLAIN ANALYZE of the per-row binding inside WhatsApp RLS (`dawaa_can_read_conversation_review_row_v2`).
4. Fresh Production md5/catalog re-capture immediately before any apply; the migrations must abort on drift.
5. `scripts/staging/run-fresh-staging.mjs` still simulates identity with the old header and must move to session tokens before it can be treated as a canonical security-compatible staging runner.
6. Safe Preview runtime: Preview must not point at the Production Supabase project. `src/lib/deployEnvironmentGuard.ts` fails closed by design and must not be weakened.
7. Separate explicit approval is required before **any** Production DB write, merge to `main`, or Production deployment.

## Out of scope for this checkpoint (unchanged)

- Source Gate;
- Golden source contamination;
- the Doctor Eye legacy KPI;
- the 11 WhatsApp / SI / review / follow-up migrations;
- invoice confirmation.
