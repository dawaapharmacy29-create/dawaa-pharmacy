create table if not exists public.attendance_policy_rollout_assignments (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('staff','role','branch','default')),
  scope_key text,
  mode text not null default 'shadow' check (mode in ('off','shadow','enforce')),
  effective_from date not null,
  effective_to date,
  active boolean not null default true,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope_type='default' and scope_key is null) or (scope_type<>'default' and nullif(trim(scope_key),'') is not null)),
  check (effective_to is null or effective_to>=effective_from)
);

create unique index if not exists attendance_policy_rollout_assignments_scope_idx
on public.attendance_policy_rollout_assignments(scope_type,coalesce(scope_key,''),effective_from,mode);

alter table public.attendance_policy_rollout_assignments enable row level security;
revoke all on public.attendance_policy_rollout_assignments from public,anon,authenticated;

insert into public.attendance_policy_rollout_assignments(scope_type,scope_key,mode,effective_from,note)
select 'default',null,'shadow',date '2026-01-01','Default safe rollout mode: shadow only'
where not exists(
  select 1 from public.attendance_policy_rollout_assignments
  where scope_type='default' and active=true
);

create or replace function public.dawaa_resolve_attendance_policy_internal_v1(p_staff_id uuid,p_date date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_staff public.staff%rowtype;
  v_result jsonb;
begin
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then return '{}'::jsonb; end if;

  with candidates as (
    select
      a.id assignment_id,a.scope_type,a.scope_key,a.policy_version_id,
      a.effective_from assignment_effective_from,a.effective_to assignment_effective_to,
      p.policy_code,p.effective_from policy_effective_from,p.effective_to policy_effective_to,
      p.late_grace_minutes,p.very_late_minutes,p.early_leave_grace_minutes,
      p.shift_margin_before_minutes,p.shift_margin_after_minutes,p.expected_daily_hours,
      p.full_day_min_minutes,p.half_day_min_minutes,p.max_payable_minutes,
      p.auto_checkout_after_minutes,p.overtime_threshold_minutes,p.overtime_requires_approval,
      p.rounding_minutes,p.core_start,p.core_end,p.permission_limit_per_cycle,
      p.permission_max_minutes,p.weekly_off_allowance,p.annual_leave_entitlement_days,p.notes,
      case a.scope_type when 'staff' then 1 when 'role' then 2 when 'branch' then 3 else 4 end priority
    from public.attendance_policy_assignments a
    join public.attendance_policy_versions p on p.id=a.policy_version_id and p.active=true
    where a.active=true
      and p_date>=a.effective_from and (a.effective_to is null or p_date<=a.effective_to)
      and p_date>=p.effective_from and (p.effective_to is null or p_date<=p.effective_to)
      and (
        (a.scope_type='staff' and a.scope_key=p_staff_id::text)
        or (a.scope_type='role' and lower(trim(a.scope_key))=lower(trim(coalesce(v_staff.role,''))))
        or (a.scope_type='branch' and trim(a.scope_key)=trim(coalesce(v_staff.branch,'')))
        or a.scope_type='default'
      )
  )
  select jsonb_build_object(
    'assignment_id',c.assignment_id,'scope_type',c.scope_type,'scope_key',c.scope_key,
    'policy_version_id',c.policy_version_id,'policy_code',c.policy_code,
    'effective_from',c.policy_effective_from,'effective_to',c.policy_effective_to,
    'assignment_effective_from',c.assignment_effective_from,'assignment_effective_to',c.assignment_effective_to,
    'late_grace_minutes',c.late_grace_minutes,'very_late_minutes',c.very_late_minutes,
    'early_leave_grace_minutes',c.early_leave_grace_minutes,
    'shift_margin_before_minutes',c.shift_margin_before_minutes,'shift_margin_after_minutes',c.shift_margin_after_minutes,
    'expected_daily_hours',c.expected_daily_hours,'full_day_min_minutes',c.full_day_min_minutes,
    'half_day_min_minutes',c.half_day_min_minutes,'max_payable_minutes',c.max_payable_minutes,
    'auto_checkout_after_minutes',c.auto_checkout_after_minutes,
    'overtime_threshold_minutes',c.overtime_threshold_minutes,
    'overtime_requires_approval',c.overtime_requires_approval,'rounding_minutes',c.rounding_minutes,
    'core_start',c.core_start,'core_end',c.core_end,
    'permission_limit_per_cycle',c.permission_limit_per_cycle,'permission_max_minutes',c.permission_max_minutes,
    'weekly_off_allowance',c.weekly_off_allowance,'annual_leave_entitlement_days',c.annual_leave_entitlement_days,
    'notes',c.notes
  ) into v_result
  from candidates c
  order by c.priority,c.assignment_effective_from desc,c.policy_effective_from desc
  limit 1;

  return coalesce(v_result,'{}'::jsonb);
end;
$function$;

create or replace function public.resolve_attendance_policy_v2(p_staff_id uuid,p_date date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_catalog'
as $function$
declare v_staff public.staff%rowtype;
begin
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'staff not found' using errcode='22023'; end if;
  if not public.dawaa_can_read_staff_attendance_log(v_staff.id,v_staff.branch) then raise exception 'not authorized' using errcode='42501'; end if;
  return public.dawaa_resolve_attendance_policy_internal_v1(p_staff_id,p_date);
end;
$function$;

create or replace function public.dawaa_resolve_policy_rollout_internal_v1(p_staff_id uuid,p_date date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_staff public.staff%rowtype;
  v_result jsonb;
begin
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then return jsonb_build_object('mode','shadow'); end if;

  with candidates as (
    select r.*,
      case r.scope_type when 'staff' then 1 when 'role' then 2 when 'branch' then 3 else 4 end priority
    from public.attendance_policy_rollout_assignments r
    where r.active=true
      and p_date>=r.effective_from
      and (r.effective_to is null or p_date<=r.effective_to)
      and (
        (r.scope_type='staff' and r.scope_key=p_staff_id::text)
        or (r.scope_type='role' and lower(trim(r.scope_key))=lower(trim(coalesce(v_staff.role,''))))
        or (r.scope_type='branch' and trim(r.scope_key)=trim(coalesce(v_staff.branch,'')))
        or r.scope_type='default'
      )
  )
  select jsonb_build_object(
    'assignment_id',id,'scope_type',scope_type,'scope_key',scope_key,'mode',mode,
    'effective_from',effective_from,'effective_to',effective_to,'note',note
  ) into v_result
  from candidates
  order by priority,effective_from desc,created_at desc
  limit 1;

  return coalesce(v_result,jsonb_build_object('mode','shadow'));
end;
$function$;

create or replace function public.list_attendance_policy_rollout_v1()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','view_schedule','manage_payroll']) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(r) order by
      case r.scope_type when 'staff' then 1 when 'role' then 2 when 'branch' then 3 else 4 end,
      r.effective_from desc
    )
    from public.attendance_policy_rollout_assignments r
    where r.active=true
  ),'[]'::jsonb);
