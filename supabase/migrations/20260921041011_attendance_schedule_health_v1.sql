create or replace function public.attendance_schedule_health_v1(
  p_branch text default null
)
returns table(
  staff_id uuid,
  staff_name text,
  role text,
  branch text,
  weekly_rows integer,
  off_days integer,
  distinct_work_times integer,
  missing_time_rows integer,
  date_overrides integer,
  has_custom_pattern boolean,
  health_status text
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor uuid;
begin
  v_actor:=public.dawaa_current_staff_account_id_strict();
  if v_actor is null then
    raise exception 'active staff actor required' using errcode='42501';
  end if;

  return query
  with active_staff as (
    select s.id,s.name,s.role,s.branch
    from public.staff s
    where coalesce(s.active,s.is_active,true)
      and s.branch in ('فرع الشامي','فرع شكري')
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or s.branch=p_branch)
      and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
  ), agg as (
    select
      s.id,s.name,s.role,s.branch,
      count(*) filter(where ss.shift_date is null and ss.date is null)::integer as weekly_rows,
      count(*) filter(where ss.shift_date is null and ss.date is null and (coalesce(ss.is_off,false) or coalesce(ss.is_day_off,false)))::integer as off_days,
      count(distinct concat_ws('-',coalesce(ss.shift_start,ss.start_time::text),coalesce(ss.shift_end,ss.end_time::text)))
        filter(where ss.shift_date is null and ss.date is null and not(coalesce(ss.is_off,false) or coalesce(ss.is_day_off,false)))::integer as distinct_work_times,
      count(*) filter(
        where ss.shift_date is null and ss.date is null
          and not(coalesce(ss.is_off,false) or coalesce(ss.is_day_off,false))
          and (
            coalesce(nullif(trim(ss.shift_start),''),ss.start_time::text) is null
            or coalesce(nullif(trim(ss.shift_end),''),ss.end_time::text) is null
          )
      )::integer as missing_time_rows,
      count(*) filter(where coalesce(ss.shift_date,ss.date) is not null)::integer as date_overrides
    from active_staff s
    left join public.shift_schedules ss on ss.staff_id=s.id
    group by s.id,s.name,s.role,s.branch
  )
  select
    a.id,a.name,a.role,a.branch,a.weekly_rows,a.off_days,a.distinct_work_times,a.missing_time_rows,a.date_overrides,
    (a.distinct_work_times>1 or a.date_overrides>0 or a.off_days>1),
    case
      when a.weekly_rows<7 then 'missing_weekly_days'
      when a.weekly_rows>7 then 'duplicate_weekly_rows'
      when a.missing_time_rows>0 then 'missing_shift_time'
      when a.distinct_work_times>1 or a.date_overrides>0 or a.off_days>1 then 'custom_schedule'
      else 'ok'
    end
  from agg a
  order by
    case
      when a.weekly_rows<>7 or a.missing_time_rows>0 then 0
      when a.distinct_work_times>1 or a.date_overrides>0 or a.off_days>1 then 1
      else 2
    end,
    a.branch,a.name;
end;
$$;

revoke all on function public.attendance_schedule_health_v1(text) from public,anon;
grant execute on function public.attendance_schedule_health_v1(text) to authenticated,service_role;
