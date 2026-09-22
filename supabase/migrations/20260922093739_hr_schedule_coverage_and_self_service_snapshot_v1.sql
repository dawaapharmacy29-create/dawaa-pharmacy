create or replace function public.workforce_schedule_coverage_v1(
  p_date date,
  p_branch text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare v_result jsonb;
begin
  if p_date is null then raise exception 'schedule_date_required' using errcode='22023'; end if;
  if not public.dawaa_current_actor_can(array['view_schedule','view_attendance_leaves']) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  with active_staff as (
    select s.id,s.name,s.role,s.branch
    from public.staff s
    where coalesce(s.active,s.is_active,true)
      and coalesce(s.visible_in_schedule,true)
      and lower(trim(coalesce(s.status,'active'))) in ('active','نشط')
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
  ), resolved as (
    select s.*,sch.schedule_id,sch.shift_start,sch.shift_end,sch.is_off,sch.is_day_off,sch.source_kind
    from active_staff s
    left join lateral public.attendance_schedule_for_date_v1(s.id,p_date) sch on true
  ), grouped as (
    select branch,
      count(*)::int total_staff,
      count(*) filter(where schedule_id is not null and not coalesce(is_off,false) and not coalesce(is_day_off,false))::int scheduled_working,
      count(*) filter(where schedule_id is null)::int no_schedule,
      count(*) filter(where coalesce(is_off,false) or coalesce(is_day_off,false))::int off_staff,
      count(*) filter(where source_kind='date_override')::int date_overrides,
      count(*) filter(where source_kind='weekly')::int weekly_rows,
      count(*) filter(where schedule_id is not null and shift_start is not null and shift_end is not null and shift_end<=shift_start)::int overnight_shifts
    from resolved group by branch
  ), role_breakdown as (
    select branch,role,
      count(*)::int total_staff,
      count(*) filter(where schedule_id is not null and not coalesce(is_off,false) and not coalesce(is_day_off,false))::int scheduled_working,
      count(*) filter(where schedule_id is null)::int no_schedule
    from resolved group by branch,role
  )
  select jsonb_build_object(
    'date',p_date,
    'branches',coalesce((select jsonb_agg(to_jsonb(g) order by g.branch) from grouped g),'[]'::jsonb),
    'roles',coalesce((select jsonb_agg(to_jsonb(r) order by r.branch,r.role) from role_breakdown r),'[]'::jsonb),
    'totals',jsonb_build_object(
      'staff',coalesce((select sum(total_staff) from grouped),0),
      'scheduled_working',coalesce((select sum(scheduled_working) from grouped),0),
      'no_schedule',coalesce((select sum(no_schedule) from grouped),0),
      'off_staff',coalesce((select sum(off_staff) from grouped),0),
      'date_overrides',coalesce((select sum(date_overrides) from grouped),0),
      'overnight_shifts',coalesce((select sum(overnight_shifts) from grouped),0)
    ),
    'generated_at',now()
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.my_workforce_snapshot_v1(p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_staff_id uuid;
  v_date date:=coalesce(p_date,(now() at time zone 'Africa/Cairo')::date);
  v_today record; v_next record;
  v_pending_corrections integer:=0; v_pending_timeoff integer:=0; v_pending_ot integer:=0;
begin
  v_staff_id:=public.dawaa_current_actor_staff_id_v1();
  if v_staff_id is null then return jsonb_build_object('linked',false); end if;

  select * into v_today from public.attendance_schedule_for_date_v1(v_staff_id,v_date) limit 1;

  select x.* into v_next
  from generate_series(1,14) n
  cross join lateral public.attendance_schedule_for_date_v1(v_staff_id,v_date+n) x
  where not coalesce(x.is_off,false) and not coalesce(x.is_day_off,false)
  order by n limit 1;

  if to_regclass('public.attendance_correction_requests') is not null then
    execute 'select count(*)::int from public.attendance_correction_requests where staff_id=$1 and status in (''pending'',''submitted'',''review'')'
      into v_pending_corrections using v_staff_id;
  end if;
  if to_regclass('public.staff_time_off_requests') is not null then
    execute 'select count(*)::int from public.staff_time_off_requests where staff_id=$1 and status=''pending'''
      into v_pending_timeoff using v_staff_id;
  end if;
  if to_regclass('public.staff_overtime_approvals') is not null then
    select count(*)::int into v_pending_ot
    from public.staff_overtime_approvals
    where staff_id=v_staff_id and status='pending';
  end if;

  return jsonb_build_object(
    'linked',true,'staff_id',v_staff_id,'date',v_date,
    'today_schedule',case when v_today.schedule_id is null then null else jsonb_build_object(
      'schedule_id',v_today.schedule_id,'branch',v_today.branch,'day_name',v_today.day_name,
      'shift_start',v_today.shift_start,'shift_end',v_today.shift_end,'is_off',v_today.is_off,
      'is_day_off',v_today.is_day_off,'source_kind',v_today.source_kind) end,
    'next_schedule',case when v_next.schedule_id is null then null else jsonb_build_object(
      'schedule_id',v_next.schedule_id,'branch',v_next.branch,'day_name',v_next.day_name,
      'shift_start',v_next.shift_start,'shift_end',v_next.shift_end,'source_kind',v_next.source_kind) end,
    'pending_corrections',coalesce(v_pending_corrections,0),
    'pending_time_off',coalesce(v_pending_timeoff,0),
    'pending_overtime',coalesce(v_pending_ot,0)
  );
end;
$$;

revoke execute on function public.workforce_schedule_coverage_v1(date,text) from public;
revoke execute on function public.my_workforce_snapshot_v1(date) from public;
grant execute on function public.workforce_schedule_coverage_v1(date,text) to anon,authenticated,service_role;
grant execute on function public.my_workforce_snapshot_v1(date) to anon,authenticated,service_role;
