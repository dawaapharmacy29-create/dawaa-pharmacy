-- Close the Attendance Command Center read path around the canonical triage and
-- manager-review priority contracts. This keeps the public bundle backward
-- compatible while removing duplicate lane classification from the bundle.

create or replace function public.get_attendance_command_center_bundle_v1(
  p_start date,
  p_end date,
  p_branch text default null,
  p_limit integer default 1000
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
    raise exception 'attendance_command_center_bundle_invalid_range' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;
  if not found then
    raise exception 'active staff actor required' using errcode='42501';
  end if;

  with base as materialized (
    select
      a.id as resolution_id,
      a.staff_id,
      coalesce(nullif(trim(s.name),''),a.staff_id::text) as staff_name,
      a.branch,
      s.branch as staff_branch,
      coalesce(s.active,false) as staff_active,
      a.attendance_date,
      a.resolution_status,
      a.first_in,
      a.last_out,
      coalesce(a.late_minutes,0) as late_minutes,
      coalesce(a.early_leave_minutes,0) as early_leave_minutes,
      a.candidate_hours,
      a.payroll_eligible_hours,
      a.status,
      a.resolution_origin,
      a.policy_version,
      a.schedule_id,
      a.scheduled_start_at,
      a.scheduled_end_at,
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
      ) as raw_events
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
  ), triaged as materialized (
    select
      b.*,
      public.dawaa_attendance_review_triage_v1(b.resolution_status,b.preview) as triage_code
    from base b
  ), classified as materialized (
    select
      t.*,
      case when t.triage_code='manager' then 'manager' else 'system' end as queue_lane,
      case t.triage_code
        when 'manager' then 'manager_required'
        when 'auto' then 'auto_resolvable'
        when 'system_repair' then 'system_repair'
        else 'waiting'
      end as review_lane,
      case
        when t.resolution_status in ('no_schedule','invalid_schedule_time','schedule_conflict') then 'schedule'
        when t.resolution_status='sync_pending_verification' then 'sync'
        when t.resolution_status in ('needs_event_review','invalid_duration') then 'interpretation'
        when t.resolution_status in ('missing_checkin','missing_checkout') then 'missing_punch'
        when t.resolution_status='absence_review' then 'absence'
        when t.resolution_status='early_leave_review' then 'early_leave'
        when t.resolution_status='worked_on_off' then 'off_day_work'
        when t.resolution_status in ('time_off_with_events','time_off_conflict') then 'time_off'
        else 'other'
      end as issue_group,
      case
        when t.triage_code='waiting' then 'انتظار اكتمال بيانات اليوم'
        when t.triage_code='auto' then 'النظام قادر على حسم الحالة تلقائيًا'
        when t.resolution_status='needs_event_review' and t.triage_code='manager' then 'أدلة البصمات غير مكتملة وتحتاج مراجعة مدير'
        else case t.resolution_status
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
          else coalesce(t.resolution_status,'حالة تحتاج مراجعة')
        end
      end as issue_label,
      case
        when t.resolution_status='no_schedule' then 'NO_SCHEDULE'
        when t.resolution_status='invalid_schedule_time' then 'INVALID_SCHEDULE_TIME'
        when t.resolution_status='schedule_conflict' then 'SCHEDULE_CONFLICT'
        when t.resolution_status='sync_pending_verification' then 'SYNC_NOT_COMPLETE'
        when t.resolution_status='needs_event_review' and t.triage_code='manager' then 'PUNCH_EVIDENCE_INCOMPLETE'
        when t.resolution_status='needs_event_review' then 'PUNCH_INTERPRETATION_REQUIRED'
        when t.resolution_status='invalid_duration' then 'INVALID_WORK_DURATION'
        when t.resolution_status='absence_review' then 'ABSENCE_AFTER_COMPLETE_SYNC'
        when t.resolution_status='missing_checkin' then 'MISSING_OR_UNRESOLVED_CHECKIN'
        when t.resolution_status='missing_checkout' then 'MISSING_OR_UNRESOLVED_CHECKOUT'
        when t.resolution_status='early_leave_review' then 'EARLY_LEAVE_WITHOUT_PERMISSION'
        when t.resolution_status='worked_on_off' then 'WORKED_ON_OFF_DAY'
        when t.resolution_status='time_off_with_events' then 'TIMEOFF_WITH_ATTENDANCE_EVENTS'
        when t.resolution_status='time_off_conflict' then 'TIMEOFF_CONFLICT'
        else 'MANUAL_REVIEW_REQUIRED'
      end as cause_code
    from triaged t
  ), prioritized as materialized (
    select
      c.*,
      case
        when c.triage_code='manager' then public.dawaa_attendance_manager_review_priority_v1(
          c.resolution_status,c.staff_active,c.attendance_date
        )
        else null::jsonb
      end as priority
    from classified c
  ), ranked as materialized (
    select
      p.*,
      case
        when p.triage_code='manager' and p.staff_active then 0
        when p.triage_code='manager' then 1
        else 2
      end as display_lane_rank,
      coalesce((p.priority->>'sort_rank')::int,999) as priority_sort_rank,
      coalesce((p.priority->>'age_days')::int,0) as priority_age_days
    from prioritized p
  ), limited_rows as (
    select *
    from ranked
    order by
      display_lane_rank,
      priority_sort_rank,
      priority_age_days desc,
      attendance_date asc,
      staff_branch,
      staff_name
    limit greatest(1,least(coalesce(p_limit,1000),1000))
  ), causes as (
    select cause_code,issue_label,
           case when queue_lane='manager' then 'manager' else 'system' end owner,
           count(*)::int cases
    from classified
    group by cause_code,issue_label,case when queue_lane='manager' then 'manager' else 'system' end
  )
  select jsonb_build_object(
    'schema','attendance_command_center_bundle_v1',
    'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'resolution_id',r.resolution_id,
        'staff_id',r.staff_id,
        'staff_name',r.staff_name,
        'branch',r.branch,
        'staff_branch',r.staff_branch,
        'staff_active',r.staff_active,
        'attendance_date',r.attendance_date,
        'resolution_status',r.resolution_status,
        'triage_code',r.triage_code,
        'queue_lane',r.queue_lane,
        'review_lane',r.review_lane,
        'action_required',(r.triage_code='manager'),
        'employee_fault',false,
        'issue_group',r.issue_group,
        'issue_label',r.issue_label,
        'raw_events',r.raw_events,
        'first_in',r.first_in,
        'last_out',r.last_out,
        'late_minutes',r.late_minutes,
        'early_leave_minutes',r.early_leave_minutes,
        'candidate_hours',r.candidate_hours,
        'payroll_eligible_hours',r.payroll_eligible_hours,
        'status',r.status,
        'resolution_origin',r.resolution_origin,
        'policy_version',r.policy_version,
        'schedule_id',r.schedule_id,
        'scheduled_start_at',r.scheduled_start_at,
        'scheduled_end_at',r.scheduled_end_at,
        'priority_code',r.priority->>'priority_code',
        'sort_rank',case when r.priority is null then null else (r.priority->>'sort_rank')::int end,
        'age_days',case when r.priority is null then null else (r.priority->>'age_days')::int end,
        'age_bucket',r.priority->>'age_bucket',
        'priority_reason',r.priority->>'priority_reason'
      ) order by
        r.display_lane_rank,
        r.priority_sort_rank,
        r.priority_age_days desc,
        r.attendance_date asc,
        r.staff_branch,
        r.staff_name)
      from limited_rows r
    ),'[]'::jsonb),
    'summary',jsonb_build_object(
      'total_cases',(select count(*) from classified),
      'manager_cases',(select count(*) from classified where triage_code='manager'),
      'system_cases',(select count(*) from classified where triage_code<>'manager'),
      'auto_resolvable_cases',(select count(*) from classified where triage_code='auto'),
      'manager_required_active_staff',(select count(*) from classified where triage_code='manager' and staff_active),
      'manager_required_former_staff',(select count(*) from classified where triage_code='manager' and not staff_active),
      'manager_p1_active_staff',(select count(*) from prioritized where triage_code='manager' and staff_active and priority->>'priority_code'='P1'),
      'manager_p2_active_staff',(select count(*) from prioritized where triage_code='manager' and staff_active and priority->>'priority_code'='P2'),
      'manager_p3_active_staff',(select count(*) from prioritized where triage_code='manager' and staff_active and priority->>'priority_code'='P3'),
      'system_repair_cases',(select count(*) from classified where triage_code='system_repair'),
      'waiting_cases',(select count(*) from classified where triage_code='waiting'),
      'causes',coalesce((
        select jsonb_agg(jsonb_build_object(
          'code',c.cause_code,'label',c.issue_label,'owner',c.owner,'cases',c.cases
        ) order by c.cases desc,c.issue_label)
        from causes c
      ),'[]'::jsonb)
    ),
    'generated_at',now()
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_attendance_command_center_bundle_v1(date,date,text,integer) from public;
grant execute on function public.get_attendance_command_center_bundle_v1(date,date,text,integer)
to anon,authenticated,service_role;
