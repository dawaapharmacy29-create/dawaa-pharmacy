-- Staff sales branch scope v1 (security fix; NOT APPLIED until approved).
-- Rollback reference: supabase/sql/ROLLBACK_20261009_staff_sales_branch_scope_v1.sql
--
-- Problem: get_staff_performance_sales_bundle_v1 (Doctor Performance Eye) and get_staff_evaluation_sales_summary_v3
-- (evaluation header) check only that the caller's branch scope matches the employee's HOME branch, then read
-- the employee's invoices from EVERY branch. A branch-scoped caller therefore sees totals, counts and customer
-- counts of invoices issued in another branch (measured 2026-10-09: 1,709 invoices / 568,541 EGP at فرع شكري by
-- 5 الشامي employees in 190 days, visible to الشامي-scoped accounts).
--
-- Fix: one helper resolves the branch the caller may read (NULL = all branches for ALL-scope roles); both
-- functions filter invoices by it and the bundle reports it as scopeBranch so the UI can say "inside your branch".
-- Signatures, grants, SECURITY DEFINER and the identity chain (dawaa_current_staff_account_id_strict, hardened by
-- 20261008120000) are unchanged. Applies only if both functions still match the reviewed definitions.

do $$
begin
  if md5(pg_get_functiondef('public.get_staff_performance_sales_bundle_v1(uuid,date,date,date,integer)'::regprocedure)) <> '91118e3b896c11f94e5e87b12a7e2f8e'
     or md5(pg_get_functiondef('public.get_staff_evaluation_sales_summary_v3(uuid,date,date)'::regprocedure)) <> '4cfce7577cb7ef6062a4aad1b91a2179' then
    raise exception 'staff sales branch scope: a target function changed since review; re-review before applying';
  end if;
end $$;

create or replace function public.dawaa_staff_sales_read_branch_v1(p_staff_id uuid)
returns text
language plpgsql stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_scope text;
begin
  perform public.dawaa_assert_staff_sales_scope_v1(p_staff_id);
  v_scope := public.dawaa_current_sales_invoice_scope_v1(array['view_dashboard','view_sales','view_all_invoices','view_quarterly_incentives','view_points']);
  return case when v_scope = 'ALL' then null else v_scope end;
end
$function$;
revoke all on function public.dawaa_staff_sales_read_branch_v1(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_staff_performance_sales_bundle_v1(p_staff_id uuid, p_window_start date, p_window_end date, p_current_start date, p_elapsed_days integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
with scope as (select public.dawaa_staff_sales_read_branch_v1(p_staff_id) branch),
staff_row as (select s.name,s.branch from public.staff s,scope sc where s.id=p_staff_id limit 1),
aliases as materialized (
 select public.normalize_cs_identity_name(sr.name) norm from staff_row sr
 union select public.normalize_cs_identity_name(a.alias_name) from public.staff_identity_aliases a
 where a.staff_id=p_staff_id and coalesce(a.active,true)
),source_freshness as (
 select ((select max(si.invoice_date) from public.sales_invoices si
  where coalesce(nullif(btrim(si.branch_name),''),nullif(btrim(si.branch),''))=coalesce(sc.branch,sr.branch)) at time zone 'Africa/Cairo')::date data_as_of
 from staff_row sr,scope sc
),bounds as (
 select sf.data_as_of,case when sf.data_as_of is null or sf.data_as_of<p_current_start then 0 else greatest(0,least(p_elapsed_days,(sf.data_as_of-p_current_start)+1)) end::integer effective_days from source_freshness sf
),matched as materialized (
 select (si.invoice_date at time zone 'Africa/Cairo')::date d,coalesce(nullif(btrim(si.customer_id::text),''),nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),'')) customer_key,
 coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric amount
 from public.sales_invoices si,scope sc where si.staff_id=p_staff_id::text and si.invoice_date >= (p_window_start::timestamp at time zone 'Africa/Cairo') and si.invoice_date < (p_window_end::timestamp at time zone 'Africa/Cairo')
 and (sc.branch is null or coalesce(nullif(btrim(si.branch_name),''),nullif(btrim(si.branch),''))=sc.branch)
 union all
 select (si.invoice_date at time zone 'Africa/Cairo')::date,coalesce(nullif(btrim(si.customer_id::text),''),nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),'')),
 coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric
 from public.sales_invoices si,scope sc where coalesce(btrim(si.staff_id),'')='' and si.invoice_date >= (p_window_start::timestamp at time zone 'Africa/Cairo') and si.invoice_date < (p_window_end::timestamp at time zone 'Africa/Cairo')
 and (sc.branch is null or coalesce(nullif(btrim(si.branch_name),''),nullif(btrim(si.branch),''))=sc.branch)
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
select jsonb_build_object('cycles',(select coalesce(jsonb_agg(to_jsonb(c) order by cycle_start desc),'[]'::jsonb) from cycle_rows c),'samePeriod',(select coalesce(jsonb_object_agg(k,to_jsonb(s)-'k'),'{}'::jsonb) from same_period s),'dataAsOf',(select data_as_of from bounds),'effectiveDays',(select effective_days from bounds),'scopeBranch',(select branch from scope))
$function$;

