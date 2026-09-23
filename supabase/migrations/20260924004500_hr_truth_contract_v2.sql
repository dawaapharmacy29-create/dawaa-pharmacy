-- HR Truth Contract V2
-- Centralizes canonical employee + schedule quality checks so HR surfaces stop re-implementing them.

create or replace function public.hr_truth_quality_snapshot_v2(
  p_date date default null,
  p_branch text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Africa/Cairo')::date);
  v_result jsonb;
begin
  if not public.dawaa_current_actor_can(array['view_schedule','view_attendance_leaves','view_staff_accounts']) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  with active_staff as (
    select s.id, s.name, s.role, s.branch, s.shift_start, s.shift_end,
           coalesce(s.visible_in_schedule,true) as visible_in_schedule
    from public.staff s
    where coalesce(s.active,s.is_active,true)
      and lower(trim(coalesce(s.status,'active'))) in ('active','نشط')
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
  ),
  archived_visible as (
    select count(*)::int as c
    from public.staff s
    where not coalesce(s.active,s.is_active,true)
      and coalesce(s.visible_in_schedule,true)
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
  ),
  resolved as (
    select s.*,
           sch.schedule_id,
           sch.branch as schedule_branch,
           sch.shift_start as schedule_start,
           sch.shift_end as schedule_end,
           sch.is_off,
           sch.is_day_off,
           sch.source_kind
    from active_staff s
    left join lateral public.attendance_schedule_for_date_v1(s.id,v_date) sch on true
  ),
  duplicate_names as (
    select count(*)::int as c
    from (
      select lower(regexp_replace(trim(name),'\s+',' ','g')) as normalized_name
      from public.staff
      where name is not null and trim(name)<>''
      group by 1
      having count(*) filter (where coalesce(active,is_active,true)) > 1
    ) d
  )
  select jsonb_build_object(
    'date',v_date,
    'branch',p_branch,
    'active_staff',coalesce((select count(*) from active_staff),0),
    'active_without_schedule',coalesce((select count(*) from resolved where schedule_id is null),0),
    'active_schedule_branch_mismatch',coalesce((select count(*) from resolved where schedule_id is not null and schedule_branch is not null and branch is not null and trim(schedule_branch)<>trim(branch)),0),
    'legacy_shift_drift',coalesce((select count(*) from resolved where schedule_id is not null and not coalesce(is_off,false) and not coalesce(is_day_off,false)
      and shift_start is not null and shift_end is not null
      and (shift_start<>schedule_start or shift_end<>schedule_end)),0),
    'archived_visible_in_schedule',coalesce((select c from archived_visible),0),
    'duplicate_active_display_names',coalesce((select c from duplicate_names),0),
    'overnight_schedules',coalesce((select count(*) from resolved where schedule_id is not null and schedule_start is not null and schedule_end is not null and schedule_end<=schedule_start),0),
    'generated_at',now()
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.hr_employee_core_360_v2(
  p_staff_id uuid,
  p_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Africa/Cairo')::date);
  v_staff public.staff%rowtype;
  v_schedule record;
  v_result jsonb;
begin
  if p_staff_id is null then
    raise exception 'staff_id_required' using errcode='22023';
  end if;
  if not public.dawaa_current_actor_can(array['view_schedule','view_attendance_leaves','view_staff_accounts']) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='P0002'; end if;

  select * into v_schedule
  from public.attendance_schedule_for_date_v1(p_staff_id,v_date)
  limit 1;

  select jsonb_build_object(
    'staff',jsonb_build_object(
      'id',v_staff.id,
      'name',v_staff.name,
      'role',v_staff.role,
      'type',v_staff.type,
      'branch',v_staff.branch,
      'status',v_staff.status,
      'active',coalesce(v_staff.active,v_staff.is_active,true),
      'visible_in_schedule',coalesce(v_staff.visible_in_schedule,true),
      'join_date',v_staff.join_date,
      'day_off',v_staff.day_off
    ),
    'schedule',case when v_schedule.schedule_id is null then null else jsonb_build_object(
      'schedule_id',v_schedule.schedule_id,
      'branch',v_schedule.branch,
      'day_name',v_schedule.day_name,
      'shift_start',v_schedule.shift_start,
      'shift_end',v_schedule.shift_end,
      'is_off',v_schedule.is_off,
      'is_day_off',v_schedule.is_day_off,
      'source_kind',v_schedule.source_kind
    ) end,
    'quality',jsonb_build_object(
      'has_schedule',v_schedule.schedule_id is not null,
      'branch_matches',v_schedule.schedule_id is null or v_schedule.branch is null or v_staff.branch is null or trim(v_schedule.branch)=trim(v_staff.branch),
      'legacy_shift_matches',v_schedule.schedule_id is null or v_staff.shift_start is null or v_staff.shift_end is null
        or (v_staff.shift_start=v_schedule.shift_start and v_staff.shift_end=v_schedule.shift_end)
    ),
    'date',v_date,
    'generated_at',now()
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.hr_truth_quality_snapshot_v2(date,text) from public;
revoke execute on function public.hr_employee_core_360_v2(uuid,date) from public;
grant execute on function public.hr_truth_quality_snapshot_v2(date,text) to anon,authenticated,service_role;
grant execute on function public.hr_employee_core_360_v2(uuid,date) to anon,authenticated,service_role;
