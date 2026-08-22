-- Keep customer invoice history/detail reads index-backed when the read view
-- exposes customer_code as NULLIF(btrim(customer_code), '').
-- This preserves the existing view semantics while avoiding a full sales_invoices scan.
create index if not exists idx_sales_invoices_customer_code_trim_stats_v1
on public.sales_invoices ((nullif(btrim(customer_code),'')));
