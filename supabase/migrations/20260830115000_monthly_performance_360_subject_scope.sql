create or replace function public.can_view_monthly_performance_360_safe(p_actor_id uuid, p_staff_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor record;
  v_target public.staff%rowtype;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found or v_actor.staff_id is null then return false; end if;

  select * into v_target from public.staff where id = p_staff_id;
  if not found then return false; end if;

  if v_actor.staff_id = p_staff_id then return true; end if;
  if v_actor.role in ('general_manager','executive_manager','branches_manager') then return true; end if;

  if v_actor.role in ('branch_manager','branch_manager_shamy','branch_manager_shokry')
     and coalesce(v_target.branch,'') = coalesce(v_actor.branch,'') then
    return true;
  end if;

  return false;
end
$function$;

revoke all on function public.can_view_monthly_performance_360_safe(uuid,uuid) from public;
grant execute on function public.can_view_monthly_performance_360_safe(uuid,uuid) to anon, authenticated;

create or replace function public.list_staff_for_monthly_performance_360_safe(p_actor_id uuid)
returns table(id uuid, name text, role text, branch text, status text)
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor record;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found or v_actor.staff_id is null then return; end if;

  return query
  select s.id,
         s.name,
         coalesce(s.role,s.type),
         coalesce(s.branch,''),
         coalesce(s.status, case when coalesce(s.active,s.is_active,true) then 'active' else 'inactive' end)
  from public.staff s
  where coalesce(s.active,s.is_active,true)=true
    and not (coalesce(s.status,'') ~* 'inactive|disabled|موقوف|غير نشط|archived')
    and (
      s.id = v_actor.staff_id
      or v_actor.role in ('general_manager','executive_manager','branches_manager')
      or (
        v_actor.role in ('branch_manager','branch_manager_shamy','branch_manager_shokry')
        and coalesce(s.branch,'') = coalesce(v_actor.branch,'')
      )
    )
  order by case when s.id=v_actor.staff_id then 0 else 1 end, s.name;
end
$function$;

revoke all on function public.list_staff_for_monthly_performance_360_safe(uuid) from public;
grant execute on function public.list_staff_for_monthly_performance_360_safe(uuid) to anon, authenticated;
