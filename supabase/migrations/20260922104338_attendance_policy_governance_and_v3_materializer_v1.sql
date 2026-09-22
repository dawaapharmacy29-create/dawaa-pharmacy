
create table if not exists public.attendance_policy_change_audit (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_id uuid,
  actor_name text,
  policy_version_id uuid,
  rollout_assignment_id uuid,
  scope_type text,
  scope_key text,
  effective_from date,
  effective_to date,
  before_snapshot jsonb,
  after_snapshot jsonb,
  note text,
  created_at timestamptz not null default now()
);

alter table public.attendance_policy_change_audit enable row level security;
revoke all on public.attendance_policy_change_audit from public,anon,authenticated;

create or replace function public.create_attendance_policy_version_v1(
  p_policy_code text,
  p_effective_from date,
  p_late_grace_minutes integer,
  p_very_late_minutes integer,
  p_early_leave_grace_minutes integer default null,
  p_overtime_threshold_minutes integer default null,
  p_rounding_minutes integer default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_base public.attendance_policy_versions%rowtype;
  v_new public.attendance_policy_versions%rowtype;
begin
  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true and coalesce(can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;
  if coalesce(v_actor.role,'') not in ('general_manager','admin','executive_manager','branches_manager') then
    raise exception 'not_authorized_for_policy_write' using errcode='42501';
  end if;

  if nullif(trim(coalesce(p_policy_code,'')),'') is null or p_effective_from is null then
    raise exception 'policy_code_and_effective_from_required' using errcode='22023';
  end if;
  if p_late_grace_minutes<0 or p_late_grace_minutes>240
     or p_very_late_minutes<p_late_grace_minutes or p_very_late_minutes>480
     or coalesce(p_early_leave_grace_minutes,0)<0 or coalesce(p_early_leave_grace_minutes,0)>240 then
    raise exception 'invalid_attendance_policy_thresholds' using errcode='22023';
  end if;

  select * into v_base
  from public.attendance_policy_versions p
  where coalesce(p.active,false)=true
  order by p.effective_from desc,p.created_at desc
  limit 1;
  if not found then raise exception 'base_attendance_policy_missing' using errcode='22023'; end if;

  insert into public.attendance_policy_versions(
    policy_code,effective_from,effective_to,active,
    late_grace_minutes,very_late_minutes,permission_limit_per_cycle,permission_max_minutes,
    weekly_off_allowance,authorized_absence_uncompensated_days,unauthorized_absence_days,
    annual_leave_entitlement_days,annual_leave_negative_balance_allowed,notes,
    expected_daily_hours,early_leave_grace_minutes,shift_margin_before_minutes,shift_margin_after_minutes,
    full_day_min_minutes,half_day_min_minutes,max_payable_minutes,auto_checkout_after_minutes,
    overtime_threshold_minutes,overtime_requires_approval,rounding_minutes,core_start,core_end
  )
  values(
    trim(p_policy_code),p_effective_from,null,true,
    p_late_grace_minutes,p_very_late_minutes,v_base.permission_limit_per_cycle,v_base.permission_max_minutes,
    v_base.weekly_off_allowance,v_base.authorized_absence_uncompensated_days,v_base.unauthorized_absence_days,
    v_base.annual_leave_entitlement_days,v_base.annual_leave_negative_balance_allowed,
    concat_ws(' | ',nullif(v_base.notes,''),nullif(trim(coalesce(p_note,'')),'')),
    v_base.expected_daily_hours,coalesce(p_early_leave_grace_minutes,v_base.early_leave_grace_minutes),
    v_base.shift_margin_before_minutes,v_base.shift_margin_after_minutes,
    v_base.full_day_min_minutes,v_base.half_day_min_minutes,v_base.max_payable_minutes,v_base.auto_checkout_after_minutes,
    coalesce(p_overtime_threshold_minutes,v_base.overtime_threshold_minutes),v_base.overtime_requires_approval,
    coalesce(p_rounding_minutes,v_base.rounding_minutes),v_base.core_start,v_base.core_end
  )
  returning * into v_new;

  insert into public.attendance_policy_change_audit(
    action,actor_id,actor_name,policy_version_id,effective_from,after_snapshot,note
  )
  values(
    'policy_version_created',v_actor.id,coalesce(v_actor.name,v_actor.username),v_new.id,v_new.effective_from,
    to_jsonb(v_new),nullif(trim(coalesce(p_note,'')),'')
  );

  return jsonb_build_object('success',true,'policy',to_jsonb(v_new));
end;
$$;

create or replace function public.assign_attendance_policy_v1(
  p_policy_version_id uuid,
  p_scope_type text,
  p_scope_key text default null,
  p_effective_from date default null,
  p_effective_to date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_policy public.attendance_policy_versions%rowtype;
  v_assignment public.attendance_policy_assignments%rowtype;
  v_key text:=nullif(trim(coalesce(p_scope_key,'')),'');
  v_date date;
begin
  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true and coalesce(can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;
  if coalesce(v_actor.role,'') not in ('general_manager','admin','executive_manager','branches_manager') then
    raise exception 'not_authorized_for_policy_write' using errcode='42501';
  end if;

  select * into v_policy from public.attendance_policy_versions where id=p_policy_version_id and active=true;
  if not found then raise exception 'policy_version_not_found' using errcode='22023'; end if;

  if p_scope_type not in ('staff','role','branch','default') then raise exception 'invalid_policy_scope' using errcode='22023'; end if;
  if p_scope_type='default' then v_key:=null;
  elsif v_key is null then raise exception 'policy_scope_key_required' using errcode='22023';
  end if;

  v_date:=coalesce(p_effective_from,v_policy.effective_from);
  if p_effective_to is not null and p_effective_to<v_date then raise exception 'invalid_policy_assignment_range' using errcode='22023'; end if;

  update public.attendance_policy_assignments
  set effective_to=v_date-1,updated_at=now()
  where active=true
    and scope_type=p_scope_type
    and coalesce(scope_key,'')=coalesce(v_key,'')
    and effective_from<v_date
    and (effective_to is null or effective_to>=v_date);

  insert into public.attendance_policy_assignments(
    policy_version_id,scope_type,scope_key,effective_from,effective_to,active,notes
  )
  values(p_policy_version_id,p_scope_type,v_key,v_date,p_effective_to,true,nullif(trim(coalesce(p_note,'')),''))
  returning * into v_assignment;

  insert into public.attendance_policy_change_audit(
    action,actor_id,actor_name,policy_version_id,scope_type,scope_key,effective_from,effective_to,after_snapshot,note
  )
  values(
    'policy_assigned',v_actor.id,coalesce(v_actor.name,v_actor.username),p_policy_version_id,
    p_scope_type,v_key,v_date,p_effective_to,to_jsonb(v_assignment),nullif(trim(coalesce(p_note,'')),'')
  );

  return jsonb_build_object('success',true,'assignment',to_jsonb(v_assignment));
end;
$$;

create or replace function public.set_attendance_policy_rollout_v1(
  p_scope_type text,
  p_scope_key text default null,
  p_mode text default 'shadow',
  p_effective_from date default null,
  p_effective_to date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_key text:=nullif(trim(coalesce(p_scope_key,'')),'');
  v_date date:=coalesce(p_effective_from,(now() at time zone 'Africa/Cairo')::date);
  v_rollout public.attendance_policy_rollout_assignments%rowtype;
begin
  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true and coalesce(can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;
  if coalesce(v_actor.role,'') not in ('general_manager','admin','executive_manager','branches_manager') then
    raise exception 'not_authorized_for_policy_write' using errcode='42501';
  end if;

  if p_scope_type not in ('staff','role','branch','default') then raise exception 'invalid_rollout_scope' using errcode='22023'; end if;
  if p_mode not in ('off','shadow','enforce') then raise exception 'invalid_rollout_mode' using errcode='22023'; end if;
  if p_scope_type='default' then v_key:=null;
  elsif v_key is null then raise exception 'rollout_scope_key_required' using errcode='22023';
  end if;
  if p_effective_to is not null and p_effective_to<v_date then raise exception 'invalid_rollout_range' using errcode='22023'; end if;

  update public.attendance_policy_rollout_assignments
  set effective_to=v_date-1,updated_at=now()
  where active=true
    and scope_type=p_scope_type
    and coalesce(scope_key,'')=coalesce(v_key,'')
    and effective_from<v_date
    and (effective_to is null or effective_to>=v_date);

  insert into public.attendance_policy_rollout_assignments(
    scope_type,scope_key,mode,effective_from,effective_to,active,note,created_by
  )
  values(p_scope_type,v_key,p_mode,v_date,p_effective_to,true,nullif(trim(coalesce(p_note,'')),''),v_actor.id)
  returning * into v_rollout;

  insert into public.attendance_policy_change_audit(
    action,actor_id,actor_name,rollout_assignment_id,scope_type,scope_key,effective_from,effective_to,after_snapshot,note
  )
  values(
    'rollout_set',v_actor.id,coalesce(v_actor.name,v_actor.username),v_rollout.id,p_scope_type,v_key,
    v_date,p_effective_to,to_jsonb(v_rollout),nullif(trim(coalesce(p_note,'')),'')
  );

  return jsonb_build_object('success',true,'rollout',to_jsonb(v_rollout));
end;
$$;

create or replace function public.list_attendance_policy_change_audit_v1(p_limit integer default 100)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_catalog'
as $$
begin
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','view_schedule','manage_payroll']) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(a) order by a.created_at desc)
    from (
      select * from public.attendance_policy_change_audit
      order by created_at desc
      limit greatest(1,least(coalesce(p_limit,100),300))
    ) a
  ),'[]'::jsonb);
end;
$$;

create or replace function public.attendance_policy_v3_compare_v1(
  p_start date,p_end date,p_branch text default null,p_limit integer default 30
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_catalog'
as $$
declare v_result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'invalid_v3_compare_range' using errcode='22023';
  end if;
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','view_schedule','manage_payroll']) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  with eligible as (
    select a.staff_id,a.attendance_date,a.branch,s.name staff_name
    from public.attendance_daily_summary a
    join public.staff s on s.id=a.staff_id
    where a.attendance_date between p_start and p_end
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(a.branch)=trim(p_branch))
      and public.dawaa_can_read_staff_attendance_log(a.staff_id,a.branch)
  ), compared as (
    select e.*,
      public.dawaa_build_attendance_day_resolution_v2(e.staff_id,e.attendance_date) v2,
      public.dawaa_build_attendance_day_resolution_v3(e.staff_id,e.attendance_date) v3
    from eligible e
  )
  select jsonb_build_object(
    'checked_days',(select count(*) from compared),
    'effective_status_changes',(select count(*) from compared where v2->>'resolution_status' is distinct from v3->>'resolution_status'),
    'candidate_changes',(select count(*) from compared where coalesce((v3->>'policy_candidate_changed')::boolean,false)),
    'shadow_days',(select count(*) from compared where v3->>'policy_rollout_mode'='shadow'),
    'enforced_days',(select count(*) from compared where v3->>'policy_rollout_mode'='enforce'),
    'samples',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',x.staff_id,'staff_name',x.staff_name,'branch',x.branch,'attendance_date',x.attendance_date,
        'v2_status',x.v2->>'resolution_status','v3_status',x.v3->>'resolution_status',
        'candidate_status',x.v3->>'policy_candidate_status','rollout_mode',x.v3->>'policy_rollout_mode',
        'policy_version',x.v3->>'resolved_policy_version'
      ) order by x.attendance_date desc,x.staff_name)
      from (
        select * from compared
        where (v2->>'resolution_status' is distinct from v3->>'resolution_status')
           or coalesce((v3->>'policy_candidate_changed')::boolean,false)
        order by attendance_date desc,staff_name
        limit greatest(1,least(coalesce(p_limit,30),100))
      ) x
    ),'[]'::jsonb),
    'generated_at',now()
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.dawaa_materialize_attendance_day_internal_v3(
  p_staff_id uuid,p_attendance_date date
)
returns public.attendance_daily_summary
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_preview jsonb;
  v_saved public.attendance_daily_summary%rowtype;
  v_system boolean;
  v_finalizable boolean;
  v_hours numeric;
  v_resolution_status text;
  v_action text;
