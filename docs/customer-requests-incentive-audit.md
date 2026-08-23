# Customer Requests Incentive Audit

## Scope

This audit verifies whether an authoritative numeric doctor-points policy already exists for Customer Requests before the refactor starts settling points automatically.

## Verified findings

1. The employee performance architecture defines `employee_transactions` as the canonical approved points/money event ledger. New feature events must carry canonical `staff_id`, explicit source, stable source id, lifecycle status, and must keep money separate from performance points.
2. Customer Requests already has a strong negative-policy signal in historical conversation-evaluation transactions: failure to register a promised/customer request is treated as a performance error (`unregistered_customer_request`). Historical point values vary because these records span older policies and recalculations; they are not a safe source for deriving a new positive award value.
3. No authoritative positive numeric rule was found in the repository, prior Customer Requests PRs, or current production employee transactions for:
   - registering a valid customer request;
   - starting sourcing;
   - fulfilling the requested product;
   - contacting the customer;
   - completing/delivering the request.
4. Therefore the refactor must fail closed: an eligible request event may be attributed to the correct doctor, but it must not produce payable/final points until a versioned central policy explicitly provides the value.

## Canonical events

- `request_registered`
- `request_sourcing_started`
- `request_fulfilled`
- `customer_contacted`
- `request_delivered`

## Eligibility gates

No positive Customer Request event is settleable when any of the following is true:

- customer is not linked by canonical customer id;
- customer code is missing;
- product name or canonical product code is missing;
- registrar/doctor is not linked;
- unresolved sync conflict exists;
- the request is identified as duplicate/invalid.

## Attribution

Registration credit belongs to the canonical registrar (`doctor_id`/`created_by` migrated to `staff.id`). Future sourcing/contact/delivery credit can be attributed independently to the canonical employee who performed that event; this avoids giving one doctor credit for work performed by another.

## Settlement contract

Customer Requests emits an auditable candidate containing:

- request id;
- event key;
- canonical staff id;
- policy key/version;
- configured points or `null`;
- eligibility/block reasons;
- settlement-ready flag.

`points = null` means the policy is not configured. It must never be converted to zero and must never be written as an approved employee transaction.

## Required decision before numeric rollout

A single versioned policy must explicitly define the positive points for each event. Until that policy is approved, the system records attribution/evidence only and does not invent numeric awards.
