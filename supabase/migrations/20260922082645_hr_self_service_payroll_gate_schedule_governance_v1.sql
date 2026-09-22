alter table public.attendance_manual_requests
  add column if not exists attendance_date date,
  add column if not exists request_kind text,
  add column if not exists source_resolution_id uuid,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_attendance_manual_requests_staff_date
  on public.attendance_manual_requests(staff_id, attendance_date desc, created_at desc);

CREATE OR REPLACE FUNCTION public.create_my_attendance_correction_request_v2(p_attendance_date date, p_request_kind text, p_requested_time timestamp with time zone, p_reason text)
 RETURNS attendance_manual_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_account_id uuid;
  v_staff_id uuid;
  v_staff public.staff%rowtype;
  v_kind text:=lower(trim(coalesce(p_request_kind,'')));
  v_legacy_type text;
  v_row public.attendance_manual_requests%rowtype;
begin
  v_account_id:=public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then
    raise exception 'active staff actor required' using errcode='42501';
  end if;

  select nullif(sa.staff_id,'')::uuid into v_staff_id
  from public.staff_accounts sa
  where sa.id=v_account_id and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;

  if v_staff_id is null then
    begin
      select id into v_staff_id from public.staff where id=v_account_id limit 1;
    exception when others then
      v_staff_id:=null;
    end;
  end if;

  if v_staff_id is null then
    raise exception 'account_not_linked_to_staff' using errcode='22023';
  end if;

  select * into v_staff from public.staff where id=v_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;

  if p_attendance_date is null
     or p_attendance_date>(now() at time zone 'Africa/Cairo')::date
     or p_attendance_date<((now() at time zone 'Africa/Cairo')::date-62) then
    raise exception 'invalid_correction_date' using errcode='22023';
  end if;

  if v_kind not in ('missing_checkin','missing_checkout','wrong_time','other') then
    raise exception 'invalid_correction_kind' using errcode='22023';
  end if;

  v_legacy_type:=case v_kind
    when 'missing_checkin' then 'missed_check_in'
    when 'missing_checkout' then 'missed_check_out'
    when 'wrong_time' then 'biometric_issue'
    else 'other'
  end;

  if p_requested_time is null and v_kind<>'other' then
    raise exception 'requested_time_required' using errcode='22023';
  end if;

  if length(trim(coalesce(p_reason,'')))<5 then
    raise exception 'correction_reason_too_short' using errcode='22023';
  end if;

  if exists(
    select 1 from public.attendance_manual_requests r
    where r.staff_id=v_staff_id
      and coalesce(r.attendance_date,(r.requested_time at time zone 'Africa/Cairo')::date)=p_attendance_date
      and coalesce(r.request_kind,
        case r.request_type
          when 'missed_check_in' then 'missing_checkin'
          when 'missed_check_out' then 'missing_checkout'
          when 'biometric_issue' then 'wrong_time'
          else r.request_type
        end
      )=v_kind
      and r.status='pending'
  ) then
    raise exception 'duplicate_pending_correction_request' using errcode='23505';
  end if;

  insert into public.attendance_manual_requests(
    staff_id,staff_name,branch_name,request_type,request_kind,attendance_date,requested_time,reason,status,created_at,updated_at
  )
  values(
    v_staff_id,v_staff.name,v_staff.branch,v_legacy_type,v_kind,p_attendance_date,
    coalesce(p_requested_time,(p_attendance_date::timestamp+time '12:00') at time zone 'Africa/Cairo'),
    trim(p_reason),'pending',now(),now()
  )
  returning * into v_row;

  return v_row;
end;
$function$


CREATE OR REPLACE FUNCTION public.list_my_attendance_correction_requests_v2(p_limit integer DEFAULT 50)
 RETURNS SETOF attendance_manual_requests
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_staff_id uuid;
begin
  select nullif(sa.staff_id,'')::uuid into v_staff_id
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;

  if v_staff_id is null then raise exception 'account_not_linked_to_staff' using errcode='22023'; end if;

  return query
  select * from public.attendance_manual_requests r
  where r.staff_id=v_staff_id
  order by r.created_at desc
  limit greatest(1,least(coalesce(p_limit,50),100));
end;
$function$


CREATE OR REPLACE FUNCTION public.list_attendance_correction_requests_v2(p_branch text DEFAULT NULL::text, p_status text DEFAULT 'pending'::text, p_limit integer DEFAULT 200)
 RETURNS SETOF attendance_manual_requests
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','view_schedule']) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  return query
  select r.*
  from public.attendance_manual_requests r
  where (p_status is null or trim(p_status)='' or r.status=p_status)
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(coalesce(r.branch_name,''))=trim(p_branch))
    and (r.staff_id is null or public.dawaa_can_read_staff_attendance_log(r.staff_id,r.branch_name))
  order by case when r.status='pending' then 0 else 1 end,r.created_at desc
  limit greatest(1,least(coalesce(p_limit,200),500));
