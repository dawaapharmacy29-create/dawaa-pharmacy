-- Canonical date-aware schedule resolver and critical reader alignment.
-- Ensures weekly custom schedules and date overrides are interpreted consistently.

create or replace function public.attendance_schedule_for_date_v1(
  p_staff_id uuid,
  p_date date
)
returns table(
  schedule_id uuid,
  staff_id uuid,
  branch text,
  day_name text,
  shift_start time,
  shift_end time,
  is_off boolean,
  is_day_off boolean,
  source_kind text
)
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
  with d as (
    select case extract(dow from p_date)::int
      when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
      when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة'
      else 'السبت' end as day_ar
  )
  select
    ss.id, ss.staff_id, ss.branch,
    coalesce(nullif(trim(ss.day_name),''),(select day_ar from d)),
    case when trim(coalesce(ss.shift_start,'')) ~ '^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$'
      then trim(ss.shift_start)::time else ss.start_time end,
    case when trim(coalesce(ss.shift_end,'')) ~ '^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$'
      then trim(ss.shift_end)::time else ss.end_time end,
    coalesce(ss.is_off,false), coalesce(ss.is_day_off,false),
    case when coalesce(ss.shift_date,ss.date)=p_date then 'date_override' else 'weekly' end
  from public.shift_schedules ss
  where ss.staff_id=p_staff_id
    and (
      coalesce(ss.shift_date,ss.date)=p_date
      or (
        ss.shift_date is null and ss.date is null
        and trim(coalesce(ss.day_name,''))=(select day_ar from d)
      )
    )
  order by (coalesce(ss.shift_date,ss.date)=p_date) desc,
           coalesce(ss.updated_at,ss.created_at) desc nulls last,
           ss.id desc
  limit 1;
$$;

revoke all on function public.attendance_schedule_for_date_v1(uuid,date) from public,anon;
grant execute on function public.attendance_schedule_for_date_v1(uuid,date) to authenticated,service_role;

