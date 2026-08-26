drop index if exists public.sales_invoices_unique_branch_date_invoice;
create unique index sales_invoices_unique_branch_cairo_day_invoice
  on public.sales_invoices (branch, ((invoice_date at time zone 'Africa/Cairo')::date), invoice_number)
  where invoice_number is not null
    and btrim(invoice_number)<>''
    and branch is not null
    and btrim(branch)<>''
    and invoice_date is not null;
