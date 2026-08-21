# Dawaa Management — Target Architecture

This document is the architectural contract for the management application. New work must reduce legacy paths and must not introduce parallel sources of truth.

## 1. Dependency direction

Allowed direction:

`Page / Component -> Hook / Domain Service -> Read Model / Repository Boundary -> Supabase`

Pages and components must not know physical database tables for shared domains such as invoices or staff identity.

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

## 4. Staff / employee domain

Canonical employee record: `staff`.

Authentication/account data: `staff_accounts` through safe account APIs/RPCs.

Aliases are compatibility/identity metadata, not independent employees.

Target flow:

`Staff UI -> staff hooks/domain services -> staffDirectoryReadModel / staff record repositories -> Supabase`

`staffDirectoryReadModel` owns the merge of canonical staff records, safe account directory data, and active aliases.

Rules:

- `staff.id` is the preferred canonical employee identifier.
- Account ids/usernames are login identifiers, not replacements for canonical staff ids.
- Name-only matching is permitted only when unambiguous; branch may be used only as a disambiguation hint.
- UI must not query the physical `staff` table directly.
- Sales branch comes from the invoice transaction; an employee home branch must never reassign a cross-branch sale.

## 5. Staff detail page

`staffDetailLoader` is transitional orchestration debt. Target structure:

`StaffDetail UI`

-> `staff profile service`

-> dedicated services/read models for:

- base staff record
- sales performance
- incentives
- attendance/schedule
- stagnant/incentive medicine performance
- customer followups
- conversation reviews

The staff detail orchestrator should only combine section results and health states. It should not contain unrelated table queries.

## 6. Accounts and permissions

`src/lib/core/permissionSystem.ts` is the permission source of truth.

New permission keys must use `snake_case`.

Existing dot-notation keys are migration-only legacy debt:

- `customer_welcome_messages.view`
- `customer_welcome_messages.create`
- `customer_welcome_messages.update`
- `employee_operating_system.view`
- `employee_operating_system.manage`

Do not add new dot-notation keys.

Permission checks must use the central permission system rather than page-specific role conditions whenever possible.

## 7. Routes

Current `App.tsx` route definitions are transitional centralized routing debt.

Target: a typed route registry containing, for each route:

- path
- page loader/component
- page label
- required permission(s)
- protection level

Until migration is complete, CI must reject duplicate literal route paths.

A route must not have an independent permission definition that can drift from its runtime guard.

## 8. Data freshness and caching

Every read is classified as:

- `live` — operational/current data, short stale time, refetch on reconnect.
- `standard` — normal application data, moderate stale time.
- `historical` — immutable/old periods, longer cache.

Do not add page-specific cache/fallback behavior unless there is a measured reason.

A failed read must not silently become a valid-looking `0` or `[]` when the distinction between "empty" and "unavailable" matters.

## 9. Fallback policy

A fallback is allowed only when all are true:

1. primary source and failure condition are explicit;
2. fallback result is observable/diagnosable;
3. parity or regression coverage exists;
4. an owner/removal condition is documented.

Never implement chains like:

`new source -> old source -> direct table -> local cached workaround`.

## 10. Migration rule

Every architectural migration must do at least one of:

- remove a direct database reader;
- remove a duplicate matching/calculation path;
- reduce the legacy debt register;
- consolidate a permission/route/data-source definition;
- add a regression guard that prevents the old pattern from returning.

A migration that only adds another wrapper while leaving all previous paths active is not complete.

## 11. CI architecture gates

`check-data-access-boundaries.cjs` currently enforces:

- no new direct `sales_invoices` readers outside approved boundaries;
- legacy invoice reader list must shrink, not become stale;
- no new direct `staff` reads from UI pages/components;
- legacy direct staff UI list must shrink;
- no duplicate literal route paths;
- no new dot-notation permission keys.

These gates should become stricter as migration debt is removed.
