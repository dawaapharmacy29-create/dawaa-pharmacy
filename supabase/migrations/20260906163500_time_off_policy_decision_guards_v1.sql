alter table public.attendance_policy_versions
  add column if not exists annual_leave_negative_balance_allowed boolean not null default false;

create or replace function public.decide_staff_time_off_request_v1(p_request_id uuid,p_decision text,p_note text default null)
returns public.staff_time_off_requests
language plpgsql security definer
set search_path='public','pg_catalog'
as $$
declare
  v_before public.staff_time_off_requests%rowtype;
  v_after public.staff_time_off_requests%rowtype;
  v_actor text:=public.employee_operating_actor_id();
  v_actor_name text;
  v_actor_role text:=public.employee_operating_actor_role();
  v_days numeric;
  v_policy jsonb;
  v_permission_limit integer;
  v_permission_max integer;
  v_prior_permissions integer;
  v_is_top boolean:=public.dawaa_time_off_scope_all_v1();
  v_leave_entitlement numeric;
  v_negative_allowed boolean;
  v_leave_balance numeric;
  v_leave_configured boolean;
begin
  if p_decision not in ('approved','rejected') then raise exception 'invalid_time_off_decision' using errcode='22023'; end if;
  select * into v_before from public.staff_time_off_requests where id=p_request_id for update;
  if not found then raise exception 'time_off_request_not_found' using errcode='22023'; end if;
  if not public.dawaa_time_off_can_decide_staff_v1(v_before.staff_id) then raise exception 'not_authorized_for_time_off_decision' using errcode='42501'; end if;
  if v_before.status<>'pending' then return v_before; end if;
  if p_decision='rejected' and nullif(trim(coalesce(p_note,'')),'') is null then raise exception 'time_off_rejection_reason_required' using errcode='22023'; end if;

  if p_decision='approved' then
    v_policy:=public.get_attendance_policy_v1(v_before.start_date);

    if v_before.request_kind='permission' then
      v_permission_limit:=coalesce((v_policy->>'permission_limit_per_cycle')::int,2);
      v_permission_max:=coalesce((v_policy->>'permission_max_minutes')::int,120);
      select count(*) into v_prior_permissions
      from public.staff_time_off_requests r
      where r.staff_id=v_before.staff_id and r.request_kind='permission' and r.status='approved'
        and r.start_date between public.current_points_cycle_start() and public.current_points_cycle_end();
      if (coalesce(v_before.duration_minutes,0)>v_permission_max or v_prior_permissions>=v_permission_limit) and not v_is_top then
        raise exception 'permission_policy_exception_requires_top_management' using errcode='42501';
      end if;
    end if;

    if v_before.request_kind='annual_leave' then
      v_leave_entitlement:=nullif(v_policy->>'annual_leave_entitlement_days','')::numeric;
      v_negative_allowed:=coalesce((v_policy->>'annual_leave_negative_balance_allowed')::boolean,false);
      select coalesce(sum(days_delta),0),
             coalesce(sum(days_delta) filter(where entry_type in ('opening','entitlement','accrual','carry_forward','adjustment') and days_delta>0),0)>0
      into v_leave_balance,v_leave_configured
      from public.staff_leave_ledger
      where staff_id=v_before.staff_id and leave_year=extract(year from v_before.start_date)::int and leave_type='annual_leave';
      if v_leave_entitlement is null and not v_leave_configured then
        raise exception 'annual_leave_policy_not_configured' using errcode='22023';
      end if;
      v_days:=(v_before.end_date-v_before.start_date)+1;
      if not v_negative_allowed and v_leave_configured and v_leave_balance<v_days then
        raise exception 'annual_leave_insufficient_balance' using errcode='22023';
      end if;
      if not v_negative_allowed and not v_leave_configured and v_leave_entitlement is not null and v_leave_entitlement<v_days then
        raise exception 'annual_leave_insufficient_balance' using errcode='22023';
      end if;
      if not v_leave_configured and v_leave_entitlement is not null then
        insert into public.staff_leave_ledger(staff_id,leave_year,leave_type,entry_type,days_delta,policy_version,reason,actor_id,actor_name,idempotency_key)
        values(v_before.staff_id,extract(year from v_before.start_date)::int,'annual_leave','entitlement',v_leave_entitlement,coalesce(v_policy->>'policy_code','annual_leave_v1'),'Annual leave entitlement initialized from active policy',v_actor,null,'annual_leave_entitlement:'||v_before.staff_id::text||':'||extract(year from v_before.start_date)::int::text)
        on conflict(idempotency_key) do nothing;
      end if;
    end if;
  end if;

  select coalesce(sa.staff_name,sa.name,sa.username) into v_actor_name from public.staff_accounts sa where sa.id::text=v_actor limit 1;
  update public.staff_time_off_requests
  set status=p_decision,decided_by=v_actor,decided_by_name=v_actor_name,decided_at=now(),decision_note=nullif(trim(coalesce(p_note,'')),''),updated_at=now()
  where id=p_request_id returning * into v_after;
  insert into public.staff_time_off_audit(request_id,staff_id,action,actor_id,actor_name,actor_role,before_state,after_state,reason)
  values(v_after.id,v_after.staff_id,p_decision,v_actor,v_actor_name,v_actor_role,to_jsonb(v_before),to_jsonb(v_after),p_note);

  if v_after.request_kind='annual_leave' and p_decision='approved' then
    v_days:=(v_after.end_date-v_after.start_date)+1;
    insert into public.staff_leave_ledger(staff_id,leave_year,leave_type,entry_type,days_delta,request_id,policy_version,reason,actor_id,actor_name,idempotency_key)
    values(v_after.staff_id,extract(year from v_after.start_date)::int,'annual_leave','consumed',-v_days,v_after.id,coalesce(v_policy->>'policy_code','annual_leave_v1'),coalesce(p_note,v_after.reason),v_actor,v_actor_name,'annual_leave_consumed:'||v_after.id::text)
    on conflict(idempotency_key) do nothing;
  end if;
  return v_after;
end;
$$;
