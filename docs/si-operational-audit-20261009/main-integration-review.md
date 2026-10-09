# Main integration review — 2026-10-09

Observed remote main: 0b9bead8df7c39373e297a47f75fc9eaba03af18.
Observed remote WhatsApp branch: e7a3f074d497d3891cf9178ee08e0e2659f55201.
Review branch: claude/project-thread-pkg0jt. No main update, live database read/write or deployment.

## Git result

main is an ancestor, with 0 main-only and 135 branch-only commits. The branch-to-main change includes the entire WhatsApp/Sales Intelligence development chain: 177 files, not merely customer correction. `git merge-tree --write-tree origin/main HEAD` completed without conflicts and produced exactly the existing branch tree (0e1118a6d58d27fbf2d0d0b0635e102849201c65). The local checks therefore exercise the simulated integrated code, without creating a merge or changing main.

## Additional PR-gate blockers repaired

The previous npm verify did not include every Quality Gate workflow check. Running its 25 single-line node checks found two failures:

1. ReviewCanonicalIdentity directly queried staff from UI. Its exact-ID, name/role-only query now belongs to the existing staffDirectoryReadModel boundary. No directory scan, name fallback or authorization bypass was introduced.
2. The manager-correction checker required an old ternary that allowed legacy reviews to follow the staff home branch. Current UI already preserves the original branch for all reviews. The checker now requires the existing form update/spread/staff selection and rejects branch assignment in that handler. Reviews.tsx and its existing regression test are unchanged. An in-memory mutation proof confirms the checker accepts current behavior and rejects injected staff-branch reassignment.

Verification after this narrow repair:

- All 25 workflow node checks: pass.
- InvoiceImporter Vitest: 27 pass.
- Full workflow semantic eslint: pass; touched-file semantic eslint: pass.
- npm run verify: 686 pass, 0 fail; doctor, typecheck, build, architecture and perf pass (initial JS 92.2 KiB gzip).
- git diff --check: pass.
- Hosted CI/runtime parity has not been claimed. Local runtime is Node 24/npm 11; Quality Gate uses Node 22. The source-mutating audit-fix-semantic-lint script was not executed; PR CI still must prove its source-purity step.

## Activation is not ready for an automatic main merge

There are 15 migration files absent from main. Git absence does NOT imply database absence. Earlier handoffs record applied versions for Story 20261008073930 and Evidence 20261008104059, but this review deliberately did not inspect the live migration ledger. Do not run an unconditional db push.

Two older migrations contain immediate historical DML: 20261005133000 changes current-review flags, and 20261005141000 demotes unmaterialized ready request actions. They must not be replayed as a side effect of this customer-correction round. The newer 20261009100000/103000/130016 repairs remain prepared-only according to their handoffs. Retry/branch fixtures still leave faithful-schema/native multi-session acceptance pending; this review does not erase those limitations or reopen the broader SI redesign.

The customer-attribution command requires existing staff sessions/accounts, canonical customer-code normalization, review access/permission helpers, action/signal/source/audit tables and the legacy signal resolver. Confirm prerequisite definitions and the intended migration ledger in a separately authorized activation review. Use a faithful isolated schema first, then stage the checked command before releasing code that calls it. Preserve the original action guard; do not bypass it with direct writes. No historical cleanup is part of activation.

vercel.json disables this WhatsApp branch only. main is unspecified and therefore defaults to automatic Git deployment. Before any main ref update, explicitly settle its no-deploy configuration/activation plan. The current branch-only protection must not be mistaken for main protection. No Vercel settings were modified by this review.

Next acceptance: reviewed migration ledger/prerequisites and historical-DML exclusion; faithful isolated DB/race checks required by existing handoffs; hosted Quality Gate/source-purity/runtime proof; explicit main deployment/activation plan. Then seek approval for the concrete main merge and production activation. Until then: no merge, migration apply, schema/data mutation, preview or production deploy.
