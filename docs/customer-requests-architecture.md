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

## UI migration plan

1. Domain extraction (this phase).
2. Repository/query extraction from `CustomerRequests.tsx`.
3. Workspace state hook and URL/filter orchestration.
4. Replace dashboard-heavy layout with operational inbox + compact queues + execution table.
5. Move details to lazy drawer and keep one primary action per workflow state.
6. Replace long create form with customer -> product -> confirmation flow.
7. Remove obsolete duplicate helpers after all callers move to the feature domain.

## Non-negotiable rules

- No new branch/status/SLA mapping inside page components.
- No incentive point constants inside Customer Requests.
- No manual customer/product name as the primary relationship when an existing record can be selected.
- Summary failure must never prevent the execution list from loading.
- Analytics/export must consume the same canonical filters and domain definitions as the execution workspace.
