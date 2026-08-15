-- Canonical sales/target exclusions for Dawaa internal/exception customer accounts.
-- Keep every invoice in sales_invoices for audit/returns; exclude only from target/performance math.

create or replace function public.dawaa_is_sales_target_excluded_customer_v1(
  p_branch text,
  p_customer_code text
) returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case
    when nullif(btrim(coalesce(p_customer_code,'')), '') is null then false
    when btrim(p_customer_code) in ('5','7','50','54','12820') then true
    when p_branch = 'فرع شكري' and btrim(p_customer_code) in ('10','4902') then true
    when p_branch = 'فرع الشامي' and btrim(p_customer_code) in ('13','170','10094') then true
    else false
  end;
$$;

grant execute on function public.dawaa_is_sales_target_excluded_customer_v1(text,text) to anon, authenticated;

create or replace function public.calculate_manager_cycle_sales_target_v1(
  p_evaluation_type text,
  p_branch text,
  p_cycle_start date,
  p_as_of date
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_sales numeric := 0;
  v_sales_count integer := 0;
  v_target numeric := 0;
begin
  if p_cycle_start is null or p_as_of is null or p_as_of < p_cycle_start then
    raise exception 'invalid manager cycle period';
  end if;
  if p_evaluation_type not in ('branch_manager','branches_manager','customer_service') then
    raise exception 'invalid evaluation type';
  end if;

  select
    coalesce(sum(coalesce(si.net_amount, si.net_total, si.amount, si.total_amount, 0)), 0),
    count(*)
  into v_sales, v_sales_count
  from public.sales_invoices si
  where si.invoice_date >= p_cycle_start::timestamp
    and si.invoice_date < (p_as_of + 1)::timestamp
    and (p_branch is null or si.branch = p_branch)
    and not public.dawaa_is_sales_target_excluded_customer_v1(si.branch, si.customer_code);

  with targets as (
    select
      t.target_amount,
      case
        when extract(day from p_cycle_start)::int >= coalesce(t.cycle_start_day, 26)
          then make_date(extract(year from p_cycle_start)::int, extract(month from p_cycle_start)::int, coalesce(t.cycle_start_day, 26))
        else (make_date(extract(year from p_cycle_start)::int, extract(month from p_cycle_start)::int, coalesce(t.cycle_start_day, 26)) - interval '1 month')::date
      end as cycle_start
    from public.branch_sales_targets t
    where coalesce(t.active, true)
      and (p_branch is null or t.branch_name = p_branch)
  ), normalized as (
    select
      target_amount,
      cycle_start,
      (cycle_start + interval '1 month - 1 day')::date as cycle_end
    from targets
  )
  select coalesce(sum(
    target_amount *
    greatest(0, least(p_as_of, cycle_end) - greatest(p_cycle_start, cycle_start) + 1)::numeric /
    greatest(1, cycle_end - cycle_start + 1)::numeric
  ), 0)
  into v_target
  from normalized;

  return jsonb_build_object(
    'sales_total', round(v_sales, 2),
    'sales_invoices_count', v_sales_count,
    'sales_target_amount', round(v_target, 2),
    'sales_target_achievement_rate', case when v_target > 0 then round(v_sales / v_target * 100, 1) else null end
  );
end;
$$;

grant execute on function public.calculate_manager_cycle_sales_target_v1(text,text,date,date) to anon, authenticated;

create or replace function public.calculate_weekly_manager_metrics_v4(
  p_evaluation_type text,
  p_branch text,
  p_week_start date,
  p_week_end date
) returns jsonb
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_result jsonb;
  v_sales numeric := 0;
  v_sales_count integer := 0;
  v_coded_sales integer := 0;
  v_target numeric := 0;
begin
  if p_week_start is null or p_week_end is null or p_week_end < p_week_start then
    raise exception 'invalid manager metrics period';
  end if;
  if p_evaluation_type not in ('branch_manager','branches_manager','customer_service') then
    raise exception 'invalid evaluation type';
  end if;

  v_result := public.calculate_weekly_manager_metrics_v2(p_evaluation_type,p_branch,p_week_start,p_week_end);

  select
    coalesce(sum(coalesce(si.net_amount,si.net_total,si.amount,si.total_amount,0)),0),
    count(*),
    count(*) filter(where si.customer_id is not null or nullif(btrim(si.customer_code),'') is not null)
  into v_sales,v_sales_count,v_coded_sales
  from public.sales_invoices si
  where si.invoice_date >= p_week_start::timestamp
    and si.invoice_date < (p_week_end + 1)::timestamp
    and (p_branch is null or si.branch = p_branch)
    and not public.dawaa_is_sales_target_excluded_customer_v1(si.branch, si.customer_code);

  with targets as (
    select
      t.target_amount,
      case
        when extract(day from p_week_start)::int >= coalesce(t.cycle_start_day,26)
          then make_date(extract(year from p_week_start)::int,extract(month from p_week_start)::int,coalesce(t.cycle_start_day,26))
        else (make_date(extract(year from p_week_start)::int,extract(month from p_week_start)::int,coalesce(t.cycle_start_day,26)) - interval '1 month')::date
      end as cycle_start
    from public.branch_sales_targets t
    where coalesce(t.active,true)
      and (p_branch is null or t.branch_name = p_branch)
  ), normalized as (
    select target_amount, cycle_start, (cycle_start + interval '1 month - 1 day')::date as cycle_end
    from targets
  )
  select coalesce(sum(
    target_amount *
    greatest(0, least(p_week_end,cycle_end) - greatest(p_week_start,cycle_start) + 1)::numeric /
    greatest(1, cycle_end - cycle_start + 1)::numeric
  ),0)
  into v_target
  from normalized;

  v_result := jsonb_set(v_result,'{sales_total}',to_jsonb(v_sales),true);
  v_result := jsonb_set(v_result,'{sales_invoices_count}',to_jsonb(v_sales_count),true);
  v_result := jsonb_set(v_result,'{coded_sales_invoices_count}',to_jsonb(v_coded_sales),true);
  v_result := jsonb_set(v_result,'{sales_coding_rate}',case when v_sales_count>0 then to_jsonb(round(v_coded_sales::numeric/v_sales_count*100,1)) else 'null'::jsonb end,true);
  v_result := jsonb_set(v_result,'{sales_target_amount}',to_jsonb(round(v_target,2)),true);
  v_result := jsonb_set(v_result,'{sales_target_achievement_rate}',case when v_target>0 then to_jsonb(round(v_sales/v_target*100,1)) else 'null'::jsonb end,true);

  v_result := jsonb_set(v_result,'{data_coverage,sales}','true'::jsonb,true);
  v_result := jsonb_set(v_result,'{data_coverage,targets}',to_jsonb(v_target>0),true);
  v_result := jsonb_set(v_result,'{data_coverage,followups}','true'::jsonb,true);
  v_result := jsonb_set(v_result,'{data_coverage,customers}','true'::jsonb,true);
  v_result := jsonb_set(v_result,'{data_coverage,reviews}','true'::jsonb,true);
  v_result := jsonb_set(v_result,'{data_coverage,points}','true'::jsonb,true);
  v_result := jsonb_set(v_result,'{data_coverage,customer_requests}','true'::jsonb,true);
  v_result := jsonb_set(v_result,'{data_coverage,shift_notes}','true'::jsonb,true);
  v_result := jsonb_set(v_result,'{data_coverage,purchases}','true'::jsonb,true);
  v_result := jsonb_set(v_result,'{data_coverage,inventory}','true'::jsonb,true);
  v_result := jsonb_set(v_result,'{data_coverage,attendance}','true'::jsonb,true);

  return v_result;
end;
$$;

grant execute on function public.calculate_weekly_manager_metrics_v4(text,text,date,date) to anon, authenticated;
