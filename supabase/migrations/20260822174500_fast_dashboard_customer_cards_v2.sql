create or replace function public.get_dashboard_customer_cards_fast_v2()
returns table(
  important_customers integer,
  very_important_customers integer,
  customers_need_attention integer,
  stopped_customers integer
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
with params as (
  select
    date_trunc('month', current_date)::date as current_month_start,
    (date_trunc('month', current_date) - interval '1 month')::date as previous_month_start,
    ((date_trunc('month', current_date) - interval '1 month')::date
      + (extract(day from current_date)::int - 1))::date as previous_same_period_end,
    extract(day from current_date)::int as current_month_day,
    extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day')::date)::int as current_month_total_days
),
important_counts as materialized (
  select
    count(*) filter (
      where coalesce(cms.total_spent,0) >= 8000
        and (
          coalesce(cms.customer_phone,'') <> ''
          or exists (
            select 1 from public.customers c
            where c.customer_code = cms.customer_code
              and length(regexp_replace(coalesce(c.customer_phone,''), '[^0-9]', '', 'g')) >= 8
          )
        )
    )::integer as important_customers,
    count(*) filter (
      where coalesce(cms.total_spent,0) >= 20000
        and (
          coalesce(cms.customer_phone,'') <> ''
          or exists (
            select 1 from public.customers c
            where c.customer_code = cms.customer_code
              and length(regexp_replace(coalesce(c.customer_phone,''), '[^0-9]', '', 'g')) >= 8
          )
        )
    )::integer as very_important_customers
  from public.customer_metrics_summary cms
  where coalesce(cms.customer_name,'') <> all(array['عميل غير مسجل','عميل الصيدلية','عميل نقدي','غير مسجل']::text[])
),
recent_raw as materialized (
  select
    nullif(btrim(si.customer_code),'') as customer_code,
    nullif(btrim(si.customer_name),'') as raw_customer_name,
    case
      when length(regexp_replace(
        coalesce(
          public.dawaa_clean_phone_for_invoice_v1(coalesce(si.customer_phone,si.phone,si.whatsapp_phone,'')),
          public.dawaa_clean_phone_for_invoice_v1(coalesce(si.phone,si.customer_phone,si.whatsapp_phone,'')),
          ''
        ), '[^0-9]', '', 'g'
      )) >= 8
      then regexp_replace(
        coalesce(
          public.dawaa_clean_phone_for_invoice_v1(coalesce(si.customer_phone,si.phone,si.whatsapp_phone,'')),
          public.dawaa_clean_phone_for_invoice_v1(coalesce(si.phone,si.customer_phone,si.whatsapp_phone,'')),
          ''
        ), '[^0-9]', '', 'g'
      )
      else null
    end as raw_customer_phone,
    si.invoice_date::date as invoice_day
  from public.dawaa_sales_invoices_dashboard_v1 si
  cross join params p
  where si.invoice_date >= p.previous_month_start
    and si.invoice_date < (p.current_month_start + interval '1 month')
    and coalesce(nullif(btrim(si.customer_code),''), nullif(btrim(si.customer_name),''), si.customer_id::text) is not null
    and coalesce(nullif(btrim(si.customer_name),''),'') <> all(array['عميل غير مسجل','عميل الصيدلية','عميل نقدي','غير مسجل']::text[])
),
recent_grouped as (
  select
    coalesce(r.customer_code, r.raw_customer_phone, r.raw_customer_name) as customer_key,
    max(r.customer_code) as customer_code,
    max(r.raw_customer_name) as raw_customer_name,
    max(r.raw_customer_phone) as recent_phone,
    count(*) filter (where r.invoice_day >= p.current_month_start)::integer as purchase_count_current_month,
    count(*) filter (where r.invoice_day >= p.previous_month_start and r.invoice_day < p.current_month_start)::integer as purchase_count_previous_month,
    count(*) filter (where r.invoice_day >= p.previous_month_start and r.invoice_day <= p.previous_same_period_end)::integer as purchase_count_previous_same_period,
    max(p.current_month_day)::integer as current_month_day,
    max(p.current_month_total_days)::integer as current_month_total_days
  from recent_raw r
  cross join params p
  where coalesce(r.customer_code, r.raw_customer_phone, r.raw_customer_name) is not null
  group by coalesce(r.customer_code, r.raw_customer_phone, r.raw_customer_name)
),
identity_enriched as (
  select
    g.*,
    coalesce(
      (select max(nullif(btrim(c.customer_name),'')) from public.customers c where g.customer_code is not null and c.customer_code = g.customer_code),
      g.raw_customer_name
    ) as customer_name,
    coalesce(
      g.recent_phone,
      (select max(case when length(regexp_replace(coalesce(c.customer_phone,''), '[^0-9]', '', 'g')) >= 8 then regexp_replace(coalesce(c.customer_phone,''), '[^0-9]', '', 'g') else null end) from public.customers c where g.customer_code is not null and c.customer_code = g.customer_code)
    ) as current_identity_phone
  from recent_grouped g
),
classified as (
  select
    i.*,
    case when i.current_month_day > 0
      then round(i.purchase_count_current_month::numeric / i.current_month_day::numeric * i.current_month_total_days::numeric)::integer
      else i.purchase_count_current_month
    end as expected_current_month_purchase_count
  from identity_enriched i
  where coalesce(i.customer_name,'') <> all(array['عميل غير مسجل','عميل الصيدلية','عميل نقدي','غير مسجل']::text[])
),
status_rows as (
  select
    c.*,
    case
      when c.purchase_count_current_month = 0 and c.purchase_count_previous_same_period >= 2 then 'توقف عن الشراء'
      when c.purchase_count_current_month = 0 and c.purchase_count_previous_same_period = 1 then 'يحتاج متابعة'
      when (c.expected_current_month_purchase_count * 2) <= c.purchase_count_previous_month and c.purchase_count_previous_month >= 4 then 'انخفض الشراء المتوقع'
      when c.purchase_count_current_month < c.purchase_count_previous_same_period and c.purchase_count_previous_same_period >= 3 then 'أقل من نفس الفترة السابقة'
      else 'طبيعي'
    end as purchase_frequency_status,
    case
      when c.purchase_count_current_month = 0 and c.purchase_count_previous_same_period >= 2 then 'توقف عن الشراء'
      when c.purchase_count_current_month = 0 and c.purchase_count_previous_same_period = 1 then 'يحتاج متابعة'
      when (c.expected_current_month_purchase_count * 2) <= c.purchase_count_previous_month and c.purchase_count_previous_month >= 4 then 'انخفاض متوقع بنهاية الشهر'
      when c.purchase_count_current_month < c.purchase_count_previous_same_period and c.purchase_count_previous_same_period >= 3 then 'أقل من نفس الفترة السابقة'
      else 'طبيعي'
    end as smart_purchase_status
  from classified c
),
status_with_phone as (
  select
    s.*,
    (
      coalesce(s.current_identity_phone,'') <> ''
      or (s.customer_code is not null and exists (
        select 1 from public.dawaa_sales_invoices_dashboard_v1 h
        where h.customer_code = s.customer_code
          and length(regexp_replace(
            coalesce(
              public.dawaa_clean_phone_for_invoice_v1(coalesce(h.customer_phone,h.phone,h.whatsapp_phone,'')),
              public.dawaa_clean_phone_for_invoice_v1(coalesce(h.phone,h.customer_phone,h.whatsapp_phone,'')),
              ''
            ), '[^0-9]', '', 'g'
          )) >= 8
      ))
      or (s.customer_code is null and coalesce(s.customer_key,'') <> '' and exists (
        select 1 from public.dawaa_sales_invoices_dashboard_v1 h
        where nullif(btrim(h.customer_name),'') = s.customer_key
          and length(regexp_replace(
            coalesce(
              public.dawaa_clean_phone_for_invoice_v1(coalesce(h.customer_phone,h.phone,h.whatsapp_phone,'')),
              public.dawaa_clean_phone_for_invoice_v1(coalesce(h.phone,h.customer_phone,h.whatsapp_phone,'')),
              ''
            ), '[^0-9]', '', 'g'
          )) >= 8
      ))
    ) as has_phone
  from status_rows s
)
select
  ic.important_customers,
  ic.very_important_customers,
  count(*) filter (where swp.smart_purchase_status in ('انخفاض متوقع بنهاية الشهر','أقل من نفس الفترة السابقة') and swp.has_phone)::integer,
  count(*) filter (where swp.purchase_frequency_status in ('توقف عن الشراء','يحتاج متابعة') and swp.has_phone)::integer
from important_counts ic
cross join status_with_phone swp
group by ic.important_customers, ic.very_important_customers;
$function$;

grant execute on function public.get_dashboard_customer_cards_fast_v2() to authenticated;
