CREATE OR REPLACE FUNCTION public.get_branch_attendance_roster_v2(p_branch text, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_end date := least(p_end,v_today);
  v_can boolean;
  v_out jsonb := '[]'::jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'invalid_attendance_roster_range' using errcode='22023';
  end if;

  v_can := public.dawaa_current_actor_can(array['view_staff_details','view_hr_compliance','view_team','manage_payroll']);
  if not v_can then raise exception 'not_authorized' using errcode='42501'; end if;
  if not public.current_user_branch_access_v1(p_branch,true) then
    raise exception 'branch_scope_denied' using errcode='42501';
  end if;

  if v_end < p_start then return '[]'::jsonb; end if;

  with eligible_staff as (
    select s.id,s.name,s.role,s.join_date
    from public.staff s
    where s.branch=p_branch and coalesce(s.active,false)=true
  ),
  attendance_agg as (
    select
      a.staff_id,
      count(*) filter(
        where a.status='approved'
          and coalesce(a.candidate_hours,0)>0
          and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','absence_review')
      )::integer actual_worked_days,
      count(*) filter(where a.status='approved' and a.resolution_status in ('late','very_late'))::integer late_days,
      coalesce(sum(a.late_minutes) filter(where a.status='approved' and a.resolution_status in ('late','very_late')),0)::integer total_late_minutes,
      round(coalesce(sum(a.candidate_hours) filter(
        where a.status='approved'
          and coalesce(a.candidate_hours,0)>0
          and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','absence_review')
      ),0)::numeric,2) total_worked_hours,
      count(*) filter(where a.status='pending_review' and a.resolution_status='absence_review')::integer absence_review_days,
      count(*) filter(where a.status='pending_review')::integer pending_review_days
    from public.attendance_daily_summary a
    where a.attendance_date between p_start and v_end
    group by a.staff_id
  ),
  pending_triage as (
    select
      a.staff_id,
      count(*) filter(
        where a.status='pending_review'
          and (
            a.resolution_status not in ('missing_checkin','missing_checkout','absence_review')
            or (
              a.resolution_status in ('missing_checkin','missing_checkout','absence_review')
              and (
                select count(*)
                from public.biometric_attendance_logs b
                where b.staff_id=a.staff_id
                  and (
                    (a.scheduled_start_at is not null and a.scheduled_end_at is not null
                     and b.punch_time between a.scheduled_start_at-interval '4 hours' and a.scheduled_end_at+interval '6 hours')
                    or
                    ((a.scheduled_start_at is null or a.scheduled_end_at is null)
                     and (b.punch_time at time zone 'Africa/Cairo')::date between a.attendance_date and a.attendance_date+1)
                  )
              )<2
            )
          )
      )::integer manager_review_days,
      count(*) filter(
        where a.status='pending_review'
          and a.resolution_status in ('missing_checkin','missing_checkout','absence_review')
          and (
            select count(*)
            from public.biometric_attendance_logs b
            where b.staff_id=a.staff_id
              and (
                (a.scheduled_start_at is not null and a.scheduled_end_at is not null
                 and b.punch_time between a.scheduled_start_at-interval '4 hours' and a.scheduled_end_at+interval '6 hours')
                or
                ((a.scheduled_start_at is null or a.scheduled_end_at is null)
                 and (b.punch_time at time zone 'Africa/Cairo')::date between a.attendance_date and a.attendance_date+1)
              )
          )>=2
      )::integer system_review_days
    from public.attendance_daily_summary a
    where a.attendance_date between p_start and v_end
    group by a.staff_id
  ),
  overtime_agg as (
    select o.staff_id,round(coalesce(sum(o.overtime_hours) filter(where o.status='approved'),0)::numeric,2) total_overtime_hours
    from public.staff_overtime_approvals o
    where o.attendance_date between p_start and v_end
    group by o.staff_id
  ),
  rows as (
    select
      s.id staff_id,
      s.name staff_name,
      s.role,
      coalesce(a.total_late_minutes,0) total_late_minutes,
      coalesce(a.late_days,0) late_days,
      coalesce(a.absence_review_days,0) absence_review_days,
      coalesce(t.manager_review_days,0) needs_review_days,
      coalesce(t.system_review_days,0) system_review_days,
      coalesce(a.actual_worked_days,0) actual_worked_days,
      coalesce(a.total_worked_hours,0) total_worked_hours,
      coalesce(o.total_overtime_hours,0) total_overtime_hours,
      case
        when coalesce(a.absence_review_days,0)>=2 or coalesce(a.late_days,0)>=5 then 'urgent'
        when coalesce(a.late_days,0)>=3 or coalesce(t.manager_review_days,0)>=3 then 'watch'
        else 'none'
      end risk_level,
      jsonb_strip_nulls(jsonb_build_array(
        case when coalesce(a.absence_review_days,0)>=2 then 'غياب يحتاج قرارًا' end,
        case when coalesce(a.late_days,0)>=3 then 'تأخير متكرر معتمد' end,
        case when coalesce(t.manager_review_days,0)>=3 then 'حالات تحتاج قرار المدير' end
      )) risk_reasons,
      s.join_date,
      case when s.join_date is not null then v_today-s.join_date else null end tenure_days
    from eligible_staff s
    left join attendance_agg a on a.staff_id=s.id
    left join pending_triage t on t.staff_id=s.id
    left join overtime_agg o on o.staff_id=s.id
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by
    case r.risk_level when 'urgent' then 0 when 'watch' then 1 else 2 end,
    r.total_late_minutes desc,
    r.staff_name
  ),'[]'::jsonb)
  into v_out
  from rows r;

  return v_out;
