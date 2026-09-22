alter table public.attendance_policy_versions
  add column if not exists expected_daily_hours numeric(5,2),
  add column if not exists early_leave_grace_minutes integer,
  add column if not exists shift_margin_before_minutes integer,
  add column if not exists shift_margin_after_minutes integer,
  add column if not exists full_day_min_minutes integer,
  add column if not exists half_day_min_minutes integer,
  add column if not exists max_payable_minutes integer,
  add column if not exists auto_checkout_after_minutes integer,
  add column if not exists overtime_threshold_minutes integer,
  add column if not exists overtime_requires_approval boolean not null default true,
  add column if not exists rounding_minutes integer,
  add column if not exists core_start time,
  add column if not exists core_end time,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.attendance_policy_assignments (
  id uuid primary key default gen_random_uuid(),
  policy_version_id uuid not null references public.attendance_policy_versions(id) on delete restrict,
  scope_type text not null check (scope_type in ('staff','role','branch','default')),
  scope_key text,
  effective_from date not null,
  effective_to date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope_type='default' and scope_key is null) or (scope_type<>'default' and nullif(trim(scope_key),'') is not null)),
  check (effective_to is null or effective_to>=effective_from)
);

create unique index if not exists attendance_policy_assignments_unique_active
on public.attendance_policy_assignments(scope_type,coalesce(scope_key,''),effective_from,policy_version_id);

alter table public.attendance_policy_assignments enable row level security;
revoke all on table public.attendance_policy_assignments from public,anon,authenticated;

insert into public.attendance_policy_assignments(policy_version_id,scope_type,scope_key,effective_from,notes)
select p.id,'default',null,p.effective_from,'Default canonical attendance policy assignment'
from public.attendance_policy_versions p
where p.active=true
  and not exists(select 1 from public.attendance_policy_assignments a where a.scope_type='default' and a.active=true)
order by p.effective_from desc
limit 1;

create or replace function public.resolve_attendance_policy_v2(p_staff_id uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog'
as $$
declare v_staff public.staff%rowtype; v_result jsonb;
begin
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'staff not found' using errcode='22023'; end if;
  if not public.dawaa_can_read_staff_attendance_log(v_staff.id,v_staff.branch) then raise exception 'not authorized' using errcode='42501'; end if;
  with candidates as (
    select a.*,p.*,
      case a.scope_type when 'staff' then 1 when 'role' then 2 when 'branch' then 3 else 4 end priority
    from public.attendance_policy_assignments a
    join public.attendance_policy_versions p on p.id=a.policy_version_id and p.active=true
    where a.active=true and p_date>=a.effective_from and (a.effective_to is null or p_date<=a.effective_to)
      and (
        (a.scope_type='staff' and a.scope_key=p_staff_id::text)
        or (a.scope_type='role' and lower(trim(a.scope_key))=lower(trim(coalesce(v_staff.role,''))))
        or (a.scope_type='branch' and trim(a.scope_key)=trim(coalesce(v_staff.branch,'')))
        or a.scope_type='default'
      )
  )
  select jsonb_build_object(
    'assignment_id',id,'scope_type',scope_type,'scope_key',scope_key,'policy_version_id',policy_version_id,
    'policy_code',policy_code,'effective_from',effective_from,'effective_to',effective_to,
    'late_grace_minutes',late_grace_minutes,'very_late_minutes',very_late_minutes,
    'early_leave_grace_minutes',early_leave_grace_minutes,'shift_margin_before_minutes',shift_margin_before_minutes,
    'shift_margin_after_minutes',shift_margin_after_minutes,'expected_daily_hours',expected_daily_hours,
    'full_day_min_minutes',full_day_min_minutes,'half_day_min_minutes',half_day_min_minutes,
    'max_payable_minutes',max_payable_minutes,'auto_checkout_after_minutes',auto_checkout_after_minutes,
    'overtime_threshold_minutes',overtime_threshold_minutes,'overtime_requires_approval',overtime_requires_approval,
    'rounding_minutes',rounding_minutes,'core_start',core_start,'core_end',core_end,
    'permission_limit_per_cycle',permission_limit_per_cycle,'permission_max_minutes',permission_max_minutes,
    'weekly_off_allowance',weekly_off_allowance,'annual_leave_entitlement_days',annual_leave_entitlement_days,'notes',notes
  ) into v_result
  from candidates order by priority,effective_from desc limit 1;
  return coalesce(v_result,'{}'::jsonb);
end;
$$;

create or replace function public.list_attendance_policy_catalog_v2()
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_catalog'
as $$
begin
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','view_schedule','manage_payroll']) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  return jsonb_build_object(
    'policies',coalesce((select jsonb_agg(to_jsonb(p) order by p.effective_from desc) from public.attendance_policy_versions p),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by case a.scope_type when 'staff' then 1 when 'role' then 2 when 'branch' then 3 else 4 end,a.effective_from desc) from public.attendance_policy_assignments a where a.active=true),'[]'::jsonb)
  );
