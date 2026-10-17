# Identity hardening — isolated rehearsal tooling

Rebuilds and re-runs the isolated rehearsal of the 20261017 identity hardening migrations. **Everything here runs
against local, disposable databases only.** Never point these scripts at Production.

| Step | File | What it does |
|---|---|---|
| 1 | `00_capture_catalog_readonly.sql` | Read-only catalog capture (DDL text, no rows). Save its JSON result **outside the repository**. |
| 2 | `parse_dump.cjs <saved-result> <catalog.json>` | Extracts the rows from a saved query result. |
| 3 | `build_clone.cjs <catalog.json> <outdir>` | Writes `10_clone_schema.sql` (Supabase shims + tables + functions + grants), `20_clone_policies.sql`, `prod_function_md5.json`. |
| 4 | `30_synthetic_seed.sql` | Synthetic accounts, session tokens (only sha256 stored) and HR/payroll rows. No real data. |
| 5 | `run_tests.cjs pre|post [out.json]` | 58-case security suite. `pre` documents the vulnerable behaviour, `post` the requirement. Each case = one PostgREST-equivalent transaction that is rolled back. |
| 6 | `run_flows.cjs [out.json]` | 150 legitimate calls (5 accounts × 30) diffed between `dawaa_sec_baseline` (pre-fix) and `dawaa_sec_rehearsal` (fixed). |
| 7 | `gen_binding.cjs <migrations-dir>` | Regenerates the four domain binding migrations (identical md5-guarded helper). |
| 8 | `gen_rollback.cjs <catalog.json> <20_clone_policies.sql> <out.sql>` | Regenerates the emergency rollback from the captured bodies. |
| 9 | `classify.cjs` / `gen_actor_table.cjs` | p_actor_id classification table. |

Expected local results (2026-10-17): security suite pre 58/58 (exposure reproduced), post 58/58; flows 150/150 identical;
`supabase/tests/identity_contract_live_v1.sql` 48 violations on the pre-fix clone, 0 after; rollback restores the baseline catalog;
apply → rollback → re-apply passes; drift guards abort as designed.

Local databases: a dedicated database inside the local Docker Supabase Postgres (`dawaa_sec_rehearsal`, `dawaa_sec_baseline`),
created with `create database`; the local stack's own `postgres` database is not used.
