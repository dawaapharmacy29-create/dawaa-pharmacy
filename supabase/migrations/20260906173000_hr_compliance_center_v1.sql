-- HR / compliance read models.
-- These functions do not calculate payroll deductions. They provide transparent
-- operational attendance/compliance facts for management review.

create or replace function public.hr_staff_compliance_summary_v1(
  p_start date,
  p_end date,
  p_branch text default null
)
returns table(
  staff_id uuid,
  staff_name text,
  role text,
  branch text,
  cycle_start date,
  cycle_end date,
  scheduled_days integer,
  present_days integer,
  absent_days integer,
  on_time_days integer,
  late_days integer,
  very_late_days integer,
  total_late_minutes integer,
  early_leave_days integer,
  total_early_leave_minutes integer,
  missing_checkout_days integer,
  approved_exception_days integer,
  approved_permission_days integer,
  approved_leave_days integer,
  worked_on_off_days integer,
  schedule_issue_days integer,
  biometric_days integer,
  biometric_events integer,
  attendance_rate numeric,
  punctuality_rate numeric,
  compliance_score numeric,
  risk_level text,
  attention_reasons text[]
)
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_role text;
  v_actor_branch text;
  v_effective_branch text;
begin
  if p_start is null or p_end is null or p_end < p_start then
    raise exception using errcode='22023', message='valid HR report dates required';
  end if;
  if (p_end - p_start) > 93 then
    raise exception using errcode='22023', message='HR compliance period cannot exceed 94 days';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id = public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;
  if not found then
    raise exception using errcode='42501', message='active staff actor required';
  end if;

  v_role := lower(coalesce(v_actor.role,''));
  v_actor_branch := nullif(trim(coalesce(v_actor.branch,'')),'');

  if v_role in ('general_manager','executive_manager','branches_manager','admin') then
    v_effective_branch := nullif(trim(coalesce(p_branch,'')),'');
  elsif v_role in ('branch_manager','shift_supervisor_morning','shift_supervisor_evening') then
    v_effective_branch := v_actor_branch;
  else
    raise exception using errcode='42501', message='not authorized to view HR compliance summary';
  end if;

  return query
  with daily as (
    select d.work_day, a.*
    from generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') g(day_ts)
    cross join lateral (select g.day_ts::date as work_day) d
    cross join lateral public.attendance_daily_command_v1(d.work_day,v_effective_branch) a
  ), agg as (
    select
      x.staff_id,
      max(x.staff_name) as staff_name,
      max(x.role) as role,
      max(x.branch) as branch,
      count(*) filter (where x.schedule_status='scheduled')::int as scheduled_days,
      count(*) filter (where x.first_check_in is not null)::int as present_days,
      count(*) filter (where x.attendance_status='absent')::int as absent_days,
      count(*) filter (where x.attendance_status in ('on_time','working_now') and coalesce(x.late_minutes,0)=0)::int as on_time_days,
      count(*) filter (where coalesce(x.late_minutes,0)>0)::int as late_days,
      count(*) filter (where coalesce(x.late_minutes,0)>30)::int as very_late_days,
      coalesce(sum(x.late_minutes),0)::int as total_late_minutes,
      count(*) filter (where coalesce(x.early_leave_minutes,0)>0)::int as early_leave_days,
      coalesce(sum(x.early_leave_minutes),0)::int as total_early_leave_minutes,
      count(*) filter (where x.attendance_status='missing_checkout')::int as missing_checkout_days,
      count(*) filter (where x.attendance_status='approved_exception' or x.approved_exception_type is not null)::int as approved_exception_days,
      count(*) filter (
        where lower(coalesce(x.approved_exception_type,'')) similar to '%(permission|permit|اذن|إذن)%'
      )::int as approved_permission_days,
      count(*) filter (
        where lower(coalesce(x.approved_exception_type,'')) similar to '%(leave|vacation|off|اجاز|إجاز)%'
      )::int as approved_leave_days,
      count(*) filter (where x.attendance_status='worked_on_off')::int as worked_on_off_days,
      count(*) filter (where x.attendance_status in ('schedule_conflict','schedule_missing','punch_without_valid_schedule'))::int as schedule_issue_days,
      count(*) filter (where coalesce(x.biometric_events,0)>0)::int as biometric_days,
      coalesce(sum(x.biometric_events),0)::int as biometric_events
    from daily x
    group by x.staff_id
  ), scored as (
    select
      a.*,
      case when a.scheduled_days>0 then round((a.present_days::numeric/a.scheduled_days::numeric)*100,1) else 0 end as attendance_rate,
      case when a.present_days>0 then round((a.on_time_days::numeric/a.present_days::numeric)*100,1) else 0 end as punctuality_rate,
      greatest(0,least(100,
        100
        - a.absent_days*12
        - a.very_late_days*5
        - greatest(a.late_days-a.very_late_days,0)*2
        - a.early_leave_days*2
        - a.missing_checkout_days*3
        - a.schedule_issue_days
      ))::numeric as compliance_score
    from agg a
  )
  select
    s.staff_id,s.staff_name,s.role,s.branch,p_start,p_end,
    s.scheduled_days,s.present_days,s.absent_days,s.on_time_days,s.late_days,s.very_late_days,
    s.total_late_minutes,s.early_leave_days,s.total_early_leave_minutes,s.missing_checkout_days,
    s.approved_exception_days,s.approved_permission_days,s.approved_leave_days,s.worked_on_off_days,
    s.schedule_issue_days,s.biometric_days,s.biometric_events,s.attendance_rate,s.punctuality_rate,
    round(s.compliance_score,1),
    case
      when s.absent_days>=2 or s.compliance_score<70 then 'critical'
      when s.very_late_days>=2 or s.missing_checkout_days>=2 or s.compliance_score<85 then 'attention'
      when s.compliance_score<95 then 'watch'
      else 'good'
    end,
    array_remove(array[
      case when s.absent_days>0 then 'غياب: '||s.absent_days end,
      case when s.late_days>0 then 'تأخير: '||s.late_days||' مرات / '||s.total_late_minutes||' دقيقة' end,
      case when s.early_leave_days>0 then 'انصراف مبكر: '||s.early_leave_days||' مرات' end,
      case when s.missing_checkout_days>0 then 'بصمة خروج ناقصة: '||s.missing_checkout_days end,
      case when s.schedule_issue_days>0 then 'مشكلة جدول/ربط: '||s.schedule_issue_days end,
      case when s.biometric_days<s.present_days then 'أيام حضور بدون تغطية بصمة كاملة' end
    ],null)::text[]
  from scored s
  order by
    case when s.compliance_score<70 then 0 when s.compliance_score<85 then 1 when s.compliance_score<95 then 2 else 3 end,
    s.branch,s.staff_name;
