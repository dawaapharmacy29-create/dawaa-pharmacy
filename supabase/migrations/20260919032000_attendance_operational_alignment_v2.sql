-- Attendance operational alignment v2
-- Align downstream detectors with the hardened semantic classifier and canonical approved daily resolution.

create or replace function public.attendance_schedule_mismatch_candidates_v1(p_days integer default 21)
returns table(
  staff_id uuid,
  staff_name text,
  branch text,
  day_of_week text,
  occurrences bigint,
  distinct_dates bigint,
  earliest_time time without time zone,
  latest_time time without time zone,
  spread_minutes numeric,
  sample_dates date[]
)
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $function$
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception using errcode='42501', message='صلاحية الإدارة مطلوبة لعرض احتمالات عدم مطابقة الجدول';
  end if;

  return query
  with flagged as (
    select
      bl.staff_id,
      bl.punch_time,
      case extract(dow from (bl.punch_time at time zone 'Africa/Cairo'))::int
        when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء' when 3 then 'الأربعاء'
        when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت'
      end as day_of_week,
      (bl.punch_time at time zone 'Africa/Cairo')::time as punch_time_of_day,
      (bl.punch_time at time zone 'Africa/Cairo')::date as punch_date
    from public.biometric_attendance_logs bl
    join public.biometric_semantic_decisions bd on bd.biometric_log_id=bl.id
    where bd.reason in ('no_matching_schedule_fallback_to_raw','no_matching_schedule_review')
      and bl.punch_time>=current_date-greatest(7,least(coalesce(p_days,21),90))
      and bl.staff_id is not null
  )
  select
    s.id,s.name,s.branch,f.day_of_week,
    count(*)::bigint,
    count(distinct f.punch_date)::bigint,
    min(f.punch_time_of_day),
    max(f.punch_time_of_day),
    round(extract(epoch from (max(f.punch_time_of_day)-min(f.punch_time_of_day)))/60.0,0),
    array_agg(distinct f.punch_date order by f.punch_date)
  from flagged f
  join public.staff s on s.id=f.staff_id
  where coalesce(s.active,false)=true
    and not exists (
      select 1
      from public.attendance_schedule_mismatch_dismissals d
      where d.staff_id=f.staff_id and d.day_of_week=f.day_of_week
    )
  group by s.id,s.name,s.branch,f.day_of_week
  having count(distinct f.punch_date)>=2
  order by count(distinct f.punch_date) desc,(max(f.punch_time_of_day)-min(f.punch_time_of_day)) asc
  limit 40;
end;
$function$;

revoke execute on function public.attendance_schedule_mismatch_candidates_v1(integer) from public,anon;
grant execute on function public.attendance_schedule_mismatch_candidates_v1(integer) to authenticated,service_role;


create or replace function public.dawaa_detect_pending_overtime_v1(p_lookback_days integer default 3)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $function$
declare
  v_day public.attendance_daily_summary%rowtype;
  v_staff public.staff%rowtype;
  v_comp record;
  v_true_hourly_rate numeric;
  v_scheduled_hours numeric;
  v_extra_minutes integer;
  v_deviation jsonb;
  v_overtime_minutes integer;
  v_inserted integer:=0;
  v_invalidated integer:=0;
  v_flagged_unreasonable integer:=0;
  v_skipped_unapproved integer:=0;
  v_today date:=(now() at time zone 'Africa/Cairo')::date;
