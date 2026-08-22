-- Keep seller-name substring diagnostics bounded when staff aliases are imperfect.
-- This is intentionally narrow: it does not change invoice identity or any business rules.
create index if not exists idx_sales_invoices_seller_name_trgm_v1
  on public.sales_invoices using gin (seller_name gin_trgm_ops)
  where seller_name is not null and btrim(seller_name) <> '';