end;
$$;

create or replace function public.get_attendance_exception_inbox_v2(
  p_start date,p_end date,p_branch text default null,p_lane text default 'manager',p_limit integer default 300
)
returns table(
  resolution_id uuid,staff_id uuid,staff_name text,branch text,attendance_date date,resolution_status text,
  queue_lane text,action_required boolean,employee_fault boolean,issue_group text,issue_label text,raw_events integer,
  first_in timestamptz,last_out timestamptz,late_minutes integer,early_leave_minutes integer,candidate_hours numeric,
  payroll_eligible_hours numeric,status text,resolution_origin text,policy_version text,schedule_id uuid
)
language plpgsql stable security definer set search_path to 'public','pg_catalog'
as $$
begin
  return query
  with base as (
    select a.*,s.name as resolved_staff_name,
      (select count(*)::int from public.biometric_attendance_logs bl
       where bl.staff_id=a.staff_id
         and (
           (a.scheduled_start_at is not null and a.scheduled_end_at is not null
            and bl.punch_time between a.scheduled_start_at-interval '4 hours' and a.scheduled_end_at+interval '6 hours')
           or ((a.scheduled_start_at is null or a.scheduled_end_at is null)
            and (bl.punch_time at time zone 'Africa/Cairo')::date between a.attendance_date and a.attendance_date+1)
         )) as raw_count
    from public.attendance_daily_summary a join public.staff s on s.id=a.staff_id
    where a.attendance_date between p_start and p_end and a.status='pending_review'
      and coalesce(a.resolution_version,0)>=2
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(a.branch)=trim(p_branch))
      and public.dawaa_can_read_staff_attendance_log(a.staff_id,a.branch)
  ), classified as (
    select b.*,
      case
        when b.resolution_status in ('no_schedule','invalid_schedule_time','schedule_conflict','sync_pending_verification','needs_event_review','invalid_duration') then 'system'
        when b.resolution_status in ('missing_checkin','missing_checkout','absence_review') and b.raw_count>=2 then 'system'
        else 'manager'
      end as lane,
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
      end as grp
    from base b
  )
  select c.id,c.staff_id,coalesce(nullif(trim(c.resolved_staff_name),''),c.staff_id::text),c.branch,c.attendance_date,c.resolution_status,
    c.lane,c.lane='manager',false,c.grp,
    case c.resolution_status
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
    end,
    c.raw_count,c.first_in,c.last_out,coalesce(c.late_minutes,0),coalesce(c.early_leave_minutes,0),
    c.candidate_hours,c.payroll_eligible_hours,c.status,c.resolution_origin,c.policy_version,c.schedule_id
  from classified c
  where coalesce(p_lane,'all')='all' or c.lane=p_lane
  order by case when c.lane='manager' then 0 else 1 end,
    case c.grp when 'absence' then 1 when 'missing_punch' then 2 when 'early_leave' then 3 when 'time_off' then 4 when 'schedule' then 5 else 6 end,
    c.attendance_date desc,c.branch,c.resolved_staff_name
  limit greatest(1,least(coalesce(p_limit,300),1000));
end;
$$;

revoke execute on function public.resolve_attendance_policy_v2(uuid,date) from public;
revoke execute on function public.list_attendance_policy_catalog_v2() from public;
revoke execute on function public.get_attendance_exception_inbox_v2(date,date,text,text,integer) from public;
grant execute on function public.resolve_attendance_policy_v2(uuid,date) to anon,authenticated,service_role;
grant execute on function public.list_attendance_policy_catalog_v2() to anon,authenticated,service_role;
grant execute on function public.get_attendance_exception_inbox_v2(date,date,text,text,integer) to anon,authenticated,service_role;
