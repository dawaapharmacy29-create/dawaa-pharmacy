-- Exact Production definitions (pg_get_functiondef, 2026-10-16) of the seven legacy time-off APIs.
-- Included by attendance_legacy_time_off_revoke_client_v1.fixture.sql; the migration guard hashes these texts.

CREATE OR REPLACE FUNCTION public.attendance_branch_review_time_off_v1(p_request_id uuid, p_decision text, p_note text DEFAULT NULL::text)
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
  select * into v_row from public.staff_time_off_requests where id=p_request_id and status='pending_branch_review' for update;
  if not found then raise exception using errcode='22023', message='الطلب غير موجود أو تم البت فيه بالفعل'; end if;
  if not public.dawaa_can_read_staff_attendance_log(v_row.staff_id, v_row.branch_snapshot) then
    raise exception using errcode='42501', message='لا تملك صلاحية مراجعة طلبات هذا الفرع';
  end if;
  select * into v_actor from public.staff_accounts sa where sa.id=public.dawaa_current_staff_account_id_strict();
  v_new_status := case when p_decision='approve' then 'pending_gm_review' else 'rejected' end;

  update public.staff_time_off_requests
  set status = v_new_status,
      metadata = metadata || jsonb_build_object('branch_decision', jsonb_build_object(
        'decision', p_decision, 'decided_by', v_actor.id, 'decided_by_name', v_actor.name, 'decided_at', now(), 'note', p_note)),
      updated_at = now()
  where id = p_request_id;

  return jsonb_build_object('id', p_request_id, 'new_status', v_new_status);
end;
$function$
;

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
$function$
;

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
$function$
;

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
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.attendance_my_time_off_requests_v1()
 RETURNS SETOF staff_time_off_requests
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select * from public.staff_time_off_requests
  where staff_id = public.dawaa_current_attendance_subject_id()
  order by requested_at desc limit 50;
$function$
;

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
$function$
;

-- Modern reader (Production 2026-10-16), included to prove the closure leaves it unaffected.
CREATE OR REPLACE FUNCTION public.list_staff_time_off_requests_v1(p_staff_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS SETOF staff_time_off_requests
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_self uuid:=public.dawaa_current_staff_subject_uuid_v1();
  v_scope_all boolean:=public.dawaa_time_off_scope_all_v1();
  v_actor_branch text:=trim(coalesce(public.employee_operating_actor_branch(),''));
  v_can_manage boolean:=public.dawaa_current_actor_can(array['manage_time_off','approve_leave_request']::text[]);
begin
  if p_staff_id is not null and not public.dawaa_time_off_can_access_staff_v1(p_staff_id) then
    raise exception 'not_authorized_for_time_off' using errcode='42501';
  end if;
  if p_staff_id is null and not v_scope_all and not v_can_manage and v_self is null then
    raise exception 'not_authorized_for_time_off' using errcode='42501';
  end if;
  return query
  select r.* from public.staff_time_off_requests r
  where (
    case
      when p_staff_id is not null then r.staff_id=p_staff_id
      when v_scope_all then true
      when v_can_manage then lower(trim(coalesce(r.branch_snapshot,'')))=lower(v_actor_branch)
      else r.staff_id=v_self
    end
  )
    and (p_from is null or r.end_date>=p_from)
    and (p_to is null or r.start_date<=p_to)
    and (p_status is null or r.status=p_status)
  order by r.start_date desc,r.created_at desc
  limit least(greatest(coalesce(p_limit,200),1),500);
end;
$function$
;
