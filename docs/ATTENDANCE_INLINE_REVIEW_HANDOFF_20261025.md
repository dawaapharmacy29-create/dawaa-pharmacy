# Attendance inline review handoff — 2026-10-25

PR: https://github.com/dawaapharmacy29-create/dawaa-pharmacy/pull/552
Branch: `feat/attendance-inline-dated-decisions-20261025`.
Isolated checkout: `dawaa-attendance-codex`; baseline `6b4af66b26a75956d5d9acaef070366cf44ab253`.

## Problem and changes

The decision component cleared its selected employee/day after saving a dated shift, manual punch or permission. Permission creation also immediately approved attendance with the previous candidate hours. Managers could not review the recomputed result before a separate final decision.

- Keep the selected case and its manager note after evidence changes, reread the persisted day and reload diagnosis, requests and the review list.
- Separate final approval from permission creation. Require verified database approval and a subsequent read before closing the dialog.
- Gate the new final action on central `manage_payroll`, canonical finalizability, standard-v2 routing, manager/system-resolvable evidence, complete punches, schedule and candidate hours. Flexible-v3 finalization remains unavailable through this new action.
- Do not finalize a newly approved permission while its attachment is absent from the persisted attendance result. Pending/rejected policy outcomes remain visible in the dialog.
- Prevent repeat in-flight mutations and refreshes. Reuse an existing same-range pending permission; do not silently approve a different-range request.
- Convert manually entered punch wall time through the canonical Cairo boundary, independent of workstation timezone; require a documented reason.
- Offer the existing inline permission and dated-schedule actions for manager cases, including the embedded view.

## Boundaries, security and performance

UI → `attendanceResolutionService` → existing RPCs. The dated-shift RPC call was moved out of the component. Reads use the canonical resolution queue, bounded to a single date and 1000 rows; absent/truncated staff records fail closed. There are no new direct shared-table reads, identity matching, payroll calculations or payroll writes.

No SQL definition, database grants, RLS policy, production configuration or recurring schedule was changed by this follow-up. Existing database authorization remains authoritative. New UI tests use fixture services; SQL tests execute the committed migration on local PostgreSQL/WASM with fixture authorization/schedule/materialization dependencies. They do not prove real session authorization or production RLS.

## Verification

- `npm test`: **1053 passed, 0 failed**, including six new executable service-boundary tests. Timezone gate: 41 fixtures plus Golden Case #1 identical in four machine timezones.
- `npm run verify`: **passed** (doctor, tests, TypeScript, architecture/security/attendance/payroll prebuild gates, Vite build, runtime performance budget).
- `node scripts/test-attendance-inline-ui.mjs`: **13 passed, 0 failed**, actual headless Edge rendering of the real component with fixture services. Covers open/save/stay open/finalize/remove pending, invalid times, policy blocking, request reuse, read failure, unresolved evidence, permission gating and mobile viewport. Final approval is clicked twice in the same turn; only one approval is recorded.
- `node scripts/test-attendance-dated-shift-local.mjs`: **9 passed, 0 failed**. Covers real dated-RPC overnight SQL calculation, materialized return, unchanged recurring schedule, audit, duplicates, invalid clocks, >18h, approved-day protection, fixture authorization rejection and two known release blockers.
- Final-source TypeScript: **passed**. Rebuilt final source: **passed** (3419 modules); runtime performance budget: **passed**, 202.3 KiB gzip across six initial chunks. The emitted attendance chunk contains the final complete-punch guard.

Run `npm run build` before the browser runner so it can load the production CSS. Browser runner requires Playwright (or `PLAYWRIGHT_MODULE_PATH` pointing to an installed package) and Edge, or `PLAYWRIGHT_CHANNEL`. Neither test runner needs production credentials or performs external API calls. SQL tests use the existing PGlite dependency.

## Release blockers — keep PR draft

1. The existing dated-shift migration revokes execution from `anon`; custom staff sessions use PostgREST `anon`. The local SQL test confirms this grant state. A securely reviewed, verified-session authorization/grant change is required before that RPC works for these sessions.
2. The existing RPC rolls the entire correction back if canonical materialization would automatically approve the corrected day. The local SQL test reproduces the rollback. A narrowly scoped database design must retain explicit review without removing safety barriers or writing payroll effects.
3. Permission approval does not itself provide a staff/day rematerialization boundary in the existing client service. The UI waits for the persisted result to include the permission and blocks the new final action meanwhile. An authorized single-day recomputation path needs database review.
4. Concurrent permission creation in separate tabs is not made atomic by a client lock. Database-level duplicate protection remains necessary; sequential retries in this dialog are protected.
5. No authenticated staging/database-to-browser end-to-end test or production migration was run. Flexible-v3 finalization requires its own canonical decision boundary.

An attempted local migration proposal (not applied anywhere) was rejected by automatic approval review because it changed shared database behavior and granted a mutating RPC to `anon`. That proposal was not written/executed; this follow-up contains no SQL changes. Approval is needed for the narrowly scoped database/security work before continuing that part.

## Deployment and reversal

**Not ready to merge or deploy.** No main merge, production deploy or production data write was performed. This work does not change Claude's checkout, untracked files, `.claude/`, WhatsApp branch or shared Git settings. Shared `node_modules` was reused through a junction for running tools; no dependency installation or package-lock change occurred.

Reversal: revert this follow-up commit to restore the prior UI/service behavior; there is no database migration to reverse in this follow-up. Keep the original PR migration unapplied until the blockers are resolved and an authenticated isolated test passes.
