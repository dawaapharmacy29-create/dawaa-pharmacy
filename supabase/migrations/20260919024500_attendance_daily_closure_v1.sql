-- Daily attendance closure read model v1.
-- One canonical operational view per employee/day. Read-only: no points/payroll writes.

create or replace function public.attendance_daily_closure_v1(
  p_date date default ((now() at time zone 'Africa/Cairo')::date),
  p_branch text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_payload jsonb;
begin
  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;

  if not found then
    raise exception 'active staff actor required' using errcode='42501';
  end if;

  with cmd as (
    select * from public.attendance_daily_command_v1(p_date,p_branch)
  ), intel as (
    select * from public.attendance_daily_intelligence_v2(p_date,p_branch)
  ), sessions as (
    select
      c.staff_id,c.staff_name,c.role,c.branch,c.work_date,
      c.schedule_status,c.shift_start,c.shift_end,
      c.first_check_in,c.last_check_out,c.late_minutes,c.early_leave_minutes,
      c.attendance_status,c.approved_exception_type,c.approved_exception_reason,
      c.biometric_events,c.source_status,
      coalesce(i.raw_events,0) raw_events,
      coalesce(i.effective_events,0) effective_events,
      coalesce(i.duplicate_events,0) duplicate_events,
      coalesce(i.corrected_type_events,0) corrected_type_events,
      coalesce(i.review_events,0) review_events,
      i.avg_confidence,
      i.intelligence_status,
      s.id resolution_id,
      s.status resolution_state,
      s.resolution_status,
      s.resolution_origin,
      coalesce(s.review_required,false) resolution_review_required,
      s.approved_at,
      s.approved_by_name,
      s.sync_complete_through,
      case
        when c.attendance_status in ('sync_pending','sync_pending_checkout','sync_pending_verification') then 'sync_pending'
        when c.attendance_status in ('working_now','scheduled','not_arrived','shift_in_progress') then 'in_progress'
        when coalesce(i.review_events,0)>0
          or c.attendance_status in ('schedule_conflict','schedule_missing','punch_without_valid_schedule','needs_event_review','invalid_duration','missing_checkout')
          or coalesce(s.review_required,false)
          or s.status='pending_review'
          then 'review_required'
        when s.status='approved' and coalesce(s.resolution_origin,'')='manager' then 'closed_manager'
        when s.status='approved' then 'closed_system'
        else 'ready_for_resolution'
      end closure_status,
      greatest(0,least(100,
        case
          when c.attendance_status in ('sync_pending','sync_pending_checkout','sync_pending_verification') then 45
          when c.attendance_status in ('schedule_conflict','schedule_missing','punch_without_valid_schedule','invalid_duration') then 30
          when coalesce(i.review_events,0)>0 then 50
          when c.attendance_status='missing_checkout' then 40
          when s.status='approved' and coalesce(i.avg_confidence,1)>=0.90 then 99
          when s.status='approved' then 95
          when c.attendance_status in ('on_time','late','very_late','approved_exception','off','worked_on_off') then 85
          else 70
        end
        - least(coalesce(i.duplicate_events,0),5)
      ))::int confidence_score,
      array_remove(array[
        case when c.attendance_status in ('sync_pending','sync_pending_checkout','sync_pending_verification') then 'المزامنة لم تكتمل' end,
        case when c.attendance_status='missing_checkout' then 'بصمة خروج ناقصة' end,
        case when c.attendance_status in ('schedule_conflict','schedule_missing','punch_without_valid_schedule') then 'مشكلة في الجدول أو مطابقته' end,
        case when coalesce(i.review_events,0)>0 then coalesce(i.review_events,0)::text||' بصمة تحتاج مراجعة' end,
        case when coalesce(i.duplicate_events,0)>0 then coalesce(i.duplicate_events,0)::text||' بصمة تأكيد مكررة مستبعدة' end,
        case when coalesce(i.corrected_type_events,0)>0 then coalesce(i.corrected_type_events,0)::text||' بصمة صحح النظام نوعها' end,
        case when s.status='pending_review' then 'التسوية بانتظار قرار الإدارة' end
      ],null) reasons
    from cmd c
    left join intel i on i.staff_id=c.staff_id
    left join public.attendance_daily_summary s
      on s.staff_id=c.staff_id
     and s.attendance_date=p_date
     and coalesce(s.resolution_version,0)>=2
  ), summary as (
    select
      count(*) total,
      count(*) filter(where closure_status='closed_system') closed_system,
      count(*) filter(where closure_status='closed_manager') closed_manager,
      count(*) filter(where closure_status='review_required') review_required,
      count(*) filter(where closure_status='sync_pending') sync_pending,
      count(*) filter(where closure_status='in_progress') in_progress,
      count(*) filter(where closure_status='ready_for_resolution') ready_for_resolution,
      round(avg(confidence_score),1) avg_confidence
    from sessions
  ), branch_summary as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'branch',branch,
      'total',total,
      'closed',closed,
      'review_required',review_required,
      'sync_pending',sync_pending,
      'in_progress',in_progress,
      'avg_confidence',avg_confidence
    ) order by branch),'[]'::jsonb) data
    from (
      select branch,count(*) total,
        count(*) filter(where closure_status in ('closed_system','closed_manager')) closed,
        count(*) filter(where closure_status='review_required') review_required,
        count(*) filter(where closure_status='sync_pending') sync_pending,
        count(*) filter(where closure_status='in_progress') in_progress,
        round(avg(confidence_score),1) avg_confidence
      from sessions group by branch
    ) x
  )
  select jsonb_build_object(
    'date',p_date,
    'branch',p_branch,
    'generated_at',now(),
    'total',coalesce(sm.total,0),
    'closed_system',coalesce(sm.closed_system,0),
    'closed_manager',coalesce(sm.closed_manager,0),
    'closed_total',coalesce(sm.closed_system,0)+coalesce(sm.closed_manager,0),
    'review_required',coalesce(sm.review_required,0),
    'sync_pending',coalesce(sm.sync_pending,0),
    'in_progress',coalesce(sm.in_progress,0),
    'ready_for_resolution',coalesce(sm.ready_for_resolution,0),
    'avg_confidence',coalesce(sm.avg_confidence,0),
    'can_close_day',coalesce(sm.review_required,0)=0
      and coalesce(sm.sync_pending,0)=0
      and coalesce(sm.in_progress,0)=0
      and coalesce(sm.ready_for_resolution,0)=0,
    'branch_summary',bs.data,
    'sessions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',s.staff_id,'staff_name',s.staff_name,'role',s.role,'branch',s.branch,
        'work_date',s.work_date,'schedule_status',s.schedule_status,
        'shift_start',s.shift_start,'shift_end',s.shift_end,
        'first_check_in',s.first_check_in,'last_check_out',s.last_check_out,
        'late_minutes',s.late_minutes,'early_leave_minutes',s.early_leave_minutes,
        'attendance_status',s.attendance_status,'source_status',s.source_status,
        'raw_events',s.raw_events,'effective_events',s.effective_events,
        'duplicate_events',s.duplicate_events,'corrected_type_events',s.corrected_type_events,
        'review_events',s.review_events,'avg_confidence',s.avg_confidence,
        'resolution_id',s.resolution_id,'resolution_state',s.resolution_state,
        'resolution_status',s.resolution_status,'resolution_origin',s.resolution_origin,
        'approved_at',s.approved_at,'approved_by_name',s.approved_by_name,
        'sync_complete_through',s.sync_complete_through,
        'closure_status',s.closure_status,'confidence_score',s.confidence_score,
        'reasons',to_jsonb(s.reasons)
      ) order by
        case s.closure_status
          when 'review_required' then 0
          when 'sync_pending' then 1
          when 'ready_for_resolution' then 2
          when 'in_progress' then 3
          else 4 end,
        s.branch,s.staff_name
      )
      from sessions s
    ),'[]'::jsonb)
  ) into v_payload
  from summary sm cross join branch_summary bs;

  return v_payload;
end;
$function$;

revoke execute on function public.attendance_daily_closure_v1(date,text) from public,anon;
grant execute on function public.attendance_daily_closure_v1(date,text) to authenticated,service_role;

notify pgrst,'reload schema';
