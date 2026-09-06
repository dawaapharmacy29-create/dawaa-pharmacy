create or replace function public.dawaa_time_off_scope_all_v1()
returns boolean
language sql stable security definer
set search_path='public','pg_catalog'
as $$
  select public.dawaa_actor_is_top_management_v1()
    or lower(trim(coalesce(public.employee_operating_actor_role(),''))) in ('general_manager','executive_manager','branches_manager')
$$;
revoke all on function public.dawaa_time_off_scope_all_v1() from public;
grant execute on function public.dawaa_time_off_scope_all_v1() to anon,authenticated,service_role;

create or replace function public.dawaa_time_off_can_access_staff_v1(p_staff_id uuid)
returns boolean
language plpgsql stable security definer
set search_path='public','pg_catalog'
as $$
declare
  v_self uuid:=public.dawaa_current_staff_subject_uuid_v1();
  v_actor_branch text:=trim(coalesce(public.employee_operating_actor_branch(),''));
  v_staff_branch text;
begin
  if p_staff_id is null then return false; end if;
  if v_self=p_staff_id then return true; end if;
  if public.dawaa_time_off_scope_all_v1() then return true; end if;
  if not public.dawaa_current_actor_can(array['manage_time_off','approve_leave_request']::text[]) then return false; end if;
  select trim(coalesce(s.branch,'')) into v_staff_branch from public.staff s where s.id=p_staff_id;
  return v_actor_branch<>'' and v_staff_branch<>'' and lower(v_actor_branch)=lower(v_staff_branch);
end;
$$;
revoke all on function public.dawaa_time_off_can_access_staff_v1(uuid) from public;
grant execute on function public.dawaa_time_off_can_access_staff_v1(uuid) to anon,authenticated,service_role;

create or replace function public.dawaa_time_off_can_decide_staff_v1(p_staff_id uuid)
returns boolean
language sql stable security definer
set search_path='public','pg_catalog'
as $$
  select public.dawaa_time_off_can_access_staff_v1(p_staff_id)
    and (public.dawaa_time_off_scope_all_v1() or public.dawaa_current_actor_can(array['manage_time_off','approve_leave_request']::text[]))
$$;
revoke all on function public.dawaa_time_off_can_decide_staff_v1(uuid) from public;
grant execute on function public.dawaa_time_off_can_decide_staff_v1(uuid) to anon,authenticated,service_role;

create or replace function public.list_staff_time_off_requests_v1(
  p_staff_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_status text default null,
  p_limit integer default 200
)
returns setof public.staff_time_off_requests
language plpgsql stable security definer
set search_path='public','pg_catalog'
as $$
declare
  v_self uuid:=public.dawaa_current_staff_subject_uuid_v1();
  v_scope_all boolean:=public.dawaa_time_off_scope_all_v1();
  v_actor_branch text:=trim(coalesce(public.employee_operating_actor_branch(),''));
  v_can_manage boolean:=public.dawaa_current_actor_can(array['manage_time_off','approve_leave_request']::text[]);
begin
  if p_staff_id is not null and not public.dawaa_time_off_can_access_staff_v1(p_staff_id) then
    raise exception 'not_authorized_for_time_off' using errcode='42501';
  end if;
  if p_staff_id is null and not v_scope_all and not v_can_manage and v_self is null then
    raise exception 'not_authorized_for_time_off' using errcode='42501';
  end if;
  return query
  select r.* from public.staff_time_off_requests r
  where (
    case
      when p_staff_id is not null then r.staff_id=p_staff_id
      when v_scope_all then true
      when v_can_manage then lower(trim(coalesce(r.branch_snapshot,'')))=lower(v_actor_branch)
      else r.staff_id=v_self
    end
  )
    and (p_from is null or r.end_date>=p_from)
    and (p_to is null or r.start_date<=p_to)
    and (p_status is null or r.status=p_status)
  order by r.start_date desc,r.created_at desc
  limit least(greatest(coalesce(p_limit,200),1),500);
end;
$$;

