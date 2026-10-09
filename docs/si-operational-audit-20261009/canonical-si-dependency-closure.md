# Canonical SI dependency closure — 2026-10-09

Starting HEAD: `fe52e3a8ff582158f48d4cfa349418b6e73b2fd5`.
Repository: `dawaapharmacy29-create/dawaa-pharmacy`.
Branch: `claude/project-thread-pkg0jt`.

Decision: **DEVELOPMENT_CLOSED_READY_FOR_REAL_TESTING** for the scoped canonical SI closure.

## Closed dependencies

| Dependency | Source and resolution |
|---|---|
| `dawaa_sync_whatsapp_story_product_events_v16(uuid)` | Exact catalog body captured into `20261009210000_close_internal_story_sync_dependencies_v16.sql`; only schema qualification, search path and privileges changed. |
| `dawaa_sync_whatsapp_story_reengagement_events_v16(uuid)` | Same capture and security treatment; business-body parity verified after normalizing those security-only edits. |
| `sales_intelligence_case_analyses` | A real table and its composite row type, absent from the earlier staging bootstrap. Columns, defaults, nullability, constraints and unique keys are source-controlled in `supabase/staging/15_canonical_si_schema.sql`. |
| Supporting canonical relation contracts | The same schema-only artifact includes the missing attribution/match/policy/config/invoice tables and actual catalog columns needed by captured SI/story writers. No dummy analysis table or invented column types. |
| Publication read models | Bootstrap now loads the existing canonical lifecycle function and current-case/current-attribution views from `20261003193000`; the earlier one-column current-case table placeholder was removed. Staff-name normalization uses the existing repository function. No compatibility data backfill is replayed. |

The schema artifact is staging-only, not a Production migration. It supplies the existing baseline contract before loading functions and synthetic seed; it is not a full export of all pharmacy domains.

## Security boundary

The two sync helpers have no direct UI/API RPC callers in the current source. Their canonical caller is `dawaa_refresh_whatsapp_customer_story_v16`, which application code calls from the authorized server refresh service.

- Old helper ACLs allowed PUBLIC, anon and authenticated EXECUTE under SECURITY DEFINER without a caller check.
- New helper ACLs revoke those client roles and retain owner/service_role execution.
- Explicit search path: `pg_catalog, public, pg_temp`; all referenced application relations in both helpers are schema-qualified; no dynamic SQL.
- The parent's old authenticated EXECUTE grant is revoked too: otherwise clients could bypass the internal-helper boundary indirectly. Its function body is unchanged, and its existing owner/service_role path remains.
- Runtime SQL tests deny both direct helper RPCs and the indirect parent entry for anon/authenticated, then prove service_role refresh still writes exactly the accepted-product and reengagement events and preserves aggregate/retry behavior.

## Reproducible validation

```bash
npm ci --legacy-peer-deps --no-audit --no-fund
node scripts/check-canonical-writer-source-control.cjs --strict
npm run check:canonical-si-dependencies
npm run test:db:fresh-staging:pglite
npm run test:db:sql-security:pglite
npm run verify
git diff --check
```

| Gate | Observed result |
|---|---|
| Strict canonical inventory | PASS: 22 entries, zero classified canonical gaps or duplicate errors. |
| Scoped dependency source/runtime checks | PASS: 30 referenced objects have committed definitions and exist in fresh staging. Negative tests detect a removed sync helper or analysis table definition. |
| Fresh local staging | PASS: 30 steps, PGlite 0.5.8; native PostgreSQL remains available through the existing script. |
| Migration chain | Existing RC steps 1–18, captured canonical migration at step 19, internal-sync closure at step 20. Supporting schema and existing prerequisite definitions load before this chain. |
| Re-application | PASS for rerunnable migrations; the two historical apply-once rename migrations remain apply-once. |
| Historical DML guard | PASS: intended staging chain leaves watched review/action rows unchanged. The inherited negative-control test executes the original statements only against a separate synthetic database to demonstrate the guard is sensitive. |
| Reconciliation | PASS: existing read-only report completes; watched rows unchanged. |
| Internal story sync | PASS: actual role denials, safe search path, exact evidence events, aggregate values and no duplicate events on refresh retry. |
| Actual SI writer schema smoke | PASS: analysis/attribution/match/policy writers and unproven reconciliation execute using the actual captured composite table contracts. No false proof is created. |
| Concurrent retry submissions | PASS: five analysis submissions converge on one current row. PGlite serializes SQL batches; this is not a native multi-backend lock-interleaving benchmark. |
| Existing SQL authorization suites | PASS: customer review/incubation RLS, conversation review correction, evidence journey link. |
| Existing operation attribution test | PASS: actual canonical TypeScript writer with local PostgreSQL/WASM guards, session/scope denials, CAS retry and audit. |
| Existing Contract A assertions | 15 checks PASS using the existing test bodies through the local PGlite boundary, including retry/branch/security and concurrent-submission scenarios. Native lock-interleaving is not claimed. |
| Repository test suite | 798 passed, 0 failed; includes Sale Proof, Conversion, Stable Identity, stale import, branch and follow-up regressions. |
| Verify | PASS: doctor, tests, typecheck, production build, runtime performance budget. Initial static JS remains 92.2 KiB gzip. |
| Diff checks | PASS. |

## Safety and stop condition

Production was used only for read-only system-catalog definitions/metadata. Production writes, DML, function execution and customer/invoice/WhatsApp row reads were all zero. No migration was applied remotely. Delivery, main and Vercel were not changed; Vercel Git deployment is disabled for this branch. No paid resources were created. No production data or secrets were copied into the artifacts.

No Sale Proof, Conversion, attribution, branch provenance, Stable Identity or Follow-up Contract A business logic was changed. The next phase is real smoke testing and fixes for reproduced bugs only. Merge and Production activation remain separate gates.
