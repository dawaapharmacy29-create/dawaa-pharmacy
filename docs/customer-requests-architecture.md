# Customer Requests Architecture

## Goal

Turn Customer Requests from a monolithic page into a feature with one canonical domain model shared by UI, filters, exports, analytics, integrations, and incentives.

## Source of truth

- `customer_requests`: current request state and stable links to customer, product, branch, registrar, assignee.
- `customer_request_events`: immutable history of completed actions.
- Follow-up/task scheduling will be separated from historical events in a later migration.
- External payloads such as Base44 remain integration data and must be normalized before operational use.

## Feature boundaries

`src/features/customer-requests/domain` owns:

- canonical branch identity and aliases;
- workflow status normalization;
- operational stages and primary action;
- SLA, urgency, overdue logic;
- customer/product/registrar identity quality;
- operational queue membership;
- incentive attribution eligibility (not point values).

`src/features/customer-requests/data` owns:

- request list query contract;
- summary query contract;
- exact deep-link filters;
- paging and branch normalization at the data boundary;
- customer-segment enrichment required by the workspace.

`src/features/customer-requests/hooks` owns workspace orchestration, not business rules.

`src/features/customer-requests/workspace` owns the new operational presentation layer.

Point values are deliberately outside this feature and must be resolved by the central incentive rules engine.

## Integration contracts

### Customers

Prefer `customer_id` as the stable relationship. `customer_code`, name, and phone are display/snapshot fields and must not replace the relationship when an ID is available.

### Products

Prefer `product_id` and `product_code`. Product name remains a snapshot/display value. Imported requests without product linkage belong to a data-quality queue until resolved.

### Branches

Operational code uses canonical keys (`shokry`, `elshamy`). Source aliases such as `فرع شكري`, `دواء شكري`, and `شكري` normalize at the boundary.

### Shortages / sourcing

A request remains the customer-facing origin. Linking to shortages or sourcing must retain the request ID and must not duplicate customer/product identity as a new independent truth.

### Incentives

Customer Requests emits auditable event attribution. Eligibility requires a valid customer, product, registrar, and no unresolved sync/duplicate conflict. Actual points are calculated by the central incentive rules layer.

## Repository migration

The command-center query implementation has moved to:

`src/features/customer-requests/data/customerRequestsRepository.ts`

The old `src/lib/api/customerRequestsCommandCenter.ts` is now a compatibility bridge that re-exports the feature repository. Existing production callers therefore keep working while the migration proceeds.

Deep-link filters such as `customerId`, `customerCode` and `productCode` remain exact; they do not fall back to fuzzy search.

## Workspace orchestration

`useCustomerRequestsWorkspace` owns:

- filters;
- paging;
- list load/error state;
- summary load/error state;
- stale-request protection;
- selected request state;
- refresh coordination.

List and summary loading are deliberately independent. A summary/RPC failure must not take down the operational request list.

## New operational workspace

A new workspace shell now exists in parallel with the legacy page. Its intended model is:

- compact header and search;
- canonical branch filter;
- small operational queue strip;
- table-first execution view;
- side panel for the selected request;
- one clearly visible primary action from the canonical workflow.

This workspace is not yet the production route in this phase. Route replacement should happen only after parity for create/update/contact/timeline actions is complete enough to preserve daily operations.

## UI migration plan

1. Domain extraction. ✅
2. Repository/query extraction from the legacy command center. ✅
3. Workspace state hook and independent list/summary failure handling. ✅
4. Operational workspace shell + table-first presentation. ✅
5. Wire production route to the new workspace behind a safe compatibility/fallback boundary.
6. Replace long create form with customer -> product -> confirmation flow.
7. Extract details/timeline/contact/sourcing commands from the monolithic page.
8. Add duplicate prevention and Base44 source adapter.
9. Connect shortages/product fulfillment metrics.
10. Connect incentive attribution to the central incentive engine.
11. Remove obsolete legacy helpers only after production verification.

## Non-negotiable rules

- No new branch/status/SLA mapping inside page components.
- No incentive point constants inside Customer Requests.
- No manual customer/product name as the primary relationship when an existing record can be selected.
- Summary failure must never prevent the execution list from loading.
- Analytics/export must consume the same canonical filters and domain definitions as the execution workspace.
- Legacy code is removed only after its replacement is active, verified, and reversible during migration.
