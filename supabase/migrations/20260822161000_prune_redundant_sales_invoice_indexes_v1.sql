-- Remove only non-constraint indexes that are structurally duplicated by retained btree indexes.
-- All invoice identity / unique indexes remain intact.

drop index if exists public.idx_sales_invoices_kpi_covering_v3;
drop index if exists public.sales_invoices_seller_date_idx;
drop index if exists public.idx_sales_invoices_customer_code_invoice_date;
drop index if exists public.idx_sales_invoices_date_branch;
