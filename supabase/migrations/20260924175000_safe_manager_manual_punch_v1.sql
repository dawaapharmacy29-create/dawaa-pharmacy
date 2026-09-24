-- Safe manager-entered attendance path.
-- Preserve the explicitly targeted employee for authorized admin manual punches,
-- while keeping the actor recorded as created_by and bypassing personal-device binding only for that trusted path.

create or replace function public.dawaa_normalize_staff_attendance_log_identity_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_account_id uuid;
  v_subject_id uuid;
  v_source_staff_id uuid;
  v_name text;
  v_role text;
  v_branch text;
  v_manual_target text:=nullif(current_setting('dawaa.manual_attendance_target',true),'');
begin
  v_account_id:=public.dawaa_current_staff_account_id_strict();

  if new.biometric_source_log_id is not null then
    select b.staff_id into v_source_staff_id
    from public.biometric_attendance_logs b where b.id=new.biometric_source_log_id;
    if v_source_staff_id is null or v_source_staff_id is distinct from new.staff_id then
      raise exception 'biometric attendance staff identity does not match source';
    end if;
    if v_account_id is not null and not public.dawaa_can_manage_biometric_mapping_v1() then
      raise exception 'not authorized to promote biometric attendance';
    end if;
    return new;
  end if;

  -- Explicit manager-entered punch for another employee.
  if v_manual_target is not null
     and new.staff_id is not null
     and new.staff_id::text=v_manual_target
     and v_account_id is not null
     and public.dawaa_can_manage_biometric_mapping_v1() then
    new.created_by:=v_account_id;
    return new;
  end if;

  if v_account_id is null then return new; end if;

  v_subject_id:=public.dawaa_current_attendance_subject_id();
  select sa.name,sa.role,sa.branch into v_name,v_role,v_branch
  from public.staff_accounts sa where sa.id=v_account_id;

  new.staff_id:=v_subject_id;
  new.created_by:=v_account_id;
  new.staff_name:=coalesce(nullif(trim(v_name),''),new.staff_name);
  new.role:=coalesce(nullif(trim(v_role),''),new.role);
  new.branch_name:=coalesce(nullif(trim(v_branch),''),new.branch_name);
  return new;
end;
$$;

create or replace function public.guard_staff_attendance_device()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $$
declare
  v_staff_key text;
  v_active_device text;
  v_manual_target text:=nullif(current_setting('dawaa.manual_attendance_target',true),'');
begin
  -- Trusted central fingerprint terminals are not personal employee devices.
  if coalesce(NEW.biometric_verified,false)=true
     and NEW.biometric_method='fingerprint_terminal'
     and NEW.biometric_source_log_id is not null then
    return NEW;
  end if;

  -- Authorized manager-entered punch: actor identity is audited separately.
  if v_manual_target is not null
     and NEW.staff_id is not null
     and NEW.staff_id::text=v_manual_target
     and NEW.biometric_method='not_checked'
     and NEW.created_by is not null then
    return NEW;
  end if;

  v_staff_key := coalesce(NEW.staff_id::text, NEW.staff_name);

  if NEW.device_id is null or length(trim(NEW.device_id)) = 0 then
    NEW.status := 'manual_review';
    NEW.rejection_reason := coalesce(NEW.rejection_reason, 'لا يمكن تحديد جهاز الحضور الخاص بالموظف.');
    return NEW;
  end if;

  select device_id
  into v_active_device
  from public.staff_attendance_devices
  where coalesce(staff_id::text, staff_name) = v_staff_key
    and status = 'active'
  limit 1;

  if v_active_device is null then
    insert into public.staff_attendance_devices
      (staff_id, staff_name, role, branch_name, device_id, status, notes)
    values
      (NEW.staff_id, NEW.staff_name, NEW.role, NEW.branch_name, NEW.device_id, 'active', 'تم ربط أول جهاز تلقائيًا عند أول تسجيل حضور');
    return NEW;
  end if;

  if v_active_device <> NEW.device_id then
    NEW.status := 'rejected';
    NEW.rejection_reason := 'هذا الحساب مربوط بجهاز حضور آخر. يلزم اعتماد تغيير الجهاز من الإدارة.';
    return NEW;
  end if;

  update public.staff_attendance_devices
  set last_seen_at = now(), updated_at = now()
  where coalesce(staff_id::text, staff_name) = v_staff_key
    and status = 'active';

  return NEW;
end;
$$;

create or replace function public.attendance_manual_punch_entry_v1(
  p_staff_id uuid,
  p_attendance_type text,
  p_recorded_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_staff public.staff%rowtype;
  v_actor public.staff_accounts%rowtype;
  v_new_id uuid;
  v_attendance_date date;
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
  if not public.dawaa_can_read_staff_attendance_log(v_staff.id,v_staff.branch)
     or not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception using errcode='42501', message='لا تملك صلاحية تسجيل بصمة يدوية لهذا الموظف';
  end if;

  select * into v_actor from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict();

  v_attendance_date:=(p_recorded_at at time zone 'Africa/Cairo')::date;
  perform set_config('dawaa.manual_attendance_target',v_staff.id::text,true);

  insert into public.staff_attendance_logs(
    staff_id,staff_name,role,branch_name,attendance_type,recorded_at,
    shift_date,biometric_verified,biometric_method,status,rejection_reason,created_by
  ) values (
    v_staff.id,v_staff.name,v_staff.role,v_staff.branch,p_attendance_type,p_recorded_at,
    v_attendance_date,false,'not_checked','accepted',null,v_actor.id
  ) returning id into v_new_id;

  insert into public.attendance_manual_actions_audit(
    action_type,staff_id,target_id,old_value,new_value,reason,
    actor_account_id,actor_name,actor_role
  ) values (
    'manual_punch_entry',v_staff.id,v_new_id,null,
    jsonb_build_object('attendance_type',p_attendance_type,'recorded_at',p_recorded_at),
    p_reason,v_actor.id,coalesce(v_actor.name,v_actor.staff_name,v_actor.username),v_actor.role
  );

  perform public.dawaa_materialize_attendance_day_internal_v2(v_staff.id,v_attendance_date);

  return jsonb_build_object(
    'id',v_new_id,
    'staff_id',v_staff.id,
    'attendance_type',p_attendance_type,
    'recorded_at',p_recorded_at
  );
end;
$$;
