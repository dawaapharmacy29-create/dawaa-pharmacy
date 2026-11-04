-- Confirmed device identity for Ahmed Salah. Preserve raw timestamps and existing attendance decisions.
do $$
declare
  v_staff public.staff%rowtype;
  v_account uuid;
  v_log record;
  v_decision jsonb;
  v_type text;
  v_status text;
  v_shift_date date;
  v_raw_type text;
  v_provider constant text := 'zk_shokry_direct_bridge';
  v_device constant text := 'GED7242701315';
  v_code constant text := '319';
begin
  if not exists (select 1 from public.biometric_attendance_logs
    where provider = v_provider and device_id::text = v_device and biometric_user_id = v_code) then
    return;
  end if;

  select * into strict v_staff from public.staff
  where trim(translate(name, 'أإآ', 'ااا')) = 'احمد صلاح' and active and branch = 'فرع شكري';
  select id into strict v_account from public.staff_accounts
  where staff_id = v_staff.id::text and active;

  if exists (
    select 1 from public.biometric_staff_mapping m
    where m.provider = v_provider and m.biometric_user_id = v_code
      and m.device_id in (v_device, '*') and m.staff_id is distinct from v_staff.id
  ) or exists (
    select 1 from public.biometric_employee_scope e
    where e.provider = v_provider and e.biometric_user_id = v_code
      and (e.in_scope is distinct from true or e.canonical_branch is distinct from v_staff.branch)
  ) then
    raise exception 'conflicting_shokry_319_mapping';
  end if;

  insert into public.biometric_employee_scope
    (provider, biometric_user_id, source_branch, canonical_branch, in_scope, source_note)
  values (v_provider, v_code, v_staff.branch, v_staff.branch, true, 'Confirmed Shokry terminal mapping')
  on conflict (provider, biometric_user_id) do nothing;

  insert into public.biometric_staff_mapping
    (provider, device_id, biometric_user_id, staff_account_id, staff_id, branch, active)
  values (v_provider, v_device, v_code, v_account, v_staff.id, v_staff.branch, true)
  on conflict (provider, device_id, biometric_user_id) do update
    set active = true, staff_account_id = excluded.staff_account_id, updated_at = now()
    where biometric_staff_mapping.staff_id = excluded.staff_id;

  for v_log in
    select b.* from public.biometric_attendance_logs b
    where b.provider = v_provider and b.device_id::text = v_device
      and b.biometric_user_id = v_code and b.staff_id is null
    order by b.punch_time, b.id for update
  loop
    if exists (select 1 from public.staff_attendance_logs a where a.biometric_source_log_id = v_log.id)
       or exists (select 1 from public.biometric_semantic_decisions d where d.biometric_log_id = v_log.id) then
      raise exception 'existing_shokry_319_decision';
    end if;

    update public.biometric_attendance_logs
    set staff_id = v_staff.id, staff_name_snapshot = v_staff.name
    where id = v_log.id;

    v_raw_type := case lower(trim(coalesce(v_log.punch_type, '')))
      when 'check_in' then 'check_in' when 'in' then 'check_in'
      when 'check_out' then 'check_out' when 'out' then 'check_out' end;
    v_decision := public.dawaa_biometric_semantic_decision_v1(v_staff.id, v_log.punch_time, v_raw_type, v_log.id);
    v_type := nullif(v_decision->>'semantic_type', '');
    v_shift_date := coalesce((v_decision->>'schedule_date')::date,
      (v_log.punch_time at time zone 'Africa/Cairo')::date);
    v_status := case
      when v_decision->>'decision' = 'duplicate' then 'rejected'
      when v_decision->>'decision' = 'accepted' and v_type in ('check_in', 'check_out')
        and (v_decision->>'confidence')::numeric >= 0.75 then 'accepted'
      else 'manual_review'
    end;

    insert into public.biometric_semantic_decisions
      (biometric_log_id, staff_id, raw_type, semantic_type, decision, confidence, reason,
       schedule_date, scheduled_start_at, scheduled_end_at, duplicate_of_log_id)
    values (v_log.id, v_staff.id, v_raw_type, v_type, coalesce(v_decision->>'decision', 'review'),
      (v_decision->>'confidence')::numeric, v_decision->>'reason', (v_decision->>'schedule_date')::date,
      (v_decision->>'scheduled_start_at')::timestamptz, (v_decision->>'scheduled_end_at')::timestamptz,
      (v_decision->>'duplicate_of_log_id')::uuid);

    insert into public.staff_attendance_logs
      (staff_id, staff_name, role, branch_name, attendance_type, recorded_at, shift_date,
       biometric_verified, biometric_method, device_id, status, rejection_reason, biometric_source_log_id)
    values (v_staff.id, v_staff.name, v_staff.role, v_staff.branch, coalesce(v_type, v_raw_type, 'check_in'),
      v_log.punch_time, v_shift_date, true, 'fingerprint_terminal', v_device, v_status,
      case when v_status <> 'accepted' then v_decision->>'reason' end, v_log.id);
  end loop;
end $$;