CREATE OR REPLACE FUNCTION public.get_staff_evaluation_sales_summary_v3(p_staff_id uuid, p_start date, p_end_exclusive date)
 RETURNS TABLE(sales numeric, invoices bigint, customers bigint, avg_invoice numeric, data_as_of date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_name text;v_branch text;v_scope text;v_sales numeric:=0;v_invoices bigint:=0;v_customers bigint:=0;v_direct_sales numeric:=0;v_direct_invoices bigint:=0;v_fallback_sales numeric:=0;v_fallback_invoices bigint:=0;v_start timestamptz;v_end timestamptz;v_aliases text[];
begin
 -- Asserts the caller's scope and returns the branch it may read (NULL = all branches).
 v_scope:=public.dawaa_staff_sales_read_branch_v1(p_staff_id);
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
 where si.staff_id=p_staff_id::text and si.invoice_date>=v_start and si.invoice_date<v_end
 and (v_scope is null or coalesce(nullif(btrim(si.branch_name),''),nullif(btrim(si.branch),''))=v_scope);
 select coalesce(sum(coalesce(si.net_total,si.net_amount,si.discounted_amount,si.total_amount,si.amount,si.gross_total,si.gross_amount,0)),0),count(*)
 into v_fallback_sales,v_fallback_invoices from public.sales_invoices si
 where coalesce(btrim(si.staff_id),'')='' and si.invoice_date>=v_start and si.invoice_date<v_end
 and (v_scope is null or coalesce(nullif(btrim(si.branch_name),''),nullif(btrim(si.branch),''))=v_scope)
 and public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name),''),nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),'')))=any(v_aliases);
 v_sales:=v_direct_sales+v_fallback_sales;v_invoices:=v_direct_invoices+v_fallback_invoices;
 select count(distinct customer_key) into v_customers from (
  select coalesce(nullif(btrim(si.customer_id::text),''),nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),'')) customer_key
  from public.sales_invoices si where si.staff_id=p_staff_id::text and si.invoice_date>=v_start and si.invoice_date<v_end
  and (v_scope is null or coalesce(nullif(btrim(si.branch_name),''),nullif(btrim(si.branch),''))=v_scope)
  union all
  select coalesce(nullif(btrim(si.customer_id::text),''),nullif(btrim(si.customer_code),''),nullif(btrim(si.customer_phone),''))
  from public.sales_invoices si where coalesce(btrim(si.staff_id),'')='' and si.invoice_date>=v_start and si.invoice_date<v_end
  and (v_scope is null or coalesce(nullif(btrim(si.branch_name),''),nullif(btrim(si.branch),''))=v_scope)
  and public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name),''),nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),'')))=any(v_aliases)
 ) q where customer_key is not null;
 select (max(si.invoice_date) at time zone 'Africa/Cairo')::date into data_as_of from public.sales_invoices si
 where coalesce(nullif(btrim(si.branch_name),''),nullif(btrim(si.branch),''))=coalesce(v_scope,v_branch);
 sales:=v_sales;invoices:=v_invoices;customers:=coalesce(v_customers,0);avg_invoice:=case when v_invoices>0 then v_sales/v_invoices else 0 end;return next;
end $function$;
