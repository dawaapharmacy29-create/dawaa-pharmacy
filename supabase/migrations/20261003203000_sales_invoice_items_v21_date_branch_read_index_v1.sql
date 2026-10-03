-- Read-path index for Demand Evidence. No data semantics change.
create index if not exists sales_invoice_items_v21_date_branch_idx
  on public.sales_invoice_items_v21 (invoice_date, branch)
  include (invoice_number, product_code, quantity, customer_id, customer_code);
