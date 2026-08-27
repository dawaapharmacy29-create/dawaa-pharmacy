-- Keep manager evaluation usable when a heavy cache refresh exceeds statement_timeout.
-- This function NEVER recalculates metrics. It only returns the last authorized cached snapshot.

create or replace function public.get_weekly_manager_metrics_cached_v1(
  p_actor_id uuid,
  p_evaluation_type text,
  p_branch text,
  p_week_start date,
  p_week_end date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor_role text;
  v_branch_key text := coalesce(p_branch,'');
  v_metrics jsonb;
begin
  if p_week_start is null or p_week_end is null or p_week_end < p_week_start then
    raise exception 'invalid period';
  end if;

  select lower(coalesce(a.role,'')) into v_actor_role
  from public.staff_accounts a
  where a.id=p_actor_id
    and coalesce(a.active,false)=true
    and coalesce(a.can_login,false)=true
  limit 1;

  if v_actor_role is null then raise exception 'unauthorized'; end if;
  if p_evaluation_type='branch_manager' and v_actor_role not in ('general_manager','executive_manager','branches_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type='branches_manager' and v_actor_role <> 'general_manager' then raise exception 'not allowed'; end if;
  if p_evaluation_type='customer_service' and v_actor_role not in ('general_manager','executive_manager','branches_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type not in ('branch_manager','branches_manager','customer_service') then raise exception 'invalid evaluation type'; end if;

  select c.metrics into v_metrics
  from public.manager_weekly_metrics_cache c
  where c.evaluation_type=p_evaluation_type
    and c.branch_key=v_branch_key
    and c.week_start=p_week_start
    and c.week_end=p_week_end;

  return v_metrics;
end;
$function$;

revoke all on function public.get_weekly_manager_metrics_cached_v1(uuid,text,text,date,date) from public;
grant execute on function public.get_weekly_manager_metrics_cached_v1(uuid,text,text,date,date) to anon, authenticated;