end;
$function$;

create or replace function public.dawaa_build_attendance_day_resolution_v3(p_staff_id uuid,p_attendance_date date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_base jsonb;
  v_policy jsonb;
  v_rollout jsonb;
  v_mode text;
  v_current text;
  v_candidate text;
  v_late integer;
  v_early integer;
  v_late_grace integer;
  v_very_late integer;
  v_early_grace integer;
  v_permission boolean;
  v_system boolean;
begin
  v_base:=public.dawaa_build_attendance_day_resolution_v2(p_staff_id,p_attendance_date);
  v_policy:=public.dawaa_resolve_attendance_policy_internal_v1(p_staff_id,p_attendance_date);
  v_rollout:=public.dawaa_resolve_policy_rollout_internal_v1(p_staff_id,p_attendance_date);
  v_mode:=coalesce(v_rollout->>'mode','shadow');
  v_current:=v_base->>'resolution_status';
  v_late:=coalesce((v_base->>'late_minutes')::integer,0);
  v_early:=coalesce((v_base->>'early_leave_minutes')::integer,0);
  v_permission:=coalesce((v_base->>'permission_attached')::boolean,false);
  v_late_grace:=coalesce(nullif(v_policy->>'late_grace_minutes','')::integer,nullif(v_base->>'late_grace_minutes','')::integer,15);
  v_very_late:=greatest(v_late_grace,coalesce(nullif(v_policy->>'very_late_minutes','')::integer,nullif(v_base->>'very_late_minutes','')::integer,30));
  v_early_grace:=greatest(0,coalesce(nullif(v_policy->>'early_leave_grace_minutes','')::integer,0));

  v_candidate:=case
    when v_current not in ('on_time','on_time_with_permission','late','very_late','early_leave_review') then v_current
    when v_early>v_early_grace and not v_permission then 'early_leave_review'
    when v_late>v_very_late then 'very_late'
    when v_late>v_late_grace then 'late'
    else case when v_permission then 'on_time_with_permission' else 'on_time' end
  end;

  if v_mode='enforce' and v_candidate is distinct from v_current then
    v_system:=v_candidate in ('on_time','on_time_with_permission','late','very_late');
    v_base:=v_base || jsonb_build_object(
      'resolution_status',v_candidate,
      'system_resolvable',v_system,
      'review_required',not v_system,
      'reason','policy_v3_enforced',
      'resolution_version',3
    );
  else
    v_base:=v_base || jsonb_build_object('resolution_version',3);
  end if;

  return v_base || jsonb_build_object(
    'policy_rollout_mode',v_mode,
    'policy_rollout_assignment_id',v_rollout->>'assignment_id',
    'resolved_policy_version',v_policy->>'policy_code',
    'resolved_late_grace_minutes',v_late_grace,
    'resolved_very_late_minutes',v_very_late,
    'resolved_early_leave_grace_minutes',v_early_grace,
    'policy_candidate_status',v_candidate,
    'policy_candidate_changed',v_candidate is distinct from v_current,
    'policy_enforced',v_mode='enforce',
    'policy_base_status',v_current
  );
end;
$function$;

revoke execute on function public.dawaa_resolve_attendance_policy_internal_v1(uuid,date) from public,anon,authenticated;
revoke execute on function public.dawaa_resolve_policy_rollout_internal_v1(uuid,date) from public,anon,authenticated;
revoke execute on function public.list_attendance_policy_rollout_v1() from public;
revoke execute on function public.dawaa_build_attendance_day_resolution_v3(uuid,date) from public;
grant execute on function public.dawaa_resolve_attendance_policy_internal_v1(uuid,date) to service_role;
grant execute on function public.dawaa_resolve_policy_rollout_internal_v1(uuid,date) to service_role;
grant execute on function public.list_attendance_policy_rollout_v1() to anon,authenticated,service_role;
grant execute on function public.dawaa_build_attendance_day_resolution_v3(uuid,date) to anon,authenticated,service_role;