create or replace function public.create_staff_time_off_request_v1(
  p_staff_id uuid,
  p_request_kind text,
  p_request_label text,
  p_start_date date,
  p_end_date date default null,
  p_start_time time default null,
  p_end_time time default null,
  p_duration_minutes integer default null,
  p_reason text default null
)
returns public.staff_time_off_requests
language plpgsql security definer
set search_path='public','pg_catalog'
as $$
declare
  v_self uuid:=public.dawaa_current_staff_subject_uuid_v1();
  v_staff public.staff%rowtype;
  v_row public.staff_time_off_requests%rowtype;
  v_actor text:=public.employee_operating_actor_id();
  v_actor_name text;
  v_actor_role text:=public.employee_operating_actor_role();
  v_end date:=coalesce(p_end_date,p_start_date);
  v_duration integer:=p_duration_minutes;
begin
  if p_staff_id is null or p_start_date is null then raise exception 'time_off_identity_or_date_missing' using errcode='22023'; end if;
  if v_self<>p_staff_id and not public.dawaa_time_off_can_decide_staff_v1(p_staff_id) then raise exception 'not_authorized_for_time_off' using errcode='42501'; end if;
  if p_request_kind not in ('permission','annual_leave','sick_leave','exceptional_leave','approved_absence','shift_swap') then raise exception 'invalid_time_off_kind' using errcode='22023'; end if;
  if v_end<p_start_date then raise exception 'invalid_time_off_date_range' using errcode='22023'; end if;
  if p_request_kind='permission' and v_duration is null and p_start_time is not null and p_end_time is not null then
    v_duration:=extract(epoch from ((p_start_date+p_end_time)-(p_start_date+p_start_time)))/60;
    if v_duration<0 then v_duration:=v_duration+1440; end if;
  end if;
  if p_request_kind='permission' and (v_duration is null or v_duration<=0) then raise exception 'permission_duration_required' using errcode='22023'; end if;
  if v_duration is not null and (v_duration<0 or v_duration>1440) then raise exception 'invalid_permission_duration' using errcode='22023'; end if;
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;
  select coalesce(sa.staff_name,sa.name,sa.username) into v_actor_name from public.staff_accounts sa where sa.id::text=v_actor limit 1;
  insert into public.staff_time_off_requests(staff_id,staff_name_snapshot,branch_snapshot,request_kind,request_label,status,start_date,end_date,start_time,end_time,duration_minutes,reason,requested_by,policy_version,source)
  values(v_staff.id,v_staff.name,v_staff.branch,p_request_kind,nullif(trim(coalesce(p_request_label,'')),''),'pending',p_start_date,v_end,p_start_time,p_end_time,v_duration,nullif(trim(coalesce(p_reason,'')),''),v_actor,'attendance_timeoff_v1','app') returning * into v_row;
  insert into public.staff_time_off_audit(request_id,staff_id,action,actor_id,actor_name,actor_role,after_state,reason)
  values(v_row.id,v_row.staff_id,'created',v_actor,v_actor_name,v_actor_role,to_jsonb(v_row),p_reason);
  return v_row;
