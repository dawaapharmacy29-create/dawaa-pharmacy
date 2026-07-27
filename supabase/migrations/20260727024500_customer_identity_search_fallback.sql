-- Reliable customer search for loyalty/points pages.
-- Search order: exact customer code -> exact phone -> exact customer id -> partial name/code/phone.

create index if not exists customers_customer_code_trim_idx
  on public.customers ((trim(customer_code::text)));

create index if not exists customers_phone_digits_idx
  on public.customers ((regexp_replace(coalesce(phone, mobile, whatsapp, ''), '\D', '', 'g')));

create index if not exists sales_invoices_customer_code_trim_idx
  on public.sales_invoices ((trim(customer_code::text)));

create or replace function public.search_customer_identity_for_points(
  p_query text,
  p_limit integer default 20
)
returns table (
  customer_id text,
  customer_code text,
  customer_name text,
  customer_phone text,
  branch text,
  match_source text,
  match_rank integer
)
language sql
security definer
set search_path = public
set statement_timeout = '8s'
as $$
  with input as (
    select
      trim(coalesce(p_query, '')) as q,
      regexp_replace(coalesce(p_query, ''), '\D', '', 'g') as digits,
      greatest(1, least(coalesce(p_limit, 20), 50)) as lim
  ),
  customer_matches as (
    select
      c.id::text as customer_id,
      nullif(trim(c.customer_code::text), '') as customer_code,
      coalesce(nullif(trim(c.name), ''), 'عميل بدون اسم') as customer_name,
      nullif(trim(coalesce(c.phone, c.mobile, c.whatsapp)), '') as customer_phone,
      nullif(trim(c.branch), '') as branch,
      'customers'::text as match_source,
      case
        when nullif(trim(c.customer_code::text), '') = i.q then 1
        when i.digits <> '' and regexp_replace(coalesce(c.phone, c.mobile, c.whatsapp, ''), '\D', '', 'g') = i.digits then 2
        when c.id::text = i.q then 3
        when c.name ilike '%' || i.q || '%' then 10
        when c.customer_code::text ilike '%' || i.q || '%' then 11
        else 12
      end as match_rank
    from public.customers c
    cross join input i
    where i.q <> ''
      and (
        nullif(trim(c.customer_code::text), '') = i.q
        or c.id::text = i.q
        or (i.digits <> '' and regexp_replace(coalesce(c.phone, c.mobile, c.whatsapp, ''), '\D', '', 'g') = i.digits)
        or c.name ilike '%' || i.q || '%'
        or c.customer_code::text ilike '%' || i.q || '%'
        or coalesce(c.phone, c.mobile, c.whatsapp, '') ilike '%' || i.q || '%'
      )
  ),
  invoice_matches as (
    select distinct on (coalesce(si.customer_id::text, ''), coalesce(trim(si.customer_code::text), ''), coalesce(si.phone, si.whatsapp_phone, ''))
      si.customer_id::text as customer_id,
      nullif(trim(si.customer_code::text), '') as customer_code,
      coalesce(nullif(trim(si.customer_name), ''), nullif(trim(si.name), ''), 'عميل من الفواتير') as customer_name,
      nullif(trim(coalesce(si.phone, si.whatsapp_phone, nullif(si.customer_phone, ''), '')), '') as customer_phone,
      nullif(trim(coalesce(si.branch, si.branch_name)), '') as branch,
      'sales_invoices'::text as match_source,
      case
        when nullif(trim(si.customer_code::text), '') = i.q then 20
        when i.digits <> '' and regexp_replace(coalesce(si.phone, si.whatsapp_phone, si.customer_phone, ''), '\D', '', 'g') = i.digits then 21
        else 30
      end as match_rank
    from public.sales_invoices si
    cross join input i
    where i.q <> ''
      and (
        nullif(trim(si.customer_code::text), '') = i.q
        or si.customer_id::text = i.q
        or (i.digits <> '' and regexp_replace(coalesce(si.phone, si.whatsapp_phone, si.customer_phone, ''), '\D', '', 'g') = i.digits)
        or si.customer_name ilike '%' || i.q || '%'
        or si.name ilike '%' || i.q || '%'
      )
    order by
      coalesce(si.customer_id::text, ''),
      coalesce(trim(si.customer_code::text), ''),
      coalesce(si.phone, si.whatsapp_phone, ''),
      si.invoice_date desc nulls last
  ),
  combined as (
    select * from customer_matches
    union all
    select im.*
    from invoice_matches im
    where not exists (
      select 1
      from customer_matches cm
      where
        (im.customer_id is not null and cm.customer_id = im.customer_id)
        or (im.customer_code is not null and cm.customer_code = im.customer_code)
        or (im.customer_phone is not null and regexp_replace(coalesce(cm.customer_phone, ''), '\D', '', 'g') = regexp_replace(im.customer_phone, '\D', '', 'g'))
    )
  )
  select
    c.customer_id,
    c.customer_code,
    c.customer_name,
    c.customer_phone,
    c.branch,
    c.match_source,
    c.match_rank
  from combined c
  cross join input i
  order by c.match_rank, c.customer_name
  limit (select lim from input);
$$;

grant execute on function public.search_customer_identity_for_points(text, integer) to authenticated;

select pg_notify('pgrst', 'reload schema');