end;
$$;

revoke all on function public.hr_staff_compliance_summary_v1(date,date,text) from public;
grant execute on function public.hr_staff_compliance_summary_v1(date,date,text) to authenticated,service_role;

create or replace function public.hr_branch_compliance_summary_v1(
  p_start date,
  p_end date
)
returns table(
  branch text,
  employees integer,
  scheduled_days integer,
  present_days integer,
  absent_days integer,
  late_days integer,
  total_late_minutes integer,
  early_leave_days integer,
  permissions_days integer,
  leave_days integer,
  missing_checkout_days integer,
  schedule_issue_days integer,
  attendance_rate numeric,
  punctuality_rate numeric,
  avg_compliance_score numeric,
  critical_employees integer,
  attention_employees integer
)
language sql
stable
security definer
set search_path=public,pg_catalog
as $$
  with s as (
    select * from public.hr_staff_compliance_summary_v1(p_start,p_end,null)
  )
  select
    coalesce(nullif(trim(branch),''),'غير محدد') as branch,
    count(*)::int as employees,
    coalesce(sum(scheduled_days),0)::int,
    coalesce(sum(present_days),0)::int,
    coalesce(sum(absent_days),0)::int,
    coalesce(sum(late_days),0)::int,
    coalesce(sum(total_late_minutes),0)::int,
    coalesce(sum(early_leave_days),0)::int,
    coalesce(sum(approved_permission_days),0)::int,
    coalesce(sum(approved_leave_days),0)::int,
    coalesce(sum(missing_checkout_days),0)::int,
    coalesce(sum(schedule_issue_days),0)::int,
    case when sum(scheduled_days)>0 then round(sum(present_days)::numeric/sum(scheduled_days)*100,1) else 0 end,
    case when sum(present_days)>0 then round(sum(on_time_days)::numeric/sum(present_days)*100,1) else 0 end,
    round(avg(compliance_score),1),
    count(*) filter (where risk_level='critical')::int,
    count(*) filter (where risk_level='attention')::int
  from s
  group by coalesce(nullif(trim(branch),''),'غير محدد')
  order by avg(compliance_score) asc nulls first;