begin
  select * into v_saved
  from public.attendance_daily_summary
  where staff_id=p_staff_id and attendance_date=p_attendance_date and status='approved'
  limit 1;
  if found then return v_saved; end if;

  v_preview:=public.dawaa_build_attendance_day_resolution_v3(p_staff_id,p_attendance_date);
  v_system:=coalesce((v_preview->>'system_resolvable')::boolean,false);
  v_finalizable:=coalesce((v_preview->>'finalizable')::boolean,false);
  v_resolution_status:=v_preview->>'resolution_status';

  if not v_finalizable then
    select * into v_saved from public.attendance_daily_summary where staff_id=p_staff_id and attendance_date=p_attendance_date limit 1;
    return v_saved;
  end if;

  v_hours:=case when v_resolution_status in ('off_day','approved_time_off') then 0 else coalesce((v_preview->>'candidate_hours')::numeric,0) end;

  insert into public.attendance_daily_summary(
    staff_id,attendance_date,branch,first_in,last_out,total_hours,late_minutes,early_leave_minutes,
    missing_punch,status,source,schedule_id,scheduled_start_at,scheduled_end_at,candidate_hours,
    payroll_eligible_hours,resolution_status,resolution_version,resolution_snapshot,approved_at,
    approved_by,approved_by_name,approval_note,updated_at,resolution_origin,review_required,
    resolved_at,time_off_request_id,policy_version,sync_complete_through
  )
  values(
    p_staff_id,p_attendance_date,v_preview->>'branch',
    nullif(v_preview->>'first_in','')::timestamptz,nullif(v_preview->>'last_out','')::timestamptz,
    coalesce((v_preview->>'candidate_hours')::numeric,0),coalesce((v_preview->>'late_minutes')::integer,0),
    coalesce((v_preview->>'early_leave_minutes')::integer,0),not v_system,
    case when v_system then 'approved' else 'pending_review' end,'attendance_resolution_v3',
    nullif(v_preview->>'schedule_id','')::uuid,nullif(v_preview->>'scheduled_start_at','')::timestamptz,
    nullif(v_preview->>'scheduled_end_at','')::timestamptz,coalesce((v_preview->>'candidate_hours')::numeric,0),
    case when v_system then v_hours else null end,v_resolution_status,3,v_preview,
    case when v_system then now() else null end,
    case when v_system then 'system:auto-attendance-v3' else null end,
    case when v_system then 'النظام التلقائي للحضور V3' else null end,null,now(),
    case when v_system then 'system' else 'review_queue' end,not v_system,now(),
    nullif(v_preview->>'time_off_request_id','')::uuid,v_preview->>'resolved_policy_version',
    nullif(v_preview->>'sync_complete_through','')::timestamptz
  )
  on conflict(staff_id,attendance_date) where staff_id is not null and attendance_date is not null
  do update set
    branch=excluded.branch,first_in=excluded.first_in,last_out=excluded.last_out,total_hours=excluded.total_hours,
    late_minutes=excluded.late_minutes,early_leave_minutes=excluded.early_leave_minutes,missing_punch=excluded.missing_punch,
    status=excluded.status,source=excluded.source,schedule_id=excluded.schedule_id,
    scheduled_start_at=excluded.scheduled_start_at,scheduled_end_at=excluded.scheduled_end_at,
    candidate_hours=excluded.candidate_hours,payroll_eligible_hours=excluded.payroll_eligible_hours,
    resolution_status=excluded.resolution_status,resolution_version=excluded.resolution_version,
    resolution_snapshot=excluded.resolution_snapshot,approved_at=excluded.approved_at,
    approved_by=excluded.approved_by,approved_by_name=excluded.approved_by_name,
    approval_note=excluded.approval_note,updated_at=excluded.updated_at,resolution_origin=excluded.resolution_origin,
    review_required=excluded.review_required,resolved_at=excluded.resolved_at,time_off_request_id=excluded.time_off_request_id,
    policy_version=excluded.policy_version,sync_complete_through=excluded.sync_complete_through
  where public.attendance_daily_summary.status is distinct from 'approved'
  returning * into v_saved;

  if v_saved.id is null then
    select * into v_saved from public.attendance_daily_summary where staff_id=p_staff_id and attendance_date=p_attendance_date limit 1;
  end if;

  if v_saved.id is not null then
    v_action:=case when v_saved.status='approved' then 'system_resolved_v3' else 'review_queued_v3' end;
    insert into public.attendance_resolution_audit(
      resolution_id,staff_id,attendance_date,action,actor_id,actor_name,note,snapshot
    )
    select v_saved.id,p_staff_id,p_attendance_date,v_action,'system:auto-attendance-v3',
      'النظام التلقائي للحضور V3',v_preview->>'reason',v_preview
    where not exists(
      select 1 from public.attendance_resolution_audit a
      where a.resolution_id=v_saved.id and a.action=v_action and a.snapshot=v_preview
    );
  end if;

  return v_saved;
