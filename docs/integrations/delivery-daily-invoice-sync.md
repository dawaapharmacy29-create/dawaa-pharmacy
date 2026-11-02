# Daily management invoice → delivery reconciliation

## Boundaries

Canonical invoice evidence remains `sales_invoices`, after a transaction commits, with saved/valid rows only. The importer and source invoice ownership are unchanged. The current 26–25 cycle is the only automatically writable cycle. Payroll/closed-cycle archives are not invoked.

Statement triggers queue one revision per committed write, not one job per row. A 45-second quiet window coalesces import chunks. An authenticated Edge worker claims a five-minute lease and sends the cycle's bounded canonical snapshot to Delivery. Concurrent imports retain a higher pending revision; a lost response is safe to retry.

Delivery writes its existing `monthly_system_invoices`, `monthly_invoice_import_batches`, `monthly_invoice_reconciliation_results` and upload history. There is no second invoice source, order counter, or financial ledger. Invoice evidence uses the existing cycle key; number+normalized branch+invoice day must match an order. Ambiguous identities and changed previously stored customer/value/date evidence stop the transaction for review rather than replacing source evidence.

Canonical management invoice value follows `getInvoiceNetValue`: first nonzero stored net/discounted/total/amount value in the established priority order, never the maximum. This accommodates legacy zero defaults without inflating corrected amounts.

## Decisions and invariants

- Saved/valid source invoices only; pending/zero/invalid invoices are not proof.
- Driver identity is taken from the Delivery order and never from the source seller/courier.
- Existing human exclusions, manual approvals and duplicate approvals/rejections survive re-import. Failed/deleted orders remain excluded.
- Missing source evidence is a report observation, not a rejection or loss of an existing right.
- Same-day duplicate visits require the existing explicit administrative decision.
- Customer code, phone and amount conflicts require review; customer-name discrepancies remain review flags. Multipliers retain their value-review status.
- Nonzero stored order earnings or missing rider identity require manual review, avoiding legacy UPDATE triggers that zero earnings or infer riders.
- Locks are acquired before inspecting decisions. Source evidence, result batch, projections and sync state commit atomically.
- Source and order hashes make identical re-uploads/retries no-ops; unchanged projections are not rewritten.

## Timing and observability

The minute cron dispatches only pending source revisions, after the quiet window. New uploads normally start reconciliation within a few minutes. Catch-up without another file is daily, limiting whole-cycle snapshot growth. New orders are also revisited on the next source upload. Old cycles remain manual.

The import completion page shows sync state, last successful cycle, source/order/match/pending/system-only/failed counts. An import succeeds independently of the cross-project link; errors remain queued with visible retry/review state. Delivery's existing reconciliation page reads the updated orders and upload history.

## Security and rollout

A dedicated high-entropy shared key is stored only in each project's Vault. The worker retrieves configuration through a service-role-only RPC. Delivery's receiving RPC validates the key before taking locks or accessing records. Anonymous requests cannot read the export queue, sync state or configuration. No secret is stored in repository source or browser code.

The worker authenticates its caller; JWT verification is disabled only because the minute job uses the dedicated Vault-backed integration header. Rotate the key in both Vaults as one coordinated operation.

Rollout order: outbox schema; Delivery receiver and financial/idempotency guards; secret configuration; worker; rollback-only production rehearsal; cron last. Stop the cron to pause processing. Do not delete invoices, orders, evidence snapshots or closed-cycle records during rollback.

## Reproducible verification

Check out Management and `DawaaPHARMACY-DELIVERY` as sibling folders (`repo` and `delivery`), or set `DAWAA_DELIVERY_REPO` to the latter. From Management run:

```
node scripts/verification/test-delivery-daily-invoice-sync.mjs
npm run verify
```

The isolated PGlite test verifies transaction-coupled queueing, pending-row exclusion, amount precedence, revision/lease safety, strict date+branch matching, protected earnings despite an adversarial legacy trigger, human decisions, duplicates, failed exclusion, dry-run, retry and identical-file idempotency, conflict rollback, late orders and denied anonymous queue/config reads. Integration configuration and data fixtures contain synthetic values only.