create or replace function public.get_payroll_attendance_eligibility_v1(
  p_staff_id uuid,
  p_month_cycle text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_cycle text:=coalesce(nullif(trim(coalesce(p_month_cycle,'')),''),public.dawaa_current_points_cycle_label_v1());
  v_start date; v_end date; v_username text; v_name text; v_mode text:='manual';
  v_cycle_closed boolean:=false; v_schedule_gaps integer:=0; v_invalid_schedule_days integer:=0;
  v_scheduled_days integer:=0; v_approved_days integer:=0; v_unresolved integer:=0;
  v_hours numeric:=0; v_unresolved_dates jsonb:='[]'::jsonb; v_ready boolean:=false;
  v_status text; v_reasons jsonb:='[]'::jsonb;
begin
  if p_staff_id is null then raise exception 'payroll_attendance_staff_identity_missing'; end if;

  select sa.username,coalesce(sa.staff_name,sa.name,sa.username),coalesce(pp.attendance_hours_mode,'manual')
    into v_username,v_name,v_mode
  from public.staff_accounts sa
  left join public.staff_payroll_profiles_v13 pp on pp.staff_username=sa.username
  where trim(coalesce(sa.staff_id,''))=p_staff_id::text or sa.id=p_staff_id
  order by (trim(coalesce(sa.staff_id,''))=p_staff_id::text) desc,coalesce(sa.active,true) desc
  limit 1;
  if v_username is null then raise exception 'payroll_attendance_staff_identity_missing'; end if;
  if not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;

  v_start:=public.dawaa_points_cycle_start_for_label_v1(v_cycle);
  v_end:=public.dawaa_points_cycle_end_for_label_v1(v_cycle);
  v_cycle_closed:=((now() at time zone 'Africa/Cairo')::date>v_end);

  with days as (
    select gs::date as d from generate_series(v_start::timestamp,v_end::timestamp,interval '1 day') gs
  ), resolved as (
    select d.d,ss.schedule_id,
      coalesce(ss.is_off,false) or coalesce(ss.is_day_off,false) as is_off,
      ss.shift_start,ss.shift_end,
      a.id as attendance_summary_id,a.status as attendance_status,a.payroll_eligible_hours
    from days d
    left join lateral public.attendance_schedule_for_date_v1(p_staff_id,d.d) ss on true
    left join public.attendance_daily_summary a
      on a.staff_id=p_staff_id and a.attendance_date=d.d
      and a.status='approved' and coalesce(a.resolution_version,0)>=1
  ), workdays as (
    select *,
      (schedule_id is not null and not is_off and shift_start is not null and shift_end is not null) as valid_workday
    from resolved
  )
  select
    count(*) filter(where schedule_id is null)::integer,
    count(*) filter(where schedule_id is not null and not is_off and not valid_workday)::integer,
    count(*) filter(where valid_workday)::integer,
    count(*) filter(where valid_workday and attendance_summary_id is not null)::integer,
    coalesce(sum(payroll_eligible_hours) filter(where valid_workday and attendance_summary_id is not null),0),
    coalesce(jsonb_agg(d order by d) filter(where valid_workday and attendance_summary_id is null),'[]'::jsonb)
  into v_schedule_gaps,v_invalid_schedule_days,v_scheduled_days,v_approved_days,v_hours,v_unresolved_dates
  from workdays;

  v_unresolved:=greatest(0,coalesce(v_scheduled_days,0)-coalesce(v_approved_days,0));
  if v_mode<>'resolved' then v_reasons:=v_reasons||jsonb_build_array('attendance_mode_manual'); end if;
  if not v_cycle_closed then v_reasons:=v_reasons||jsonb_build_array('cycle_not_closed'); end if;
  if v_schedule_gaps>0 then v_reasons:=v_reasons||jsonb_build_array('canonical_schedule_gaps'); end if;
  if v_invalid_schedule_days>0 then v_reasons:=v_reasons||jsonb_build_array('invalid_schedule_times'); end if;
  if v_scheduled_days=0 then v_reasons:=v_reasons||jsonb_build_array('no_scheduled_workdays'); end if;
  if v_unresolved>0 then v_reasons:=v_reasons||jsonb_build_array('unresolved_workdays'); end if;

  v_ready:=v_mode='resolved' and v_cycle_closed and v_schedule_gaps=0 and v_invalid_schedule_days=0 and v_scheduled_days>0 and v_unresolved=0;
  v_status:=case
    when v_mode<>'resolved' then 'manual_mode'
    when not v_cycle_closed then 'cycle_open'
    when v_schedule_gaps>0 or v_invalid_schedule_days>0 then 'schedule_not_ready'
    when v_unresolved>0 then 'attendance_unresolved'
    when v_scheduled_days=0 then 'no_scheduled_workdays'
    else 'ready' end;

  return jsonb_build_object(
    'staff_id',p_staff_id,'staff_name',v_name,'month_cycle',v_cycle,'cycle_start',v_start,'cycle_end',v_end,
    'attendance_hours_mode',v_mode,'cycle_closed',v_cycle_closed,'schedule_gap_days',v_schedule_gaps,
    'invalid_schedule_days',v_invalid_schedule_days,'scheduled_workdays',v_scheduled_days,'approved_workdays',v_approved_days,
    'unresolved_workdays',v_unresolved,'approved_payroll_hours',round(coalesce(v_hours,0)::numeric,2),
    'unresolved_dates',v_unresolved_dates,'ready_for_payroll',v_ready,'status',v_status,'reasons',v_reasons,
    'source','approved attendance_daily_summary snapshots + canonical schedule resolver v1','generated_at',now()
  );
end;
$$;

create or replace function public.get_today_shift_presence_v2(
  p_today date default ((now() at time zone 'Africa/Cairo'))::date
)
returns table(
  staff_id text, staff_name text, role text, branch text, day_name text,
  shift_name text, shift_start text, shift_end text, attendance_status text, source text
)
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
  select
    d.staff_id::text,d.staff_name,d.role,d.branch,
    case extract(dow from p_today)::int
      when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
      when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة'
      else 'السبت' end,
    null::text,d.shift_start::text,d.shift_end::text,
    case
      when d.last_check_out is not null then 'خرج'
      when d.first_check_in is not null then 'موجود الآن'
      else 'لم يبصم'
    end,
    'attendance_daily_command_v1'
  from public.attendance_daily_command_v1(p_today,null) d
  where d.schedule_status<>'off'
  order by d.branch,d.role,d.shift_start,d.staff_name;
$$;

revoke all on function public.get_today_shift_presence_v2(date) from public,anon;
grant execute on function public.get_today_shift_presence_v2(date) to authenticated,service_role;

create or replace function public.settle_assistant_operational_streak_bonus()
returns void
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_staff record; v_streak integer; v_last_counted date; v_cursor date;
  v_yesterday date := (now() at time zone 'Africa/Cairo')::date - 1;
  v_schedule record; v_has_attendance boolean; v_month_cycle text;
begin
  for v_staff in
    select e.staff_id,s.name,s.branch
    from public.assistant_operational_eligible_staff e join public.staff s on s.id=e.staff_id
  loop
    select streak_count,last_counted_date into v_streak,v_last_counted
    from public.assistant_operational_streak_state where staff_id=v_staff.staff_id;
    if not found then
      v_streak:=0; v_last_counted:=v_yesterday-60;
      insert into public.assistant_operational_streak_state(staff_id,streak_count,last_counted_date)
      values(v_staff.staff_id,0,v_last_counted) on conflict(staff_id) do nothing;
    end if;

    v_cursor:=coalesce(v_last_counted,v_yesterday-60)+1;
    while v_cursor<=v_yesterday loop
      select * into v_schedule from public.attendance_schedule_for_date_v1(v_staff.staff_id,v_cursor);
      if not found or coalesce(v_schedule.is_off,false) or coalesce(v_schedule.is_day_off,false) then
        v_cursor:=v_cursor+1; continue;
      end if;

      select exists(
        select 1 from public.attendance_daily_summary a
        where a.staff_id=v_staff.staff_id and a.attendance_date=v_cursor
          and a.status='approved' and coalesce(a.candidate_hours,0)>0
      ) into v_has_attendance;

      if v_has_attendance then
        v_streak:=v_streak+1;
        if v_streak>=6 then
          v_month_cycle:=public.dawaa_current_points_cycle_label_v1();
          insert into public.employee_transactions(
            staff_id,employee_id,employee_name,type,title,reason,amount,points,points_delta,
            source,source_id,transaction_date,created_at,description,month_cycle,branch,
            status,category,employee_visible,created_by
          ) values(
            v_staff.staff_id,v_staff.staff_id,v_staff.name,'reward',
            'مكافأة التزام (٦ أيام عمل حقيقيين متتالية)',
            'مكافأة التزام (٦ أيام عمل حقيقيين متتالية)',0,25,25,
            'assistant_operational_streak_bonus',gen_random_uuid(),current_date,now(),
            'التزام ٦ أيام عمل حقيقيين متتالية حتى '||v_cursor::text,
            v_month_cycle,v_staff.branch,'active','مكافأة الالتزام',true,'system_streak_cron'
          );
          v_streak:=0;
        end if;
      else
        v_streak:=0;
      end if;
      v_cursor:=v_cursor+1;
    end loop;

    update public.assistant_operational_streak_state
    set streak_count=v_streak,last_counted_date=v_yesterday,updated_at=now()
    where staff_id=v_staff.staff_id;
  end loop;
end;
$$;
