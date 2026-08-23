# Task Evidence Architecture

## Goal

Unify how operational work contributes evidence to employee performance without forcing every workflow into one generic task table.

The canonical pipeline is:

`Domain workflow -> Task Evidence -> Task Completion Projection -> Evaluation Metrics -> Approved Evaluation -> Settlement -> Payroll`

Task evidence is operational evidence. It is **not** points, incentive money, payroll, or notification truth.

## Domain ownership

Existing domains keep their own workflow state and tables, including:

- `tasks`
- `shift_notes`
- `daily_followups`
- `manager_daily_checklist`
- `branch_cleaning_tasks`
- `shelf_tasks`
- `customer_requests`

A domain adapter may expose expected/completed/cancelled work as the canonical `TaskEvidence` envelope. This prevents evaluation/profile code from independently interpreting every source table.

## Required identity

Every new evidence record requires:

- canonical `subjectStaffId` (`staff.id`)
- stable `sourceType`
- stable `sourceId`
- stable `taskKey`
- branch context
- explicit status
- event time

Employee names may be display/audit fields in source domains, but they are not valid relationship keys for new evidence.

## Lifecycle

Canonical task-evidence statuses are:

- `expected`
- `assigned`
- `accepted`
- `completed`
- `missed`
- `cancelled`

Completion requires `completedAt`.
Cancellation requires a documented `cancellationReason`.

A task can have richer source-specific states; the adapter maps them into this operational evidence lifecycle without deleting source detail.

## Separation from financial effects

Task Evidence must never contain or settle:

- employee point balance
- `points_delta`
- incentive amount
- payroll amount
- salary deduction

The evidence is consumed by the Evaluation Metrics Projection. Only an approved, auditable settlement layer may create employee point/money movements.

This prevents Cleaning, Shift Notes, Customer Follow-up, or any future task UI from independently changing an employee's points or payroll.

## Notifications

Notifications are downstream delivery effects only:

`Assignment/due/missed event -> audience resolved by domain permission/scope -> notification`

A notification does not own assignment, authorization, completion, or evaluation state.

## Migration approach

1. Introduce the shared evidence contract with no database mutation.
2. Add read adapters one domain at a time.
3. Add parity tests between each source domain and its evidence adapter.
4. Build a Task Completion Projection over evidence.
5. Move evaluation metrics to that projection.
6. Only after parity, delete duplicated task interpretation from employee/profile/evaluation pages.

## Non-negotiable rules

- Do not replace all operational domains with a giant generic task table.
- New task-like evidence must use canonical `staff.id`.
- A feature page must not turn task completion directly into points or money.
- A failed evidence source is `unavailable`, not equivalent to `missed` or zero performance.
- Historical name/task-key aliases belong in one compatibility adapter only.
- Evaluation and payroll consume projections/settlement truth, not cross-feature UI joins.
