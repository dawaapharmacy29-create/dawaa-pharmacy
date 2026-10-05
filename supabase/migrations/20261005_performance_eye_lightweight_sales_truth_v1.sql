create index if not exists idx_sales_invoices_perf_norm_identity_date_v1
on public.sales_invoices (
  public.normalize_cs_identity_name(coalesce(nullif(btrim(normalized_seller_name),''),nullif(btrim(seller_name),''),nullif(btrim(staff_name),''))),
  invoice_date
)
where coalesce(btrim(staff_id),'')='';

create or replace function public.get_staff_performance_sales_cycles_v1(
 p_staff_id uuid, p_window_start date, p_window_end date
) returns table(cycle_start date,cycle_end date,sales numeric,invoices bigint,customers bigint,first_sale_date date)
language sql stable
set search_path=public,pg_catalog
as $function$
with staff_row as (
 select s.id,s.name from public.staff s where s.id=p_staff_id limit 1
), aliases as materialized (
 select public.normalize_cs_identity_name(sr.name) norm from staff_row sr
 union
 select public.normalize_cs_identity_name(a.alias_name) from public.staff_identity_aliases a
 where a.staff_id=p_staff_id and coalesce(a.active,true)
), matched as materialized (
 select si.invoice_date::date invoice_day,coalesce(nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),'')) customer_key,
 coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric amount
 from public.sales_invoices si
 where si.staff_id=p_staff_id::text and si.invoice_date>=p_window_start and si.invoice_date<p_window_end::timestamp
 union all
 select si.invoice_date::date,coalesce(nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),'')),
 coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric
 from public.sales_invoices si
 where coalesce(btrim(si.staff_id),'')='' and si.invoice_date>=p_window_start and si.invoice_date<p_window_end::timestamp
 and public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name),''),nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),'')))
 in (select norm from aliases where norm<>'')
), cycles as (
 select gs::date cycle_start,(gs+interval '1 month')::date cycle_end
 from generate_series(p_window_start::timestamp,(p_window_end-interval '1 month')::timestamp,interval '1 month') gs
)
select c.cycle_start,c.cycle_end,coalesce(sum(m.amount),0)::numeric,count(m.invoice_day)::bigint,
 count(distinct m.customer_key) filter(where m.customer_key is not null)::bigint,min(m.invoice_day)
from cycles c left join matched m on m.invoice_day>=c.cycle_start and m.invoice_day<c.cycle_end
group by c.cycle_start,c.cycle_end order by c.cycle_start desc;
$function$;

revoke all on function public.get_staff_performance_sales_cycles_v1(uuid,date,date) from public;
revoke execute on function public.get_staff_performance_sales_cycles_v1(uuid,date,date) from anon;
grant execute on function public.get_staff_performance_sales_cycles_v1(uuid,date,date) to authenticated;


create or replace function public.get_staff_performance_sales_period_v1(
 p_staff_id uuid,p_start date,p_end_exclusive date
) returns table(sales numeric,invoices bigint,customers bigint,first_sale_date date)
language sql stable set search_path=public,pg_catalog
as $function$
with staff_row as (
 select s.id,s.name from public.staff s where s.id=p_staff_id limit 1
), aliases as materialized (
 select public.normalize_cs_identity_name(sr.name) norm from staff_row sr
 union select public.normalize_cs_identity_name(a.alias_name) from public.staff_identity_aliases a
 where a.staff_id=p_staff_id and coalesce(a.active,true)
), matched as materialized (
 select si.invoice_date::date invoice_day,coalesce(nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),'')) customer_key,
 coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric amount
 from public.sales_invoices si where si.staff_id=p_staff_id::text and si.invoice_date>=p_start and si.invoice_date<p_end_exclusive::timestamp
 union all
 select si.invoice_date::date,coalesce(nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),'')),
 coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric
 from public.sales_invoices si where coalesce(btrim(si.staff_id),'')='' and si.invoice_date>=p_start and si.invoice_date<p_end_exclusive::timestamp
 and public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name),''),nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),'')))
 in(select norm from aliases where norm<>'')
)
select coalesce(sum(amount),0)::numeric,count(*)::bigint,count(distinct customer_key) filter(where customer_key is not null)::bigint,min(invoice_day) from matched;
$function$;
revoke all on function public.get_staff_performance_sales_period_v1(uuid,date,date) from public;
revoke execute on function public.get_staff_performance_sales_period_v1(uuid,date,date) from anon;
grant execute on function public.get_staff_performance_sales_period_v1(uuid,date,date) to authenticated;
