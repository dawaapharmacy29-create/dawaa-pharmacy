# Action permission boundary

Sensitive UI actions must be decided by the canonical permission system (`checkPermission` / `hasPermission`), not by local role-name arrays.

Role checks remain valid for data scope, workspace shape, role-specific copy, and role-specific source data. They must not be the sole authorization decision for edit/delete/approve/manage actions.

Known verified debt is intentionally small and explicit:

- `src/pages/Reviews.tsx`: migrate review creation/edit/approval to explicit `add_reviews`, `edit_reviews`, and `approve_reviews` decisions.
- `src/pages/ShiftNotes.tsx`: replace the local manager-role guard for administrative note actions with a dedicated canonical permission after its intended role ceiling is defined.

The architecture gate baselines only those verified cases so new role-only sensitive action guards cannot spread while the existing debt is migrated safely.
