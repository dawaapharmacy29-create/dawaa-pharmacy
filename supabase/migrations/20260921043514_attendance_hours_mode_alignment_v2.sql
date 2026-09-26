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
  v_scheduled_days integer:=0; v_approved_days integer:=0; v_unresolved integer:=0; v_hours numeric:=0;
  v_unresolved_dates jsonb:='[]'::jsonb; v_ready boolean:=false; v_status text; v_reasons jsonb:='[]'::jsonb;
begin
  if p_staff_id is null then raise exception 'payroll_attendance_staff_identity_missing'; end if;

  select
    sa.username,
    coalesce(sa.staff_name,sa.name,sa.username),
    case
      when coalesce(cp.salary_calculation_mode,'')='attendance_hours_v1' then 'resolved'
      else coalesce(pp.attendance_hours_mode,'manual')
    end
  into v_username,v_name,v_mode
  from public.staff_accounts sa
  left join public.staff_payroll_profiles_v13 pp on pp.staff_username=sa.username
  left join lateral (
    select p.salary_calculation_mode
    from public.employee_compensation_profiles p
    where p.staff_id=p_staff_id::text and coalesce(p.active,true)
    order by p.effective_from desc nulls last,p.updated_at desc nulls last
    limit 1
  ) cp on true
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
