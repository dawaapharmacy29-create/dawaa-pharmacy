-- Rebuild the full legacy dashboard customer-card shape from fast sources while
-- preserving the exact v13 output contract and values.
create or replace function public.get_dashboard_customer_cards_fast_v3()
returns table (
  total_customers_with_purchase integer,
  important_customers integer,
  very_important_customers integer,
  customers_need_attention integer,
  stopped_customers integer,
  normal_customers integer,
  total_customer_spent numeric,
  avg_customer_spent numeric,
  avg_invoice_count_per_customer numeric,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, auth, extensions, pg_temp
as $function$
with fast as (
  select * from public.get_dashboard_customer_cards_fast_v2()
),
grouped as (
  select
    coalesce(
      nullif(btrim(cms.customer_code), ''),
      nullif(btrim(cms.customer_phone), ''),
      nullif(btrim(cms.customer_name), '')
    ) as customer_key,
    max(nullif(btrim(cms.customer_code), '')) as customer_code,
    max(nullif(btrim(cms.customer_phone), '')) as customer_phone,
    max(cms.customer_name) as customer_name,
    sum(coalesce(cms.total_spent, 0))::numeric as total_spent,
    sum(coalesce(cms.invoices_count, 0))::numeric as invoices_count
  from public.customer_metrics_summary cms
  where coalesce(cms.customer_name, '') <> all(
    array['عميل غير مسجل','عميل الصيدلية','عميل نقدي','غير مسجل']::text[]
  )
  group by 1
),
summary as (
  select
    count(*)::integer as total_customers,
    coalesce(sum(g.total_spent), 0)::numeric as total_spent,
    round(coalesce(avg(g.total_spent), 0), 2)::numeric as avg_spent,
    round(coalesce(avg(g.invoices_count), 0), 2)::numeric as avg_invoices,
    count(*) filter (
      where coalesce(g.customer_phone, '') <> ''
         or exists (
           select 1
           from public.customers c
           where c.customer_code = g.customer_code
             and length(regexp_replace(coalesce(c.customer_phone, ''), '[^0-9]', '', 'g')) >= 8
         )
         or exists (
           select 1
           from public.sales_invoices si
           where si.customer_code = g.customer_code
             and length(
               regexp_replace(
                 coalesce(si.customer_phone, si.phone, si.whatsapp_phone, ''),
                 '[^0-9]',
                 '',
                 'g'
               )
             ) >= 8
         )
    )::integer as eligible_phone_customers
  from grouped g
  where g.customer_key is not null
)
select
  s.total_customers,
  f.important_customers,
  f.very_important_customers,
  f.customers_need_attention,
  f.stopped_customers,
  greatest(
    s.eligible_phone_customers - f.customers_need_attention - f.stopped_customers,
    0
  )::integer,
  s.total_spent,
  s.avg_spent,
  s.avg_invoices,
  now()
from fast f
cross join summary s;
$function$;

grant execute on function public.get_dashboard_customer_cards_fast_v3() to authenticated, service_role;

-- Keep the existing v13 relation name and exact 10-column contract so all old
-- consumers become fast without requiring a coordinated UI rewrite.
create or replace view public.dawaa_dashboard_customer_cards_v13 as
select
  total_customers_with_purchase,
  important_customers,
  very_important_customers,
  customers_need_attention,
  stopped_customers,
  normal_customers,
  total_customer_spent,
  avg_customer_spent,
  avg_invoice_count_per_customer,
  updated_at
from public.get_dashboard_customer_cards_fast_v3();
