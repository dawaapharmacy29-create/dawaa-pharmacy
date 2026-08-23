# Customer Requests Incentive Audit — Approved Policy

## Verified architecture

- Canonical employee identity is `staff.id`.
- `staff_incentive_tiers` is the current source of doctor tier assignment.
- Current tier keys used by the system are `senior_doctor`, `mid_doctor`, and `assistant`.
- `employee_transactions` is the canonical approved employee points ledger.
- Customer Request points are performance points only; `amount` remains zero and cash settlement stays in the central incentive/payroll domain.

## Approved Customer Request point schedule

Policy: `customer_requests_doctor_points`
Version: `2026-08-24-v1`

| Doctor category | Current tier key | Valid request registration | Request achievement |
|---|---|---:|---:|
| First category | `senior_doctor` | 2 | 4 |
| Second category | `mid_doctor` | 1 | 2 |
| Third category | `assistant` | 0.5 | 1 |

These are event points, not Egyptian-pound conversion rates. They must not be derived from `point_rate_egp`.

## Canonical point events

Only two Customer Request events award this policy:

- `request_registered`: a valid request has been registered by the doctor.
- `request_achieved`: the request first reaches a fulfilled state.

A request is considered achieved when it first enters one of the states already used by the Customer Requests fulfillment KPI:

- `available`
- `arrived`
- `customer_contacted`
- `delivered`
- `closed`

The achievement event is paid once only. `cancelled` and `not_available` do not qualify for achievement points.

## Attribution

Both registration and achievement points belong to the canonical doctor who owns the registered request. Attribution requires a real `staff.id`; name-only matching is not allowed for new settlements.

Migration compatibility may resolve `created_by` through `staff_accounts.staff_id`, but the resulting settlement still stores the canonical staff id.

## Eligibility gates

No points are settled until the request has:

- canonical customer id;
- customer code;
- product name;
- product code;
- canonical doctor/staff id;
- a valid current tier in `staff_incentive_tiers`;
- no unresolved sync conflict;
- no duplicate/invalid marker.

If product/customer/doctor identity is repaired after creation, settlement retries automatically and idempotently.

## Anti-duplication contract

The event ledger uses the unique identity:

`request_id + event_key + staff_id + policy_version`

The linked `employee_transactions` entry also has a unique source/source-id guard for Customer Request incentive events. Repeated status changes, migration reruns, or later identity repairs therefore cannot double-credit the same event.

## Production implementation

The production database now contains:

- `customer_request_incentive_policy`
- `customer_request_incentive_events`
- idempotent registration/achievement settlement functions and trigger
- retry settlement when canonical identity fields are repaired
- `customer_request_doctor_points_summary_v1` for doctor/cycle reporting

The policy is effective from 2026-08-24 00:00 Africa/Cairo. Requests before the effective policy are not silently back-awarded by this migration.

## UI/read-model rule

Pages do not recalculate these values independently. Doctor profiles, monthly performance views, and Customer Requests analytics should consume the canonical event/transaction projection so registration points, achievement points, and totals stay identical everywhere.
