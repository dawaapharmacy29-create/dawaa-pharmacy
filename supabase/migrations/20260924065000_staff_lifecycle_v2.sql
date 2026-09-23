-- HR Staff Lifecycle V2
-- Effective-dated employment lifecycle with reviewed transitions and operational projection.
-- States: active -> leaving -> archived, with explicit reactivation support.
-- Historical records are preserved; archiving disables operational visibility/login without deleting data.

create table if not exists public.hr_staff_lifecycle_changes_v2 (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  effective_from date not null,
  target_state text not null check (target_state in ('active','leaving','archived')),
  last_working_date date,
  separation_kind text check (separation_kind is null or separation_kind in ('resignation','termination','contract_end','retirement','transfer_out','other')),
  reason text not null check (length(trim(reason)) between 3 and 1000),
  state text not null default 'pending' check (state in ('pending','approved','rejected','cancelled')),
  requested_by uuid not null references public.staff_accounts(id) on delete restrict,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.staff_accounts(id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  projection_applied_at timestamptz,
  offboarding_applied_at timestamptz,
  previous_staff_status text,
  previous_active boolean,
  previous_is_active boolean,
  previous_visible_in_schedule boolean,
  created_at timestamptz not null default now(),
  constraint hr_staff_lifecycle_v2_last_day_chk check (
    (target_state='leaving' and last_working_date is not null and last_working_date>=effective_from)
    or (target_state<>'leaving')
  )
);

create index if not exists hr_staff_lifecycle_v2_staff_idx
  on public.hr_staff_lifecycle_changes_v2(staff_id,effective_from desc,created_at desc);
create index if not exists hr_staff_lifecycle_v2_pending_idx
  on public.hr_staff_lifecycle_changes_v2(requested_at desc) where state='pending';
create unique index if not exists hr_staff_lifecycle_v2_one_pending_per_staff
  on public.hr_staff_lifecycle_changes_v2(staff_id) where state='pending';
create unique index if not exists hr_staff_lifecycle_v2_one_approved_effective
  on public.hr_staff_lifecycle_changes_v2(staff_id,effective_from) where state='approved';

alter table public.hr_staff_lifecycle_changes_v2 enable row level security;
revoke all on public.hr_staff_lifecycle_changes_v2 from public,anon,authenticated;
grant select,insert,update on public.hr_staff_lifecycle_changes_v2 to service_role;

create or replace function public.hr_staff_lifecycle_snapshot_v2(p_staff_id uuid,p_as_of date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare
  v_staff public.staff%rowtype;
  v_date date:=coalesce(p_as_of,(now() at time zone 'Africa/Cairo')::date);
  v_current jsonb;
  v_history jsonb;
  v_effective_state text;
begin
  if p_staff_id is null then raise exception 'staff_id_required' using errcode='22023'; end if;
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;

  if not public.dawaa_can_read_staff_attendance_log(v_staff.id,v_staff.branch)
     and not public.dawaa_current_actor_can(array['view_staff_accounts','view_team','view_staff_details']) then
    raise exception 'not_authorized_for_staff_lifecycle' using errcode='42501';
  end if;

  select jsonb_build_object(
    'id',x.id,'staff_id',x.staff_id,'effective_from',x.effective_from,'target_state',x.target_state,
    'effective_state',case when x.target_state='leaving' and x.last_working_date is not null and v_date>x.last_working_date then 'archived' else x.target_state end,
    'last_working_date',x.last_working_date,'separation_kind',x.separation_kind,'reason',x.reason,'state',x.state,
    'requested_at',x.requested_at,'decided_at',x.decided_at,'decision_note',x.decision_note,
    'projection_applied_at',x.projection_applied_at,'offboarding_applied_at',x.offboarding_applied_at,
    'requested_by_name',coalesce(req.name,req.username),'decided_by_name',coalesce(dec.name,dec.username)
  )
  into v_current
  from public.hr_staff_lifecycle_changes_v2 x
  left join public.staff_accounts req on req.id=x.requested_by
  left join public.staff_accounts dec on dec.id=x.decided_by
  where x.staff_id=p_staff_id and x.state='approved' and x.effective_from<=v_date
  order by x.effective_from desc,x.decided_at desc nulls last,x.created_at desc
  limit 1;

  if v_current is null then
    v_effective_state:=case
      when coalesce(v_staff.active,v_staff.is_active,true)=false
        or lower(trim(coalesce(v_staff.status,''))) in ('غير نشط','inactive','disabled','archived')
      then 'archived' else 'active' end;
    v_current:=jsonb_build_object(
      'id',null,'staff_id',v_staff.id,'effective_from',v_staff.join_date,
      'target_state',v_effective_state,'effective_state',v_effective_state,
      'last_working_date',null,'separation_kind',null,'reason','legacy_staff_projection',
      'state','legacy_projection','requested_at',null,'decided_at',null,'decision_note',null,
      'projection_applied_at',null,'offboarding_applied_at',null,'requested_by_name',null,'decided_by_name',null
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'staff_id',x.staff_id,'effective_from',x.effective_from,'target_state',x.target_state,
    'last_working_date',x.last_working_date,'separation_kind',x.separation_kind,'reason',x.reason,'state',x.state,
    'requested_at',x.requested_at,'decided_at',x.decided_at,'decision_note',x.decision_note,
    'projection_applied_at',x.projection_applied_at,'offboarding_applied_at',x.offboarding_applied_at,
    'requested_by_name',coalesce(req.name,req.username),'decided_by_name',coalesce(dec.name,dec.username)
  ) order by x.effective_from desc,x.requested_at desc),'[]'::jsonb)
  into v_history
  from public.hr_staff_lifecycle_changes_v2 x
  left join public.staff_accounts req on req.id=x.requested_by
  left join public.staff_accounts dec on dec.id=x.decided_by
  where x.staff_id=p_staff_id;

  return jsonb_build_object(
    'staff_id',v_staff.id,'staff_name',v_staff.name,'as_of',v_date,'current',v_current,
    'projection',jsonb_build_object('status',v_staff.status,'active',v_staff.active,'is_active',v_staff.is_active,'visible_in_schedule',v_staff.visible_in_schedule),
    'history',v_history,'generated_at',now()
  );
