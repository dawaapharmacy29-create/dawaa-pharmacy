-- Attendance production contract reconciliation v1
-- Captures the live attendance operational contract that existed in Production but was missing from this branch.
-- Safe/repeatable: tables use IF NOT EXISTS and functions use CREATE OR REPLACE.
-- No business data is copied and no historical attendance decisions are rewritten.

create table if not exists public.staff_overtime_approvals (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  staff_name text,
  branch text,
  attendance_date date not null,
  overtime_hours numeric not null,
  hourly_rate numeric,
  overtime_amount numeric,
  status text not null default 'pending',
  decided_by text,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_staff_overtime_approvals_staff_day on public.staff_overtime_approvals(staff_id,attendance_date);
alter table public.staff_overtime_approvals enable row level security;
revoke all on public.staff_overtime_approvals from anon,authenticated;
grant all on public.staff_overtime_approvals to service_role;

create table if not exists public.staff_time_off_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  staff_name_snapshot text not null,
  branch_snapshot text,
  request_kind text not null,
  request_label text,
  status text not null default 'pending',
  start_date date not null,
  end_date date not null,
  start_time time,
  end_time time,
  duration_minutes integer,
  reason text,
  requested_by text,
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  cancelled_by text,
  cancelled_at timestamptz,
  cancellation_reason text,
  policy_version text not null default 'attendance_timeoff_v1',
  source text not null default 'app',
  legacy_source text,
  legacy_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_staff_time_off_requests_staff_dates on public.staff_time_off_requests(staff_id,start_date,end_date);
create index if not exists idx_staff_time_off_requests_status_branch on public.staff_time_off_requests(status,branch_snapshot,requested_at);
alter table public.staff_time_off_requests enable row level security;
revoke all on public.staff_time_off_requests from anon,authenticated;
grant all on public.staff_time_off_requests to service_role;

create table if not exists public.staff_time_off_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  staff_id uuid not null,
  action text not null,
  actor_id text,
  actor_name text,
  actor_role text,
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_staff_time_off_audit_request on public.staff_time_off_audit(request_id,created_at desc);
alter table public.staff_time_off_audit enable row level security;
revoke all on public.staff_time_off_audit from anon,authenticated;
grant all on public.staff_time_off_audit to service_role;

create table if not exists public.attendance_manual_actions_audit (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  staff_id uuid not null,
  target_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text not null,
  actor_account_id uuid,
  actor_name text,
  actor_role text,
  created_at timestamptz not null default now()
);
create index if not exists idx_attendance_manual_actions_staff_created on public.attendance_manual_actions_audit(staff_id,created_at desc);
alter table public.attendance_manual_actions_audit enable row level security;
revoke all on public.attendance_manual_actions_audit from anon,authenticated;
grant all on public.attendance_manual_actions_audit to service_role;

create table if not exists public.attendance_schedule_mismatch_dismissals (
  staff_id uuid not null,
  day_of_week text not null,
  dismissed_by uuid,
  dismissed_by_name text,
  dismissed_at timestamptz not null default now(),
  note text,
  primary key(staff_id,day_of_week)
);
alter table public.attendance_schedule_mismatch_dismissals enable row level security;
revoke all on public.attendance_schedule_mismatch_dismissals from anon,authenticated;
grant all on public.attendance_schedule_mismatch_dismissals to service_role;


CREATE OR REPLACE FUNCTION public.attendance_branch_role_group_rates_v1(p_from date DEFAULT (((now() AT TIME ZONE 'Africa/Cairo'::text))::date - 29), p_to date DEFAULT ((now() AT TIME ZONE 'Africa/Cairo'::text))::date)
 RETURNS TABLE(branch text, role_group text, staff_count bigint, evaluated_days bigint, on_time_days bigint, late_days bigint, very_late_days bigint, early_leave_days bigint, permission_days bigint, absence_days bigint, late_rate_pct numeric, permission_rate_pct numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception using errcode='42501', message='صلاحية الإدارة مطلوبة لعرض إحصائيات الفروع';
  end if;
  return query
  with scoped_staff as (
    select s.id, s.branch,
      case
        when s.role = 'توصيل' then 'دليفري'
        when s.role in ('صيدلاني','pharmacist') then 'دكاترة وصيادلة'
        else 'باقي الفريق'
      end as role_group
    from public.staff s
    where coalesce(s.active,false)=true and s.branch in ('فرع الشامي','فرع شكري')
  ), days as (
    select ads.staff_id, ads.resolution_status, ads.status
    from public.attendance_daily_summary ads
    where ads.attendance_date between p_from and p_to
  )
  select
    ss.branch,
    ss.role_group,
    count(distinct ss.id) as staff_count,
    count(d.staff_id) as evaluated_days,
    count(*) filter (where d.resolution_status in ('on_time','on_time_with_permission')) as on_time_days,
    count(*) filter (where d.resolution_status = 'late') as late_days,
    count(*) filter (where d.resolution_status = 'very_late') as very_late_days,
    count(*) filter (where d.resolution_status = 'early_leave_review') as early_leave_days,
    count(*) filter (where d.resolution_status in ('approved_time_off') or d.status='pending_review' and d.resolution_status='needs_event_review') as permission_days,
    count(*) filter (where d.resolution_status = 'absence_review') as absence_days,
    case when count(d.staff_id) = 0 then 0
      else round((count(*) filter (where d.resolution_status in ('late','very_late')))::numeric * 100 / count(d.staff_id), 1)
    end as late_rate_pct,
    case when count(d.staff_id) = 0 then 0
      else round((count(*) filter (where d.resolution_status = 'approved_time_off'))::numeric * 100 / count(d.staff_id), 1)
    end as permission_rate_pct
  from scoped_staff ss
  left join days d on d.staff_id = ss.id
  group by ss.branch, ss.role_group
  order by ss.branch, ss.role_group;
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_branch_sync_complete_through_v1(p_branch text DEFAULT NULL::text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select case
    when p_branch = 'فرع الشامي' then
      (select w.complete_through from public.biometric_sync_watermarks w where w.provider = 'zk_shami_direct_bridge' limit 1)
    when p_branch = 'فرع شكري' then
      (select w.complete_through from public.biometric_sync_watermarks w where w.provider = 'zk_shokry_direct_bridge' limit 1)
    else
      -- فرع غير معروف/غير محدد: نستخدم أقدم مزامنة بين الفرعين (محافظ) بدل الأحدث، حتى لا نعتبر اليوم مكتملًا قبل الأوان
      (select min(w.complete_through) from public.biometric_sync_watermarks w where w.provider in ('zk_shami_direct_bridge','zk_shokry_direct_bridge'))
  end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_branch_time_off_queue_v1()
 RETURNS TABLE(id uuid, staff_id uuid, staff_name text, branch text, request_kind text, request_label text, start_date date, end_date date, start_time time without time zone, end_time time without time zone, reason text, requested_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_role text; v_branch text;
begin
  select lower(trim(sa.role)), trim(coalesce(sa.branch,'')) into v_role, v_branch
  from public.staff_accounts sa where sa.id=public.dawaa_current_staff_account_id_strict() and sa.active=true and sa.can_login=true;
  if v_role is null then raise exception using errcode='42501', message='حساب غير صالح'; end if;

  return query
  select r.id, r.staff_id, r.staff_name_snapshot, r.branch_snapshot, r.request_kind, r.request_label,
    r.start_date, r.end_date, r.start_time, r.end_time, r.reason, r.requested_at
  from public.staff_time_off_requests r
  where r.status = 'pending_branch_review'
    and (
      v_role in ('general_manager','executive_manager','branches_manager','admin')
      or (v_role in ('branch_manager','shift_supervisor_morning','shift_supervisor_evening') and nullif(v_branch,'') is not null and trim(coalesce(r.branch_snapshot,''))=v_branch)
    )
  order by r.requested_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_cancel_time_off_request_v1(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_row public.staff_time_off_requests%rowtype;
  v_actor public.staff_accounts%rowtype;
begin
  select * into v_row from public.staff_time_off_requests where id=p_request_id for update;
  if not found then raise exception using errcode='22023', message='الطلب غير موجود'; end if;
  if v_row.staff_id <> public.dawaa_current_attendance_subject_id() then
    raise exception using errcode='42501', message='لا يمكنك إلغاء طلب موظف آخر';
  end if;
  if v_row.status not in ('pending_branch_review','pending_gm_review') then
    raise exception using errcode='22023', message='لا يمكن إلغاء طلب تم البت فيه بالفعل';
  end if;
  select * into v_actor from public.staff_accounts sa where sa.id=public.dawaa_current_staff_account_id_strict();

  update public.staff_time_off_requests
  set status='cancelled', cancelled_by=coalesce(v_actor.id::text,'self'), cancelled_at=now(), cancellation_reason='تم الإلغاء من صاحب الطلب', updated_at=now()
  where id=p_request_id;

  return jsonb_build_object('id', p_request_id, 'new_status', 'cancelled');
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_deduction_adjust_v1(p_transaction_id uuid, p_new_points numeric DEFAULT NULL::numeric, p_multiplier numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_row public.employee_transactions%rowtype;
  v_actor public.staff_accounts%rowtype;
  v_old_points numeric; v_new_points numeric; v_point_rate numeric; v_new_amount numeric;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception using errcode='42501', message='صلاحية الإدارة مطلوبة لتعديل خصومات الحضور';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception using errcode='22023', message='سبب التعديل مطلوب حتى يظل القرار قابلًا للمراجعة';
  end if;
  if p_new_points is null and p_multiplier is null then
    raise exception using errcode='22023', message='حدد قيمة جديدة أو معامل مضاعفة';
  end if;

  select * into v_row from public.employee_transactions
  where id=p_transaction_id and source='attendance_deduction_v1' and status='pending' for update;
  if not found then
    raise exception using errcode='22023', message='الحركة غير موجودة أو تم البت فيها بالفعل';
  end if;
  select * into v_actor from public.staff_accounts sa where sa.id=public.dawaa_current_staff_account_id_strict();

  v_old_points := v_row.points;
  v_point_rate := case when coalesce(v_row.points,0) <> 0 then round(v_row.amount / v_row.points, 4) else 1 end;
  v_new_points := round(coalesce(p_new_points, v_old_points * coalesce(p_multiplier,1)), 2);
  if v_new_points < 0 then
    raise exception using errcode='22023', message='قيمة الخصم لا يمكن أن تكون سالبة';
  end if;
  v_new_amount := round(v_new_points * v_point_rate, 2);

  update public.employee_transactions
  set points = v_new_points, points_delta = -v_new_points, base_points = v_new_points, final_points = v_new_points,
      amount = v_new_amount,
      description = v_row.description || format(' | تم تعديل القيمة يدويًا من %s إلى %s نقطة — السبب: %s', v_old_points, v_new_points, p_reason),
      updated_at = now()
  where id = p_transaction_id;

  insert into public.attendance_manual_actions_audit(action_type, staff_id, target_id, old_value, new_value, reason, actor_account_id, actor_name, actor_role)
  values('deduction_adjustment', v_row.staff_id, p_transaction_id,
    jsonb_build_object('points', v_old_points, 'amount', v_row.amount),
    jsonb_build_object('points', v_new_points, 'amount', v_new_amount, 'multiplier', p_multiplier),
    p_reason, v_actor.id, v_actor.name, v_actor.role);

  return jsonb_build_object('id', p_transaction_id, 'old_points', v_old_points, 'new_points', v_new_points, 'new_amount', v_new_amount);
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_deduction_pending_review_v1()
 RETURNS TABLE(id uuid, staff_id uuid, employee_name text, branch text, month_cycle text, points numeric, amount numeric, description text, transaction_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select et.id, et.staff_id, et.employee_name, et.branch, et.month_cycle, et.points, et.amount, et.description, et.transaction_date
  from public.employee_transactions et
  where et.source='attendance_deduction_v1' and et.status='pending'
  order by et.points desc;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_deduction_review_decide_v1(p_transaction_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_row public.employee_transactions%rowtype;
  v_actor public.staff_accounts%rowtype;
  v_new_status text;
begin
  if p_decision not in ('approve','reject') then
    raise exception using errcode='22023', message='القرار يجب أن يكون approve أو reject';
  end if;
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception using errcode='42501', message='صلاحية الإدارة مطلوبة لاعتماد خصومات الحضور';
  end if;
  select * into v_row from public.employee_transactions where id=p_transaction_id and source='attendance_deduction_v1' and status='pending' for update;
  if not found then
    raise exception using errcode='22023', message='الحركة غير موجودة أو تم البت فيها بالفعل';
  end if;
  select * into v_actor from public.staff_accounts sa where sa.id=public.dawaa_current_staff_account_id_strict();
  v_new_status := case when p_decision='approve' then 'approved' else 'cancelled' end;

  update public.employee_transactions set status=v_new_status, updated_at=now() where id=p_transaction_id;

  insert into public.incentive_audit_log(staff_id, rule_code, source_module, cycle_start, cycle_end, points_delta, money_delta, status, note, created_by)
  values(v_row.staff_id, 'attendance_deduction_v1_manual_review', 'attendance',
    (public.dawaa_pay_cycle_bounds_v1(to_date(v_row.month_cycle||'-25','YYYY-MM-DD'))).cycle_start,
    (public.dawaa_pay_cycle_bounds_v1(to_date(v_row.month_cycle||'-25','YYYY-MM-DD'))).cycle_end,
    case when p_decision='approve' then v_row.points_delta else 0 end, v_row.amount, v_new_status,
    coalesce(p_note, case when p_decision='approve' then 'اعتماد إداري لخصم حضور تلقائي' else 'رفض خصم حضور تلقائي' end),
    coalesce(v_actor.name, 'unknown'));

  return jsonb_build_object('id', p_transaction_id, 'new_status', v_new_status);
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_dismiss_schedule_mismatch_v1(p_staff_id uuid, p_day_of_week text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_actor public.staff_accounts%rowtype;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception using errcode='42501', message='صلاحية الإدارة مطلوبة';
  end if;
  select * into v_actor from public.staff_accounts sa where sa.id=public.dawaa_current_staff_account_id_strict();
  insert into public.attendance_schedule_mismatch_dismissals(staff_id, day_of_week, dismissed_by, dismissed_by_name, note)
  values(p_staff_id, p_day_of_week, v_actor.id, v_actor.name, p_note)
  on conflict (staff_id, day_of_week) do update set dismissed_by=excluded.dismissed_by, dismissed_by_name=excluded.dismissed_by_name, dismissed_at=now(), note=excluded.note;
  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_employee_profile_v1(p_staff_id uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_staff public.staff%rowtype;
  v_from date := (now() at time zone 'Africa/Cairo')::date - greatest(1, least(coalesce(p_days,30), 90));
  v_to date := (now() at time zone 'Africa/Cairo')::date;
  v_result jsonb;
begin
  select * into v_staff from public.staff where id = p_staff_id;
  if not found then
    raise exception using errcode='22023', message='الموظف غير موجود';
  end if;
  if not public.dawaa_can_read_staff_attendance_log(p_staff_id, v_staff.branch) then
    raise exception using errcode='42501', message='لا تملك صلاحية عرض بيانات هذا الموظف';
  end if;

  select jsonb_build_object(
    'staff', jsonb_build_object(
      'id', v_staff.id, 'name', v_staff.name, 'role', v_staff.role, 'branch', v_staff.branch, 'active', v_staff.active
    ),
    'weekly_schedule', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day_name', ss.day_name, 'shift_date', coalesce(ss.shift_date, ss.date),
        'is_off', coalesce(ss.is_off, ss.is_day_off, false),
        'shift_start', coalesce(ss.shift_start, ss.start_time::text),
        'shift_end', coalesce(ss.shift_end, ss.end_time::text)
      ) order by
        (coalesce(ss.shift_date, ss.date) is not null),
        coalesce(ss.shift_date, ss.date) nulls last,
        case trim(coalesce(ss.day_name,''))
          when 'السبت' then 0 when 'الأحد' then 1 when 'الاثنين' then 2 when 'الثلاثاء' then 3
          when 'الأربعاء' then 4 when 'الخميس' then 5 when 'الجمعة' then 6 else 7
        end
      ), '[]'::jsonb)
      from public.shift_schedules ss
      where ss.staff_id = p_staff_id
        and (ss.shift_date is null or ss.shift_date between v_from and v_to + 14)
      limit 20
    ),
    'rates', (
      select jsonb_build_object(
        'evaluated_days', count(*),
        'on_time_days', count(*) filter (where ads.resolution_status in ('on_time','on_time_with_permission')),
        'late_days', count(*) filter (where ads.resolution_status = 'late'),
        'very_late_days', count(*) filter (where ads.resolution_status = 'very_late'),
        'early_leave_days', count(*) filter (where ads.resolution_status = 'early_leave_review'),
        'permission_days', count(*) filter (where ads.resolution_status = 'approved_time_off'),
        'absence_days', count(*) filter (where ads.resolution_status = 'absence_review'),
        'pending_review_days', count(*) filter (where ads.status = 'pending_review'),
        'late_rate_pct', case when count(*) = 0 then 0 else round((count(*) filter (where ads.resolution_status in ('late','very_late')))::numeric * 100 / count(*), 1) end,
        'permission_rate_pct', case when count(*) = 0 then 0 else round((count(*) filter (where ads.resolution_status = 'approved_time_off'))::numeric * 100 / count(*), 1) end
      )
      from public.attendance_daily_summary ads
      where ads.staff_id = p_staff_id and ads.attendance_date between v_from and v_to
    ),
    'recent_days', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'attendance_date', ads.attendance_date, 'status', ads.status, 'resolution_status', ads.resolution_status,
        'first_in', ads.first_in, 'last_out', ads.last_out, 'late_minutes', ads.late_minutes,
        'early_leave_minutes', ads.early_leave_minutes, 'payroll_eligible_hours', ads.payroll_eligible_hours,
        'scheduled_branch', ads.branch,
        'punch_branches', (
          select coalesce(jsonb_agg(distinct bl.branch), '[]'::jsonb)
          from public.biometric_attendance_logs bl
          where bl.staff_id = p_staff_id
            and (bl.punch_time at time zone 'Africa/Cairo')::date between ads.attendance_date - 1 and ads.attendance_date + 1
            and nullif(trim(bl.branch), '') is not null
        ),
        'branch_mismatch', exists (
          select 1 from public.biometric_attendance_logs bl
          where bl.staff_id = p_staff_id
            and (bl.punch_time at time zone 'Africa/Cairo')::date between ads.attendance_date - 1 and ads.attendance_date + 1
            and nullif(trim(bl.branch), '') is not null
            and trim(bl.branch) <> trim(coalesce(ads.branch, v_staff.branch))
        )
      ) order by ads.attendance_date desc), '[]'::jsonb)
      from public.attendance_daily_summary ads
      where ads.staff_id = p_staff_id and ads.attendance_date between v_from and v_to
    )
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_gm_review_time_off_v1(p_request_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_row public.staff_time_off_requests%rowtype;
  v_actor public.staff_accounts%rowtype;
  v_new_status text;
begin
  if p_decision not in ('approve','reject') then raise exception using errcode='22023', message='القرار يجب أن يكون approve أو reject'; end if;
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception using errcode='42501', message='صلاحية المدير العام مطلوبة للاعتماد النهائي';
  end if;
  select * into v_row from public.staff_time_off_requests where id=p_request_id and status='pending_gm_review' for update;
  if not found then raise exception using errcode='22023', message='الطلب غير موجود أو تم البت فيه بالفعل'; end if;
  select * into v_actor from public.staff_accounts sa where sa.id=public.dawaa_current_staff_account_id_strict();
  v_new_status := case when p_decision='approve' then 'approved' else 'rejected' end;

  update public.staff_time_off_requests
  set status = v_new_status, decided_by = v_actor.id::text, decided_by_name = v_actor.name, decided_at = now(), decision_note = p_note,
      metadata = metadata || jsonb_build_object('gm_decision', jsonb_build_object(
        'decision', p_decision, 'decided_by', v_actor.id, 'decided_by_name', v_actor.name, 'decided_at', now(), 'note', p_note)),
      updated_at = now()
  where id = p_request_id;

  return jsonb_build_object('id', p_request_id, 'new_status', v_new_status);
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_gm_time_off_queue_v1()
 RETURNS TABLE(id uuid, staff_id uuid, staff_name text, branch text, request_kind text, request_label text, start_date date, end_date date, start_time time without time zone, end_time time without time zone, reason text, requested_at timestamp with time zone, branch_decided_by_name text, branch_decided_at timestamp with time zone, branch_note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception using errcode='42501', message='صلاحية المدير العام مطلوبة لهذه الشاشة';
  end if;
  return query
  select r.id, r.staff_id, r.staff_name_snapshot, r.branch_snapshot, r.request_kind, r.request_label,
    r.start_date, r.end_date, r.start_time, r.end_time, r.reason, r.requested_at,
    r.metadata->'branch_decision'->>'decided_by_name', (r.metadata->'branch_decision'->>'decided_at')::timestamptz,
    r.metadata->'branch_decision'->>'note'
  from public.staff_time_off_requests r
  where r.status = 'pending_gm_review'
  order by r.requested_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_manual_punch_entry_v1(p_staff_id uuid, p_attendance_type text, p_recorded_at timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_staff public.staff%rowtype;
  v_actor public.staff_accounts%rowtype;
  v_new_id uuid;
begin
  if p_attendance_type not in ('check_in','check_out') then
    raise exception using errcode='22023', message='النوع يجب أن يكون check_in أو check_out';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception using errcode='22023', message='سبب التسجيل اليدوي مطلوب حتى يظل القرار قابلًا للمراجعة';
  end if;
  if p_recorded_at is null or p_recorded_at > now() + interval '5 minutes' then
    raise exception using errcode='22023', message='وقت البصمة اليدوية غير صالح';
  end if;

  select * into v_staff from public.staff where id=p_staff_id and coalesce(active,false)=true;
  if not found then raise exception using errcode='22023', message='الموظف غير موجود أو غير نشط'; end if;
  if not public.dawaa_can_read_staff_attendance_log(v_staff.id, v_staff.branch) then
    raise exception using errcode='42501', message='لا تملك صلاحية تسجيل بصمة لهذا الموظف';
  end if;
  select * into v_actor from public.staff_accounts sa where sa.id=public.dawaa_current_staff_account_id_strict();

  insert into public.staff_attendance_logs(
    staff_id, staff_name, role, branch_name, attendance_type, recorded_at,
    shift_date, biometric_verified, biometric_method, status, rejection_reason
  ) values (
    v_staff.id, v_staff.name, v_staff.role, v_staff.branch, p_attendance_type, p_recorded_at,
    (p_recorded_at at time zone 'Africa/Cairo')::date, false, 'manual_admin_entry', 'accepted', null
  ) returning id into v_new_id;

  insert into public.attendance_manual_actions_audit(action_type, staff_id, target_id, old_value, new_value, reason, actor_account_id, actor_name, actor_role)
  values('manual_punch_entry', v_staff.id, v_new_id, null,
    jsonb_build_object('attendance_type', p_attendance_type, 'recorded_at', p_recorded_at),
    p_reason, v_actor.id, v_actor.name, v_actor.role);

  perform public.dawaa_materialize_attendance_day_internal_v2(v_staff.id, (p_recorded_at at time zone 'Africa/Cairo')::date);

  return jsonb_build_object('id', v_new_id, 'staff_id', v_staff.id, 'attendance_type', p_attendance_type, 'recorded_at', p_recorded_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_manual_reinterpret_punch_v1(p_biometric_log_id uuid, p_new_type text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_log public.biometric_attendance_logs%rowtype;
  v_staff public.staff%rowtype;
  v_actor public.staff_accounts%rowtype;
  v_old_decision public.biometric_semantic_decisions%rowtype;
  v_status text; v_rejection text;
begin
  if p_new_type not in ('check_in','check_out','duplicate','ignore') then
    raise exception using errcode='22023', message='النوع يجب أن يكون check_in أو check_out أو duplicate أو ignore';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception using errcode='22023', message='سبب التعديل مطلوب حتى يظل القرار قابلًا للمراجعة';
  end if;

  select * into v_log from public.biometric_attendance_logs where id=p_biometric_log_id;
  if not found then raise exception using errcode='22023', message='البصمة غير موجودة'; end if;
  if v_log.staff_id is null then raise exception using errcode='22023', message='لا يمكن تعديل تفسير بصمة غير مربوطة بموظف'; end if;

  select * into v_staff from public.staff where id=v_log.staff_id;
  if not public.dawaa_can_read_staff_attendance_log(v_staff.id, v_staff.branch) then
    raise exception using errcode='42501', message='لا تملك صلاحية تعديل بصمات هذا الموظف';
  end if;
  select * into v_actor from public.staff_accounts sa where sa.id=public.dawaa_current_staff_account_id_strict();
  select * into v_old_decision from public.biometric_semantic_decisions where biometric_log_id=p_biometric_log_id;

  if p_new_type = 'duplicate' then
    v_status := 'rejected'; v_rejection := 'تعديل يدوي: تم اعتبارها بصمة مكررة — ' || p_reason;
    update public.biometric_semantic_decisions set decision='duplicate', semantic_type=null, confidence=1.0,
      reason='manual_override_duplicate: '||p_reason, updated_at=now() where biometric_log_id=p_biometric_log_id;
  elsif p_new_type = 'ignore' then
    v_status := 'rejected'; v_rejection := 'تعديل يدوي: تم تجاهلها — ' || p_reason;
    update public.biometric_semantic_decisions set decision='manual_ignored', semantic_type=null, confidence=1.0,
      reason='manual_override_ignored: '||p_reason, updated_at=now() where biometric_log_id=p_biometric_log_id;
  else
    v_status := 'accepted'; v_rejection := null;
    update public.biometric_semantic_decisions set decision='accepted', semantic_type=p_new_type, confidence=1.0,
      reason='manual_override_by_manager: '||p_reason, updated_at=now() where biometric_log_id=p_biometric_log_id;
  end if;

  update public.staff_attendance_logs
  set attendance_type = case when p_new_type in ('check_in','check_out') then p_new_type else attendance_type end,
      status = v_status, rejection_reason = v_rejection, updated_at = now()
  where biometric_source_log_id = p_biometric_log_id;

  insert into public.attendance_manual_actions_audit(action_type, staff_id, target_id, old_value, new_value, reason, actor_account_id, actor_name, actor_role)
  values('punch_reinterpretation', v_log.staff_id, p_biometric_log_id,
    jsonb_build_object('decision', v_old_decision.decision, 'semantic_type', v_old_decision.semantic_type),
    jsonb_build_object('decision', v_status, 'semantic_type', p_new_type),
    p_reason, v_actor.id, v_actor.name, v_actor.role);

  perform public.dawaa_materialize_attendance_day_internal_v2(v_log.staff_id, (v_log.punch_time at time zone 'Africa/Cairo')::date);

  return jsonb_build_object('biometric_log_id', p_biometric_log_id, 'new_type', p_new_type);
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_my_time_off_requests_v1()
 RETURNS SETOF staff_time_off_requests
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select * from public.staff_time_off_requests
  where staff_id = public.dawaa_current_attendance_subject_id()
  order by requested_at desc limit 50;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_request_time_off_v1(p_request_kind text, p_start_date date, p_end_date date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_subject_id uuid;
  v_staff public.staff%rowtype;
  v_actor public.staff_accounts%rowtype;
  v_new_id uuid;
  v_overlap_count int;
begin
  if p_request_kind not in ('permission','annual_leave','sick_leave','exceptional_leave') then
    raise exception using errcode='22023', message='نوع الطلب غير معروف';
  end if;
  if p_end_date < p_start_date then
    raise exception using errcode='22023', message='تاريخ النهاية قبل تاريخ البداية';
  end if;
  v_subject_id := public.dawaa_current_attendance_subject_id();
  if v_subject_id is null then
    raise exception using errcode='42501', message='لا يمكن تحديد هوية الموظف صاحب الطلب';
  end if;
  select * into v_staff from public.staff where id=v_subject_id and coalesce(active,false)=true;
  if not found then raise exception using errcode='22023', message='الموظف غير موجود أو غير نشط'; end if;

  select count(*) into v_overlap_count from public.staff_time_off_requests r
  where r.staff_id = v_staff.id
    and r.status in ('pending_branch_review','pending_gm_review','approved')
    and r.start_date <= p_end_date and r.end_date >= p_start_date;
  if v_overlap_count > 0 then
    raise exception using errcode='22023', message='عندك طلب آخر (معلّق أو معتمد) بيتداخل مع نفس التواريخ';
  end if;

  select * into v_actor from public.staff_accounts sa where sa.id=public.dawaa_current_staff_account_id_strict();

  insert into public.staff_time_off_requests(
    id, staff_id, staff_name_snapshot, branch_snapshot, request_kind, request_label, status,
    start_date, end_date, start_time, end_time, reason, requested_by, requested_at, policy_version, source, metadata
  ) values (
    gen_random_uuid(), v_staff.id, v_staff.name, v_staff.branch, p_request_kind,
    case p_request_kind when 'permission' then 'إذن' when 'annual_leave' then 'إجازة سنوية' when 'sick_leave' then 'إجازة مرضية' else 'إجازة استثنائية' end,
    'pending_branch_review', p_start_date, p_end_date, p_start_time, p_end_time, p_reason,
    coalesce(v_actor.name, v_staff.name), now(), 'two_stage_v1', 'self_service',
    jsonb_build_object('workflow','two_stage_v1')
  ) returning id into v_new_id;

  return jsonb_build_object('id', v_new_id, 'status', 'pending_branch_review');
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_schedule_mismatch_candidates_v1(p_days integer DEFAULT 21)
 RETURNS TABLE(staff_id uuid, staff_name text, branch text, day_of_week text, occurrences bigint, distinct_dates bigint, earliest_time time without time zone, latest_time time without time zone, spread_minutes numeric, sample_dates date[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception using errcode='42501', message='صلاحية الإدارة مطلوبة لعرض احتمالات عدم مطابقة الجدول';
  end if;
  return query
  with flagged as (
    select bl.staff_id, bl.punch_time,
      case extract(dow from (bl.punch_time at time zone 'Africa/Cairo'))::int
        when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء' when 3 then 'الأربعاء'
        when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end as day_of_week,
      (bl.punch_time at time zone 'Africa/Cairo')::time as punch_time_of_day,
      (bl.punch_time at time zone 'Africa/Cairo')::date as punch_date
    from public.biometric_attendance_logs bl
    join public.biometric_semantic_decisions bd on bd.biometric_log_id = bl.id
    where bd.reason = 'no_matching_schedule_fallback_to_raw'
      and bl.punch_time >= current_date - greatest(7, least(coalesce(p_days,21), 90))
      and bl.staff_id is not null
  )
  select s.id, s.name, s.branch, f.day_of_week,
    count(*)::bigint, count(distinct f.punch_date)::bigint,
    min(f.punch_time_of_day), max(f.punch_time_of_day),
    round(extract(epoch from (max(f.punch_time_of_day) - min(f.punch_time_of_day)))/60.0, 0),
    array_agg(distinct f.punch_date order by f.punch_date)
  from flagged f
  join public.staff s on s.id = f.staff_id
  where coalesce(s.active,false) = true
    and not exists (
      select 1 from public.attendance_schedule_mismatch_dismissals d
      where d.staff_id = f.staff_id and d.day_of_week = f.day_of_week
    )
  group by s.id, s.name, s.branch, f.day_of_week
  having count(distinct f.punch_date) >= 2
  order by count(distinct f.punch_date) desc, (max(f.punch_time_of_day) - min(f.punch_time_of_day)) asc
  limit 40;
end;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_unified_approvals_v1()
 RETURNS TABLE(item_type text, item_id uuid, staff_id uuid, staff_name text, branch text, title text, subtitle text, amount numeric, hours numeric, requested_at timestamp with time zone, priority integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_rec record;
begin
  begin
    for v_rec in
      select 'deduction'::text as t, d.id, d.staff_id, d.employee_name, d.branch,
        'خصم حضور تلقائي'::text as ti, format('%s نقطة (%s ج.م)', d.points, d.amount) as sub, d.amount,
        d.transaction_date::timestamptz as ra, 2 as pr
      from public.attendance_deduction_pending_review_v1() d
    loop
      item_type:=v_rec.t; item_id:=v_rec.id; staff_id:=v_rec.staff_id; staff_name:=v_rec.employee_name; branch:=v_rec.branch;
      title:=v_rec.ti; subtitle:=v_rec.sub; amount:=v_rec.amount; hours:=null; requested_at:=v_rec.ra; priority:=v_rec.pr;
      return next;
    end loop;
  exception when others then
    raise warning 'attendance_unified_approvals_v1: deduction source failed: %', sqlerrm;
  end;

  begin
    for v_rec in
      select 'overtime'::text as t, o.id, o.staff_id, o.staff_name, o.branch,
        'أوفرتايم بانتظار الاعتماد'::text as ti,
        case when o.overtime_amount is not null then format('(~%s ج.م)', o.overtime_amount) else 'يحتاج مراجعة يدوية' end as sub,
        o.overtime_amount, o.overtime_hours as hrs, o.attendance_date::timestamptz as ra, case when o.overtime_amount is null then 1 else 3 end as pr
      from public.list_pending_overtime_v1(null) o
    loop
      item_type:=v_rec.t; item_id:=v_rec.id; staff_id:=v_rec.staff_id; staff_name:=v_rec.staff_name; branch:=v_rec.branch;
      title:=v_rec.ti; subtitle:=v_rec.sub; amount:=v_rec.overtime_amount; hours:=v_rec.hrs; requested_at:=v_rec.ra; priority:=v_rec.pr;
      return next;
    end loop;
  exception when others then
    raise warning 'attendance_unified_approvals_v1: overtime source failed: %', sqlerrm;
  end;

  begin
    for v_rec in
      select 'timeoff_branch'::text as t, tt.id, tt.staff_id, tt.staff_name, tt.branch,
        format('طلب %s — بانتظار موافقة الفرع', tt.request_label)::text as ti,
        format('%s%s', tt.start_date::text, case when tt.end_date<>tt.start_date then ' ← '||tt.end_date::text else '' end) as sub,
        null::numeric as am, tt.requested_at as ra, 2 as pr
      from public.attendance_branch_time_off_queue_v1() tt
    loop
      item_type:=v_rec.t; item_id:=v_rec.id; staff_id:=v_rec.staff_id; staff_name:=v_rec.staff_name; branch:=v_rec.branch;
      title:=v_rec.ti; subtitle:=v_rec.sub; amount:=v_rec.am; hours:=null; requested_at:=v_rec.ra; priority:=v_rec.pr;
      return next;
    end loop;
  exception when others then
    raise warning 'attendance_unified_approvals_v1: timeoff_branch source failed: %', sqlerrm;
  end;

  begin
    for v_rec in
      select 'timeoff_gm'::text as t, g.id, g.staff_id, g.staff_name, g.branch,
        format('طلب %s — بانتظار الاعتماد النهائي', g.request_label)::text as ti,
        format('%s%s — وافق مدير الفرع: %s', g.start_date::text, case when g.end_date<>g.start_date then ' ← '||g.end_date::text else '' end, coalesce(g.branch_decided_by_name,'-')) as sub,
        null::numeric as am, g.requested_at as ra, 2 as pr
      from public.attendance_gm_time_off_queue_v1() g
    loop
      item_type:=v_rec.t; item_id:=v_rec.id; staff_id:=v_rec.staff_id; staff_name:=v_rec.staff_name; branch:=v_rec.branch;
      title:=v_rec.ti; subtitle:=v_rec.sub; amount:=v_rec.am; hours:=null; requested_at:=v_rec.ra; priority:=v_rec.pr;
      return next;
    end loop;
  exception when others then
    raise warning 'attendance_unified_approvals_v1: timeoff_gm source failed: %', sqlerrm;
  end;

  return;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dawaa_detect_pending_overtime_v1(p_lookback_days integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_s record; v_d date; v_r jsonb; v_scheduled_hours numeric; v_extra_minutes int; v_late_minutes int;
  v_deviation jsonb; v_overtime_minutes int; v_comp record; v_true_hourly_rate numeric;
  v_inserted int := 0; v_invalidated int := 0; v_flagged_unreasonable int := 0;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
begin
  update public.staff_overtime_approvals o
  set status = 'rejected',
      decision_note = 'إبطال تلقائي: تغيّر تفسير يوم الحضور بعد إنشاء هذا السجل ولم يعد مؤهلاً للأوفرتايم.',
      decided_at = now()
  where o.status = 'pending'
    and exists (
      select 1 from public.attendance_daily_summary ads
      where ads.staff_id = o.staff_id and ads.attendance_date = o.attendance_date
        and ads.resolution_status not in ('on_time','late','very_late','on_time_with_permission','worked_on_off')
    );
  get diagnostics v_invalidated = row_count;

  for v_s in select id, name, branch, role from public.staff where coalesce(active,false) = true loop
    select * into v_comp from public.employee_compensation_profiles
    where staff_id = v_s.id::text and active = true order by effective_from desc nulls last limit 1;

    -- (إضافة) الموظف المعفى من خصم التأخير مستبعد كمان من احتساب الأوفرتايم بالساعة تلقائيًا
    if coalesce(v_comp.exempt_from_lateness_deduction, false) then
      continue;
    end if;

    v_true_hourly_rate := case when v_comp.hourly_rate is not null and v_comp.hourly_rate > 0 then round(v_comp.hourly_rate/26.0, 4) else null end;

    for v_d in select generate_series(v_today - p_lookback_days, v_today - 1, interval '1 day')::date loop
      if exists (select 1 from public.staff_overtime_approvals where staff_id = v_s.id and attendance_date = v_d) then
        continue;
      end if;
      v_r := public.dawaa_build_attendance_day_resolution_v2(v_s.id, v_d);
      if (v_r->>'resolution_status') not in ('on_time','late','very_late','on_time_with_permission','worked_on_off') then
        continue;
      end if;
      v_scheduled_hours := case when (v_r->>'scheduled_start_at') is not null and (v_r->>'scheduled_end_at') is not null
        then extract(epoch from ((v_r->>'scheduled_end_at')::timestamptz - (v_r->>'scheduled_start_at')::timestamptz))/3600.0
        else null end;
      v_extra_minutes := round(greatest(coalesce((v_r->>'candidate_hours')::numeric,0) - coalesce(v_scheduled_hours,0), 0) * 60)::int;
      v_late_minutes := coalesce((v_r->>'late_minutes')::int, 0);

      v_deviation := public.dawaa_net_attendance_deviation_v1(v_late_minutes, v_extra_minutes, v_s.role, false);
      v_overtime_minutes := coalesce((v_deviation->>'overtime_minutes')::int, 0);
      if v_overtime_minutes < 10 then continue; end if;

      if v_overtime_minutes > 360 then
        insert into public.staff_overtime_approvals (staff_id, staff_name, branch, attendance_date, overtime_hours, hourly_rate, overtime_amount, status, decision_note)
        values (v_s.id, v_s.name, v_s.branch, v_d, round(v_overtime_minutes/60.0,2), null, null, 'pending',
          'تنبيه: عدد ساعات كبير بشكل غير معتاد — راجع صحة بصمة الدخول/الخروج قبل الاعتماد.')
        on conflict (staff_id, attendance_date) do nothing;
        v_flagged_unreasonable := v_flagged_unreasonable + 1;
        continue;
      end if;

      insert into public.staff_overtime_approvals (staff_id, staff_name, branch, attendance_date, overtime_hours, hourly_rate, overtime_amount, status)
      values (v_s.id, v_s.name, v_s.branch, v_d, round(v_overtime_minutes/60.0,2), v_true_hourly_rate,
        case when v_true_hourly_rate is not null then round((v_overtime_minutes/60.0) * v_true_hourly_rate * 1.5, 2) else null end,
        'pending')
      on conflict (staff_id, attendance_date) do nothing;
      v_inserted := v_inserted + 1;
    end loop;
  end loop;
  return jsonb_build_object('queued', v_inserted, 'invalidated_stale', v_invalidated, 'flagged_unreasonable', v_flagged_unreasonable);
end;
$function$;

CREATE OR REPLACE FUNCTION public.decide_overtime_approval_v1(p_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_can boolean;
  v_actor_name text;
begin
  if p_decision not in ('approved','rejected') then raise exception 'invalid_decision'; end if;
  v_can := public.dawaa_current_actor_can(array['manage_payroll']);
  if not v_can then raise exception 'not_authorized'; end if;

  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'email', 'admin') into v_actor_name;

  update public.staff_overtime_approvals
  set status = p_decision, decided_at = now(), decided_by_name = v_actor_name, decision_note = p_note, updated_at = now()
  where id = p_id and status = 'pending';

  if not found then raise exception 'not_found_or_already_decided'; end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_decision);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_pending_overtime_v1(p_branch text DEFAULT NULL::text)
 RETURNS SETOF staff_overtime_approvals
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select * from public.staff_overtime_approvals
  where status = 'pending'
    and (p_branch is null or branch = p_branch)
    and public.current_user_branch_access_v1(branch, true)
  order by attendance_date desc;
$function$;


grant execute on function public.attendance_branch_role_group_rates_v1(date,date) to authenticated,service_role;
grant execute on function public.attendance_branch_sync_complete_through_v1(text) to authenticated,service_role;
grant execute on function public.attendance_branch_time_off_queue_v1() to authenticated,service_role;
grant execute on function public.attendance_cancel_time_off_request_v1(uuid) to authenticated,service_role;
grant execute on function public.attendance_deduction_adjust_v1(uuid,numeric,numeric,text) to authenticated,service_role;
grant execute on function public.attendance_deduction_pending_review_v1() to authenticated,service_role;
grant execute on function public.attendance_deduction_review_decide_v1(uuid,text,text) to authenticated,service_role;
grant execute on function public.attendance_dismiss_schedule_mismatch_v1(uuid,text,text) to authenticated,service_role;
grant execute on function public.attendance_employee_profile_v1(uuid,integer) to authenticated,service_role;
grant execute on function public.attendance_gm_review_time_off_v1(uuid,text,text) to authenticated,service_role;
grant execute on function public.attendance_gm_time_off_queue_v1() to authenticated,service_role;
grant execute on function public.attendance_manual_punch_entry_v1(uuid,text,timestamptz,text) to authenticated,service_role;
grant execute on function public.attendance_manual_reinterpret_punch_v1(uuid,text,text) to authenticated,service_role;
grant execute on function public.attendance_my_time_off_requests_v1() to authenticated,service_role;
grant execute on function public.attendance_request_time_off_v1(text,date,date,time,time,text) to authenticated,service_role;
grant execute on function public.attendance_schedule_mismatch_candidates_v1(integer) to authenticated,service_role;
grant execute on function public.attendance_unified_approvals_v1() to authenticated,service_role;
grant execute on function public.decide_overtime_approval_v1(uuid,text,text) to authenticated,service_role;
grant execute on function public.list_pending_overtime_v1(text) to authenticated,service_role;
revoke execute on function public.dawaa_detect_pending_overtime_v1(integer) from public,anon,authenticated;
grant execute on function public.dawaa_detect_pending_overtime_v1(integer) to service_role;
notify pgrst,'reload schema';
