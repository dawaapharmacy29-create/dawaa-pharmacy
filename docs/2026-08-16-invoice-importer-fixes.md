# Invoice importer fixes — 2026-08-16

Investigated after finding 10 isolated (non-recent) invoices missing from the database
compared to the raw POS export for the period 26/7–16/8/2026. Two real bugs were found and
fixed in `src/lib/invoiceImporter.ts`, plus one behavioral gap closed.

## Bug 1: whole batch dropped on a single bad row

`insertRowsWithOptionalColumns` inserts invoices in chunks of 25. On failure, the code only
degraded to per-row retries (`shouldSplitBatch`) when the error was classified as a duplicate
or a retryable network/timeout error. Any OTHER kind of failure (e.g. one row with an
out-of-range value) caused the **entire batch of up to 25 invoices** to be marked failed
together, silently dropping otherwise-valid invoices that happened to share a batch with one
bad row.

Fix: always split a failed multi-row batch into single-row inserts (`shouldSplitBatch = chunk.length > 1`),
so only the genuinely bad row(s) fail and everything else is saved.

## Bug 2: save/pending status column resolved to the wrong column

The source file has two columns both literally named "النوع" (invoice type: كاش/آجل/توصيل
منزلى, and save status: تم حفظها/معلقة). The parser deduplicates repeat header names by
appending `__2`, `__3`, etc., and `SAVE_STATUS_KEYS` correctly targets `'النوع__2'` — but
`findColumn()` stripped the `__N` suffix from every header before comparing, so the exact
match never fired and the fuzzy fallback matched the *first* "النوع" column (invoice type)
instead. `save_status` was therefore always populated with كاش/آجل/توصيل منزلى values, never
with the real تم حفظها/معلقة status.

Fix: `findColumn()` now tries an exact match against the raw (non-stripped) header first for
any candidate that carries a `__N` suffix, before falling back to the stripped/fuzzy match used
by all other (plain) candidates. No behavior change for any other field.

## Gap closed: pending ("معلقة") invoices were never excluded

`saveStatus` was captured but never used to filter anything. Once bug 2 is fixed and the real
status is read correctly, rows whose status matches معلقة/معلق/pending/held/draft are now
marked `importValidationStatus: 'pending_not_finalized'` and skipped before save (not counted
as sales), since they are not-yet-finalized POS transactions.

## Found (not auto-fixed): 5 invoices already imported while still pending at export time

Cross-checking the 14 "معلقة" rows in the 26/7–16/8 file against the current database found 5
that are already present as regular saved invoices, totalling ~4,549 EGP
(66666, 66130, 67449, 67205, 67199 — all فرع شكري). These were likely imported before this fix
existed. Left untouched deliberately — they may have been legitimately finalized after the
export was taken, and deleting revenue automatically is not safe without confirmation.
Recommend the branch owner check these 5 invoice numbers in the POS and decide.
