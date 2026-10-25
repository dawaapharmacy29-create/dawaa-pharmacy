# V32 — authorized database activation and branch Preview
Date: 2026-10-19 (UTC).

Runtime source: `6431f417c5148043d4f7fcf217a7b57a19a898a9`.
Branch: `fix/whatsapp-master-brain-lifecycle-v4-continuation-20261017`.

## Database release
User explicitly authorized the two reviewed SQL files and one branch Preview.
Supabase project: `jkjqeqkshllustwlzzbf`.
Migration: `canonical_followup_contract_a_and_projection_lifecycle_v31`.

Applied exact pinned function statements from:
- `20261009180000_customer_followup_one_open_case_contract_a_v1.sql`
  SHA256 `9d6e2526e0b29153627265aa740646a334990428a4ce3fb438e59caeb8be8bd9`.
- `20261018061544_canonical_followup_projection_lifecycle.sql`
  SHA256 `76497284e1ec8638265d7468df19e326bb01be6ed14298d457ce3431aa74c403`.

Only Contract A outer BEGIN/COMMIT were removed with the existing SQL statement parser so both files run under the migration transaction. Four expected predecessor definition hashes and new-RPC absence guarded installation. Lock timeout 5s; statement timeout 60s. No top-level business DML.

Post-install verification:
- All six function body MD5s exactly match committed SQL bodies.
- Existing function ACLs preserved; new reconcile RPC and provenance trigger function grant execution only to postgres/service_role, not browser roles.
- New RPC and trigger function are SECURITY INVOKER.
- Provenance guard trigger enabled.
- Canonical unmaterialized follow-up proposals: 1 before / 1 after.
- Queue fingerprint unchanged: `c992fb49b8ee76298c339a3bd8579426`.
- No refresh, historical repair, business materialization or business task/request creation performed.
- The existing older proposal remains unchanged; it requires explicit current projection/review before future execution.

## Validation
Latest runtime CI: https://github.com/dawaapharmacy29-create/dawaa-pharmacy/actions/runs/39199637216
- 1047 custom checks passed, 0 failed.
- 1318 Vitest passed plus 1 existing skip in each Cairo and UTC.
- 5 native PostgreSQL multi-session concurrency checks passed.
- 55 isolated authorization/runtime/BEFORE-insert-guard rehearsal steps passed, repeated successfully immediately before activation.
- TypeScript, build, semantic lint, generated API parity and performance budgets passed.
These are inherited source-validation results, not a new live business smoke.

## Preview
Deployment: `dpl_6uU5xFCRrgHYC7ZqLG1ajVc77KbL`.
URL: https://dawaa-pharmacy-8syv18w9l-dawaapharmacy29-creates-projects.vercel.app
Exact source SHA pinned above; target Preview (null), never Production.
Only branch-scoped Preview config `DAWAA_APPROVED_PRODUCTION_PREVIEW_SHA` changed to that SHA.
One Preview deployment requested. No production promotion.

Production alias remained on `dpl_Fz5rUnvA3no9CyCK6Cdkh7vsbsn3`, SHA `ba26a40179fb3d10f03100e902f7494ffa12122c`.
No main merge, no new Supabase project, no historical 14/39 work.

## Remaining scope
Real authenticated browser acceptance of conversation analysis, customer requests, follow-ups, complaints and invoice/product evidence remains required. Passing source tests and database installation does not establish perfect semantic recall or complete real UI acceptance.

## Completed deployment checks
Preview READY; build completed successfully (Vite 39.10s; deployment creation-to-ready 75.957s). Root HTTP GET returned 200 with the Arabic application shell through the authorized Vercel fetch connector. This is an HTTP shell check, not an authenticated browser acceptance test. No business POST issued.
