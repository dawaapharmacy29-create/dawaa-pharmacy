# Staff alias atomic ownership — local verification, 2026-10-25

Continuation of PR #556, branch `fix/staff-identity-fail-closed-20261025`,
confirmed starting SHA `117ffd38b3fce0e6c37e46498565d35c028f179b`.
The checkout initially had detached HEAD `6b4af66b`; the requested branch was
fetched and checked out without resetting files. Untracked `.claude/` was preserved.

## Architect and planner passes

`staff.id` remains person identity. Accounts authorize callers; aliases are
compatibility metadata. The existing `staffIdentityMapping` boundary resolves
invoice imports and WhatsApp names; `staffDirectoryReadModel` composes aliases
for directory consumers. Attendance uses canonical staff IDs. Monthly evaluation
consumes domain evidence and canonical sales projections.

Root cause: browser preflight reads and INSERT are separate transactions.
Two writers can both observe no active alias and commit different owners.
The committed staging schema supplies alias table shape and RLS, but does not
provide atomic normalized-name ownership. A subsequent Production **catalog-only,
read-only transaction** confirmed the live columns, indexes, policies, grants,
default-filling trigger and identity helper definitions. No business rows were
read and no Production DDL/DML was executed.

Smallest change: one migration, central service permission checks, regression
fixtures, and a local PostgreSQL test runner. Non-goals: identity merges,
historical attribution/backfills, branch-scoped name inference, a reassignment
UI/RPC, payroll recalculation, deployment, and PR merge.

## Implementation and review passes

- An immutable SQL normalizer matches the existing TypeScript normalizer.
  PostgreSQL POSIX longest-match behavior differs from JavaScript first-match
  alternation; parity tests preserve the existing prefix behavior deliberately.
  The earlier Unified Core note overstated the raw-label folding of `د/ اسلام`
  and `دكتور اسلام`; the runtime clarification is recorded there. Stored legacy
  keys must be reviewed independently, never rewritten from that assumption.
- A unique expression index arbitrates active aliases across INSERT, UPDATE,
  reactivation and independent concurrent transactions. The key is global because
  current readers do not scope aliases by branch/source/date. NULL active retains
  the database readers' existing `coalesce(active,true)` semantics.
- Migration preflight rejects stale active normalized keys, missing identity,
  empty keys and duplicate active ownership. It does not repair/delete evidence
  or select a winner. Deployment requires explicit review of any existing conflict.
- The trigger rejects identity/provenance reassignment and deletion, computes
  normalized keys server-side, validates/locks an active target staff row, binds
  creation actor to the verified caller, and writes old/new records to a protected
  append-only audit table in the same transaction.
- Existing triggers/policies are not disabled or removed. A restrictive RLS policy
  and trigger authorization constrain legacy permissive policies and privileged
  RPC paths. Server/migration/service-role contexts retain their trusted authority.
- Production has unrestricted authenticated INSERT/UPDATE policies, anon SELECT,
  and legacy ALL table grants including TRUNCATE. The migration removes client
  ALL grants, grants only SELECT/INSERT/UPDATE, and adds explicit session-read and
  manager-write policies for both client roles. Existing permissive policies
  cannot bypass the restrictive policy or authorization trigger. TRUNCATE does
  not obey row RLS/triggers, so revoking it is required.
- The guard trigger sorts after the observed
  `trg_staff_identity_aliases_fill_defaults`, normalizing/auditing the final defaults.
  The existing SQL normalizer differs from JavaScript. Existing rows are never
  rewritten to reconcile these algorithms. The alias table has no staff FK;
  new writes validate and lock the canonical staff row instead.
- `createStaffAlias` and `confirmStaffAlias` check canonical
  `manage_staff_accounts` before access. No new alias management UI exists in this
  change; any future UI still needs its own central permission guard.

Security review: anon and authenticated need a verified active session; expired,
revoked and archived-account tokens fail closed. Caller IDs are never trusted.
The observed strict identity helper retains Supabase-auth compatibility paths;
for these sensitive writes its actor must also equal the existing opaque-session
verifier's result. A compatibility identity alone cannot authorize an alias mutation.
Audit access is revoked from clients and RLS is enabled. Trigger execution is
revoked as an RPC; its fixed search path and qualified relations are explicit.
Failed writes roll back audit rows together with the alias. Unauthorized UPDATE
can legitimately affect zero rows under RLS; tests verify persisted state.

Performance review: one expression index over alias metadata; writes take a
single primary-key staff row lock and append one audit row. No invoice, ledger,
attendance or conversation scans were introduced. Existing client preflights
remain bounded at 1000 aliases and one staff row. Index build and metadata
preflight scan the alias table once and take DDL locks; plan any eventual rollout
accordingly. No new cache/freshness behavior or asynchronous read was added.

## Environment and reproduction

Windows: Git `2.54.0.windows.1`, Node `22.23.0`, npm `10.9.2`, Docker client/server
`29.8.1`, Supabase CLI `2.105.0`. Docker Desktop was initially stopped and started
successfully. Supabase telemetry needed filesystem access outside the sandbox.

The official local CLI workflow was used:
https://supabase.com/docs/guides/local-development/cli/getting-started