$$;

revoke all on function public.hr_branch_compliance_summary_v1(date,date) from public;
grant execute on function public.hr_branch_compliance_summary_v1(date,date) to authenticated,service_role;

create or replace function public.hr_daily_attention_queue_v1(
  p_date date default ((now() at time zone 'Africa/Cairo'))::date,
  p_branch text default null
)
returns table(
  staff_id uuid,
  staff_name text,
  role text,
  branch text,
  work_date date,
  attendance_status text,
  shift_start text,
  shift_end text,
  first_check_in timestamptz,
  last_check_out timestamptz,
  late_minutes integer,
  early_leave_minutes integer,
  approved_exception_type text,
  approved_exception_reason text,
  biometric_events integer,
  source_status text,
  severity text,
  manager_action text
)
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_role text;
  v_effective_branch text;
begin
  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;
  if not found then raise exception using errcode='42501', message='active staff actor required'; end if;
  v_role := lower(coalesce(v_actor.role,''));
  if v_role in ('general_manager','executive_manager','branches_manager','admin') then
    v_effective_branch := nullif(trim(coalesce(p_branch,'')),'');
  elsif v_role in ('branch_manager','shift_supervisor_morning','shift_supervisor_evening') then
    v_effective_branch := nullif(trim(coalesce(v_actor.branch,'')),'');
  else
    raise exception using errcode='42501', message='not authorized to view HR attention queue';
  end if;

  return query
  select
    a.staff_id,a.staff_name,a.role,a.branch,a.work_date,a.attendance_status,
    a.shift_start,a.shift_end,a.first_check_in,a.last_check_out,
    coalesce(a.late_minutes,0),coalesce(a.early_leave_minutes,0),
    a.approved_exception_type,a.approved_exception_reason,coalesce(a.biometric_events,0),a.source_status,
    case
      when a.attendance_status in ('absent','schedule_conflict','punch_without_valid_schedule') then 'critical'
      when coalesce(a.late_minutes,0)>30 or a.attendance_status='missing_checkout' then 'high'
      when coalesce(a.late_minutes,0)>0 or coalesce(a.early_leave_minutes,0)>0 then 'medium'
      else 'info'
    end,
    case
      when a.attendance_status='absent' then 'راجع وجود إذن/إجازة معتمدة قبل اعتماد الغياب'
      when a.attendance_status='missing_checkout' then 'راجع بصمة الخروج أو طلب تصحيح موثق'
      when a.attendance_status in ('schedule_conflict','schedule_missing','punch_without_valid_schedule') then 'صحح الجدول أو ربط الموظف قبل أي محاسبة'
      when coalesce(a.late_minutes,0)>30 then 'راجع سبب التأخير وتكراره خلال الدورة'
      when coalesce(a.early_leave_minutes,0)>0 then 'راجع إذن الانصراف المبكر إن وجد'
      else 'مراجعة إدارية'
    end
  from public.attendance_daily_command_v1(p_date,v_effective_branch) a
  where a.attendance_status in ('absent','missing_checkout','schedule_conflict','schedule_missing','punch_without_valid_schedule')
     or coalesce(a.late_minutes,0)>0
     or coalesce(a.early_leave_minutes,0)>0
  order by
    case when a.attendance_status in ('absent','schedule_conflict','punch_without_valid_schedule') then 0
         when coalesce(a.late_minutes,0)>30 or a.attendance_status='missing_checkout' then 1
         else 2 end,
    a.branch,a.staff_name;
end;
$$;

revoke all on function public.hr_daily_attention_queue_v1(date,text) from public;
grant execute on function public.hr_daily_attention_queue_v1(date,text) to authenticated,service_role;

comment on function public.hr_staff_compliance_summary_v1(date,date,text) is
'HR operational compliance summary. Informational only; does not post payroll deductions or incentive changes.';
comment on function public.hr_daily_attention_queue_v1(date,text) is
'Daily manager review queue for attendance exceptions before HR/payroll action.';

notify pgrst,'reload schema';
