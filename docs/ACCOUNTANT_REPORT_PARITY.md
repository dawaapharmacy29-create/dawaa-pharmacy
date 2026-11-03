# Accountant reporting parity

The management report reads the existing accountant projection; Dawaa Bills remains the financial writer. Source contracts were inspected in `src/pages/Accountant.jsx`, `TreasuryGroups.jsx`, `TreasuryReport.jsx` and `treasuryMath.js` in the Bills app.

## Source contract

- Resolve transaction labels using the latest `AccountantAlias` by original description, then category name; fall back to `AccountantCategory` and stored labels. Per-movement classification overrides win. Normalize legacy groups exactly as Bills does.
- Retain source statement/provenance alongside the existing transaction and vault projections. Do not merge daily sales or shift receipts into treasury movements: Bills entry already posts the corresponding movement, so doing so would double count cash.
- Exclude cancelled/sample movements. Vault balances and ledger entries start at the vault opening date. Partial history has an unknown opening, never an invented zero.
- Report months are calendar months, matching Bills, independent of the payroll 26–25 cycle. Monthly history is bounded to six months; returned ledger entries are bounded to one month with an explicit oversized-month error instead of truncation.
- A deterministic source-row/part/creation/id ordering determines each vault's running balance. Filtering and pagination never recalculate that balance.
- Stable ID pagination and duplicate guards reject incomplete source snapshots before invoking the atomic importer.

## Access and UI

The read RPC retains the canonical `gm_daily_review_actor_v1` verified-session/top-management guard. The `anon` transport grant supports Dawaa staff sessions without granting direct table access or importer access. No client financial writes were added. Source review/edit links open the exact movement in Bills.

The UI distinguishes current all-time balances from selected-period figures, provides category/item drilldown, a complete paginated ledger, original/source details, six-month comparison, and exports all matching rows rather than just the visible page. Stale or failed refreshes retain the last successful data with a visible error. Superseded requests cannot overwrite a newer report.

## Validation

- `npm run verify`: repository gates, tests, typecheck, production build and performance budget.
- Targeted Vitest: accountant report and snapshot resolution/filter/export tests.
- `node scripts/verification/test-accountant-report-parity.mjs`: isolated PGlite importer/report/ACL fixture.
- Production rollback-only verified-session tests: general/executive manager allowed; delivery and missing session denied.
- Source-to-projection financial reconciliation for every vault: counts and incoming/outgoing totals match in integer cents; every projected movement carries source details.
- Browser interaction checks on a temporary harness using a production read response: desktop/mobile, pagination, detail dialog, search, history, complete workbook download, retained data after a failed refresh, no runtime errors. Harness and production fixture are excluded from git.

Rollback the UI commit independently if necessary. The additive metadata columns and extended JSON response are backward compatible with the previous UI. Reverting the sync function leaves existing financial data intact; do not remove or truncate financial rows as part of rollback.
