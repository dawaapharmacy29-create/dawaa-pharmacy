-- Keep every invoice for audit/returns, but exclude active system-generic customer codes
-- from sales-target/performance calculations through the canonical customer_flags table.

create or replace function public.dawaa_is_sales_target_excluded_customer_v1(
  p_branch text,
  p_customer_code text
) returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.customer_flags f
    where f.flag_key = 'system_generic_code'
      and coalesce(f.is_active,false)
      and f.customer_code = btrim(coalesce(p_customer_code,''))
  );
$$;

grant execute on function public.dawaa_is_sales_target_excluded_customer_v1(text,text) to anon, authenticated;
