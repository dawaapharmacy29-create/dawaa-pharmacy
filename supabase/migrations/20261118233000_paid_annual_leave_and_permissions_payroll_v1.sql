-- What the base pay counts, as management set it (18/11/2026):
--   * an approved annual-leave day is paid: it counts the hours of its shift (it used to count 0, like any day off);
--   * a permission is paid only within the first 2 of the pay cycle and 4 hours in total: the minutes past that
--     are deducted like any missing time (every permission day used to count the whole shift);
--   * every other day off stays unpaid: weekly off, sick, exceptional and approved absence count 0, as before.
-- Same change in the standard engine and in the delivery hours truth, which share the day rule.

create or replace function public.attendance_payroll_engine_core_v2(p_staff_id uuid, p_month_cycle text DEFAULT NULL::text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_start date; v_end date; v_month text;
  v_comp public.employee_compensation_profiles%rowtype;
  v_username text;
  v_actual_days integer:=0;
  v_actual_hours numeric:=0;
  v_base_hours numeric:=0;
  v_absence_days integer:=0;
  v_off_days integer:=0;
  v_timeoff_days integer:=0;
  v_annual_days integer:=0;
  v_pending_days integer:=0;
  v_worked_on_off integer:=0;
  v_approved_ot_hours numeric:=0;
  v_approved_ot_amount numeric:=0;
  v_pending_ot_hours numeric:=0;
  v_true_hourly_rate numeric:=0;
  v_base_salary numeric:=0;
  v_cycle_closed boolean:=false;
  v_eligibility jsonb;
begin
  if p_staff_id is null then
    raise exception 'payroll_staff_required' using errcode='22023';
  end if;

  select sa.username into v_username
  from public.staff_accounts sa
  where sa.staff_id=p_staff_id::text or sa.id=p_staff_id
  order by (sa.staff_id=p_staff_id::text) desc,coalesce(sa.active,true) desc
  limit 1;

  if v_username is null or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;

  if p_month_cycle is not null then
    select cycle_start,cycle_end into v_start,v_end
    from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));
    v_month:=p_month_cycle;
  else
    select cycle_start,cycle_end,month_cycle into v_start,v_end,v_month
    from public.dawaa_pay_cycle_bounds_v1(null);
  end if;

  select * into v_comp
  from public.employee_compensation_profiles p
  where p.staff_id=p_staff_id::text
    and coalesce(p.active,true)
    and (p.effective_from is null or p.effective_from<=v_end)
  order by p.effective_from desc nulls last,p.updated_at desc nulls last,p.created_at desc nulls last
  limit 1;

  if not found or coalesce(v_comp.hourly_rate,0)<=0 then
    return jsonb_build_object(
      'ready',false,'reason','no_hourly_rate_configured',
      'staff_id',p_staff_id,'month_cycle',v_month,'cycle_start',v_start,'cycle_end',v_end
    );
  end if;

  with approved0 as (
    select
      a.*,
      case
        when a.scheduled_start_at is not null and a.scheduled_end_at is not null
        then greatest(extract(epoch from(a.scheduled_end_at-a.scheduled_start_at))/3600.0,0)
        else null
      end as scheduled_hours,
      case
        when a.scheduled_start_at is not null and a.scheduled_end_at is not null
             and a.first_in is not null and a.last_out is not null
        then greatest(
          extract(epoch from(
            least(a.last_out,a.scheduled_end_at)
            - greatest(a.first_in,a.scheduled_start_at)
          ))/3600.0,0
        )
        else coalesce(a.candidate_hours,0)
      end as bounded_hours,
      case
        when a.scheduled_start_at is not null and a.scheduled_end_at is not null
             and a.last_out is not null
        then greatest(
          extract(epoch from(
            least(a.last_out,a.scheduled_end_at)-a.scheduled_start_at
          ))/3600.0,0
        )
        else coalesce(a.candidate_hours,0)
      end as exempt_late_hours,
      coalesce((
        select nullif((x.new_value->>'deduction_minutes')::numeric,0)
        from public.attendance_manual_actions_audit x
        where x.target_id=a.id
          and x.action_type='deduction_adjustment'
          and x.new_value ? 'deduction_minutes'
        order by x.created_at desc
        limit 1
      ),0) as manual_deduction_minutes,
      coalesce(a.resolution_status,'') in ('approved_time_off','approved_annual_leave')
        and coalesce(a.resolution_snapshot->>'time_off_kind','')='annual_leave' as annual_leave_day,
      coalesce((select pp.paid_minutes from public.dawaa_paid_permission_minutes_v1(p_staff_id,v_start,v_end) pp
                where pp.permission_date=a.attendance_date),0) as paid_permission_minutes
    from public.attendance_daily_summary a
    where a.staff_id=p_staff_id
      and a.attendance_date between v_start and least(v_end,(now() at time zone 'Africa/Cairo')::date)
      and a.status='approved'
  ),
  approved as (
    select
      q.*,
      case
        -- Annual leave is paid: the hours of the shift it replaced.
        when q.annual_leave_day
          then coalesce(q.scheduled_hours,nullif(v_comp.contracted_daily_hours,0),0)

        when coalesce(q.candidate_hours,0)<=0
          or coalesce(q.resolution_status,'') in (
            'off_day','approved_time_off','approved_time_off_permission',
            'approved_leave','approved_absence_permission','absence_review'
          ) then 0

        when q.scheduled_hours is null or q.scheduled_hours<=0
          then coalesce(q.candidate_hours,0)

        when q.manual_deduction_minutes>0
          then greatest(q.scheduled_hours-(q.manual_deduction_minutes/60.0),0)

        when coalesce(v_comp.exempt_from_lateness_deduction,false)
          then least(q.scheduled_hours,q.exempt_late_hours)

        -- A permission covers only its paid minutes (2 per cycle, 4 hours in total).
        when coalesce(q.resolution_status,'')='on_time_with_permission'
          then least(q.scheduled_hours,q.bounded_hours+q.paid_permission_minutes/60.0)

        when coalesce(q.resolution_status,'') in (
          'on_time',
          'approved_late','approved_schedule_change','approved_early_leave'
        )
          or lower(coalesce(q.approval_note,'')) like '%بدون خصم%'
          or lower(coalesce(q.approval_note,'')) like '%بإذن%'
          then q.scheduled_hours

        else least(q.scheduled_hours,q.bounded_hours)
      end as payable_hours
    from approved0 q
  )
  select
    count(*) filter(
      where coalesce(candidate_hours,0)>0
        and coalesce(resolution_status,'') not in (
          'off_day','approved_time_off','approved_time_off_permission',
          'approved_leave','approved_absence_permission','absence_review'
        )
    )::integer,
    round(coalesce(sum(candidate_hours) filter(
      where coalesce(candidate_hours,0)>0
        and coalesce(resolution_status,'') not in (
          'off_day','approved_time_off','approved_time_off_permission',
          'approved_leave','approved_absence_permission','absence_review'
        )
    ),0),2),
    round(coalesce(sum(payable_hours),0),2),
    count(*) filter(where resolution_status='absence_review')::integer,
    count(*) filter(where resolution_status='off_day')::integer,
    count(*) filter(where resolution_status in ('approved_time_off','approved_time_off_permission','approved_leave','approved_absence_permission'))::integer,
    count(*) filter(where annual_leave_day)::integer,
    count(*) filter(where resolution_status='worked_on_off' and coalesce(candidate_hours,0)>0)::integer
  into v_actual_days,v_actual_hours,v_base_hours,v_absence_days,v_off_days,v_timeoff_days,v_annual_days,v_worked_on_off
  from approved;

  select count(*)::integer into v_pending_days
  from public.attendance_daily_summary a
  where a.staff_id=p_staff_id
    and a.attendance_date between v_start and least(v_end,(now() at time zone 'Africa/Cairo')::date)
    and a.status='pending_review';

  select
    round(coalesce(sum(o.overtime_hours) filter(where o.status='approved'),0),2),
    round(coalesce(sum(
      case when o.status='approved'
        then coalesce(o.overtime_amount,
          coalesce(o.overtime_hours,0)*coalesce(nullif(v_comp.overtime_hour_rate,0),v_comp.hourly_rate/26.0))
        else 0 end
    ),0),2),
    round(coalesce(sum(o.overtime_hours) filter(where o.status='pending'),0),2)
  into v_approved_ot_hours,v_approved_ot_amount,v_pending_ot_hours
  from public.staff_overtime_approvals o
  where o.staff_id=p_staff_id and o.attendance_date between v_start and v_end;

  v_true_hourly_rate:=round(v_comp.hourly_rate/26.0,4);
  v_base_salary:=round(v_base_hours*v_true_hourly_rate,2);
  v_cycle_closed:=((now() at time zone 'Africa/Cairo')::date>v_end);

  begin
    v_eligibility:=public.get_payroll_attendance_eligibility_v1(p_staff_id,v_month);
  exception when others then
    v_eligibility:=jsonb_build_object('ready_for_payroll',false,'status','eligibility_unavailable');
  end;

  return jsonb_build_object(
    'ready',true,
    'engine_version',4,
    'staff_id',p_staff_id,
    'month_cycle',v_month,
    'cycle_start',v_start,
    'cycle_end',v_end,
    'cycle_closed',v_cycle_closed,
    'salary_calculation_mode',coalesce(v_comp.salary_calculation_mode,'legacy_fixed'),
    'monthly_reference_rate',v_comp.hourly_rate,
    'true_hourly_rate',v_true_hourly_rate,
    'actual_worked_days',v_actual_days,
    'actual_worked_hours',v_actual_hours,
    'base_payable_hours',v_base_hours,
    'base_salary_computed',v_base_salary,
    'approved_overtime_hours',v_approved_ot_hours,
    'approved_overtime_amount',v_approved_ot_amount,
    'pending_overtime_hours',v_pending_ot_hours,
    'absence_days',v_absence_days,
    'off_days',v_off_days,
    'approved_time_off_days',v_timeoff_days,
    'paid_annual_leave_days',v_annual_days,
    'worked_on_off_days',v_worked_on_off,
    'pending_review_days',v_pending_days,
    'attendance_eligibility',v_eligibility,
    'ready_for_final',
      v_cycle_closed
      and v_pending_days=0
      and v_pending_ot_hours=0
      and coalesce((v_eligibility->>'ready_for_payroll')::boolean,false),
    'rule','base pay is limited to scheduled shift; annual leave days are paid at their shift hours, other days off are not; permissions are paid up to 2 per cycle and 4 hours in total; approved overtime is separate; manual deduction multipliers are honored'
  );
