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
