-- Accelerates the header side of the Demand Evidence completeness gate.
-- Matches the canonical COALESCE expressions used by sales_invoice_items_completeness_v1.
create index if not exists sales_invoices_completeness_read_v1_idx
on public.sales_invoices (
  (coalesce(invoice_datetime, invoice_date)),
  (trim(coalesce(branch_name, branch, '')))
)
include (invoice_number, invoice_no);