end;
$function$;

-- The paid minutes of each permission day in a cycle: the first 2 approved permissions, up to 4 hours together.
create or replace function public.dawaa_paid_permission_minutes_v1(p_staff_id uuid, p_start date, p_end date)
returns table(permission_date date, paid_minutes numeric)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with policy as (
    select coalesce((public.get_attendance_policy_v1(p_end)->>'permission_limit_per_cycle')::int,2) as n,
           coalesce((public.get_attendance_policy_v1(p_end)->>'permission_max_total_minutes')::int,240) as total
  ),
  ranked as (
    select r.start_date,
           coalesce(r.duration_minutes,120)::numeric as minutes,
           row_number() over (order by r.start_date,r.decided_at nulls last,r.created_at) as rn,
           coalesce(sum(coalesce(r.duration_minutes,120)) over (
             order by r.start_date,r.decided_at nulls last,r.created_at
             rows between unbounded preceding and 1 preceding),0)::numeric as before
    from public.staff_time_off_requests r
    where r.staff_id=p_staff_id and r.request_kind='permission' and r.status='approved'
      and r.start_date between p_start and p_end
  )
  select k.start_date,
         sum(case when k.rn<=p.n then least(k.minutes,greatest(p.total-k.before,0)) else 0 end)
  from ranked k cross join policy p
  group by k.start_date
