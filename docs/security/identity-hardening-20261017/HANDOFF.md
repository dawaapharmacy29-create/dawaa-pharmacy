# HANDOFF — verified identity hardening checkpoint (2026-10-17)

**Status: CANDIDATE ONLY. Production is NOT fixed.** None of these migrations has been applied to Production.
All results below come from an isolated local rehearsal (Production-schema subset clone with synthetic data).

## What is in this checkpoint

- `supabase/migrations/20261017090000` … `090600`: 7 candidate migrations.
  - Remove trust in the client-chosen `x-dawaa-user-id` header from 3 identity functions and 15 RLS policies.
  - Bind `p_actor_id` to the verified session in 15 functions, grouped by domain.
  - Revoke client EXECUTE on 7 internal actor-trusting writers.
  - Every file is md5-guarded against drift, fails closed, is idempotent and forward-only, and contains no business-row DML.
- `supabase/sql/ROLLBACK_20261017_security_identity_hardening_v1.sql`: emergency rollback. It re-opens the exposure; use only for an outage.
- `supabase/tests/identity_contract_live_v1.sql`: read-only live catalog contract.
  - 48 violations on Production at capture time, 0 on the fixed clone.
- `scripts/check-verified-session-identity.cjs`: upgraded CI gate.
  - Checks effective definitions, adds forward rules for new migrations, and checks client headers and `p_actor_id` calls.
- `src/lib/supabase.ts`: the browser no longer sends the `x-dawaa-user-id` hint.
  - **Deploy only after the DB migrations.**
- `api/sales-intelligence-refresh-source.js`: regenerated; the diff is only the removed hint lines, and the parity check passes.
- `scripts/security/identity-rehearsal/`: rehearsal tooling and the synthetic seed.
- `docs/security/identity-hardening-20261017/`: full rehearsal report, per-function classification and synthetic test results.

## Local results (isolated, not Production)

| Check | Result |
|---|---|
| Security suite | 58/58 pass (forged header, forged `p_actor_id`, no session, cross-branch, manager, staff, server passthrough) |
| Differential legitimate calls | 150/150 identical to the pre-fix baseline |
| Live contract | 48 → 0 violations |
| Rollback | restores the baseline catalog |
| apply → rollback → re-apply | pass |
| Drift guards | D1–D6 pass |
| `run-tests` | 1048 passed / 0 failed |
| Timezone gate, generated-API parity, TypeScript | pass |
| `p_actor_id` classification | 70 functions, UNKNOWN = 0 |

## Not done / open

1. Human security review of the 7 migrations and the gate.
2. Production-volume EXPLAIN ANALYZE of the per-row binding inside WhatsApp RLS (`dawaa_can_read_conversation_review_row_v2`).
3. Fresh md5 re-capture right before any apply (the guards enforce it).
4. `scripts/staging/run-fresh-staging.mjs` still simulates identity with the old header and must move to session tokens.
5. Schema default privileges still grant EXECUTE on new functions to anon/authenticated (systemic). The gate and the live contract catch it; the default ACL itself is unchanged.
6. Safe Preview runtime: the Preview environment must not point at the Production Supabase project. `src/lib/deployEnvironmentGuard.ts` fails closed by design and must not be weakened.

Out of scope for this checkpoint (unchanged):
- Source Gate;
- Golden source contamination;
- the Doctor Eye legacy KPI;
- the 11 WhatsApp / SI / review / follow-up migrations;
- invoice confirmation.
