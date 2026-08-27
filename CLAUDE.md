# Dawaa Pharmacy — Claude Instructions

Use `AGENTS.md` as the primary repository operating contract.

Before changing a shared or sensitive domain, also read:

- `docs/ARCHITECTURE_TARGET.md`
- `docs/EMPLOYEE_DOMAIN_ARCHITECTURE.md` when staff, points, incentives, evaluations, attendance, tasks, or payroll are involved
- the relevant architecture gate scripts under `scripts/`

For non-trivial work, explicitly perform separate Architect, Planner, Implementer, Reviewer, Security, Performance, and Verifier passes as defined in `AGENTS.md`.

Do not create parallel sources of truth, page-specific permission systems, hidden fallbacks, or unbounded high-volume reads. Prefer the smallest safe change and finish with deterministic verification.