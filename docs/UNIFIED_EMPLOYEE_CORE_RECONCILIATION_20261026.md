# Unified Employee Core — continuation review, 2026-10-26

This review continues PR #556. Starting local/remote HEAD was
`c9e903ded2ecaa3360635487e85fd3edd09a7ae0`, following `e89dd1db`.
The working tree had no tracked changes. `.claude/` and
`staff-core-unfinished.patch` were preserved and excluded from this change.

## Confirmed previous work

The intervening commit contains a Claude co-author trailer and changes 17 files.
It includes the already-reviewed shared name decision, strict directory reads,
WhatsApp consolidation, audit AFTER trigger, append-only audit guards and
alias-only purchase RPC. The React Query callback wrapper and generated refresh
transport were already present. Git establishes the commit/co-author metadata,
not exclusive line-by-line authorship; earlier work in this chat overlaps it.

## Architect / planner passes

Canonical employee identity remains `staff.id`. Live name resolution uses
`staffIdentityMapping -> resolveStaffDirectoryName -> staffDirectoryReadModel`.
Stored transaction IDs remain authoritative for historical records. Account IDs,
usernames, branch hints and display names cannot manufacture a missing employee.

The remaining repair surface was the importer caller and older navigation/seller
wrappers. Non-goals: Production writes, historical reconciliation, new identity
systems, payroll recalculation, deployment or merge.

## Confirmed problems and changes

1. Quality Gate's separate invoice-importer suite failed because its old Supabase
   mock omitted `isSupabaseConfigured`. The fixture now supplies independent staff
   and alias responses. The importer suite is included in the timezone regression
   gate, so `npm run verify` also exercises it.
2. The importer bypassed a declined canonical identity decision with direct staff
   name/branch queries. Those duplicate readers were removed. Ambiguous new sales
   stay unlinked and an unavailable identity directory aborts before invoice writes.
3. Re-import updates could clear or replace recorded `staff_id` from a current
   name lookup. Existing-invoice UPDATE payloads now omit that column entirely,
   preserving even an attribution approved concurrently. Invoice fact/value
   correction remains available, including downward corrections.
4. Live seller/profile wrappers retained completed name decisions indefinitely,
   accepted account display-name matching after ambiguity, and could expose an
   orphan account's linked ID as a canonical person. They now use the shared
   complete decision, retain only in-flight sharing, and require a canonical staff
   record for account links. Explicit archived staff IDs still open historical
   profiles; archived names cannot receive new live attribution.
5. Import identity resolution loads one complete directory per batch, instead of
   three source requests per distinct seller. No completed identity cache is added.
6. Two existing architecture gates compared native Windows paths with slash-based
   canonical paths/baselines. Only path separators were normalized. No whitelist,
   threshold, authorization predicate or baseline entry was relaxed.
7. Two files assert wall-clock performance/cold-load deadlines. They now run in a
   separate single-worker phase in each timezone, rather than competing with the
   parallel database/catalog suites. All tests and original thresholds/deadlines
   remain enforced, and any phase failure still fails the gate.

The generated refresh transport was checked, then regenerated after the new
resolver changes. Existing hook and migration fixes were retained.

## Reviewer / security / performance passes

- New inserts retain the source invoice branch, amount and deduplication identity;
  ambiguity cannot cause a home-branch reassignment.
- Historical IDs are preserved by omission from UPDATE, rather than copying an
  older read back over a newer database attribution.
- No permissions, RLS or payroll/ledger mutation boundary was widened in this
  continuation. Verified-session, alias uniqueness and audit guards remain in the
  earlier non-deployed migration and were retested on synthetic local databases.
- Live lookup failures are retriable; they do not become cached absence/uniqueness.
- Directory queries remain bounded to the established staff/alias limits and safe
  account RPC. No new high-volume table scan or per-employee query was introduced.
- Attendance accepted-evidence rules, cycle boundaries, settled payroll and
  monthly ID-only sales evidence retain their existing boundaries and tests.

Production findings and management decisions belong in a separate private review;
no raw Production export or private security report is committed here.

## Verification

| Check | Result |
| --- | --- |
| Core tests | 1070 passed, retained from the successful unchanged checkpoint |
| Cairo | 1739 regression + 44 isolated timing tests passed; 1 live integration test skipped |
| Resumed UTC | 1739 regression + 44 isolated timing tests passed; 1 live integration test skipped |
| Targeted identity/import/attendance/cycle suites | 95 passed across 9 files |
| Local PostgreSQL, staging and legacy-catalog fixtures | Both passed, 39 check groups plus completion marker each |
| Additional Quality Gate scripts outside `npm run verify` | 25 passed |
| Repository semantic lint, matching CI options | Passed, 0 errors |
| Resumed TypeScript / prebuild / production build / performance budget | Passed; resume command exit 0; initial JS 202.6 KiB gzip |
| Generated refresh transport and diff checks | Passed |

The former single-process verification was deliberately interrupted during UTC
when another assistant was running verification concurrently. It is not claimed
as a successful uninterrupted `npm run verify` invocation. The completed core and
Cairo results were retained; both UTC phases and all remaining verification steps
were resumed successfully on the unchanged source. GitHub CI runs the complete
sequence again on the resulting commit; consult PR checks for that separate result.

An earlier parallel run failed the original 50ms product-resolution assertion at
50.714ms and the default 5s module-load timeout. The isolated timing phase passed
all 44 tests without changing thresholds or deadlines. PostgreSQL runs use only
the existing isolated `supabase_db_employee-core` container and synthetic
databases; they do not connect to a hosted project.

## Release / reversal

Keep PR #556 Draft. Code review readiness does not approve a Production migration.
Existing alias conflicts/stale keys must be reviewed independently, and the
migration deliberately refuses to guess a repair. Revert this continuation commit
to reverse its application changes; do not remove earlier uniqueness/audit guards
or erase audit history to bypass a data conflict.
