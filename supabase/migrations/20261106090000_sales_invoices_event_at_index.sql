-- overtime_decision_evidence_v3 filters invoices on this exact expression, which had no index: every
-- evidence check scanned all of sales_invoices (mean 9.5s, max 12.7s for the calls that finished, against
-- the 15s anon statement_timeout). decide_overtime_approval_v3 calls the same function, so approve and
-- reject timed out too, and its `when others` does not catch a statement timeout.
create index if not exists idx_sales_invoices_event_at_v1
  on public.sales_invoices ((coalesce(close_datetime, analysis_datetime, invoice_datetime)));
