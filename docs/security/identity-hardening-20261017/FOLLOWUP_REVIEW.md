# Follow-up security review — 2026-10-17

This file records the corrective review performed after checkpoint `363dd003569777ef66b0f4346c23191ded2a3f5b`.

## Corrections made on the private security branch

1. **RLS partial-state guard fixed (`090100`).**
   - The original subset test could accept a partial set of the 15 reviewed policies.
   - The migration now requires every reviewed policy to match an exact captured PRE or exact expected POST metadata hash.
   - Hash input covers command, permissive mode, sorted roles, table RLS flag, FORCE RLS flag, USING, and WITH CHECK.
   - All 15 must be wholly PRE or wholly POST; a mixed state aborts.
   - Any additional policy anywhere that reads `x-dawaa-user-id` or raw `request.headers` aborts.

2. **Default-function privilege root cause addressed (`090700`).**
   - Production read-only catalog review confirmed the managed SQL executor is `postgres` and is not a member of `supabase_admin`.
   - All non-extension public functions are postgres-owned.
   - The 31 `supabase_admin`-owned public functions are `pg_trgm` extension members and none is SECURITY DEFINER.
   - The candidate therefore changes only `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public`.
   - PUBLIC/anon/authenticated lose implicit EXECUTE for future postgres-created public functions; service_role remains explicit.
   - It never requests superuser, membership, or `SET ROLE supabase_admin`.

3. **Live catalog contract expanded.**
   - Exact hardened metadata for the 15 direct RLS policies.
   - Default ACL check for postgres/public/functions.
   - Ownership-boundary checks for non-extension public functions and managed-role extension functions.

4. **Static repository gate expanded.**
   - Requires the default-ACL migration and the stronger RLS guards.
   - Rejects future default-ACL grants to browser roles.
   - Rejects repository attempts to alter `supabase_admin` default privileges.

## Read-only Production facts used

- PostgreSQL 17.6.
- `current_user = postgres`; `session_user = postgres`.
- `postgres` is not a member of `supabase_admin`.
- 1299 postgres-owned public functions.
- 31 supabase_admin-owned public functions; all 31 are pg_trgm extension members; 0 SECURITY DEFINER.
- No Production business data was changed by this review.

## Required before Production apply

- Re-run the isolated native PostgreSQL 17.6 rehearsal on the **updated 8-migration candidate**.
- Re-run the 58-case security suite and 150 legitimate differential calls.
- Verify the live contract returns zero violations on the fixed isolated clone, including the new R2M/R6/R7/R8 rules.
- Confirm apply → rollback → re-apply behavior for the updated package and a recovery path for the default-ACL change.
- Convert the legacy fresh-staging identity simulation from `x-dawaa-user-id` to verified session tokens before treating it as a security-compatible canonical runner.
- Fresh catalog/hash preflight immediately before any Production apply.
- Separate explicit user approval before any Production DB write, merge to main, or Production deployment.

**Current status: REVIEW CANDIDATE ONLY — Production is not fixed.**
