
create or replace function public.configure_annual_leave_entitlement_v1(
  p_staff_id uuid,
  p_year integer,
  p_days numeric,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_staff public.staff%rowtype;
  v_existing numeric:=0;
  v_id uuid;
  v_key text;
begin
  if p_staff_id is null
     or p_year < 2020 or p_year > 2100
     or p_days is null or p_days <= 0 or p_days > 365 then
    raise exception 'invalid_annual_leave_entitlement_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true
    and coalesce(can_login,false)=true;

  if not found or not public.dawaa_actor_is_top_management_v1() then
    raise exception 'not_authorized_to_configure_annual_leave_entitlement' using errcode='42501';
  end if;

  select * into v_staff from public.staff where id=p_staff_id;
  if not found then
    raise exception 'staff_not_found' using errcode='22023';
  end if;

  select coalesce(sum(days_delta),0)
    into v_existing
  from public.staff_leave_ledger
  where staff_id=p_staff_id
    and leave_year=p_year
    and leave_type='annual_leave'
    and entry_type in ('opening','entitlement','accrual','carry_forward','adjustment')
    and days_delta>0;

  if v_existing > 0 then
    raise exception 'annual_leave_entitlement_already_configured' using errcode='23505';
  end if;

  v_key:=format('annual-entitlement:%s:%s:v1',p_staff_id,p_year);

  insert into public.staff_leave_ledger(
    staff_id,leave_year,leave_type,entry_type,days_delta,
    policy_version,reason,actor_id,actor_name,idempotency_key,metadata
  )
  values(
    p_staff_id,p_year,'annual_leave','entitlement',p_days,
    'annual_leave_v1',
    nullif(trim(coalesce(p_reason,'')),''),
    v_actor.id::text,
    coalesce(v_actor.name,v_actor.username),
    v_key,
    jsonb_build_object(
      'source','manual_top_management_configuration',
      'staff_name',v_staff.name,
      'configured_days',p_days
    )
  )
  returning id into v_id;

  return jsonb_build_object(
    'success',true,
    'ledger_id',v_id,
    'staff_id',p_staff_id,
    'staff_name',v_staff.name,
    'year',p_year,
    'days',p_days,
    'configured_by',coalesce(v_actor.name,v_actor.username),
    'configured_at',now()
  );
end;
$$;

revoke execute on function public.configure_annual_leave_entitlement_v1(uuid,integer,numeric,text) from public,anon;
grant execute on function public.configure_annual_leave_entitlement_v1(uuid,integer,numeric,text) to authenticated,service_role;