end;
$function$


CREATE OR REPLACE FUNCTION public.get_staff_attendance_detail_v2(p_staff_id uuid, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_end date := least(p_end, v_today);
  v_actor_account_id uuid;
  v_actor_staff_id uuid;
  v_is_self boolean := false;
  v_can boolean;
  v_staff record;
  v_comp record;
  v_days jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_actual_worked_days integer := 0;
  v_scheduled_workdays integer := 0;
  v_off_days integer := 0;
  v_approved_leave_days integer := 0;
  v_pending_review_days integer := 0;
  v_absence_review_days integer := 0;
  v_missing_punch_days integer := 0;
  v_late_days integer := 0;
  v_total_late_minutes integer := 0;
  v_total_early_minutes integer := 0;
  v_total_worked_hours numeric := 0;
  v_pending_worked_hours numeric := 0;
  v_ot_approved numeric := 0;
  v_ot_pending numeric := 0;
  v_true_hourly_rate numeric;
  v_overtime_rate numeric;
begin
  if p_staff_id is null or p_start is null or p_end is null or p_end < p_start or p_end - p_start > 62 then
    raise exception 'invalid_attendance_detail_range' using errcode='22023';
  end if;

  v_actor_account_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_account_id is not null then
    select trim(sa.staff_id)::uuid into v_actor_staff_id
    from public.staff_accounts sa
    where sa.id=v_actor_account_id
      and trim(coalesce(sa.staff_id,'')) ~* '^[0-9a-f]{8}-'
    limit 1;
  end if;
  v_is_self := v_actor_staff_id is not null and v_actor_staff_id=p_staff_id;
  v_can := v_is_self or public.dawaa_current_actor_can(array['view_staff_details','view_hr_compliance','view_team','manage_payroll']);
  if not v_can then raise exception 'not_authorized' using errcode='42501'; end if;

  select s.id,s.name,s.role,s.branch into v_staff
  from public.staff s
  where s.id=p_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;
  if not v_is_self and not public.current_user_branch_access_v1(v_staff.branch,true) then
    raise exception 'branch_scope_denied' using errcode='42501';
  end if;

  select * into v_comp
  from public.employee_compensation_profiles cp
  where cp.staff_id=p_staff_id::text and coalesce(cp.active,true)
  order by cp.effective_from desc nulls last,cp.updated_at desc nulls last
  limit 1;

  v_true_hourly_rate := case when coalesce(v_comp.hourly_rate,0)>0 then round(v_comp.hourly_rate/26.0,4) else null end;
  v_overtime_rate := case when v_true_hourly_rate is not null then round(v_true_hourly_rate*1.5,4) else null end;

  if v_end >= p_start then
    with dates as (
      select gs::date d
      from generate_series(p_start::timestamp,v_end::timestamp,interval '1 day') gs
    ),
    daily as (
      select
        d.d,
        case extract(dow from d.d)::int
          when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
          when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت'
        end day_name,
        a.id summary_id,
        a.status approval_state,
        a.resolution_status,
        a.first_in,
        a.last_out,
        a.candidate_hours,
        a.payroll_eligible_hours,
        a.late_minutes,
        a.early_leave_minutes,
        a.scheduled_start_at,
        a.scheduled_end_at,
        a.resolution_snapshot,
        r.schedule_id,
        coalesce(r.is_off,false) or coalesce(r.is_day_off,false) is_off_day,
        o.status overtime_status,
        coalesce(o.overtime_hours,0) overtime_hours
      from dates d
      left join public.attendance_daily_summary a
        on a.staff_id=p_staff_id and a.attendance_date=d.d
      left join lateral public.attendance_schedule_for_date_v1(p_staff_id,d.d) r on true
      left join public.staff_overtime_approvals o
        on o.staff_id=p_staff_id and o.attendance_date=d.d
    )
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'attendance_date',x.d,
        'day_name',x.day_name,
        'resolution_status',coalesce(x.resolution_status,case when x.is_off_day then 'off_day' else 'not_materialized' end),
        'approval_state',coalesce(x.approval_state,'not_materialized'),
        'is_off_day',x.is_off_day,
        'first_in',x.first_in,
        'last_out',x.last_out,
        'candidate_hours',x.candidate_hours,
        'payroll_eligible_hours',x.payroll_eligible_hours,
        'scheduled_hours',case
          when x.scheduled_start_at is not null and x.scheduled_end_at is not null
          then round((extract(epoch from(x.scheduled_end_at-x.scheduled_start_at))/3600.0)::numeric,2)
          else null end,
        'overtime_hours',round(x.overtime_hours::numeric,2),
        'overtime_approval_status',x.overtime_status,
        'late_minutes',coalesce(x.late_minutes,0),
        'early_leave_minutes',coalesce(x.early_leave_minutes,0),
        'time_off_kind',x.resolution_snapshot->>'time_off_kind',
        'permission_attached',coalesce((x.resolution_snapshot->>'permission_attached')::boolean,false),
        'reason',x.resolution_snapshot->>'reason',
        'data_source',case
          when x.approval_state='approved' then 'approved_snapshot'
          when x.approval_state='pending_review' then 'pending_snapshot'
          else 'schedule_only' end
      ) order by x.d),'[]'::jsonb),
      count(*) filter(
        where x.approval_state='approved'
          and coalesce(x.candidate_hours,0)>0
          and coalesce(x.resolution_status,'') not in ('off_day','approved_time_off','absence_review')
      )::integer,
      count(*) filter(
        where x.schedule_id is not null and not x.is_off_day
      )::integer,
      count(*) filter(where x.is_off_day)::integer,
      count(*) filter(where x.approval_state='approved' and x.resolution_status='approved_time_off')::integer,
      count(*) filter(where x.approval_state='pending_review')::integer,
      count(*) filter(where x.approval_state='pending_review' and x.resolution_status='absence_review')::integer,
      count(*) filter(where x.approval_state='pending_review' and x.resolution_status in ('missing_checkin','missing_checkout'))::integer,
      count(*) filter(where x.approval_state='approved' and x.resolution_status in ('late','very_late'))::integer,
      coalesce(sum(x.late_minutes) filter(where x.approval_state='approved' and x.resolution_status in ('late','very_late')),0)::integer,
      coalesce(sum(x.early_leave_minutes) filter(where x.approval_state='approved'),0)::integer,
      round(coalesce(sum(x.candidate_hours) filter(
        where x.approval_state='approved'
          and coalesce(x.candidate_hours,0)>0
          and coalesce(x.resolution_status,'') not in ('off_day','approved_time_off','absence_review')
      ),0)::numeric,2),
      round(coalesce(sum(x.candidate_hours) filter(where x.approval_state='pending_review'),0)::numeric,2),
      round(coalesce(sum(x.overtime_hours) filter(where x.overtime_status='approved'),0)::numeric,2),
      round(coalesce(sum(x.overtime_hours) filter(where x.overtime_status='pending'),0)::numeric,2)
    into
      v_days,
      v_actual_worked_days,
      v_scheduled_workdays,
      v_off_days,
      v_approved_leave_days,
      v_pending_review_days,
      v_absence_review_days,
      v_missing_punch_days,
      v_late_days,
      v_total_late_minutes,
      v_total_early_minutes,
      v_total_worked_hours,
      v_pending_worked_hours,
      v_ot_approved,
      v_ot_pending
    from daily x;
  end if;

  v_summary := jsonb_build_object(
    'requested_start',p_start,
    'requested_end',p_end,
    'effective_start',p_start,
    'effective_end',case when v_end>=p_start then v_end else null end,
    'cycle_open',p_end>v_today and p_start<=v_today,
    'future_days_excluded',greatest(p_end-v_today,0),
    'period_days',case when v_end>=p_start then v_end-p_start+1 else 0 end,
    'scheduled_workdays',v_scheduled_workdays,
    'actual_worked_days',v_actual_worked_days,
    'off_days',v_off_days,
    'approved_leave_days',v_approved_leave_days,
    'pending_review_days',v_pending_review_days,
    'absence_review_days',v_absence_review_days,
    'missing_punch_days',v_missing_punch_days,
    'late_days',v_late_days,
    'total_late_minutes',v_total_late_minutes,
    'total_early_leave_minutes',v_total_early_minutes,
    'total_worked_hours',v_total_worked_hours,
    'pending_worked_hours',v_pending_worked_hours,
    'total_overtime_hours_approved',v_ot_approved,
    'total_overtime_hours_pending',v_ot_pending,
    'hourly_rate',v_comp.hourly_rate,
    'true_hourly_rate',v_true_hourly_rate,
    'overtime_hour_rate',v_overtime_rate,
    'salary_calculation_mode',v_comp.salary_calculation_mode,
    'financial_deductions_source','payroll_engine_only',
    'compensation_profile_complete',coalesce(v_comp.hourly_rate,0)>0
  );

  return jsonb_build_object(
    'staff',jsonb_build_object('id',v_staff.id,'name',v_staff.name,'role',v_staff.role,'branch',v_staff.branch),
    'days',v_days,
    'summary',v_summary
  );
end;
$function$


grant execute on function public.get_staff_attendance_detail_v2(uuid,date,date) to anon,authenticated,service_role;
grant execute on function public.get_branch_attendance_roster_v2(text,date,date) to anon,authenticated,service_role;
