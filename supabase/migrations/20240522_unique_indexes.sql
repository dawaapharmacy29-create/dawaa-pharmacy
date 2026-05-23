-- Unique index for customer_analysis.customer_code (needed for upsert onConflict)
create unique index if not exists customer_analysis_customer_code_uidx
  on public.customer_analysis (customer_code)
  where customer_code is not null;

-- Unique index for sales_invoices deduplication
create unique index if not exists sales_invoices_invoice_no_branch_date_uidx
  on public.sales_invoices (invoice_number, branch, invoice_date)
  where invoice_number is not null and invoice_number <> '';

-- Ensure user_permissions has unique index on (user_id, permission_key) for upsert
create unique index if not exists user_permissions_user_permission_uidx
  on public.user_permissions (user_id, permission_key);
