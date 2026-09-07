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
    and (
      (p_evaluation_type='branch_manager' and lower(sa.role)='branch_manager')
      or (p_evaluation_type='branches_manager' and lower(sa.role)='branches_manager')
      or (p_evaluation_type='customer_service' and lower(sa.role) in ('customer_service_manager','team_dawaa_alpha'))
    )
  order by coalesce(s.branch,''), btrim(s.name);
end;
$function$;

revoke all on function public.list_weekly_manager_evaluation_subjects_v1(uuid,text) from public;
grant execute on function public.list_weekly_manager_evaluation_subjects_v1(uuid,text) to anon, authenticated;
