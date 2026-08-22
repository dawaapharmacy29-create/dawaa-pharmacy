create or replace function public.get_stagnant_cycle_metrics_v1(
  p_start date,
  p_end date,
  p_branch text default null
)
returns table(
  stagnant_medicine_id text,
  dispensed_quantity numeric,
  total_incentive numeric,
  dispense_count bigint,
  last_dispensed_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select
    d.stagnant_medicine_id::text,
    coalesce(sum(coalesce(d.quantity,0)),0)::numeric,
    coalesce(sum(coalesce(d.total_incentive,0)),0)::numeric,
    count(*)::bigint,
    max(coalesce(d.dispensed_at,d.created_at))
  from public.stagnant_medicine_dispenses d
  where coalesce(d.dispensed_at,d.created_at)::date between p_start and p_end
    and (
      p_branch is null or btrim(p_branch)='' or p_branch in ('الكل','كل الفروع','all')
      or d.branch_name=p_branch
    )
    and d.stagnant_medicine_id is not null
  group by d.stagnant_medicine_id;
$$;

revoke all on function public.get_stagnant_cycle_metrics_v1(date,date,text) from public;
grant execute on function public.get_stagnant_cycle_metrics_v1(date,date,text) to authenticated;
