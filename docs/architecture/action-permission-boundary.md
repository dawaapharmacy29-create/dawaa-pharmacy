# Action permission boundary

Sensitive UI actions must be decided by the canonical permission system (`checkPermission` / `hasPermission`), not by local role-name arrays.

Role checks remain valid for data scope, workspace shape, role-specific copy, and role-specific source data. They must not be the sole authorization decision for edit/delete/approve/manage actions.

`src/pages/Reviews.tsx` is temporarily baselined as known debt and should be migrated to explicit `add_reviews`, `edit_reviews`, and `approve_reviews` decisions before removing the baseline.
