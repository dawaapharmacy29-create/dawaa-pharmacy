create or replace function public.attendance_employee_profile_v1(p_staff_id uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_staff public.staff%rowtype;
  v_from date := (now() at time zone 'Africa/Cairo')::date - greatest(1, least(coalesce(p_days,30), 90));
  v_to date := (now() at time zone 'Africa/Cairo')::date;
  v_week_start date;
  v_result jsonb;
begin
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception using errcode='22023', message='الموظف غير موجود'; end if;
  if not public.dawaa_can_read_staff_attendance_log(p_staff_id,v_staff.branch) then
    raise exception using errcode='42501', message='لا تملك صلاحية عرض بيانات هذا الموظف';
  end if;

  v_week_start := v_to - ((extract(dow from v_to)::int + 1) % 7);

  select jsonb_build_object(
    'staff',jsonb_build_object(
      'id',v_staff.id,'name',v_staff.name,'role',v_staff.role,'branch',v_staff.branch,'active',v_staff.active
    ),
    'weekly_schedule',(
      with days as (
        select (v_week_start+gs)::date as d
        from generate_series(0,6) gs
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'day_name',case extract(dow from days.d)::int
          when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
          when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة'
          else 'السبت' end,
        'shift_date',case when r.source_kind='date_override' then days.d else null end,
        'is_off',coalesce(r.is_off,false) or coalesce(r.is_day_off,false),
        'shift_start',r.shift_start,
        'shift_end',r.shift_end,
        'source_kind',r.source_kind
      ) order by days.d),'[]'::jsonb)
      from days
      left join lateral public.attendance_schedule_for_date_v1(p_staff_id,days.d) r on true
    ),
    'rates',(
      select jsonb_build_object(
        'evaluated_days',count(*),
        'on_time_days',count(*) filter(where ads.resolution_status in ('on_time','on_time_with_permission')),
        'late_days',count(*) filter(where ads.resolution_status='late'),
        'very_late_days',count(*) filter(where ads.resolution_status='very_late'),
        'early_leave_days',count(*) filter(where ads.resolution_status='early_leave_review'),
        'permission_days',count(*) filter(where ads.resolution_status='approved_time_off'),
        'absence_days',count(*) filter(where ads.resolution_status='absence_review'),
        'pending_review_days',count(*) filter(where ads.status='pending_review'),
        'late_rate_pct',case when count(*)=0 then 0 else round((count(*) filter(where ads.resolution_status in ('late','very_late')))::numeric*100/count(*),1) end,
        'permission_rate_pct',case when count(*)=0 then 0 else round((count(*) filter(where ads.resolution_status='approved_time_off'))::numeric*100/count(*),1) end
      )
      from public.attendance_daily_summary ads
      where ads.staff_id=p_staff_id and ads.attendance_date between v_from and v_to
    ),
    'recent_days',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'attendance_date',ads.attendance_date,'status',ads.status,'resolution_status',ads.resolution_status,
        'first_in',ads.first_in,'last_out',ads.last_out,'late_minutes',ads.late_minutes,
        'early_leave_minutes',ads.early_leave_minutes,'payroll_eligible_hours',ads.payroll_eligible_hours,
        'scheduled_branch',ads.branch,
        'punch_branches',(
          select coalesce(jsonb_agg(distinct bl.branch),'[]'::jsonb)
          from public.biometric_attendance_logs bl
          where bl.staff_id=p_staff_id
            and (bl.punch_time at time zone 'Africa/Cairo')::date between ads.attendance_date-1 and ads.attendance_date+1
            and nullif(trim(bl.branch),'') is not null
        ),
        'branch_mismatch',exists(
          select 1 from public.biometric_attendance_logs bl
          where bl.staff_id=p_staff_id
            and (bl.punch_time at time zone 'Africa/Cairo')::date between ads.attendance_date-1 and ads.attendance_date+1
            and nullif(trim(bl.branch),'') is not null
            and trim(bl.branch)<>trim(coalesce(ads.branch,v_staff.branch))
        )
      ) order by ads.attendance_date desc),'[]'::jsonb)
      from public.attendance_daily_summary ads
      where ads.staff_id=p_staff_id and ads.attendance_date between v_from and v_to
    )
  ) into v_result;

  return v_result;
end;
$$;
