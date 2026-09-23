-- Schedule Core V2
-- One operational reader + one reviewed publishing path.
-- Legacy staff.shift_* stays descriptive only and direct schedule replacement is no longer client-executable.

create or replace function public.hr_canonical_schedule_week_v2(
  p_week_start date,
  p_branch text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_start date := p_week_start;
  v_result jsonb;
begin
  if v_start is null then raise exception 'week_start_required' using errcode='22023'; end if;
  if not public.dawaa_current_actor_can(array['view_schedule','view_attendance_leaves']) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  with active_staff as (
    select s.id,s.name,s.role,s.branch,s.status,s.visible_in_schedule
    from public.staff s
    where coalesce(s.active,s.is_active,true)
      and coalesce(s.visible_in_schedule,true)
      and lower(trim(coalesce(s.status,'active'))) in ('active','نشط')
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
      and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
  ),
  dates as (
    select (v_start + g)::date as schedule_date
    from generate_series(0,6) g
  ),
  resolved as (
    select s.id staff_id,s.name staff_name,s.role,s.branch,d.schedule_date,
           sch.schedule_id,sch.day_name,sch.shift_start,sch.shift_end,
           coalesce(sch.is_off,false) is_off,coalesce(sch.is_day_off,false) is_day_off,
           sch.source_kind
    from active_staff s
    cross join dates d
    left join lateral public.attendance_schedule_for_date_v1(s.id,d.schedule_date) sch on true
  )
  select jsonb_build_object(
    'week_start',v_start,
    'week_end',v_start+6,
    'branch',p_branch,
    'staff',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',s.id,'staff_name',s.name,'role',s.role,'branch',s.branch,
        'days',(
          select jsonb_agg(jsonb_build_object(
            'date',r.schedule_date,
            'schedule_id',r.schedule_id,
            'day_name',coalesce(r.day_name,case extract(dow from r.schedule_date)::int
              when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
              when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end),
            'shift_start',r.shift_start,
            'shift_end',r.shift_end,
            'is_off',r.is_off,
            'is_day_off',r.is_day_off,
            'source_kind',r.source_kind,
            'has_schedule',r.schedule_id is not null
          ) order by r.schedule_date)
          from resolved r where r.staff_id=s.id
        )
      ) order by s.branch,s.role,s.name)
      from active_staff s
    ),'[]'::jsonb),
    'summary',jsonb_build_object(
      'staff_count',(select count(*) from active_staff),
      'staff_days',(select count(*) from resolved),
      'missing_schedule_days',(select count(*) from resolved where schedule_id is null),
      'date_override_days',(select count(*) from resolved where source_kind='date_override'),
      'overnight_days',(select count(*) from resolved where schedule_id is not null and shift_start is not null and shift_end is not null and shift_end<=shift_start)
    ),
    'generated_at',now()
  ) into v_result;

  return v_result;
end;
$$;

-- Direct-write lockdown is intentionally deferred until the V2 client is fully accepted.
-- This migration is additive so the current production client remains compatible while the
-- experimental branch is validated. A later release migration will revoke direct replacement.

revoke execute on function public.hr_canonical_schedule_week_v2(date,text) from public;
grant execute on function public.hr_canonical_schedule_week_v2(date,text) to anon,authenticated,service_role;

comment on function public.hr_canonical_schedule_week_v2(date,text) is
'Canonical seven-day workforce schedule reader. UI must prefer this over raw shift_schedules scans.';
