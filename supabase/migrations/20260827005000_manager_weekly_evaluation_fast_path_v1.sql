create table if not exists public.manager_weekly_metrics_cache (
  evaluation_type text not null,
  branch_key text not null default '',
  week_start date not null,
  week_end date not null,
  metrics jsonb not null default '{}'::jsonb,
  refreshed_at timestamptz not null default now(),
  primary key (evaluation_type, branch_key, week_start, week_end)
);

alter table public.manager_weekly_metrics_cache enable row level security;
revoke all on public.manager_weekly_metrics_cache from public, anon, authenticated;

create or replace function public.list_weekly_manager_evaluation_subjects_v1(
  p_actor_id uuid,
  p_evaluation_type text
)
returns table(id uuid, name text, role text, branch text)
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor_role text;
begin
  select lower(coalesce(a.role,'')) into v_actor_role
  from public.staff_accounts a
  where a.id=p_actor_id
    and coalesce(a.active,false)=true
    and coalesce(a.can_login,false)=true
  limit 1;

  if v_actor_role is null then raise exception 'unauthorized'; end if;
  if p_evaluation_type='branch_manager' and v_actor_role not in ('general_manager','executive_manager','branches_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type='branches_manager' and v_actor_role not in ('general_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type='customer_service' and v_actor_role not in ('general_manager','executive_manager','branches_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type not in ('branch_manager','branches_manager','customer_service') then raise exception 'invalid evaluation type'; end if;

  return query
  select s.id, btrim(s.name), lower(sa.role), coalesce(s.branch,'')
  from public.staff s
  join public.staff_accounts sa
    on sa.staff_id=s.id::text
   and coalesce(sa.active,false)=true
   and coalesce(sa.can_login,false)=true
  where coalesce(s.active,s.is_active,true)=true
    and not (coalesce(s.status,'') ~* 'inactive|disabled|archived|موقوف|غير نشط')
    and lower(sa.role)=case p_evaluation_type
      when 'branch_manager' then 'branch_manager'
      when 'branches_manager' then 'branches_manager'
      else 'customer_service_manager'
    end
  order by coalesce(s.branch,''), btrim(s.name);
end;
$function$;

revoke all on function public.list_weekly_manager_evaluation_subjects_v1(uuid,text) from public;
grant execute on function public.list_weekly_manager_evaluation_subjects_v1(uuid,text) to anon, authenticated;

create or replace function public.get_weekly_manager_metrics_fast_v1(
  p_actor_id uuid,
  p_evaluation_type text,
  p_branch text,
  p_week_start date,
  p_week_end date,
  p_max_age_seconds integer default 300
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
  v_refreshed_at timestamptz;
begin
  if p_week_start is null or p_week_end is null or p_week_end < p_week_start then raise exception 'invalid period'; end if;

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

  select c.metrics,c.refreshed_at into v_metrics,v_refreshed_at
  from public.manager_weekly_metrics_cache c
  where c.evaluation_type=p_evaluation_type
    and c.branch_key=v_branch_key
    and c.week_start=p_week_start
    and c.week_end=p_week_end;

  if v_metrics is not null and v_refreshed_at >= now() - make_interval(secs => greatest(30,coalesce(p_max_age_seconds,300))) then
    return v_metrics;
  end if;

  v_metrics := public.calculate_weekly_manager_metrics_v5(p_evaluation_type,p_branch,p_week_start,p_week_end);
  insert into public.manager_weekly_metrics_cache(evaluation_type,branch_key,week_start,week_end,metrics,refreshed_at)
  values(p_evaluation_type,v_branch_key,p_week_start,p_week_end,v_metrics,now())
  on conflict(evaluation_type,branch_key,week_start,week_end)
  do update set metrics=excluded.metrics, refreshed_at=excluded.refreshed_at;
  return v_metrics;
end;
$function$;

revoke all on function public.get_weekly_manager_metrics_fast_v1(uuid,text,text,date,date,integer) from public;
grant execute on function public.get_weekly_manager_metrics_fast_v1(uuid,text,text,date,date,integer) to anon, authenticated;
