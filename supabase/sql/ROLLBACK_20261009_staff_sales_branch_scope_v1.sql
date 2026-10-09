-- Rollback for 20261009120000_staff_sales_branch_scope_v1 (reference only; run only with approval).
-- Restores the exact production definitions captured on 2026-10-09 (md5 of pg_get_functiondef:
-- bundle 91118e3b896c11f94e5e87b12a7e2f8e, summary v3 4cfce7577cb7ef6062a4aad1b91a2179), then removes the helper.
-- Re-opens the cross-branch read described in the migration header; data is not touched either way.
begin;

CREATE OR REPLACE FUNCTION public.get_staff_performance_sales_bundle_v1(p_staff_id uuid, p_window_start date, p_window_end date, p_current_start date, p_elapsed_days integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
with authorized as (select public.dawaa_assert_staff_sales_scope_v1(p_staff_id) ok),
staff_row as (select s.name,s.branch from public.staff s,authorized a where a.ok and s.id=p_staff_id limit 1),
aliases as materialized (
 select public.normalize_cs_identity_name(sr.name) norm from staff_row sr
 union select public.normalize_cs_identity_name(a.alias_name) from public.staff_identity_aliases a
 where a.staff_id=p_staff_id and coalesce(a.active,true)
),source_freshness as (
 -- Scalar subquery keeps max() single-table so the planner uses the Limit-1 scan on
 -- idx_sales_invoices_perf_branch_invoice_date_v2 instead of reading every branch invoice.
 select ((select max(si.invoice_date) from public.sales_invoices si
  where coalesce(nullif(btrim(si.branch_name),''),nullif(btrim(si.branch),''))=sr.branch) at time zone 'Africa/Cairo')::date data_as_of
 from staff_row sr
),bounds as (
 select sf.data_as_of,case when sf.data_as_of is null or sf.data_as_of<p_current_start then 0 else greatest(0,least(p_elapsed_days,(sf.data_as_of-p_current_start)+1)) end::integer effective_days from source_freshness sf
),matched as materialized (
 select (si.invoice_date at time zone 'Africa/Cairo')::date d,coalesce(nullif(btrim(si.customer_id::text),''),nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),'')) customer_key,
 coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric amount
 from public.sales_invoices si where si.staff_id=p_staff_id::text and si.invoice_date >= (p_window_start::timestamp at time zone 'Africa/Cairo') and si.invoice_date < (p_window_end::timestamp at time zone 'Africa/Cairo')
 union all
 select (si.invoice_date at time zone 'Africa/Cairo')::date,coalesce(nullif(btrim(si.customer_id::text),''),nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),'')),
 coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric
 from public.sales_invoices si where coalesce(btrim(si.staff_id),'')='' and si.invoice_date >= (p_window_start::timestamp at time zone 'Africa/Cairo') and si.invoice_date < (p_window_end::timestamp at time zone 'Africa/Cairo')
 and public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name),''),nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),''))) in(select norm from aliases where norm<>'')
),cycles as (
 select gs::date s,(gs+interval '1 month')::date e from generate_series(p_window_start::timestamp,(p_window_end-interval '1 month')::timestamp,interval '1 month') gs
),cycle_rows as (
 select c.s cycle_start,c.e cycle_end,coalesce(sum(m.amount),0) sales,count(m.d) invoices,count(distinct m.customer_key) filter(where m.customer_key is not null) customers,min(m.d) first_sale_date
 from cycles c left join matched m on m.d>=c.s and m.d<c.e group by c.s,c.e
),same_period as (
 select 'current' k,coalesce(sum(m.amount),0) sales,count(*) invoices,count(distinct m.customer_key) filter(where m.customer_key is not null) customers
 from matched m,bounds b where b.effective_days>0 and m.d>=p_current_start and m.d<(p_current_start+b.effective_days)
 union all
 select 'previous',coalesce(sum(m.amount),0),count(*),count(distinct m.customer_key) filter(where m.customer_key is not null)
 from matched m,bounds b where b.effective_days>0 and m.d>=(p_current_start-interval '1 month')::date and m.d<((p_current_start-interval '1 month')::date+b.effective_days)
)
select jsonb_build_object('cycles',(select coalesce(jsonb_agg(to_jsonb(c) order by cycle_start desc),'[]'::jsonb) from cycle_rows c),'samePeriod',(select coalesce(jsonb_object_agg(k,to_jsonb(s)-'k'),'{}'::jsonb) from same_period s),'dataAsOf',(select data_as_of from bounds),'effectiveDays',(select effective_days from bounds))
$function$
;

