-- Weekly/leadership evaluation V5: bind client actor parameters to canonical session identity.

create or replace function public.list_weekly_manager_evaluation_subjects_v1(
  p_actor_id uuid,p_evaluation_type text
)
returns table(id uuid,name text,role text,branch text)
language plpgsql security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_session_id uuid:=public.dawaa_current_staff_account_id_strict();
  v_actor_role text;
begin
  if v_session_id is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if p_actor_id is not null and p_actor_id is distinct from v_session_id then
    raise exception 'actor_mismatch' using errcode='42501';
  end if;
  select lower(coalesce(a.role,'')) into v_actor_role
  from public.staff_accounts a
  where a.id=v_session_id and coalesce(a.active,false) and coalesce(a.can_login,false)
  limit 1;
  if v_actor_role is null then raise exception 'unauthorized'; end if;
  if p_evaluation_type='branch_manager' and v_actor_role not in ('general_manager','executive_manager','branches_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type='branches_manager' and v_actor_role<>'general_manager' then raise exception 'not allowed'; end if;
  if p_evaluation_type='customer_service' and v_actor_role not in ('general_manager','executive_manager','branches_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type not in ('branch_manager','branches_manager','customer_service') then raise exception 'invalid evaluation type'; end if;
  return query
  select s.id,btrim(s.name),lower(sa.role),coalesce(s.branch,'')
  from public.staff s join public.staff_accounts sa
    on sa.staff_id=s.id::text and coalesce(sa.active,false) and coalesce(sa.can_login,false)
  where coalesce(s.active,s.is_active,true)
    and not(coalesce(s.status,'')~*'inactive|disabled|archived|موقوف|غير نشط')
    and (
      (p_evaluation_type='branch_manager' and lower(sa.role)='branch_manager')
      or(p_evaluation_type='branches_manager' and lower(sa.role)='branches_manager')
      or(p_evaluation_type='customer_service' and lower(sa.role) in ('customer_service_manager','team_dawaa_alpha'))
    )
  order by coalesce(s.branch,''),btrim(s.name);
end;
$function$;

create or replace function public.get_weekly_manager_metrics_cached_v1(
  p_actor_id uuid,p_evaluation_type text,p_branch text,p_week_start date,p_week_end date
)
returns jsonb
language plpgsql security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_session_id uuid:=public.dawaa_current_staff_account_id_strict();
  v_actor_role text;
  v_branch_key text:=coalesce(p_branch,'');
  v_metrics jsonb;
begin
  if p_week_start is null or p_week_end is null or p_week_end<p_week_start then raise exception 'invalid period'; end if;
  if v_session_id is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if p_actor_id is not null and p_actor_id is distinct from v_session_id then raise exception 'actor_mismatch' using errcode='42501'; end if;
  select lower(coalesce(a.role,'')) into v_actor_role
  from public.staff_accounts a
  where a.id=v_session_id and coalesce(a.active,false) and coalesce(a.can_login,false)
  limit 1;
  if v_actor_role is null then raise exception 'unauthorized'; end if;
  if p_evaluation_type='branch_manager' and v_actor_role not in ('general_manager','executive_manager','branches_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type='branches_manager' and v_actor_role<>'general_manager' then raise exception 'not allowed'; end if;
  if p_evaluation_type='customer_service' and v_actor_role not in ('general_manager','executive_manager','branches_manager') then raise exception 'not allowed'; end if;
  if p_evaluation_type not in ('branch_manager','branches_manager','customer_service') then raise exception 'invalid evaluation type'; end if;
  select c.metrics into v_metrics from public.manager_weekly_metrics_cache c
  where c.evaluation_type=p_evaluation_type and c.branch_key=v_branch_key
    and c.week_start=p_week_start and c.week_end=p_week_end;
  return v_metrics;
end;
$function$;

revoke all on function public.list_weekly_manager_evaluation_subjects_v1(uuid,text) from public;
grant execute on function public.list_weekly_manager_evaluation_subjects_v1(uuid,text) to anon,authenticated;
revoke all on function public.get_weekly_manager_metrics_cached_v1(uuid,text,text,date,date) from public;
grant execute on function public.get_weekly_manager_metrics_cached_v1(uuid,text,text,date,date) to anon,authenticated;

notify pgrst,'reload schema';
