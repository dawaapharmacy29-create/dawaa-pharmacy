# HR system review — 2026-09-22

Scope: `experiment/hr-workforce-architecture-v1` at `4e62622c`, compared with the official Odoo HR documentation and Zoho People feature/service catalog. This is a code and architecture review, not a claim of production acceptance.

## What exists

| Domain | Current entry point | State |
| --- | --- | --- |
| Employee identity | `/team`, canonical `staff` | Existing directory and account linkage; not a full employment lifecycle record. |
| Planning | `/schedule` | Versioned schedule, draft/validate/publish and coverage workflows. |
| Attendance | `/attendance-report` | Biometric ingestion, interpretation, resolution, exception queue, sync health and audit. Policy V3 supports staged versions and shadow/pilot controls. |
| Time off | `/time-off` | Requests, approvals and annual entitlement configuration; validate balances and all leave categories against real policies. |
| Overtime | Attendance overtime tab | Worked and approved time separated. |
| Payroll | `/staff-payroll` | Readiness, snapshot staging/review and finalization gates; payroll jurisdiction and compensation rules still require explicit validation. |
| Performance | Employee KPI, monthly evaluation, incentives | Existing operational modules, not a unified goal/review/development cycle. |
| Self service | `/my-attendance` and requests | Attendance and request surfaces; limited employee document and profile workflows. |

## Missing capabilities for a complete HR suite

1. **Core HR lifecycle:** employment records with effective dates, job/grade, reporting line, contract history, branch transfers and termination/re-hire events. Use `staff.id`; never identify employees by display name or login account.
2. **Recruitment and onboarding:** requisitions, applicants, interview stages, offer approval and onboarding tasks. Convert accepted hires to canonical staff records only through a reviewed boundary.
3. **Documents and compliance:** permissioned employee documents, expiry reminders and retention policy. Personal files need server-side authorization and audit, not sidebar visibility alone.
4. **Compensation history:** approved effective-dated salary and allowance records, separate from time and performance. Every payroll snapshot must point to the exact input versions and remain immutable after payment.
5. **Leave administration:** entitlement allocation, carryover, expiry, partial-day rules, holidays and accrual, with explicit localized policy; expose balances separately from requests.
6. **Performance and development:** review cycle, goals, manager/employee input, calibration, learning and training records; preserve existing incentive and target components as distinct ledgers.
7. **Employee self service and HR cases:** profile correction, document requests, confidential cases and approval inbox with delegated approvals and traceability.
8. **Workforce analytics:** headcount movement, coverage, turnover, leave utilization, overtime cost and payroll variance, each tied to canonical source and branch scope.

## Build order

1. Strengthen current truth: error visibility, branch scoping, historical reproducibility and end-to-end checks on biometric → attendance → payroll. Pilot V3 in shadow before any enforce decision.
2. Add one canonical effective-dated employment profile and event history behind an HR service/RPC and RLS. Link existing staff directory; do not duplicate `staff`.
3. Add contract/document access and onboarding/offboarding workflows using the profile and permission boundary.
4. Complete leave balances and policy rules; validate locally with actual Dawaa policies before linking to payroll.
5. Add compensation history and then recruitment, performance development and analytics. Release each as a narrow, independently testable slice.

## Acceptance gates per slice

- Managers see their authorized branch; employees see only their own confidential data; payroll and HR administrators have explicit roles. Verify UI, RPC authorization and RLS together.
- A change to a contract, branch, schedule or policy preserves the old effective-dated result and paid payroll snapshot.
- Unavailable services display an error, never a plausible zero. Bounded queries and pagination protect historical data growth.
- Test real scenarios for Shokry/Shami, overnight shifts, cross-branch punches, missing sync, time off and the 26th–25th payroll cycle.

References: https://www.odoo.com/documentation/18.0/applications/hr/ and https://www.zoho.com/people/features.html