begin
  -- Pending overtime can only survive while its canonical attendance day remains approved and eligible.
  update public.staff_overtime_approvals o
  set status='rejected',
      decision_note='إبطال تلقائي: يوم الحضور لم يعد معتمدًا أو لم يعد مؤهلًا للأوفرتايم.',
      decided_at=now(),
      updated_at=now()
  where o.status='pending'
    and not exists (
      select 1
      from public.attendance_daily_summary ads
      where ads.staff_id=o.staff_id
        and ads.attendance_date=o.attendance_date
        and ads.status='approved'
        and coalesce(ads.resolution_version,0)>=2
        and not coalesce(ads.review_required,false)
        and ads.resolution_status in ('on_time','late','very_late','on_time_with_permission','worked_on_off')
    );
  get diagnostics v_invalidated=row_count;

  for v_day in
    select ads.*
    from public.attendance_daily_summary ads
    where ads.attendance_date between v_today-greatest(1,least(coalesce(p_lookback_days,3),14)) and v_today-1
      and ads.status='approved'
      and coalesce(ads.resolution_version,0)>=2
      and not coalesce(ads.review_required,false)
      and ads.resolution_status in ('on_time','late','very_late','on_time_with_permission','worked_on_off')
      and ads.first_in is not null
      and ads.last_out is not null
      and ads.scheduled_start_at is not null
      and ads.scheduled_end_at is not null
  loop
    if exists (
      select 1 from public.staff_overtime_approvals
      where staff_id=v_day.staff_id and attendance_date=v_day.attendance_date
    ) then
      continue;
    end if;

    select * into v_staff from public.staff
    where id=v_day.staff_id and coalesce(active,false)=true;
    if not found then
      continue;
    end if;

    select * into v_comp
    from public.employee_compensation_profiles
    where staff_id=v_staff.id::text and active=true
    order by effective_from desc nulls last
    limit 1;

    if coalesce(v_comp.exempt_from_lateness_deduction,false) then
      continue;
    end if;

    v_true_hourly_rate:=case
      when v_comp.hourly_rate is not null and v_comp.hourly_rate>0
        then round(v_comp.hourly_rate/26.0,4)
      else null
    end;

    v_scheduled_hours:=extract(epoch from (v_day.scheduled_end_at-v_day.scheduled_start_at))/3600.0;
    v_extra_minutes:=round(greatest(coalesce(v_day.candidate_hours,v_day.total_hours,0)-coalesce(v_scheduled_hours,0),0)*60)::int;

    v_deviation:=public.dawaa_net_attendance_deviation_v1(
      coalesce(v_day.late_minutes,0),
      v_extra_minutes,
      v_staff.role,
      false
    );
    v_overtime_minutes:=coalesce((v_deviation->>'overtime_minutes')::int,0);

    if v_overtime_minutes<10 then
      continue;
    end if;

    if v_overtime_minutes>360 then
      insert into public.staff_overtime_approvals(
        staff_id,staff_name,branch,attendance_date,overtime_hours,hourly_rate,overtime_amount,status,decision_note
      ) values (
        v_staff.id,v_staff.name,v_staff.branch,v_day.attendance_date,
        round(v_overtime_minutes/60.0,2),null,null,'pending',
        'تنبيه: عدد ساعات كبير بشكل غير معتاد — راجع Daily Closure والبصمات قبل الاعتماد.'
      )
      on conflict(staff_id,attendance_date) do nothing;
      v_flagged_unreasonable:=v_flagged_unreasonable+1;
      continue;
    end if;

    insert into public.staff_overtime_approvals(
      staff_id,staff_name,branch,attendance_date,overtime_hours,hourly_rate,overtime_amount,status
    ) values (
      v_staff.id,v_staff.name,v_staff.branch,v_day.attendance_date,
      round(v_overtime_minutes/60.0,2),
      v_true_hourly_rate,
      case when v_true_hourly_rate is not null
        then round((v_overtime_minutes/60.0)*v_true_hourly_rate*1.5,2)
        else null
      end,
      'pending'
    )
    on conflict(staff_id,attendance_date) do nothing;

    v_inserted:=v_inserted+1;
  end loop;

  select count(*)::int into v_skipped_unapproved
  from public.staff s
  cross join generate_series(
    v_today-greatest(1,least(coalesce(p_lookback_days,3),14)),
    v_today-1,
    interval '1 day'
  ) d
  where coalesce(s.active,false)=true
    and not exists (
      select 1 from public.attendance_daily_summary ads
      where ads.staff_id=s.id
        and ads.attendance_date=d::date
        and ads.status='approved'
        and coalesce(ads.resolution_version,0)>=2
    );

  return jsonb_build_object(
    'queued',v_inserted,
    'invalidated_stale',v_invalidated,
    'flagged_unreasonable',v_flagged_unreasonable,
    'skipped_unapproved_days',v_skipped_unapproved,
    'source','approved_attendance_daily_summary_v2'
  );
end;
$function$;

revoke execute on function public.dawaa_detect_pending_overtime_v1(integer) from public,anon,authenticated;
grant execute on function public.dawaa_detect_pending_overtime_v1(integer) to service_role;

notify pgrst,'reload schema';