end;
$function$


CREATE OR REPLACE FUNCTION public.decide_attendance_correction_request_v2(p_request_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS attendance_manual_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor uuid:=public.dawaa_current_staff_account_id_strict();
  v_row public.attendance_manual_requests%rowtype;
  v_decision text:=lower(trim(coalesce(p_decision,'')));
begin
  if v_actor is null or not public.dawaa_current_actor_can(array['view_attendance_leaves','view_schedule']) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if v_decision not in ('approved','rejected') then
    raise exception 'invalid_decision' using errcode='22023';
  end if;

  select * into v_row from public.attendance_manual_requests where id=p_request_id for update;
  if not found then raise exception 'request_not_found' using errcode='22023'; end if;
  if v_row.status<>'pending' then raise exception 'request_already_decided' using errcode='22023'; end if;
  if v_row.staff_id is not null and not public.dawaa_can_read_staff_attendance_log(v_row.staff_id,v_row.branch_name) then
    raise exception 'not authorized for staff' using errcode='42501';
  end if;

  update public.attendance_manual_requests
  set status=v_decision,reviewed_by=v_actor,reviewed_at=now(),review_note=nullif(trim(coalesce(p_note,'')),''),updated_at=now()
  where id=p_request_id
  returning * into v_row;

  -- Approval records the manager decision only. It does NOT invent or rewrite biometric evidence,
  -- and does not silently alter approved Attendance Truth.
  return v_row;
end;
$function$


CREATE OR REPLACE FUNCTION public.attendance_payroll_safety_gate_v1(p_staff_id uuid, p_month_cycle text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  j jsonb;
  blockers jsonb:='[]'::jsonb;
  warnings jsonb:='[]'::jsonb;
begin
  j:=public.attendance_payroll_engine_v2(p_staff_id,p_month_cycle);

  if coalesce((j->>'ready')::boolean,false) is not true then
    blockers:=blockers||jsonb_build_array(jsonb_build_object('code',coalesce(j->>'reason','engine_not_ready'),'label','بيانات التعويضات أو محرك المرتب غير جاهز'));
  else
    if coalesce((j->>'cycle_closed')::boolean,false) is not true then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('code','cycle_open','label','الدورة ما زالت مفتوحة'));
    end if;
    if coalesce((j->>'pending_review_days')::int,0)>0 then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('code','attendance_pending','label','يوجد أيام حضور معلقة','count',(j->>'pending_review_days')::int));
    end if;
    if coalesce((j->>'pending_overtime_hours')::numeric,0)>0 then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('code','overtime_pending','label','يوجد أوفر تايم بانتظار الاعتماد','hours',(j->>'pending_overtime_hours')::numeric));
    end if;
    if coalesce((j->>'financial_drift_days')::int,0)>0 then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('code','financial_drift','label','يوجد اختلاف ساعات مالي عن اعتماد سابق','count',(j->>'financial_drift_days')::int));
    end if;
    if coalesce((j->'attendance_eligibility'->>'ready_for_payroll')::boolean,false) is not true then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('code','attendance_eligibility','label','جاهزية الحضور للمرتب غير مكتملة'));
    end if;
    if coalesce((j->>'classification_only_drift_days')::int,0)>0 then
      warnings:=warnings||jsonb_build_array(jsonb_build_object('code','classification_drift','label','يوجد اختلاف تصنيف بدون فرق ساعات مالي','count',(j->>'classification_only_drift_days')::int));
    end if;
  end if;

  return jsonb_build_object(
    'staff_id',p_staff_id,
    'month_cycle',j->>'month_cycle',
    'ready',jsonb_array_length(blockers)=0 and coalesce((j->>'ready_for_final')::boolean,false),
    'blockers',blockers,
    'warnings',warnings,
    'engine',j
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.attendance_policy_shadow_audit_v1(p_start date, p_end date, p_branch text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'invalid_policy_shadow_range' using errcode='22023';
  end if;
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','view_schedule','manage_payroll']) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  with days as (
    select a.*,public.resolve_attendance_policy_v2(a.staff_id,a.attendance_date) policy
    from public.attendance_daily_summary a
    where a.attendance_date between p_start and p_end
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(a.branch)=trim(p_branch))
      and public.dawaa_can_read_staff_attendance_log(a.staff_id,a.branch)
      and a.status in ('approved','pending_review')
  ), calc as (
    select *,
      coalesce(nullif(policy->>'late_grace_minutes','')::int,15) shadow_late_grace,
      coalesce(nullif(policy->>'very_late_minutes','')::int,30) shadow_very_late,
      coalesce(nullif(policy->>'early_leave_grace_minutes','')::int,0) shadow_early_grace
    from days
  ), compared as (
    select *,
      case
        when coalesce(late_minutes,0)>shadow_very_late then 'very_late'
        when coalesce(late_minutes,0)>shadow_late_grace then 'late'
        when resolution_status in ('late','very_late') then 'on_time'
        else resolution_status
      end shadow_late_status,
      (resolution_status='early_leave_review' and coalesce(early_leave_minutes,0)<=shadow_early_grace and shadow_early_grace>0) early_within_grace
    from calc
  )
  select jsonb_build_object(
    'evaluated_days',count(*),
    'late_classification_changes',count(*) filter(where shadow_late_status is distinct from resolution_status and resolution_status in ('on_time','on_time_with_permission','late','very_late')),
    'early_leave_within_new_grace',count(*) filter(where early_within_grace),
    'policies_resolved',count(*) filter(where policy<>'{}'::jsonb),
    'generated_at',now()
  ) into result
  from compared;

  return result;
