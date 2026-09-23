# HR system review — 2026-09-22

Scope: `experiment/hr-workforce-architecture-v1` at `4e62622c`, compared with the official Odoo HR documentation and Zoho People feature/service catalog. This is a code and architecture review, not a claim of production acceptance.

Update: the first employee lifecycle slice now tracks onboarding, document completion, training and offboarding tasks at `/hr-staff-milestones`. These are auditable tasks tied to canonical `staff.id`; they do not create contracts, change staff employment status or affect payroll. Central HR roles create tasks; branch managers can review and complete tasks for staff in their own branch.

The due inbox lists open tasks overdue or due within seven days, using the Cairo date. It enforces branch scope in the database and has a bounded 100-row UI request. Tasks without a due date remain visible on the individual employee record.

The employee page also contains an immutable register for contracts, renewals and documented assignments. It stores dates and a document reference, with corrections linked to the original record. This register is documentary metadata only: it neither stores the document file nor drives current branch, login role, schedule, salary or payroll. Those changes need a separate reviewed command workflow.

Pending batch: an effective-dated employment profile adds employment type, grade and reporting line to the employee page. Its correction chain retains old versions and the read API can reconstruct the profile as of a chosen date. Central HR roles write; branch managers read within their branch. This remains descriptive metadata and does not alter payroll or the canonical `staff` row. Release only after its migration and UI are verified together.

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