end;
$$;

revoke execute on function public.create_attendance_policy_version_v1(text,date,integer,integer,integer,integer,integer,text) from public;
revoke execute on function public.assign_attendance_policy_v1(uuid,text,text,date,date,text) from public;
revoke execute on function public.set_attendance_policy_rollout_v1(text,text,text,date,date,text) from public;
revoke execute on function public.list_attendance_policy_change_audit_v1(integer) from public;
revoke execute on function public.attendance_policy_v3_compare_v1(date,date,text,integer) from public;
revoke execute on function public.dawaa_materialize_attendance_day_internal_v3(uuid,date) from public,anon,authenticated;

grant execute on function public.create_attendance_policy_version_v1(text,date,integer,integer,integer,integer,integer,text) to anon,authenticated,service_role;
grant execute on function public.assign_attendance_policy_v1(uuid,text,text,date,date,text) to anon,authenticated,service_role;
grant execute on function public.set_attendance_policy_rollout_v1(text,text,text,date,date,text) to anon,authenticated,service_role;
grant execute on function public.list_attendance_policy_change_audit_v1(integer) to anon,authenticated,service_role;
grant execute on function public.attendance_policy_v3_compare_v1(date,date,text,integer) to anon,authenticated,service_role;
grant execute on function public.dawaa_materialize_attendance_day_internal_v3(uuid,date) to service_role;