end;
$function$


CREATE OR REPLACE FUNCTION public.attendance_schedule_governance_v2(p_start date, p_end date, p_branch text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'invalid_schedule_governance_range' using errcode='22023';
  end if;
  if not public.dawaa_current_actor_can(array['view_schedule','view_attendance_leaves']) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  with active_staff as (
    select s.id,s.name,s.role,s.branch
    from public.staff s
    where coalesce(s.active,s.is_active,true)
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
  ), calendar as (
    select a.*,g::date work_date
    from active_staff a
    cross join generate_series(p_start,p_end,interval '1 day') g
  ), resolved as (
    select c.*,(select count(*) from public.shift_schedules ss
      where ss.staff_id=c.id
        and ss.effective_from<=c.work_date
        and (ss.effective_to is null or ss.effective_to>=c.work_date)
        and (
          coalesce(ss.shift_date,ss.date)=c.work_date
          or (ss.shift_date is null and ss.date is null and trim(coalesce(ss.day_name,''))=
             case extract(dow from c.work_date)::int when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء' when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end)
        )
    ) configs
    from calendar c
  )
  select jsonb_build_object(
    'staff_count',(select count(*) from active_staff),
    'staff_days',count(*),
    'missing_schedule_days',count(*) filter(where configs=0),
    'conflicting_schedule_days',count(*) filter(where configs>1),
    'healthy_schedule_days',count(*) filter(where configs=1),
    'published_like_rows',(select count(*) from public.shift_schedules ss where ss.effective_from<=p_end and (ss.effective_to is null or ss.effective_to>=p_start) and coalesce(ss.status,'scheduled')<>'draft' and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(ss.branch)=trim(p_branch))),
    'draft_rows',(select count(*) from public.shift_schedules ss where ss.effective_from<=p_end and (ss.effective_to is null or ss.effective_to>=p_start) and coalesce(ss.status,'scheduled')='draft' and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(ss.branch)=trim(p_branch))),
    'generated_at',now()
  ) into result
  from resolved;

  return result;
end;
$function$


revoke execute on function public.create_my_attendance_correction_request_v2(date,text,timestamptz,text) from public;
revoke execute on function public.list_my_attendance_correction_requests_v2(integer) from public;
revoke execute on function public.list_attendance_correction_requests_v2(text,text,integer) from public;
revoke execute on function public.decide_attendance_correction_request_v2(uuid,text,text) from public;
revoke execute on function public.attendance_payroll_safety_gate_v1(uuid,text) from public;
revoke execute on function public.attendance_policy_shadow_audit_v1(date,date,text) from public;
revoke execute on function public.attendance_schedule_governance_v2(date,date,text) from public;

grant execute on function public.create_my_attendance_correction_request_v2(date,text,timestamptz,text) to anon,authenticated,service_role;
grant execute on function public.list_my_attendance_correction_requests_v2(integer) to anon,authenticated,service_role;
grant execute on function public.list_attendance_correction_requests_v2(text,text,integer) to anon,authenticated,service_role;
grant execute on function public.decide_attendance_correction_request_v2(uuid,text,text) to anon,authenticated,service_role;
grant execute on function public.attendance_payroll_safety_gate_v1(uuid,text) to anon,authenticated,service_role;
grant execute on function public.attendance_policy_shadow_audit_v1(date,date,text) to anon,authenticated,service_role;
grant execute on function public.attendance_schedule_governance_v2(date,date,text) to anon,authenticated,service_role;
