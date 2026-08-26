# Points V3 health and compensation coverage

This follow-up keeps the V3 points engine financially safe after the main architecture merge.

- Legacy `evaluation_rules` generated as `legacy_rule_*` are quarantined by deactivating them; no historical transaction rows are deleted or rewritten.
- Compensation profile coverage is exposed through a manager-scoped RPC and never invents payout values.
- Data Health Center surfaces points architecture health, duplicate event groups, malformed transactions, active legacy rules, and compensation coverage by staff role.
- Live production audit before this change found 43 active staff, 27 missing compensation profiles, and zero historical employee transactions referencing legacy rule codes.
