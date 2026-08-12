-- Lightweight sales/target summary for the live manager incentive card.
-- Avoids recalculating every manager metric across the whole 26→25 cycle.

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
    and coalesce(btrim(si.customer_code), '') not in ('54','12820','10','5','170');

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
