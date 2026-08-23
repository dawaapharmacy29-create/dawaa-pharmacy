# Dawaa Management — Target Architecture

This document is the architectural contract for the management application. New work must reduce legacy paths and must not introduce parallel sources of truth.

Detailed employee-performance rules live in `docs/EMPLOYEE_DOMAIN_ARCHITECTURE.md`.

## 1. Dependency direction

Allowed direction:

`Page / Component -> Hook / Domain Service -> Read Model / Repository Boundary -> Supabase`

Pages and components must not know physical database tables for shared domains such as invoices, staff identity, employee transactions, or attendance.

Business/domain services may compose multiple read models, but must not silently create alternative data sources.

## 2. Sales and invoices

### Transactional truth

`sales_invoices` is the transactional/write truth for import, deduplication, corrections, and single-record integrity operations.

### Analytics truth

`dawaa_sales_invoices_dashboard_v1` is the analytics/read projection for dashboards, KPIs, and broad sales analysis.

### Approved boundaries

- `invoiceImporter` — transactional writes/import.
- `customerInvoiceReadModel` — customer invoice history during migration.
- `invoiceRecordReadModel` — one transactional invoice by id.
- `invoiceDataHealthReadModel` — invoice data-quality checks.
- canonical analytics sales reader — dashboard/analytics datasets.

No feature UI should query `sales_invoices` directly.

## 3. Customer domain

Target flow:

`Customer UI -> customer profile/service -> customer invoice read model + customer/followup repositories`

Customer identity matching rules must exist in one boundary. Do not duplicate code/phone/name matching in multiple services.

`customerProfileService` should become an orchestrator: profile + metrics + followups + recommendations. It should not own Supabase invoice schema detection or fallback scans.

## 4. Staff / employee identity

Canonical employee record: `staff`.

Authentication/account data: `staff_accounts` through safe account APIs/RPCs.

Aliases are compatibility/identity metadata, not independent employees.

Target flow:

`Staff UI -> staff hooks/domain services -> staffDirectoryReadModel / staff record repositories -> Supabase`

`staffDirectoryReadModel` owns the merge of canonical staff records, safe account directory data, and active aliases.

Rules:

- `staff.id` is the preferred canonical employee identifier.
- New employee-domain records must persist canonical `staff_id`.
- Account ids/usernames are login identifiers, not replacements for canonical staff ids.
- Name-only matching is permitted only as migration compatibility when no unambiguous canonical id exists.
- UI must not query the physical `staff` table directly.
- Sales branch comes from the invoice transaction; an employee home branch must never reassign a cross-branch sale.

## 5. Employee performance domain

Canonical pipeline:

`Employee Identity`
`-> Domain Evidence / Events`
`-> Points / Attendance / Tasks / Evaluation projections`
`-> Incentive settlement`
`-> Payroll projection`

### Points and employee events

`employee_transactions` is the canonical employee point/money event ledger for records that affect performance/payroll history.

- points and money are separate dimensions;
- approved records affect settled projections;
- pending records are visible but not payable;
- new records must use canonical `staff_id` and stable source metadata;
- UI must not rebuild final totals directly from the raw table.

### Evaluations

`manager_weekly_evaluations` is the canonical approved weekly evaluation record for managers/service leadership.

Evaluation metrics consume domain evidence; evaluation UI must not independently re-query all source tables.

Version fallback chains such as `v5 -> v4 -> v3 -> v2 -> legacy` are transitional compatibility debt and must eventually be isolated behind one canonical evaluation metrics boundary.

### Incentives and payroll

Performance incentive and target achievement are separate financial components.

Settled automated incentives flow through `employee_transactions`, and `staff_payroll_incentive_truth_v1` is the current canonical automated-incentive payroll projection.

Live estimates must never be treated as final payroll truth.

### Attendance

Schedule and attendance relationships use canonical `staff_id`.

Target flow:

`shift schedule + attendance events -> attendance projection -> current presence / monthly attendance / evaluation evidence`

A failed attendance read must never silently mean absence or zero attendance.

### Tasks

Task definition/cadence, expected assignment, completion evidence, and evaluation contribution are distinct concepts.

Task completion contributes to evaluation only through the canonical evaluation metrics projection. Historical task aliases belong in one compatibility boundary, not individual pages.

## 6. Staff detail / performance profile

`staffDetailLoader` and `staffPerformanceProfileService` are transitional orchestration debt.

Target structure:

`Staff Detail / Performance UI`
`-> Employee Identity`
`-> Sales Projection`
`-> Points/Incentive Projection`
`-> Evaluation Projection`
`-> Attendance/Schedule Projection`
`-> Task Completion Projection`
`-> Inventory / Customer / Conversation projections`

Orchestrators combine section results, freshness, and health states only. They must not contain unrelated shared-table queries or independent identity algorithms.

## 7. Accounts and permissions

`src/lib/core/permissionSystem.ts` is the permission source of truth.

New permission keys must use `snake_case`.

Existing dot-notation keys are migration-only legacy debt tracked by the architecture gate. The register must shrink as permission data and consumers are migrated.

Permission checks must use the central permission system rather than page-specific role conditions whenever possible.

## 8. Routes

Current `App.tsx` route definitions are transitional centralized routing debt.

Target: a typed route registry containing, for each route:

- path;
- page loader/component;
- page label;
- required permission(s);
- protection level.

Until migration is complete, CI rejects duplicate literal route paths.

A route must not have an independent permission definition that can drift from its runtime guard.

## 9. Data freshness and caching

Every read is classified as:

- `live` — operational/current data, short stale time, refetch on reconnect;
- `standard` — normal application data, moderate stale time;
- `historical` — immutable/old periods, longer cache.

Do not add page-specific cache/fallback behavior unless there is a measured reason.

A failed read must not silently become a valid-looking `0` or `[]` when the distinction between empty and unavailable matters.

## 10. Database reproducibility

Production database behavior must be reproducible from repository migrations.

Documentation-only migrations that describe functions/triggers applied manually to the live database are transitional debt. Live-only behavior must be captured in real idempotent migrations before those documentation markers are retired.

## 11. Fallback policy

A fallback is allowed only when all are true:

1. primary source and failure condition are explicit;
2. fallback result is observable/diagnosable;
3. parity or regression coverage exists;
4. an owner/removal condition is documented.

Never implement chains like:

`new source -> old source -> direct table -> local cached workaround`.

## 12. Migration rule

Every architectural migration must do at least one of:

- remove a direct database reader;
- remove a duplicate matching/calculation path;
- reduce a legacy debt register;
- consolidate a permission/route/data-source definition;
- add a regression guard that prevents the old pattern from returning.

A migration that only adds another wrapper while leaving all previous paths active is not complete.

## 13. CI architecture gates

`check-data-access-boundaries.cjs` currently enforces:

- no new direct `sales_invoices` readers outside approved boundaries;
- legacy invoice reader list must shrink, not become stale;
- no new direct `staff` reads from UI pages/components;
- legacy direct staff UI list must shrink;
- no new UI direct reads from `employee_transactions`;
- no new UI direct reads from `attendance`;
- employee-ledger and attendance UI debt registers must shrink;
- no duplicate literal route paths;
- no new dot-notation permission keys;
- legacy permission-key register must shrink when keys are migrated.

These gates should become stricter as migration debt is removed.
