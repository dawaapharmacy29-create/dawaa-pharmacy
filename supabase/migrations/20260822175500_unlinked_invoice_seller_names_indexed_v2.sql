create or replace function public.get_unlinked_invoice_seller_names_v1()
returns table (
  seller_name text,
  invoice_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    btrim(si.seller_name) as seller_name,
    count(*)::bigint as invoice_count
  from public.sales_invoices si
  where coalesce(btrim(si.staff_id), '') = ''
    and coalesce(btrim(si.seller_name), '') <> ''
  group by btrim(si.seller_name)
  order by count(*) desc, btrim(si.seller_name);
$$;