CREATE OR REPLACE FUNCTION public.get_staff_evaluation_sales_summary_v3(p_staff_id uuid, p_start date, p_end_exclusive date)
 RETURNS TABLE(sales numeric, invoices bigint, customers bigint, avg_invoice numeric, data_as_of date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_name text;v_branch text;v_sales numeric:=0;v_invoices bigint:=0;v_customers bigint:=0;v_direct_sales numeric:=0;v_direct_invoices bigint:=0;v_fallback_sales numeric:=0;v_fallback_invoices bigint:=0;v_start timestamptz;v_end timestamptz;v_aliases text[];
begin
 perform public.dawaa_assert_staff_sales_scope_v1(p_staff_id);
 select s.name,s.branch into v_name,v_branch from public.staff s where s.id=p_staff_id;
 if v_name is null then raise exception 'staff_sales_target_not_found' using errcode='P0002'; end if;
 v_start:=p_start::timestamp at time zone 'Africa/Cairo'; v_end:=p_end_exclusive::timestamp at time zone 'Africa/Cairo';
 select array_agg(distinct norm) into v_aliases from (
  select public.normalize_cs_identity_name(v_name) norm
  union all
  select coalesce(nullif(a.normalized_alias,''),public.normalize_cs_identity_name(a.alias_name))
  from public.staff_identity_aliases a where a.staff_id=p_staff_id and coalesce(a.active,true)
 ) x where norm<>'';
 select coalesce(sum(coalesce(si.net_total,si.net_amount,si.discounted_amount,si.total_amount,si.amount,si.gross_total,si.gross_amount,0)),0),count(*)
 into v_direct_sales,v_direct_invoices from public.sales_invoices si
 where si.staff_id=p_staff_id::text and si.invoice_date>=v_start and si.invoice_date<v_end;
 select coalesce(sum(coalesce(si.net_total,si.net_amount,si.discounted_amount,si.total_amount,si.amount,si.gross_total,si.gross_amount,0)),0),count(*)
 into v_fallback_sales,v_fallback_invoices from public.sales_invoices si
 where coalesce(btrim(si.staff_id),'')='' and si.invoice_date>=v_start and si.invoice_date<v_end
 and public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name),''),nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),'')))=any(v_aliases);
 v_sales:=v_direct_sales+v_fallback_sales;v_invoices:=v_direct_invoices+v_fallback_invoices;
 select count(distinct customer_key) into v_customers from (
  select coalesce(nullif(btrim(si.customer_id::text),''),nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),'')) customer_key
  from public.sales_invoices si where si.staff_id=p_staff_id::text and si.invoice_date>=v_start and si.invoice_date<v_end
  union all
  select coalesce(nullif(btrim(si.customer_id::text),''),nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),''))
  from public.sales_invoices si where coalesce(btrim(si.staff_id),'')='' and si.invoice_date>=v_start and si.invoice_date<v_end
  and public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name),''),nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),'')))=any(v_aliases)
 ) q where customer_key is not null;
 select (max(si.invoice_date) at time zone 'Africa/Cairo')::date into data_as_of from public.sales_invoices si
 where coalesce(nullif(btrim(si.branch_name),''),nullif(btrim(si.branch),''))=v_branch;
 sales:=v_sales;invoices:=v_invoices;customers:=coalesce(v_customers,0);avg_invoice:=case when v_invoices>0 then v_sales/v_invoices else 0 end;return next;
end $function$
;

drop function if exists public.dawaa_staff_sales_read_branch_v1(uuid);
commit;
