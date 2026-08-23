create index if not exists idx_sales_invoices_dashboard_covering_v5
on public.sales_invoices (invoice_date, id)
include (
  invoice_no,
  invoice_number,
  sale_date,
  net_total,
  net_amount,
  discounted_amount,
  total_amount,
  amount,
  gross_total,
  gross_amount,
  discount_amount,
  branch,
  branch_name,
  seller_name,
  normalized_seller_name,
  staff_name,
  delivery_staff,
  customer_code,
  customer_phone,
  customer_name,
  customer_id,
  save_status,
  invoice_type
);

drop index if exists public.idx_sales_invoices_invoice_date_id;
drop index if exists public.idx_sales_invoices_kpi_covering_v4;