1. `supabase init --workdir .local/employee-core`
2. In the generated config, use project ID `employee-core` and ports
   API 55321, database 55322, shadow 55320, Studio 55323, Mailpit 55324,
   analytics 55327, pooler 55329. Check other enabled service ports if configured.
3. `supabase start --workdir .local/employee-core`
4. `node scripts/test-staff-alias-atomic-local.mjs`
5. `node scripts/test-staff-alias-atomic-local.mjs --legacy-catalog`

No hosted project was created/linked. `.local/` is ignored. The existing
`dawaa-pharmacy` local stack was preserved. The CLI's container exclusion flag
did not honor the listed names in this installed version; the full isolated stack
was started after moving analytics off the occupied default port.

The runner hardcodes `supabase_db_employee-core`, creates a new synthetic database
per run, and retains it for inspection. It accepts no hosted URL. It imports the
committed staging alias DDL/RLS and the actual token-hash session verifier.
The legacy mode additionally loads catalog-derived indexes, defaults and permissive
client policies; `is_app_admin` is represented as false (none of these test callers
is an app admin), not a replay of its dependencies.
Staff/account tables and the strict-session wrapper are minimal
fixtures; permission evaluation intentionally uses explicit grants only, not the
complete production role/page/default-grant composition. Architecture gates cover
the central permission boundary; these tests are not a full Production schema replay.

The supplied Islam names are synthetic scenario labels with invented UUIDs, not
claims about or repairs to real employee records. Similar names remain distinct
people; the index rejects conflicting alias claims rather than merging staff.

## Cross-domain impact

| Domain | Reviewed impact |
| --- | --- |
| Sales import | Still resolves through `resolveStaffNameToStaffId`; no change to importer invoice branch, deduplication, amounts or historical rows. Automatic alias creation now requires management permission. |
| WhatsApp | Same resolution boundary; 2 fixture rows now explicitly mark `is_active=true` to match the previous fail-closed fix. No resolver weakening. |
| Attendance | No attendance writer/projection changes. Staff ID and alias ownership survive branch transfer. Existing attendance identity and authorization gates remain required. |
| Monthly evaluation/payroll | No settlement, points, salary or historical recalculation. Existing sales attribution and evidence semantics remain. A future approved alias can influence existing name-only compatibility reads; rollout therefore needs explicit identity review and financial parity. |

## Verification results

| Check | Result / evidence |
| --- | --- |
| Synthetic PostgreSQL, staging policies | PASS: 31 check groups plus completion marker; [database.txt](evidence/staff-alias-20261025/database.txt) |
| Synthetic PostgreSQL, observed legacy policies/default trigger/indexes | PASS: 31 check groups plus completion marker; [database-legacy-catalog.txt](evidence/staff-alias-20261025/database-legacy-catalog.txt) |
| Identity service + WhatsApp resolver | PASS: 16 tests; [targeted.txt](evidence/staff-alias-20261025/targeted.txt) |
| Initial full verification | FAIL in UTC: 5-second timeout and product resolution 66.10ms/call against 50ms threshold while independent typecheck/build ran concurrently. No assertions/thresholds were weakened. |
| Isolated UTC retry of those two files | PASS: 44 tests; resolution 17.57ms/call; [utc-retry.txt](evidence/staff-alias-20261025/utc-retry.txt) |
| Architecture / security review gates | PASS: data-access, permissions, DB authorization, verified session, attendance identity, payroll, incentive governance, task evidence, notifications, final evaluation |
| Independent TypeScript and production build | PASS; build completed in 2m46s |
| Runtime bundle budget | PASS: initial static JavaScript 202.6 KiB gzip, heavy tools lazy |
| Final `npm run verify` | **PASS, exit 0**: doctor, 1070 core tests, Cairo/UTC regression, TypeScript, prebuild architecture/security gates, production build and performance budget; [verification.txt](evidence/staff-alias-20261025/verification.txt) |

The full verification was then rerun without a concurrent independent build or
typecheck. Its Cairo and UTC regression rounds each passed 1714 tests, with one
live integration test skipped. The full command finished successfully. The newly
added identity suites now run automatically in both timezone regression rounds.

One initial WhatsApp test failed because its old active-staff fixture omitted
`is_active`; correcting the fixture restored 16/16 targeted tests. An initial
database test expected an error from a policy-filtered UPDATE; the final test
correctly checks zero persisted changes. The normalization parity test exposed
and prevented the SQL/JavaScript prefix mismatch before commit.

## Remaining risk and reversal

This is a local-tested draft migration, not a deployed Unified Core completion.
Production permission composition, full business flows with historical data,
and production conflict inventory remain unverified. Catalog metadata was checked
read-only; the legacy default trigger/policy fixture is exercised locally.
The migration intentionally blocks rollout on stale/conflicting metadata.
No historical record should be rewritten to make that gate pass.

Before deployment, reversal is a Git revert. After an explicitly approved future
deployment, revert client code if necessary while retaining the unique index,
authorization and audit evidence; any database rollback must be separately
reviewed. Never drop the audit table or remove uniqueness to resolve a conflict.
