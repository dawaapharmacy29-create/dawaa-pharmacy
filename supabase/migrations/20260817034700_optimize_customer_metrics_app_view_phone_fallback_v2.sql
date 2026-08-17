-- Speed up customer list/search reads without changing customer metrics truth.
-- Previous view shape LEFT JOINed all customers to customer_metrics_summary only
-- to fill a phone fallback. With ~17k customers this forced a full customer-table
-- scan/sort on every contains search. Only ~4.7% of metric rows actually need a
-- phone fallback, so resolve customers lazily only when m.customer_phone is empty.

create index if not exists customers_customer_code_nullif_trim_idx_v1
on public.customers ((nullif(btrim(customer_code), '')))
where nullif(btrim(customer_code), '') is not null;

create or replace view public.dawaa_customer_metrics_app_view as
select
  coalesce(nullif(btrim(m.final_customer_key),''),nullif(btrim(m.customer_code),''),m.customer_id) as final_customer_key,
  m.customer_id,
  m.customer_code,
  m.customer_name,
  coalesce(
    nullif(btrim(m.customer_phone),''),
    (
      select coalesce(
        nullif(btrim(c.customer_phone),''),
        nullif(btrim(c.phone),''),
        nullif(btrim(c.mobile),''),
        nullif(btrim(c.whatsapp_phone),''),
        nullif(btrim(c.whatsapp),''),
        nullif(btrim(c.normalized_phone),'')
      )
      from public.customers c
      where nullif(btrim(c.customer_code),'') = nullif(btrim(m.customer_code),'')
      limit 1
    )
  ) as customer_phone,
  m.branch,
  coalesce(m.invoices_count,0::bigint)::integer as invoices_count,
  coalesce(m.total_spent,m.total_purchases,0::numeric) as total_spent,
  coalesce(m.total_spent,m.total_purchases,0::numeric) as total_purchases,
  case when coalesce(m.invoices_count,0::bigint)>0
    then coalesce(m.total_spent,m.total_purchases,0::numeric)/m.invoices_count::numeric
    else 0::numeric end as avg_invoice,
  m.first_purchase,
  m.last_purchase,
  greatest(coalesce(m.active_months,0), case when coalesce(m.invoices_count,0::bigint)>0 then 1 else 0 end) as active_months,
  coalesce(m.avg_monthly,
    case when coalesce(m.active_months,0)>0 then coalesce(m.total_spent,m.total_purchases,0::numeric)/m.active_months::numeric else 0::numeric end,
    0::numeric) as avg_monthly,
  coalesce(nullif(btrim(m.segment),''),'عادي'::text) as segment,
  coalesce(nullif(btrim(m.customer_status),''),
    case
      when coalesce(m.invoices_count,0::bigint)<=0 or m.last_purchase is null then 'بدون شراء'::text
      when m.first_purchase >= (current_date - interval '30 days') then 'جديد'::text
      when m.last_purchase >= (current_date - interval '45 days') then 'نشط'::text
      when m.last_purchase >= (current_date - interval '90 days') then 'مهدد بالتوقف'::text
      else 'متوقف'::text
    end) as customer_status
from public.customer_metrics_summary m
where coalesce(nullif(btrim(m.final_customer_key),''),nullif(btrim(m.customer_code),''),nullif(btrim(m.customer_name),'')) is not null;

grant select on public.dawaa_customer_metrics_app_view to anon, authenticated;
