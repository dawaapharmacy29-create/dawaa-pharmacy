# Dawaa Pharmacy — Agent Operating Contract

This repository is a production pharmacy-management system. AI coding agents must optimize for correctness, traceability, security, and regression resistance before speed of implementation.

## Mandatory workflow

For any non-trivial change, work in this order:

1. **Architect** — identify the canonical domain boundary, data source of truth, affected permissions/RLS, and regression surface.
2. **Planner** — define the smallest safe change, files to touch, tests/gates to run, and explicit non-goals.
3. **Implementer** — change only the approved path; do not add parallel fallbacks or duplicate calculations.
4. **Reviewer** — inspect the diff for stale data, hidden zero/empty fallbacks, duplicated identity logic, permission drift, and cross-domain side effects.
5. **Security reviewer** — verify UI permission, service authorization, RPC/database authorization, and RLS together.
6. **Performance reviewer** — inspect query bounds, selected columns, cache/freshness policy, N+1 behavior, and high-volume table scans.
7. **Verifier** — run the narrowest relevant targeted tests plus the repository gates before merge.

A single agent may perform multiple roles, but it must perform them as separate passes.

## Architectural contract

Read `docs/ARCHITECTURE_TARGET.md` and the relevant domain document before changing a shared domain.

Required dependency direction:

`Page / Component -> Hook / Domain Service -> Read Model / Repository Boundary -> Supabase`

Do not introduce a new direct shared-table query from UI code when an approved boundary exists.

### Canonical truths

- Invoice transactional/write truth: `sales_invoices` through approved importer/record boundaries.
- Sales analytics truth: `dawaa_sales_invoices_dashboard_v1` or the canonical analytics reader.
- Employee identity: `staff`; login/account identity remains separate.
- Permission source of truth: `src/lib/core/permissionSystem.ts`.
- Employee performance ledger: `employee_transactions` through canonical services/projections.
- Automated settled payroll projection: `staff_payroll_incentive_truth_v1`.

## Dawaa-specific invariants

Never break these rules:

- A downward invoice correction must be able to decrease customer totals. Never preserve stale highs with `Math.max(...)` or equivalent merge logic unless the metric is intentionally monotonic.
- Invoice identity/deduplication must preserve branch and transaction identity; never move a sale to an employee home branch.
- Performance incentive and target-achievement incentive are separate components.
- Failed reads must not silently become valid-looking `0`, `[]`, absence, or no-permission states when the distinction matters.
- Staff/account/name/alias matching must not be reimplemented inside feature pages.
- New permissions use canonical snake_case keys and central checks.
- Sensitive mutations require both application authorization and database/RLS authorization.
- Production database behavior must be reproducible from committed migrations.

## Query and performance rules

Before adding or changing a query, answer all of the following:

- Is the source canonical for this use case?
- Is the query bounded by date, branch, staff, status, pagination, or an explicit limit?
- Are only required columns selected?
- Is this `live`, `standard`, or `historical` data?
- Can an older request overwrite a newer request?
- Does a fallback hide an outage as empty data?
- Will the query remain safe after months of data growth?

Do not add large unfiltered reads to high-volume operational tables.

## Change-size rule

Prefer one architectural concern per PR. A migration is complete only when it removes/reduces a duplicate reader, duplicate calculation, compatibility path, or legacy debt, or adds a regression guard preventing the old pattern from returning.

Do not perform broad cleanup unrelated to the requested fix.

## Required verification

Use the narrowest relevant checks during implementation. Before merge, the expected repository verification is:

```bash
npm run verify
```

Important gates also include architecture, permissions, database authorization, incentives/payroll, attendance, tasks, notifications, typecheck, production build, and runtime performance budget through the existing Quality Gate workflow.

If the full gate cannot run because of an external platform quota, report that separately from code/test failures and still run all locally available deterministic checks.

## PR handoff

Every PR should state:

- problem and root cause;
- canonical source/boundary used;
- exact behavior change;
- security/permission impact;
- performance impact;
- tests/gates run and results;
- remaining risk or external blocker;
- rollback/reversal path when the change is high risk.

Never claim a deployment or gate passed unless it actually passed.