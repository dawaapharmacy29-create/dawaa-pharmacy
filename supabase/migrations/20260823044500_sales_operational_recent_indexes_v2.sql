create index if not exists idx_sales_invoices_operational_recent_v1
on public.sales_invoices (invoice_date desc, id)
include (customer_code, staff_id, save_status, invoice_type)
where lower(coalesce(save_status,'')) !~ '(معلق|قيد|pending|draft|غير محفوظ)'
  and lower(coalesce(invoice_type,'')) !~ '(معلق|pending|draft)';

create index if not exists idx_sales_invoices_operational_recent_nullslast_v2
on public.sales_invoices (invoice_date desc nulls last, id)
include (customer_code, staff_id, save_status, invoice_type)
where lower(coalesce(save_status,'')) !~ '(معلق|قيد|pending|draft|غير محفوظ)'
  and lower(coalesce(invoice_type,'')) !~ '(معلق|pending|draft)';
