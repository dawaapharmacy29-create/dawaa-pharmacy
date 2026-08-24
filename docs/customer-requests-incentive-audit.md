# Customer Requests Incentive Audit — Approved Policy

## Canonical policy

Policy: `customer_requests_doctor_points`
Version: `2026-08-24-v1`

| Doctor category | Current tier key | Valid request registration | Request achievement |
|---|---|---:|---:|
| First category | `senior_doctor` | 2 | 4 |
| Second category | `mid_doctor` | 1 | 2 |
| Third category | `assistant` | 0.5 | 1 |

These are Performance Points, not Egyptian-pound conversion rates.

## Canonical identities

- employee identity: `staff.id`
- doctor tier: `staff_incentive_tiers`
- final point ledger: `employee_transactions`
- request event audit: `customer_request_incentive_events`

`staff_accounts.id` is never accepted as `customer_requests.doctor_id` for new V2 requests.

## Registration event

`request_registered` is settleable only after the request has canonical customer, customer code, product/product code and canonical doctor/staff identity, with no unresolved sync conflict or duplicate/invalid marker.

New V2 requests enter through `create_customer_request_canonical_v1`, which validates and inserts customer/product/staff identity in one DB transaction. This removes the temporary state where a request could exist before product linkage completed.

## Achievement event

`request_achieved` is awarded once on first entry into:
- `available`
- `arrived`
- `customer_contacted`
- `delivered`
- `closed`

`cancelled` and `not_available` do not qualify for achievement points.

`not_available` remains operationally actionable for alternative/re-search review, but that does not turn it into an achieved request.

## Anti-duplication

Protection exists at multiple layers:
- 24-hour open-request duplicate guard on customer + product + operational branch.
- unique request incentive event identity.
- unique linked employee transaction source/source-id.
- single-owner guard prevents the same request event being re-attributed to another doctor later.
- retry settlement after identity repair remains idempotent.

## Historical staff attribution

Historical source employee names are not converted automatically to `doctor_id`.

The review workflow is explicitly two-step:
1. review and record an approved source-label -> canonical Staff mapping with a written reason;
2. preview how many requests would change, then explicitly apply the approved mapping.

Ambiguous or unmatched labels cannot be auto-applied. Applying a Staff mapping still does not guarantee points: each request remains subject to identity completeness, doctor tier, policy effective date and duplicate/sync guards.

## Operational transition safety

V2 commands use one transition matrix. Invalid shortcuts such as `new -> delivered` and reopening an already delivered request are rejected before mutation. `not_available -> searching_suppliers` is intentionally allowed to support a documented alternative-search attempt.

## Reporting

Doctor profiles read the canonical points projection through safe RPCs and deep-link back to requests using `registrarId=staff.id`, not the display name.

No Customer Requests UI owns an independent total-point calculation.
