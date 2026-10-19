# V34 — canonical customer-request retry regression
Date: 2026-10-19. Base HEAD f0c63bc33cc1b4b327382e67c6637f6febb717c7.
Status: LOCAL_CANDIDATE_PASS_DATABASE_ACTIVATION_PENDING.

## Proven defect
Positive isolated execution used captured Production create_customer_request_canonical_v1/v2, the real staff-session resolver and materializer. First approved execution created the correct customer request and action target. Retrying the same completed action failed with customer_request_requires_explicit_approval: the public wrapper required status=ready before reaching the core's already_created return.

No live request was created to reproduce this. Production was read only for function definitions and table metadata.

## Small fix
Source-only forward migration:
supabase/migrations/20261019093000_customer_request_materialization_retry_v1.sql
SHA256 c4843ec9ef21af94338fd9e4683831e3a944362db0454fb62e9bd5beffc64c3b.

The existing source lock, case locks, strict session and branch/manage permissions remain first.
For a created customer_request action, validate target table and actual target customer/product/doctor/normalized branch, then let the existing core return already_created. Other states still require explicit approval, verified auto_eligible=true and ready status.
Target lookup uses the UUID primary key. No new grants, automatic execution, data repair or source reinterpretation. Existing applied migration is unchanged.

## Rehearsal results
60 isolated full-schema rehearsal steps passed locally. The runner still refuses remote database hosts and application database environment variables.
- First explicitly approved request creates one request with exact customer/product/staff/branch.
- Captured old wrapper retry failure reproduced before applying candidate.
- Candidate applied twice; completed retry returns same target without another request/event/audit.
- New unapproved requests still denied.
- Missing, cross-branch and insufficient-role actors still denied on completed retry.
- Mismatched target rejected.
- Complaint action links existing open follow-up; retry adds no extra follow-up/event/audit.
- Existing follow-up identity, BEFORE-insert guards, permission and canonical lifecycle checks pass.
- Invoice/product fingerprints unchanged.
Synthetic account/customer/staff names only. Session fixtures are generated in memory, never logged or copied from Production.

Limits: customer-request incentive AFTER triggers are not replayed, so no claim of settled incentive parity. This added request test covers serial retries; existing native concurrency tests cover follow-up publication/materialization, not the new request scenario. Browser review of forms does not establish live business execution.

## Deployment and data boundaries
No Production writes or deployments in this work. No main merge, historical repair, or 14/39 processing.
The reviewed Preview remains dpl_H32aUVoAiYZ1T9PivD2bNfqzxJUi on f0c63bc. Earlier browser review confirmed the four display corrections there.
The new SQL fix is NOT activated in shared Production; a guarded database release is a separate remaining step. No new Vercel deployment is required for this SQL-only fix.

## Authorized activation — 2026-10-19
User explicitly approved this migration after the candidate and CI passed.
Status now: DATABASE_RETRY_FIX_ACTIVATED_DEFINITION_VERIFIED.
Applied committed SQL from e8d7f0f513d6a851233d2321d37b3fbcc27896f3, SHA256 c4843ec9ef21af94338fd9e4683831e3a944362db0454fb62e9bd5beffc64c3b.
Migration execution returned success. A transaction guard required predecessor definition MD5 4aebeec71732d7365cfda3fffc172ca5. Post-checks verified body MD5 and unchanged ACL.
Installed definition MD5: c8d7a2d9d425a7121ff41ffac3c1897e.
Installed body MD5: 0a4f18ee522f45c12796bedb5bb21a3b (matches tested committed body).
Owner postgres, SECURITY DEFINER and search_path public, pg_catalog retained. Existing postgres/anon/authenticated/service_role execute ACL retained, no PUBLIC execute grant.
Canonical unmaterialized follow-up queue: 1 before/after; fingerprint c992fb49b8ee76298c339a3bd8579426 unchanged.
No live request/materialization or business smoke performed; verification is installation parity plus the 60-step isolated behavioral suite.
Candidate CI completed successfully: https://github.com/dawaapharmacy29-create/dawaa-pharmacy/actions/runs/39227785739 (1047 custom checks; 1318 Vitest plus 1 existing skip in each timezone; TypeScript/build/performance/lint passed).
No Vercel deploy, main merge, historical repair, or new project in this activation.
Earlier pending-status paragraphs above record the pre-approval state and are superseded by this activation entry.
