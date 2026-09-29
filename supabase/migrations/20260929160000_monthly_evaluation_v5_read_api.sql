-- Monthly Evaluation V5 canonical read API.
create or replace function public.get_staff_monthly_evaluation_v5(
  p_actor_id uuid,
  p_staff_id uuid,
  p_month date
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_actor record;
  v_target public.staff%rowtype;
  v_row public.staff_monthly_manager_evaluations%rowtype;
  v_month date := date_trunc('month', p_month)::date;
begin
  select * into v_actor from public.monthly_eval_actor(p_actor_id);
  if not found then return null; end if;

  if p_actor_id is not null and v_actor.account_id is distinct from p_actor_id then
    return null;
  end if;

  select * into v_target from public.staff where id=p_staff_id;
  if not found then return null; end if;

  select * into v_row
  from public.staff_monthly_manager_evaluations
  where staff_id=p_staff_id and evaluation_month=v_month;

  if not found then return null; end if;

  if not (
    v_actor.role in ('general_manager','branches_manager','executive_manager','executive','admin')
    or (
      v_actor.role in ('branch_manager','branch_manager_shamy','branch_manager_shokry')
      and coalesce(v_target.branch,'')=v_actor.branch
      and coalesce(v_target.role,v_target.type,'') !~* 'branch_manager|customer_service|خدمة العملاء'
    )
    or (
      v_actor.staff_id=p_staff_id
      and v_row.status in ('sent','approved')
    )
  ) then
    return null;
  end if;

  return to_jsonb(v_row);
end;
$function$;

revoke all on function public.get_staff_monthly_evaluation_v5(uuid,uuid,date) from public;
grant execute on function public.get_staff_monthly_evaluation_v5(uuid,uuid,date) to anon, authenticated;
