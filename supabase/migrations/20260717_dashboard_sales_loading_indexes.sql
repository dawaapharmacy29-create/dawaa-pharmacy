-- Stabilize executive dashboard and doctor competition sales reads.
-- Safe to run more than once.

create index if not exists idx_sales_invoices_invoice_date_id
  on public.sales_invoices (invoice_date, id);

create index if not exists idx_sales_invoices_branch_invoice_date_id
  on public.sales_invoices (branch, invoice_date, id);

create index if not exists idx_sales_invoices_seller_invoice_date_id
  on public.sales_invoices (seller_name, invoice_date, id);

-- Keep planner statistics current after large invoice imports.
analyze public.sales_invoices;
