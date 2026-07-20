# Customer follow-up hardening

Work in progress on `agent/customer-followup-full-hardening`.

## Completed foundation

- Canonical customer identity helper.
- Egyptian mobile normalization and validation.
- Shared follow-up open/final/cancelled/archived/completed rules.
- Customer activity state classification.
- Requested-by resolver.
- Follow-up data-quality diagnostics.
- Unit-test discovery for all `src/**/*.test.ts(x)` files.

## Remaining before merge

- Wire shared helpers into workspace, API, queue, export and import.
- Separate open queue from completed history.
- Remove source-mutating repair script from package scripts and delete it.
- Add pagination/full exports.
- Add database idempotency and duplicate diagnostics.
- Run full CI and verify immutable builds.