end;
$$;

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
begin
  if p_decision not in ('approved','rejected') then raise exception 'invalid_time_off_decision' using errcode='22023'; end if;
  select * into v_before from public.staff_time_off_requests where id=p_request_id for update;
  if not found then raise exception 'time_off_request_not_found' using errcode='22023'; end if;
  if not public.dawaa_time_off_can_decide_staff_v1(v_before.staff_id) then raise exception 'not_authorized_for_time_off_decision' using errcode='42501'; end if;
  if v_before.status<>'pending' then return v_before; end if;
  if p_decision='rejected' and nullif(trim(coalesce(p_note,'')),'') is null then raise exception 'time_off_rejection_reason_required' using errcode='22023'; end if;
  select coalesce(sa.staff_name,sa.name,sa.username) into v_actor_name from public.staff_accounts sa where sa.id::text=v_actor limit 1;
  update public.staff_time_off_requests set status=p_decision,decided_by=v_actor,decided_by_name=v_actor_name,decided_at=now(),decision_note=nullif(trim(coalesce(p_note,'')),''),updated_at=now() where id=p_request_id returning * into v_after;
  insert into public.staff_time_off_audit(request_id,staff_id,action,actor_id,actor_name,actor_role,before_state,after_state,reason)
  values(v_after.id,v_after.staff_id,p_decision,v_actor,v_actor_name,v_actor_role,to_jsonb(v_before),to_jsonb(v_after),p_note);
  if v_after.request_kind='annual_leave' and p_decision='approved' then
    v_days:=(v_after.end_date-v_after.start_date)+1;
    insert into public.staff_leave_ledger(staff_id,leave_year,leave_type,entry_type,days_delta,request_id,policy_version,reason,actor_id,actor_name,idempotency_key)
    values(v_after.staff_id,extract(year from v_after.start_date)::int,'annual_leave','consumed',-v_days,v_after.id,'annual_leave_v1',coalesce(p_note,v_after.reason),v_actor,v_actor_name,'annual_leave_consumed:'||v_after.id::text)
    on conflict(idempotency_key) do nothing;
  end if;
  return v_after;
end;
$$;

create or replace function public.get_permission_policy_status_v2(p_staff_id uuid,p_cycle_start date,p_cycle_end date)
returns jsonb
language plpgsql stable security definer
set search_path='public','pg_catalog'
as $$
declare
  v_count integer;
  v_minutes integer;
  v_over integer;
  v_policy jsonb:=public.get_attendance_policy_v1(p_cycle_end);
  v_limit integer:=coalesce((v_policy->>'permission_limit_per_cycle')::int,2);
  v_max integer:=coalesce((v_policy->>'permission_max_minutes')::int,120);
begin
  if not public.dawaa_time_off_can_access_staff_v1(p_staff_id) then raise exception 'not_authorized_for_permission_status' using errcode='42501'; end if;
  select count(*),coalesce(sum(duration_minutes),0),count(*) filter(where duration_minutes>v_max)
  into v_count,v_minutes,v_over
  from public.staff_time_off_requests
  where staff_id=p_staff_id and request_kind='permission' and status='approved' and start_date between p_cycle_start and p_cycle_end;
  return jsonb_build_object('staff_id',p_staff_id,'approved_permissions',v_count,'allowance',v_limit,'remaining',greatest(0,v_limit-v_count),'exceeded_count',greatest(0,v_count-v_limit),'total_minutes',v_minutes,'max_minutes_per_permission',v_max,'over_duration_count',v_over,'requires_manager_review',(v_count>v_limit or v_over>0),'policy_version',coalesce(v_policy->>'policy_code','attendance_policy_v1'));
end;
$$;

create or replace function public.get_annual_leave_balance_v1(p_staff_id uuid,p_year integer)
returns jsonb
language plpgsql stable security definer
set search_path='public','pg_catalog'
as $$
declare
  v_balance numeric;
  v_used numeric;
  v_reserved numeric;
  v_positive numeric;
  v_configured boolean;
begin
  if not public.dawaa_time_off_can_access_staff_v1(p_staff_id) then raise exception 'not_authorized_for_leave_balance' using errcode='42501'; end if;
  select coalesce(sum(days_delta),0),coalesce(-sum(days_delta) filter(where entry_type='consumed'),0),coalesce(-sum(days_delta) filter(where entry_type='reserved'),0),coalesce(sum(days_delta) filter(where entry_type in ('opening','entitlement','accrual','carry_forward','adjustment') and days_delta>0),0)
  into v_balance,v_used,v_reserved,v_positive
  from public.staff_leave_ledger where staff_id=p_staff_id and leave_year=p_year and leave_type='annual_leave';
  v_configured:=v_positive>0;
  return jsonb_build_object('staff_id',p_staff_id,'year',p_year,'configured',v_configured,'balance',case when v_configured then v_balance else null end,'used',coalesce(v_used,0),'reserved',coalesce(v_reserved,0),'policy_version','annual_leave_v1');
end;
$$;
