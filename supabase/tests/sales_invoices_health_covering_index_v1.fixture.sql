-- Fixture for 20261015150400_sales_invoices_health_classification_covering_index_v1: the columns, policy shape
-- and existing partial index that get_invoice_data_health_v1 reads under RLS.
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.sales_invoices (
  id bigint primary key,
  branch text,
  customer_segment text,
  customer_type text,
  seller_name text,
  staff_name text,
  payload text
);
alter table public.sales_invoices enable row level security;
grant select on public.sales_invoices to anon, authenticated;

-- Actor scope stand-in with the Production policy shape: InitPlans, then ALL or branch equality.
create or replace function public.dawaa_current_sales_invoice_scope_v1(p_permissions text[])
returns text language sql stable security definer set search_path to 'public'
as $$ select coalesce(nullif(current_setting('test.invoice_scope', true), ''), 'NONE') $$;
grant execute on function public.dawaa_current_sales_invoice_scope_v1(text[]) to anon, authenticated;
create policy sales_invoices_scoped_select on public.sales_invoices for select to anon, authenticated using (
  ((select public.dawaa_current_sales_invoice_scope_v1(array['view_sales'])) = 'ALL')
  or (branch = (select public.dawaa_current_sales_invoice_scope_v1(array['view_sales'])))
);

-- Existing Production partial index (no branch column).
create index idx_sales_invoices_health_missing_classification_v1
  on public.sales_invoices (id) where customer_segment is null and customer_type is null;

-- Representative shape: ~84% missing classification, two branches, wide incompressible rows (Production heap is
-- 157 MB / 20k pages for 76k rows, ~2 KB inline per row; ~1.5 KB of incompressible filler stays inline below the
-- TOAST threshold, while a compressible or TOASTed filler would shrink the heap and hide the scan cost).
insert into public.sales_invoices (id, branch, customer_segment, customer_type, seller_name, staff_name, payload)
select g, case when g % 2 = 0 then 'فرع شكري' else 'فرع الشامي' end,
       case when g % 7 = 0 then 'vip' end, case when g % 9 = 0 then 'retail' end, 'seller', null,
       (select string_agg(md5(g::text || '-' || i::text), '') from generate_series(1, 47) i)
from generate_series(1, 30000) g;
analyze public.sales_invoices;
