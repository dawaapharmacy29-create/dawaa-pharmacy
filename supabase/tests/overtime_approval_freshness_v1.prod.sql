-- Exact Production definitions (2026-10-16) used by overtime_approval_freshness_v1.fixture.sql.

CREATE OR REPLACE FUNCTION public.dawaa_pay_cycle_bounds_v1(p_date date DEFAULT NULL::date)
 RETURNS TABLE(cycle_start date, cycle_end date, month_cycle text)
 LANGUAGE sql
 IMMUTABLE
AS $function$
  with d as (select coalesce(p_date, (now() at time zone 'Africa/Cairo')::date) as v)
  select
    case when extract(day from d.v) >= 26
      then date_trunc('month', d.v)::date + 25
      else date_trunc('month', d.v)::date - interval '1 month' + interval '25 days'
    end::date as cycle_start,
    case when extract(day from d.v) >= 26
      then (date_trunc('month', d.v)::date + interval '1 month' + interval '24 days')::date
      else (date_trunc('month', d.v)::date + interval '24 days')::date
    end as cycle_end,
    case when extract(day from d.v) >= 26
      then to_char(date_trunc('month', d.v)::date + interval '1 month', 'YYYY-MM')
      else to_char(d.v, 'YYYY-MM')
    end as month_cycle
  from d;
$function$
;

CREATE OR REPLACE FUNCTION public.attendance_resolution_fingerprint_v2(p_resolution_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select md5(jsonb_build_object(
    'id',a.id,'staff_id',a.staff_id,'attendance_date',a.attendance_date,'status',a.status,
    'resolution_status',a.resolution_status,'candidate_hours',a.candidate_hours,
    'payroll_eligible_hours',a.payroll_eligible_hours,'schedule_id',a.schedule_id,'first_in',a.first_in,
    'last_out',a.last_out,'late_minutes',a.late_minutes,'early_leave_minutes',a.early_leave_minutes,
    'time_off_request_id',a.time_off_request_id,'policy_version',a.policy_version
  )::text)
  from public.attendance_daily_summary a where a.id=p_resolution_id
$function$
;

CREATE OR REPLACE FUNCTION public.hr_invalidate_overtime_on_attendance_change_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_invalidated integer:=0;
  v_cycle record;
begin
  if old.status='approved'
     and (
       new.status is distinct from 'approved'
       or row(
         old.schedule_id,
         old.scheduled_start_at,
         old.scheduled_end_at,
         old.first_in,
         old.last_out,
         old.candidate_hours,
         old.payroll_eligible_hours,
         old.late_minutes,
         old.early_leave_minutes,
         old.resolution_status,
         old.time_off_request_id
       ) is distinct from row(
         new.schedule_id,
         new.scheduled_start_at,
         new.scheduled_end_at,
         new.first_in,
         new.last_out,
         new.candidate_hours,
         new.payroll_eligible_hours,
         new.late_minutes,
         new.early_leave_minutes,
         new.resolution_status,
         new.time_off_request_id
       )
     ) then

    update public.staff_overtime_approvals o
    set
      status='pending',
      decided_at=null,
      decided_by=null,
      decided_by_name=null,
      decision_note=concat_ws(
        ' | ',
        nullif(trim(coalesce(o.decision_note,'')),''),
        'أعيدت للمراجعة تلقائيًا بسبب تغيير Attendance Truth'
      ),
      source_resolution_fingerprint=null,
      source_resolution_linked_at=null,
      decision_evidence_snapshot=jsonb_build_object(
        'evidence_available',false,
        'reason','attendance_truth_changed_after_overtime_decision',
        'previous_evidence',coalesce(o.decision_evidence_snapshot,'{}'::jsonb),
        'invalidated_at',now()
      ),
      decision_evidence_version='attendance_truth_invalidated_v1',
      updated_at=now()
    where o.source_resolution_id=new.id
      and o.status='approved';

    get diagnostics v_invalidated = row_count;

    if v_invalidated>0 then
      select * into v_cycle
      from public.dawaa_pay_cycle_bounds_v1(new.attendance_date);

      delete from public.employee_transactions et
      where et.staff_id=new.staff_id
        and et.month_cycle=v_cycle.month_cycle
        and et.source in ('attendance_overtime_v1','attendance_overtime_v2');
    end if;
  end if;

  return new;
end;
$function$
;
