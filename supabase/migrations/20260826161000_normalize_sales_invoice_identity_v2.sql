drop index if exists public.idx_sales_invoices_unique_branch_invoice_no;
drop index if exists public.sales_invoices_invoice_no_branch_date_uidx;

alter table public.sales_invoices
  drop constraint if exists sales_invoices_invoice_number_invoice_no_consistency_chk;

alter table public.sales_invoices
  add constraint sales_invoices_invoice_number_invoice_no_consistency_chk
  check (
    invoice_number is null
    or invoice_no is null
    or btrim(invoice_number) = btrim(invoice_no)
  ) not valid;

alter table public.sales_invoices
  validate constraint sales_invoices_invoice_number_invoice_no_consistency_chk;
