create or replace function public.attendance_diagnostic_summary_v2(
  p_start date,
  p_end date,
  p_branch text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
    raise exception 'invalid_attendance_diagnostic_summary_v2_range' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;
  if not found then
    raise exception 'active staff actor required' using errcode='42501';
  end if;

  with base as (
    select
      a.staff_id,a.branch,a.attendance_date,a.resolution_status,
      public.dawaa_build_attendance_day_resolution_current_v1(a.staff_id,a.attendance_date) preview,
      case
        when a.resolution_status='no_schedule' then 'NO_SCHEDULE'
        when a.resolution_status='invalid_schedule_time' then 'INVALID_SCHEDULE_TIME'
        when a.resolution_status='schedule_conflict' then 'SCHEDULE_CONFLICT'
        when a.resolution_status='sync_pending_verification' then 'SYNC_NOT_COMPLETE'
        when a.resolution_status='needs_event_review' then 'PUNCH_INTERPRETATION_REQUIRED'
        when a.resolution_status='invalid_duration' then 'INVALID_WORK_DURATION'
        when a.resolution_status='absence_review' then 'ABSENCE_AFTER_COMPLETE_SYNC'
        when a.resolution_status='missing_checkin' then 'MISSING_OR_UNRESOLVED_CHECKIN'
        when a.resolution_status='missing_checkout' then 'MISSING_OR_UNRESOLVED_CHECKOUT'
        when a.resolution_status='early_leave_review' then 'EARLY_LEAVE_WITHOUT_PERMISSION'
        when a.resolution_status='worked_on_off' then 'WORKED_ON_OFF_DAY'
        when a.resolution_status='time_off_with_events' then 'TIMEOFF_WITH_ATTENDANCE_EVENTS'
        when a.resolution_status='time_off_conflict' then 'TIMEOFF_CONFLICT'
        else 'MANUAL_REVIEW_REQUIRED'
      end as code,
      case
        when a.resolution_status='no_schedule' then 'لا يوجد جدول معتمد'
        when a.resolution_status='invalid_schedule_time' then 'وقت جدول غير صالح'
        when a.resolution_status='schedule_conflict' then 'تعارض في الجدول'
        when a.resolution_status='sync_pending_verification' then 'المزامنة غير مكتملة'
        when a.resolution_status='needs_event_review' then 'بصمة غير مكتملة أو تحتاج تفسير'
        when a.resolution_status='invalid_duration' then 'مدة العمل غير منطقية'
        when a.resolution_status='absence_review' then 'غياب بعد اكتمال المزامنة'
        when a.resolution_status='missing_checkin' then 'دخول ناقص أو غير مفسر'
        when a.resolution_status='missing_checkout' then 'خروج ناقص أو غير مفسر'
        when a.resolution_status='early_leave_review' then 'خروج مبكر بدون إذن'
        when a.resolution_status='worked_on_off' then 'عمل في يوم راحة'
        when a.resolution_status='time_off_with_events' then 'حضور أثناء إجازة'
        when a.resolution_status='time_off_conflict' then 'تعارض إجازات/أذونات'
        else 'مراجعة بشرية'
      end as label
    from public.attendance_daily_summary a
    join public.staff s on s.id=a.staff_id
    where a.attendance_date between p_start and p_end
      and a.status='pending_review'
      and coalesce(a.resolution_version,0)>=2
      and (
        p_branch is null or trim(p_branch)='' or p_branch='الكل'
        or trim(s.branch)=trim(p_branch)
        or trim(coalesce(a.branch,''))=trim(p_branch)
      )
      and public.dawaa_can_read_staff_attendance_log(a.staff_id,s.branch)
  ), classified as (
    select b.*,
      public.dawaa_attendance_review_triage_v1(b.resolution_status,b.preview) as triage,
      case
        when public.dawaa_attendance_review_triage_v1(b.resolution_status,b.preview)='manager' then 'manager'
        else 'system'
      end as owner
    from base b
  ), grouped as (
    select code,label,owner,count(*)::int cases
    from classified
    group by code,label,owner
  )
  select jsonb_build_object(
    'total_cases',(select count(*) from classified),
    'manager_cases',(select count(*) from classified where triage='manager'),
    'system_cases',(select count(*) from classified where triage<>'manager'),
    'auto_resolvable_cases',(select count(*) from classified where triage='auto'),
    'waiting_cases',(select count(*) from classified where triage='waiting'),
    'system_repair_cases',(select count(*) from classified where triage='system_repair'),
    'causes',coalesce((
      select jsonb_agg(jsonb_build_object(
        'code',code,'label',label,'owner',owner,'cases',cases
      ) order by cases desc,label)
      from grouped
    ),'[]'::jsonb),
    'generated_at',now()
  ) into v_result;

  return v_result;
end;
$$;
