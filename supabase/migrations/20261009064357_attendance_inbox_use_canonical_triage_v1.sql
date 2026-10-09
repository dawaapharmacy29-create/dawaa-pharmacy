create or replace function public.get_attendance_exception_inbox_v3(
  p_start date,
  p_end date,
  p_branch text default null,
  p_lane text default 'manager',
  p_limit integer default 300
)
returns table(
  resolution_id uuid,
  staff_id uuid,
  staff_name text,
  branch text,
  attendance_date date,
  resolution_status text,
  queue_lane text,
  action_required boolean,
  employee_fault boolean,
  issue_group text,
  issue_label text,
  raw_events integer,
  first_in timestamptz,
  last_out timestamptz,
  late_minutes integer,
  early_leave_minutes integer,
  candidate_hours numeric,
  payroll_eligible_hours numeric,
  status text,
  resolution_origin text,
  policy_version text,
  schedule_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_lane text:=lower(trim(coalesce(p_lane,'manager')));
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
    raise exception 'attendance_exception_inbox_v3_invalid_range' using errcode='22023';
  end if;
  if v_lane not in ('all','manager','system') then
    raise exception 'attendance_exception_inbox_v3_invalid_lane' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;
  if not found then
    raise exception 'active staff actor required' using errcode='42501';
  end if;

  return query
  with base as (
    select
      a.*,
      s.name as resolved_staff_name,
      s.branch as staff_branch,
      public.dawaa_build_attendance_day_resolution_current_v1(a.staff_id,a.attendance_date) as preview,
      (
        select count(*)::int
        from public.biometric_attendance_logs bl
        where bl.staff_id=a.staff_id
          and (
            (a.scheduled_start_at is not null and a.scheduled_end_at is not null
             and public.dawaa_fingerprint_effective_time_v1(bl.provider,bl.raw_payload,bl.punch_time)
               between a.scheduled_start_at-interval '4 hours' and a.scheduled_end_at+interval '6 hours')
            or
            ((a.scheduled_start_at is null or a.scheduled_end_at is null)
             and (public.dawaa_fingerprint_effective_time_v1(bl.provider,bl.raw_payload,bl.punch_time)
                  at time zone 'Africa/Cairo')::date between a.attendance_date and a.attendance_date+1)
          )
      ) as raw_count
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
      end as lane,
      case
        when b.resolution_status in ('no_schedule','invalid_schedule_time','schedule_conflict') then 'schedule'
        when b.resolution_status in ('sync_pending_verification') then 'sync'
        when b.resolution_status in ('needs_event_review','invalid_duration') then 'interpretation'
        when b.resolution_status in ('missing_checkin','missing_checkout') then 'missing_punch'
        when b.resolution_status='absence_review' then 'absence'
        when b.resolution_status='early_leave_review' then 'early_leave'
        when b.resolution_status in ('worked_on_off') then 'off_day_work'
        when b.resolution_status in ('time_off_with_events','time_off_conflict') then 'time_off'
        else 'other'
      end as grp
    from base b
  )
  select
    c.id,
    c.staff_id,
    coalesce(nullif(trim(c.resolved_staff_name),''),c.staff_id::text),
    c.branch,
    c.attendance_date,
    c.resolution_status,
    c.lane,
    c.lane='manager',
    false,
    c.grp,
    case
      when c.triage='waiting' then 'انتظار اكتمال بيانات اليوم'
      when c.triage='auto' then 'النظام قادر على حسم الحالة تلقائيًا'
      when c.triage='manager' and c.resolution_status='needs_event_review' then 'بصمة غير مكتملة تحتاج قرار مدير'
      else case c.resolution_status
        when 'absence_review' then 'غياب محتمل يحتاج قرار'
        when 'missing_checkin' then 'بصمة دخول ناقصة'
        when 'missing_checkout' then 'بصمة خروج ناقصة'
        when 'early_leave_review' then 'خروج مبكر يحتاج قرار'
        when 'worked_on_off' then 'عمل في يوم إجازة'
        when 'time_off_with_events' then 'بصمة أثناء إجازة'
        when 'time_off_conflict' then 'تعارض إجازة/إذن'
        when 'no_schedule' then 'لا يوجد جدول معتمد'
        when 'invalid_schedule_time' then 'وقت جدول غير صالح'
        when 'schedule_conflict' then 'تعارض في الجدول'
        when 'sync_pending_verification' then 'انتظار اكتمال المزامنة'
        when 'needs_event_review' then 'تفسير البصمات يحتاج إصلاح'
        when 'invalid_duration' then 'مدة العمل تحتاج تفسير نظام'
        else coalesce(c.resolution_status,'حالة تحتاج مراجعة')
      end
    end,
    c.raw_count,
    c.first_in,
    c.last_out,
    coalesce(c.late_minutes,0),
    coalesce(c.early_leave_minutes,0),
    c.candidate_hours,
    c.payroll_eligible_hours,
    c.status,
    c.resolution_origin,
    c.policy_version,
    c.schedule_id
  from classified c
  where v_lane='all' or c.lane=v_lane
  order by
    case when c.lane='manager' then 0 else 1 end,
    case c.grp when 'absence' then 1 when 'missing_punch' then 2 when 'early_leave' then 3 when 'time_off' then 4 when 'schedule' then 5 else 6 end,
    c.attendance_date desc,c.staff_branch,c.resolved_staff_name
  limit greatest(1,least(coalesce(p_limit,300),1000));
end;
$$;