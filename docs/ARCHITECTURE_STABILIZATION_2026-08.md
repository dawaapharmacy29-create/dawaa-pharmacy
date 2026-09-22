# Dawaa Pharmacy Architecture Stabilization — August 2026

## Goal

Stabilize the administration application before further feature growth by reducing duplicate data paths, eliminating silent fallbacks, and moving each business domain toward one explicit source of truth.

## Findings from the initial repository audit

### 1. Data access boundaries are inconsistent

The repository already contains domain/data-access modules such as `src/lib/api/*`, `src/lib/sales/salesTruthService.ts`, `src/lib/dashboard/dashboardTruthService.ts`, and `src/lib/staffInvoiceTruthService.ts`, but several page components still import the raw Supabase client directly.

This means the application currently mixes two architectural styles:

1. UI -> domain/service -> Supabase
2. UI -> Supabase directly

That makes caching, retries, normalization, permissions, error handling, and source-of-truth decisions harder to keep consistent.

### 2. Repair scripts have accumulated into long chains

`package.json` contains repair commands that execute many sequential `apply-*` scripts. These scripts were useful for recovery and migrations, but continuing to add new runtime or build repair layers increases the chance of re-applying obsolete patches and makes the deployed state harder to reason about.

The stabilization work should migrate permanent fixes into canonical source files/migrations and then retire superseded repair scripts instead of appending new ones.

### 3. Production database configuration previously failed silently

`src/lib/supabase.ts` previously created a successful empty stub client whenever Supabase environment variables were missing. In production this could make pages render empty arrays or zero metrics instead of exposing the real configuration failure.

Phase 1 changes production behavior to fail fast when required Supabase configuration is missing. The development fallback remains available for local UI work.

### 4. Authentication identity is coupled to request metadata

The Supabase fetch wrapper adds `x-dawaa-user-id` using the stored Dawaa application user. This is part of the application authorization model and therefore the storage key must have one canonical definition. Phase 1 reuses `AUTH_STORAGE_KEY` from `appRecovery.ts` instead of redefining it inside the database client.

## Target architecture

For business-critical domains the preferred dependency direction is:

`Page / component -> domain hook or service -> canonical repository/truth service -> Supabase`

Pages should not decide table names, fallback tables, branch normalization, or truth calculations themselves.

## Stabilization sequence

### Phase 1 — bootstrap and configuration safety

- Production must never report empty/zero data because the database client is a silent stub.
- Shared authentication storage identifiers must have one definition.
- No changes to business calculations in this phase.

### Phase 2 — data-access boundary inventory

Inventory every direct Supabase access from `src/pages` and classify it by domain:

- invoices / sales
- customers / followups
- staff / accounts / permissions
- customer requests
- payroll / incentives
- purchases / returns / stock
- delivery

For each domain, pick the existing canonical service when one already exists. Do not create a second service for the same truth.

### Phase 3 — invoice and sales truth consolidation

Treat invoice/sales correctness as the highest-risk migration because dashboards, doctor performance, targets, customer analytics, and incentives depend on it.

- Route reads through the existing sales/invoice truth services.
- Remove page-level fallback calculations once parity is verified.
- Preserve branch and excluded-invoice rules in one place.
- Verify import idempotency and corrected-value updates.

### Phase 4 — customer truth consolidation

- Centralize customer identity and customer-code normalization.
- Centralize branch resolution.
- Prevent pages from independently deriving last purchase, totals, or activity state when canonical data already exists.
- Reduce repeated customer queries across dashboard/followup screens.

### Phase 5 — authentication/session singleton

`useAuth` currently maintains module-level state and each hook consumer installs its own effects. Migrate authentication to one provider/store lifecycle so account refresh, inactivity timeout, logout, and identity refresh happen once per application session.

This phase must be isolated because authentication regressions can block the entire application.

### Phase 6 — request/caching policy

Standardize query behavior with TanStack Query for read-heavy UI flows:

- shared query keys
- explicit stale times by domain
- deduplicated concurrent reads
- mutation-driven invalidation
- realtime only where operationally required

Avoid page-local refresh loops and ad-hoc cache layers when React Query already owns that state.

### Phase 7 — retire superseded patches

After canonical implementations are verified:

- classify `apply-*` and `repair-*` scripts as migration-only, active, or obsolete
- remove obsolete source-rewriting scripts
- keep database migrations immutable
- make `npm run verify` the release gate

## Migration rule

Do not perform a broad rewrite. Each phase should be a small PR with measurable parity checks. Prefer deleting an obsolete path after verification over preserving both old and new paths indefinitely.
