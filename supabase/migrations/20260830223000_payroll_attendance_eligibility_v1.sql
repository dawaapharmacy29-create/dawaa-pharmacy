alter table public.staff_payroll_profiles_v13
  add column if not exists attendance_hours_mode text not null default 'manual';

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.staff_payroll_profiles_v13'::regclass
      and conname='staff_payroll_profiles_v13_attendance_hours_mode_chk'
  ) then
    alter table public.staff_payroll_profiles_v13
      add constraint staff_payroll_profiles_v13_attendance_hours_mode_chk
      check (attendance_hours_mode in ('manual','resolved'));
  end if;
end $$;

create or replace function public.get_payroll_attendance_eligibility_v1(
  p_staff_id uuid,
  p_month_cycle text default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_cycle text:=coalesce(nullif(trim(coalesce(p_month_cycle,'')),''),public.dawaa_current_points_cycle_label_v1());
  v_start date;
  v_end date;
  v_username text;
  v_name text;
  v_mode text:='manual';
  v_cycle_closed boolean:=false;
  v_schedule_gaps integer:=0;
  v_invalid_schedule_days integer:=0;
  v_scheduled_days integer:=0;
  v_approved_days integer:=0;
  v_unresolved integer:=0;
  v_hours numeric:=0;
  v_unresolved_dates jsonb:='[]'::jsonb;
  v_ready boolean:=false;
  v_status text;
  v_reasons jsonb:='[]'::jsonb;
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
    select gs::date as d,
      case extract(dow from gs)::int when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
        when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end as day_ar
    from generate_series(v_start::timestamp,v_end::timestamp,interval '1 day') gs
  ), resolved as (
    select d.d,d.day_ar,ss.id as schedule_id,
      coalesce(ss.is_off,false) or coalesce(ss.is_day_off,false) as is_off,
      ss.shift_start,ss.shift_end,
      a.id as attendance_summary_id,a.status as attendance_status,a.payroll_eligible_hours
    from days d
    left join lateral (
      select x.* from public.shift_schedules x
      where x.staff_id=p_staff_id and trim(coalesce(x.day_name,''))=d.day_ar
      order by x.updated_at desc nulls last,x.created_at desc nulls last,x.id desc
      limit 1
    ) ss on true
    left join public.attendance_daily_summary a
      on a.staff_id=p_staff_id and a.attendance_date=d.d and a.status='approved' and coalesce(a.resolution_version,0)>=1
  ), workdays as (
    select *,
      (schedule_id is not null and not is_off and
       coalesce(trim(shift_start),'') ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' and
       coalesce(trim(shift_end),'') ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$') as valid_workday
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
    'source','approved attendance_daily_summary snapshots v1','generated_at',now()
  );
end;
$function$;

revoke all on function public.get_payroll_attendance_eligibility_v1(uuid,text) from public;
grant execute on function public.get_payroll_attendance_eligibility_v1(uuid,text) to anon,authenticated,service_role;

create or replace function public.save_staff_payroll_monthly_v15(
  p_staff_username text,
  p_payroll_month date,
  p_worked_hours numeric default 0,
  p_overtime_hours numeric default 0,
  p_quarterly_bonus numeric default 0,
  p_incentives_total numeric default 0,
  p_deductions_total numeric default 0,
  p_manual_adjustment numeric default 0,
  p_notes text default null,
  p_status text default 'draft'
)
returns public.staff_payroll_monthly_v13
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_status text:=lower(trim(coalesce(p_status,'draft')));
  v_staff_id uuid;
  v_mode text:='manual';
  v_cycle text;
  v_elig jsonb;
  v_effective_hours numeric:=coalesce(p_worked_hours,0);
  v_saved public.staff_payroll_monthly_v13%rowtype;
begin
  select s.id,coalesce(pp.attendance_hours_mode,'manual')
    into v_staff_id,v_mode
  from public.staff_accounts sa
  join public.staff s on s.id::text=sa.staff_id::text
  left join public.staff_payroll_profiles_v13 pp on pp.staff_username=sa.username
  where sa.username=p_staff_username
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;
  if v_staff_id is null then raise exception 'payroll_staff_identity_missing' using errcode='22023'; end if;

  v_cycle:=to_char(p_payroll_month,'YYYY-MM');
  if v_status='approved' and v_mode='resolved' then
    v_elig:=public.get_payroll_attendance_eligibility_v1(v_staff_id,v_cycle);
    if not coalesce((v_elig->>'ready_for_payroll')::boolean,false) then
      raise exception 'attendance_resolution_not_ready_for_payroll: %',coalesce(v_elig->>'status','not_ready') using errcode='55000';
    end if;
    v_effective_hours:=coalesce((v_elig->>'approved_payroll_hours')::numeric,0);
  end if;

  v_saved:=public.save_staff_payroll_monthly_v14(
    p_staff_username,p_payroll_month,v_effective_hours,p_overtime_hours,p_quarterly_bonus,p_incentives_total,
    p_deductions_total,p_manual_adjustment,p_notes,v_status
  );

  if v_status='approved' and v_mode='resolved' and v_saved.id is not null then
    update public.staff_payroll_monthly_v13
    set approval_snapshot=coalesce(approval_snapshot,'{}'::jsonb)||jsonb_build_object(
          'attendance_hours_source','resolved_daily_snapshots_v1',
          'attendance_eligibility',v_elig
        ),
        freeze_version=15,
        updated_at=now()
    where id=v_saved.id and status='approved'
    returning * into v_saved;
  end if;

  return v_saved;
end;
$function$;

revoke all on function public.save_staff_payroll_monthly_v14(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public,anon,authenticated;
grant execute on function public.save_staff_payroll_monthly_v14(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to service_role;
revoke all on function public.save_staff_payroll_monthly_v15(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) from public;
grant execute on function public.save_staff_payroll_monthly_v15(text,date,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to anon,authenticated,service_role;