$function$;
revoke all on function public.dawaa_paid_permission_minutes_v1(uuid, date, date) from public, anon, authenticated;

create or replace function public.dawaa_delivery_hours_truth_v1(p_staff_id uuid, p_month_cycle text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_start date; v_end date; v_as_of date;
  v_payable numeric:=0; v_actual numeric:=0; v_days int:=0; v_pending_days int:=0; v_annual_days int:=0;
  v_ot_hours numeric:=0; v_ot_amount numeric:=0; v_pending_ot numeric:=0; v_unresolved_ot int:=0;
  v_rate numeric:=0; v_class jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_delivery_hours_truth_input' using errcode='22023';
  end if;
  select cycle_start,cycle_end into v_start,v_end
  from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));
  v_as_of:=least(v_end,(now() at time zone 'Africa/Cairo')::date);
  v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle);
  v_rate:=coalesce(nullif(v_class->'rates'->>'hourly_rate','')::numeric,0);

  with approved0 as (
    select a.*,
      case when a.scheduled_start_at is not null and a.scheduled_end_at is not null
        then greatest(extract(epoch from(a.scheduled_end_at-a.scheduled_start_at))/3600.0,0) else null end as scheduled_hours,
      case when a.scheduled_start_at is not null and a.scheduled_end_at is not null and a.first_in is not null and a.last_out is not null
        then greatest(extract(epoch from(least(a.last_out,a.scheduled_end_at)-greatest(a.first_in,a.scheduled_start_at)))/3600.0,0)
        else coalesce(a.candidate_hours,0) end as bounded_hours,
      coalesce((select nullif((x.new_value->>'deduction_minutes')::numeric,0)
                from public.attendance_manual_actions_audit x
                where x.target_id=a.id and x.action_type='deduction_adjustment' and x.new_value?'deduction_minutes'
                order by x.created_at desc limit 1),0) as manual_deduction_minutes,
      coalesce(a.resolution_status,'') in ('approved_time_off','approved_annual_leave')
        and coalesce(a.resolution_snapshot->>'time_off_kind','')='annual_leave' as annual_leave_day,
      coalesce((select pp.paid_minutes from public.dawaa_paid_permission_minutes_v1(p_staff_id,v_start,v_end) pp
                where pp.permission_date=a.attendance_date),0) as paid_permission_minutes
    from public.attendance_daily_summary a
    where a.staff_id=p_staff_id and a.attendance_date between v_start and v_as_of and a.status='approved'
  ), approved as (
    select q.*,
      case
        when q.annual_leave_day then coalesce(q.scheduled_hours,0)
        when coalesce(q.candidate_hours,0)<=0 or coalesce(q.resolution_status,'') in ('off_day','approved_time_off','approved_time_off_permission','approved_leave','approved_absence_permission','absence_review') then 0
        when q.scheduled_hours is null or q.scheduled_hours<=0 then coalesce(q.candidate_hours,0)
        when q.manual_deduction_minutes>0 then greatest(q.scheduled_hours-(q.manual_deduction_minutes/60.0),0)
        when coalesce(q.resolution_status,'')='on_time_with_permission'
          then least(q.scheduled_hours,q.bounded_hours+q.paid_permission_minutes/60.0)
        when coalesce(q.resolution_status,'') in ('on_time','approved_late','approved_schedule_change','approved_early_leave','approved_actual_hours_only')
          or lower(coalesce(q.approval_note,'')) like '%بدون خصم%' or lower(coalesce(q.approval_note,'')) like '%بإذن%'
          then least(q.scheduled_hours,case when coalesce(q.resolution_status,'')='approved_actual_hours_only' then coalesce(q.candidate_hours,0) else q.scheduled_hours end)
        else least(q.scheduled_hours,q.bounded_hours)
      end as payable_hours
    from approved0 q
  )
  select
    count(*) filter(where coalesce(candidate_hours,0)>0 and coalesce(resolution_status,'') not in ('off_day','approved_time_off','approved_time_off_permission','approved_leave','approved_absence_permission','absence_review'))::int,
    round(coalesce(sum(candidate_hours) filter(where coalesce(candidate_hours,0)>0 and coalesce(resolution_status,'') not in ('off_day','approved_time_off','approved_time_off_permission','approved_leave','approved_absence_permission','absence_review')),0),2),
    round(coalesce(sum(payable_hours),0),2),
    count(*) filter(where annual_leave_day)::int
  into v_days,v_actual,v_payable,v_annual_days
  from approved;

  select count(*)::int into v_pending_days
  from public.attendance_daily_summary a
  where a.staff_id=p_staff_id and a.attendance_date between v_start and v_as_of and (a.status='pending_review' or coalesce(a.review_required,false)=true);

  with ot as (
    select o.*,
      public.dawaa_overtime_multiplier_from_approval_v1(o.decision_evidence_snapshot,o.decision_note) mult,
      coalesce(nullif(o.decision_evidence_snapshot->>'overtime_minutes','')::numeric/60.0,o.overtime_hours,0) hours_truth
    from public.staff_overtime_approvals o
    where o.staff_id=p_staff_id and o.attendance_date between v_start and v_end
  )
  select
    round(coalesce(sum(hours_truth) filter(where status='approved' and mult is not null),0),2),
    round(coalesce(sum(hours_truth*v_rate*mult) filter(where status='approved' and mult is not null),0),2),
    round(coalesce(sum(hours_truth) filter(where status='pending'),0),2),
    count(*) filter(where status='approved' and mult is null)::int
  into v_ot_hours,v_ot_amount,v_pending_ot,v_unresolved_ot
  from ot;

  return jsonb_build_object(
    'schema','dawaa_delivery_hours_truth_v1','staff_id',p_staff_id,'month_cycle',p_month_cycle,'cycle_start',v_start,'cycle_end',v_end,
    'actual_worked_days',v_days,'actual_worked_hours',v_actual,'base_payable_hours',v_payable,
    'paid_annual_leave_days',v_annual_days,
    'pending_attendance_days',v_pending_days,
    'approved_overtime_hours_resolved',v_ot_hours,'approved_overtime_amount_dynamic',v_ot_amount,
    'pending_overtime_hours',v_pending_ot,'approved_overtime_missing_multiplier_count',v_unresolved_ot,
    'hourly_rate_from_delivery_classification',v_rate,
    'rule','base hours use approved attendance decisions; annual leave days are paid at their shift hours, other days off are not; permissions are paid up to 2 per cycle and 4 hours in total; overtime uses final delivery hourly rate x approved multiplier; unresolved multiplier blocks finalization'
  );
end;
$function$;
