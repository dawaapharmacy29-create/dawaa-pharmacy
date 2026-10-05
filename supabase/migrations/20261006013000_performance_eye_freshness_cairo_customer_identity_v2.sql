-- Performance Eye V2: freshness-aware same-period sales, Cairo-safe dates, canonical customer identity.
-- Additive indexes keep the corrected timestamptz path responsive.

create index if not exists idx_sales_invoices_perf_staff_cairo_date_v2
on public.sales_invoices (staff_id, ((invoice_date at time zone 'Africa/Cairo')::date))
where coalesce(btrim(staff_id),'')<>'';

create index if not exists idx_sales_invoices_perf_norm_identity_cairo_date_v2
on public.sales_invoices (
 public.normalize_cs_identity_name(coalesce(nullif(btrim(normalized_seller_name),''),nullif(btrim(seller_name),''),nullif(btrim(staff_name),''))),
 ((invoice_date at time zone 'Africa/Cairo')::date)
)
where coalesce(btrim(staff_id),'')='';

create index if not exists idx_sales_invoices_perf_branch_cairo_date_v2
on public.sales_invoices (
 coalesce(nullif(btrim(branch_name),''),nullif(btrim(branch),'')),
 ((invoice_date at time zone 'Africa/Cairo')::date) desc
);

create index if not exists idx_sales_invoices_perf_branch_invoice_date_v2
on public.sales_invoices (
 coalesce(nullif(btrim(branch_name),''),nullif(btrim(branch),'')),
 invoice_date desc
);

create or replace function public.get_staff_performance_sales_bundle_v1(
 p_staff_id uuid,p_window_start date,p_window_end date,p_current_start date,p_elapsed_days integer
) returns jsonb language sql stable set search_path=public,pg_catalog as $function$
with staff_row as (
 select s.name,s.branch from public.staff s where s.id=p_staff_id limit 1
), aliases as materialized (
 select public.normalize_cs_identity_name(sr.name) norm from staff_row sr
 union
 select public.normalize_cs_identity_name(a.alias_name) from public.staff_identity_aliases a
 where a.staff_id=p_staff_id and coalesce(a.active,true)
), source_freshness as (
 select (max(si.invoice_date) at time zone 'Africa/Cairo')::date data_as_of
 from public.sales_invoices si,staff_row sr
 where coalesce(nullif(btrim(si.branch_name),''),nullif(btrim(si.branch),''))=sr.branch
), bounds as (
 select sf.data_as_of,
 case when sf.data_as_of is null or sf.data_as_of<p_current_start then 0
 else greatest(0,least(p_elapsed_days,(sf.data_as_of-p_current_start)+1)) end::integer effective_days
 from source_freshness sf
), matched as materialized (
 select (si.invoice_date at time zone 'Africa/Cairo')::date d,
 coalesce(nullif(btrim(si.customer_id::text),''),nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),'')) customer_key,
 coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric amount
 from public.sales_invoices si
 where si.staff_id=p_staff_id::text
 and si.invoice_date >= (p_window_start::timestamp at time zone 'Africa/Cairo')
 and si.invoice_date < (p_window_end::timestamp at time zone 'Africa/Cairo')
 union all
 select (si.invoice_date at time zone 'Africa/Cairo')::date,
 coalesce(nullif(btrim(si.customer_id::text),''),nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),'')),
 coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric
 from public.sales_invoices si
 where coalesce(btrim(si.staff_id),'')=''
 and si.invoice_date >= (p_window_start::timestamp at time zone 'Africa/Cairo')
 and si.invoice_date < (p_window_end::timestamp at time zone 'Africa/Cairo')
 and public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name),''),nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),'')))
 in(select norm from aliases where norm<>'')
), cycles as (
 select gs::date s,(gs+interval '1 month')::date e
 from generate_series(p_window_start::timestamp,(p_window_end-interval '1 month')::timestamp,interval '1 month') gs
), cycle_rows as (
 select c.s cycle_start,c.e cycle_end,coalesce(sum(m.amount),0) sales,count(m.d) invoices,
 count(distinct m.customer_key) filter(where m.customer_key is not null) customers,min(m.d) first_sale_date
 from cycles c left join matched m on m.d>=c.s and m.d<c.e group by c.s,c.e
), same_period as (
 select 'current' k,coalesce(sum(m.amount),0) sales,count(*) invoices,
 count(distinct m.customer_key) filter(where m.customer_key is not null) customers
 from matched m,bounds b where b.effective_days>0 and m.d>=p_current_start and m.d<(p_current_start+b.effective_days)
 union all
 select 'previous',coalesce(sum(m.amount),0),count(*),
 count(distinct m.customer_key) filter(where m.customer_key is not null)
 from matched m,bounds b where b.effective_days>0
 and m.d>=(p_current_start-interval '1 month')::date
 and m.d<((p_current_start-interval '1 month')::date+b.effective_days)
)
select jsonb_build_object(
 'cycles',(select coalesce(jsonb_agg(to_jsonb(c) order by cycle_start desc),'[]'::jsonb) from cycle_rows c),
 'samePeriod',(select coalesce(jsonb_object_agg(k,to_jsonb(s)-'k'),'{}'::jsonb) from same_period s),
 'dataAsOf',(select data_as_of from bounds),
 'effectiveDays',(select effective_days from bounds)
);
$function$;

revoke all on function public.get_staff_performance_sales_bundle_v1(uuid,date,date,date,integer) from public;
revoke execute on function public.get_staff_performance_sales_bundle_v1(uuid,date,date,date,integer) from anon;
grant execute on function public.get_staff_performance_sales_bundle_v1(uuid,date,date,date,integer) to authenticated;