end;
$$;

create or replace function public.hr_staff_lifecycle_change_v2(
  p_action text,p_staff_id uuid default null,p_change_id uuid default null,p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_staff public.staff%rowtype;
  v_row public.hr_staff_lifecycle_changes_v2%rowtype;
  v_action text:=lower(trim(coalesce(p_action,'')));
  v_effective date; v_last date; v_target text; v_kind text; v_reason text; v_note text; v_id uuid;
begin
  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true and coalesce(can_login,false)=true;
  if not found or coalesce(v_actor.role,'') not in ('general_manager','admin','executive_manager','branches_manager') then
    raise exception 'not_authorized_for_staff_lifecycle_change' using errcode='42501';
  end if;

  if v_action='list_pending' then
    return coalesce((
      select jsonb_agg(to_jsonb(x) order by x.requested_at)
      from (
        select c.id,c.staff_id,s.name staff_name,s.branch,s.role,c.effective_from,c.target_state,c.last_working_date,
          c.separation_kind,c.reason,c.state,c.requested_at,coalesce(req.name,req.username) requested_by_name
        from public.hr_staff_lifecycle_changes_v2 c
        join public.staff s on s.id=c.staff_id
        left join public.staff_accounts req on req.id=c.requested_by
        where c.state='pending'
        order by c.requested_at limit 200
      ) x
    ),'[]'::jsonb);
  end if;

  if v_action='request' then
    select * into v_staff from public.staff where id=p_staff_id;
    if not found then raise exception 'staff_not_found' using errcode='22023'; end if;

    v_effective:=nullif(p_payload->>'effective_from','')::date;
    v_target:=lower(trim(coalesce(p_payload->>'target_state','')));
    v_last:=nullif(p_payload->>'last_working_date','')::date;
    v_kind:=nullif(lower(trim(coalesce(p_payload->>'separation_kind',''))),'');
    v_reason:=nullif(trim(coalesce(p_payload->>'reason','')),'');

    if v_effective is null or v_target not in ('active','leaving','archived') or length(coalesce(v_reason,''))<3 then
      raise exception 'invalid_staff_lifecycle_request' using errcode='22023';
    end if;
    if v_target='leaving' and (v_last is null or v_last<v_effective) then
      raise exception 'leaving_requires_valid_last_working_date' using errcode='22023';
    end if;
    if v_target in ('leaving','archived') and v_kind is null then
      raise exception 'separation_kind_required' using errcode='22023';
    end if;
    if v_kind is not null and v_kind not in ('resignation','termination','contract_end','retirement','transfer_out','other') then
      raise exception 'invalid_separation_kind' using errcode='22023';
    end if;
    if exists(select 1 from public.hr_staff_lifecycle_changes_v2 c where c.staff_id=p_staff_id and c.state='pending') then
      raise exception 'pending_staff_lifecycle_change_already_exists' using errcode='23505';
    end if;

    insert into public.hr_staff_lifecycle_changes_v2(
      staff_id,effective_from,target_state,last_working_date,separation_kind,reason,state,requested_by,
      previous_staff_status,previous_active,previous_is_active,previous_visible_in_schedule
    )
    values(
      p_staff_id,v_effective,v_target,v_last,v_kind,v_reason,'pending',v_actor.id,
      v_staff.status,v_staff.active,v_staff.is_active,v_staff.visible_in_schedule
    )
    returning id into v_id;
    return jsonb_build_object('success',true,'id',v_id,'state','pending');
  end if;

  if v_action='cancel' then
    select * into v_row from public.hr_staff_lifecycle_changes_v2 where id=p_change_id for update;
    if not found or v_row.state<>'pending' then raise exception 'staff_lifecycle_change_not_found_or_closed' using errcode='22023'; end if;
    if v_row.requested_by<>v_actor.id and coalesce(v_actor.role,'') not in ('general_manager','executive_manager') then
      raise exception 'not_authorized_to_cancel_staff_lifecycle_change' using errcode='42501';
    end if;
    update public.hr_staff_lifecycle_changes_v2
    set state='cancelled',decided_by=v_actor.id,decided_at=now(),decision_note=nullif(trim(coalesce(p_payload->>'note','')),'')
    where id=v_row.id;
    return jsonb_build_object('success',true,'id',v_row.id,'state','cancelled');
  end if;

  if v_action not in ('approve','reject') then raise exception 'invalid_staff_lifecycle_action' using errcode='22023'; end if;
  if coalesce(v_actor.role,'') not in ('general_manager','executive_manager') then
    raise exception 'staff_lifecycle_decision_requires_top_management' using errcode='42501';
  end if;

  select * into v_row from public.hr_staff_lifecycle_changes_v2 where id=p_change_id for update;
  if not found or v_row.state<>'pending' then raise exception 'staff_lifecycle_change_not_found_or_closed' using errcode='22023'; end if;
  if v_row.requested_by=v_actor.id then raise exception 'staff_lifecycle_requester_cannot_approve_own_request' using errcode='42501'; end if;

  v_note:=nullif(trim(coalesce(p_payload->>'note','')),'');
  if v_action='reject' and v_note is null then raise exception 'staff_lifecycle_rejection_reason_required' using errcode='22023'; end if;

  update public.hr_staff_lifecycle_changes_v2
  set state=case when v_action='approve' then 'approved' else 'rejected' end,
      decided_by=v_actor.id,decided_at=now(),decision_note=v_note
  where id=v_row.id returning * into v_row;

  if v_action='approve' then perform public.hr_apply_due_staff_lifecycle_v2(v_row.staff_id); end if;

  return jsonb_build_object('success',true,'id',v_row.id,
    'state',case when v_action='approve' then 'approved' else 'rejected' end,
    'effective_from',v_row.effective_from,'target_state',v_row.target_state);
end;
$$;

create or replace function public.hr_apply_due_staff_lifecycle_v2(p_staff_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_catalog' as $$
declare
  v_today date:=(now() at time zone 'Africa/Cairo')::date;
  v_item record;
  v_state text;
  v_count integer:=0;
begin
  for v_item in
    select distinct on (c.staff_id)
      c.*,s.name staff_name,s.status current_status,s.active current_active,
      s.is_active current_is_active,s.visible_in_schedule current_visible
    from public.hr_staff_lifecycle_changes_v2 c
    join public.staff s on s.id=c.staff_id
    where c.state='approved' and c.effective_from<=v_today and (p_staff_id is null or c.staff_id=p_staff_id)
    order by c.staff_id,c.effective_from desc,c.decided_at desc nulls last,c.created_at desc
  loop
    v_state:=case
      when v_item.target_state='leaving' and v_item.last_working_date is not null and v_today>v_item.last_working_date then 'archived'
      else v_item.target_state
    end;

    if v_state='active' then
      update public.staff
      set status='نشط',active=true,is_active=true,visible_in_schedule=true,updated_at=now()
      where id=v_item.staff_id
        and (coalesce(active,false)=false or coalesce(is_active,false)=false or coalesce(visible_in_schedule,false)=false or lower(trim(coalesce(status,'')))<>'نشط');
      if v_item.projection_applied_at is null then
        update public.hr_staff_lifecycle_changes_v2 set projection_applied_at=now() where id=v_item.id;
        perform public.add_staff_employment_event_v1(
          v_item.staff_id,'lifecycle_active',v_item.effective_from,'تفعيل الموظف',v_item.reason,
          jsonb_build_object('status',v_item.previous_staff_status,'active',v_item.previous_active),
          jsonb_build_object('status','نشط','active',true,'visible_in_schedule',true),
          'hr_lifecycle_v2',v_item.id::text);
      end if;

    elsif v_state='leaving' then
      update public.staff
      set status='قيد المغادرة',active=true,is_active=true,visible_in_schedule=true,updated_at=now()
      where id=v_item.staff_id
        and (coalesce(status,'')<>'قيد المغادرة' or coalesce(active,false)=false or coalesce(is_active,false)=false or coalesce(visible_in_schedule,false)=false);
      if v_item.projection_applied_at is null then
        update public.hr_staff_lifecycle_changes_v2 set projection_applied_at=now() where id=v_item.id;
        perform public.add_staff_employment_event_v1(
          v_item.staff_id,'lifecycle_leaving',v_item.effective_from,'بدء فترة مغادرة الموظف',v_item.reason,
          jsonb_build_object('status',v_item.previous_staff_status,'active',v_item.previous_active),
          jsonb_build_object('status','قيد المغادرة','last_working_date',v_item.last_working_date,'separation_kind',v_item.separation_kind),
          'hr_lifecycle_v2',v_item.id::text||':leaving');
      end if;

    else
      update public.staff
      set status='غير نشط',active=false,is_active=false,visible_in_schedule=false,updated_at=now()
      where id=v_item.staff_id
        and (coalesce(active,true)=true or coalesce(is_active,true)=true or coalesce(visible_in_schedule,true)=true
          or lower(trim(coalesce(status,''))) not in ('غير نشط','inactive','disabled','archived'));

      update public.staff_accounts
      set active=false,can_login=false,updated_at=now()
      where trim(coalesce(staff_id,''))=v_item.staff_id::text
        and (coalesce(active,false)=true or coalesce(can_login,false)=true);

      if v_item.projection_applied_at is null then
        update public.hr_staff_lifecycle_changes_v2 set projection_applied_at=now() where id=v_item.id;
      end if;

      if v_item.offboarding_applied_at is null then
        update public.hr_staff_lifecycle_changes_v2 set offboarding_applied_at=now() where id=v_item.id;
        perform public.add_staff_employment_event_v1(
          v_item.staff_id,'lifecycle_archived',
          case when v_item.target_state='leaving' then v_item.last_working_date+1 else v_item.effective_from end,
          'أرشفة الموظف وإنهاء الظهور التشغيلي',v_item.reason,
          jsonb_build_object('status',v_item.current_status,'active',v_item.current_active,'visible_in_schedule',v_item.current_visible),
          jsonb_build_object('status','غير نشط','active',false,'visible_in_schedule',false,'login_disabled',true,'separation_kind',v_item.separation_kind),
          'hr_lifecycle_v2',v_item.id::text||':archived');
      end if;
    end if;
    v_count:=v_count+1;
  end loop;

  return jsonb_build_object('success',true,'processed_staff',v_count,'as_of',v_today);
end;
$$;

revoke execute on function public.hr_staff_lifecycle_snapshot_v2(uuid,date) from public;
revoke execute on function public.hr_staff_lifecycle_change_v2(text,uuid,uuid,jsonb) from public;
revoke execute on function public.hr_apply_due_staff_lifecycle_v2(uuid) from public,anon,authenticated;
grant execute on function public.hr_staff_lifecycle_snapshot_v2(uuid,date) to anon,authenticated,service_role;
grant execute on function public.hr_staff_lifecycle_change_v2(text,uuid,uuid,jsonb) to anon,authenticated,service_role;
grant execute on function public.hr_apply_due_staff_lifecycle_v2(uuid) to service_role;

create or replace function public.hr_workforce_cycle_readiness_v2(p_month_cycle text default null,p_branch text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog' as $$
declare
  v_month text; v_start date; v_end date; v_effective_end date;
  v_truth jsonb; v_hr jsonb; v_ot jsonb; v_payroll jsonb; v_can_payroll boolean:=false;
  v_lifecycle_pending integer:=0; v_archived_login_enabled integer:=0;
begin
  if p_month_cycle is not null then
    if trim(p_month_cycle) !~ '^\d{4}-\d{2}$' then raise exception 'invalid_month_cycle' using errcode='22023'; end if;
    select cycle_start,cycle_end into v_start,v_end from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));
    v_month:=p_month_cycle;
  else
    select cycle_start,cycle_end,month_cycle into v_start,v_end,v_month from public.dawaa_pay_cycle_bounds_v1(null);
  end if;

  if not public.dawaa_current_actor_can(array['view_schedule','view_attendance_leaves','view_staff_accounts','manage_payroll']) then
    raise exception 'not_authorized_for_hr_command_center' using errcode='42501';
  end if;

  v_effective_end:=least(v_end,(now() at time zone 'Africa/Cairo')::date);
  if v_effective_end<v_start then v_effective_end:=v_start; end if;

  v_hr:=public.hr_truth_quality_snapshot_v2(v_effective_end,p_branch);
  v_truth:=public.attendance_truth_cycle_v2(v_start,v_effective_end,p_branch);
  v_ot:=public.overtime_truth_status_v2(v_start,v_effective_end,p_branch);
  v_can_payroll:=public.dawaa_current_actor_can(array['manage_payroll']);

  select count(*)::int into v_lifecycle_pending
  from public.hr_staff_lifecycle_changes_v2 c join public.staff s on s.id=c.staff_id
  where c.state='pending'
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch));

  select count(distinct s.id)::int into v_archived_login_enabled
  from public.staff s join public.staff_accounts a on trim(coalesce(a.staff_id,''))=s.id::text
  where coalesce(s.active,s.is_active,true)=false
    and (coalesce(a.active,false)=true or coalesce(a.can_login,false)=true)
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch));

  if v_can_payroll then
    begin
      v_payroll:=public.payroll_cycle_finalization_overview_v1(v_month,p_branch,200);
    exception when others then
      v_payroll:=jsonb_build_object('available',false,'reason','payroll_overview_unavailable');
    end;
  else
    v_payroll:=jsonb_build_object('available',false,'reason','payroll_permission_required');
  end if;

  return jsonb_build_object(
    'month_cycle',v_month,'cycle_start',v_start,'cycle_end',v_end,'effective_end',v_effective_end,'branch',p_branch,
    'cycle_closed',((now() at time zone 'Africa/Cairo')::date>v_end),
    'hr_truth',v_hr,'attendance_truth',v_truth,'overtime_truth',v_ot,'payroll_readiness',v_payroll,
    'actions',jsonb_build_object(
      'structural_hr_issues',coalesce((v_hr->>'active_without_schedule')::int,0)+coalesce((v_hr->>'active_schedule_branch_mismatch')::int,0)+coalesce((v_hr->>'legacy_shift_drift')::int,0)+coalesce((v_hr->>'archived_visible_in_schedule')::int,0),
      'attendance_pending',coalesce((v_truth->'summary'->>'pending_attendance_days')::int,0),
      'corrections_pending',coalesce((v_truth->'summary'->>'pending_corrections')::int,0),
      'timeoff_pending',coalesce((v_truth->'summary'->>'pending_timeoff')::int,0),
      'overtime_pending',coalesce((v_ot->>'pending')::int,0),
      'overtime_stale_approved',coalesce((v_ot->>'approved_stale')::int,0),
      'payroll_blocked_staff',coalesce((v_payroll->>'blocked_count')::int,0),
      'lifecycle_pending',v_lifecycle_pending,
      'archived_login_enabled',v_archived_login_enabled
    ),
    'gates',jsonb_build_object(
      'hr_truth_ready',coalesce((v_hr->>'active_without_schedule')::int,0)=0 and coalesce((v_hr->>'active_schedule_branch_mismatch')::int,0)=0
        and coalesce((v_hr->>'archived_visible_in_schedule')::int,0)=0 and v_archived_login_enabled=0,
      'attendance_truth_ready',coalesce((v_truth->'summary'->>'ready_for_payroll_truth')::boolean,false),
      'overtime_truth_ready',coalesce((v_ot->>'approved_stale')::int,0)=0,
      'payroll_ready',case when v_can_payroll then coalesce((v_payroll->>'blocked_count')::int,0)=0 else null end
    ),
    'generated_at',now()
  );
end;
$$;

select public.hr_apply_due_staff_lifecycle_v2(null);

do $$
begin
  if exists(select 1 from pg_extension where extname='pg_cron')
     and not exists(select 1 from cron.job where jobname='hr-apply-due-staff-lifecycle-v2') then
    perform cron.schedule('hr-apply-due-staff-lifecycle-v2','7 * * * *','select public.hr_apply_due_staff_lifecycle_v2(null);');
  end if;
end $$;
