-- مركز حالات الحضور أسرع: get_attendance_command_center_bundle_v1 كان بيحسب «الوقت الفعلي» لكل بصمة
-- الموظف في كل حالة معلقة عشان يعد البصمات الخام (١.٢ ثانية من أصل ~١.٨ على ١٨١ حالة).
-- دلوقتي بيحصر البصمات على أيام الحالة بوقت البصمة المتخزن الأول، وبعدين بيحسب الوقت الفعلي.
-- الفرق بين الوقتين أقصاه ٣ ساعات في البيانات الحالية، والحصر بهامش يوم قبل و٣ أيام بعد. اتقارن على
-- كل الحالات المعلقة (١٨١): نفس العدد بالظبط، والوقت نزل من ١١٨٣ لـ٤٤٩ مللي ثانية قبل الـ index.
-- الدالة غير كده زي ما هي حرف بحرف.

create index if not exists idx_biometric_attendance_logs_staff_punch_time
  on public.biometric_attendance_logs (staff_id, punch_time);

CREATE OR REPLACE FUNCTION public.get_attendance_command_center_bundle_v1(p_start date, p_end date, p_branch text DEFAULT NULL::text, p_limit integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
          -- Bounded on the stored punch time first (the effective time is at most a few hours off it),
          -- so the effective time is only worked out for the case's own days and not every punch.
          and bl.punch_time >= (a.attendance_date::timestamp at time zone 'Africa/Cairo') - interval '1 day'
          and bl.punch_time <  (a.attendance_date::timestamp at time zone 'Africa/Cairo') + interval '3 days'
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
  ), classified as materialized (
    select
      b.*,
      coalesce((b.preview->>'finalizable')::boolean,false) as finalizable,
      coalesce((b.preview->>'system_resolvable')::boolean,false) as auto_resolvable,
      case
        when coalesce((b.preview->>'finalizable')::boolean,false)=false then 'system'
        when coalesce((b.preview->>'system_resolvable')::boolean,false)=true then 'system'
        when b.resolution_status in (
          'absence_review','missing_checkin','missing_checkout','early_leave_review',
          'worked_on_off','time_off_with_events'
        ) then 'manager'
        else 'system'
      end as queue_lane,
      case
        when coalesce((b.preview->>'finalizable')::boolean,false)=false then 'waiting'
        when coalesce((b.preview->>'system_resolvable')::boolean,false)=true then 'auto_resolvable'
        when b.resolution_status in (
          'absence_review','missing_checkin','missing_checkout','early_leave_review',
          'worked_on_off','time_off_with_events'
        ) then 'manager_required'
        else 'system_repair'
      end as review_lane,
      case
        when b.resolution_status in ('no_schedule','invalid_schedule_time','schedule_conflict') then 'schedule'
        when b.resolution_status='sync_pending_verification' then 'sync'
        when b.resolution_status in ('needs_event_review','invalid_duration') then 'interpretation'
        when b.resolution_status in ('missing_checkin','missing_checkout') then 'missing_punch'
        when b.resolution_status='absence_review' then 'absence'
        when b.resolution_status='early_leave_review' then 'early_leave'
        when b.resolution_status='worked_on_off' then 'off_day_work'
        when b.resolution_status in ('time_off_with_events','time_off_conflict') then 'time_off'
        else 'other'
      end as issue_group,
      case
        when coalesce((b.preview->>'finalizable')::boolean,false)=false then 'انتظار اكتمال بيانات اليوم'
        when coalesce((b.preview->>'system_resolvable')::boolean,false)=true then 'النظام قادر على حسم الحالة تلقائيًا'
        else case b.resolution_status
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
          else coalesce(b.resolution_status,'حالة تحتاج مراجعة')
        end
      end as issue_label,
      case
        when b.resolution_status='no_schedule' then 'NO_SCHEDULE'
        when b.resolution_status='invalid_schedule_time' then 'INVALID_SCHEDULE_TIME'
        when b.resolution_status='schedule_conflict' then 'SCHEDULE_CONFLICT'
        when b.resolution_status='sync_pending_verification' then 'SYNC_NOT_COMPLETE'
        when b.resolution_status='needs_event_review' then 'PUNCH_INTERPRETATION_REQUIRED'
        when b.resolution_status='invalid_duration' then 'INVALID_WORK_DURATION'
        when b.resolution_status='absence_review' then 'ABSENCE_AFTER_COMPLETE_SYNC'
        when b.resolution_status='missing_checkin' then 'MISSING_OR_UNRESOLVED_CHECKIN'
        when b.resolution_status='missing_checkout' then 'MISSING_OR_UNRESOLVED_CHECKOUT'
        when b.resolution_status='early_leave_review' then 'EARLY_LEAVE_WITHOUT_PERMISSION'
        when b.resolution_status='worked_on_off' then 'WORKED_ON_OFF_DAY'
        when b.resolution_status='time_off_with_events' then 'TIMEOFF_WITH_ATTENDANCE_EVENTS'
        when b.resolution_status='time_off_conflict' then 'TIMEOFF_CONFLICT'
        else 'MANUAL_REVIEW_REQUIRED'
      end as cause_code
    from base b
  ), limited_rows as (
    select *
    from classified
    order by
      case when queue_lane='manager' then 0 else 1 end,
      case issue_group
        when 'absence' then 1
        when 'missing_punch' then 2
        when 'early_leave' then 3
        when 'time_off' then 4
        when 'schedule' then 5
        else 6
      end,
      attendance_date desc,staff_branch,staff_name
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
        'queue_lane',r.queue_lane,
        'review_lane',r.review_lane,
        'action_required',(r.queue_lane='manager'),
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
        'scheduled_end_at',r.scheduled_end_at
      ))
      from limited_rows r
    ),'[]'::jsonb),
    'summary',jsonb_build_object(
      'total_cases',(select count(*) from classified),
      'manager_cases',(select count(*) from classified where queue_lane='manager'),
      'system_cases',(select count(*) from classified where queue_lane='system'),
      'auto_resolvable_cases',(select count(*) from classified where review_lane='auto_resolvable'),
      'manager_required_active_staff',(select count(*) from classified where review_lane='manager_required' and staff_active),
      'manager_required_former_staff',(select count(*) from classified where review_lane='manager_required' and not staff_active),
      'system_repair_cases',(select count(*) from classified where review_lane='system_repair'),
      'waiting_cases',(select count(*) from classified where review_lane='waiting'),
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
