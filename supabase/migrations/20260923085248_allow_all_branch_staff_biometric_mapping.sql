-- Attribute an all-branch employee to the actual terminal branch for this mapping.
CREATE OR REPLACE FUNCTION public.assign_biometric_staff_mapping_v2(p_provider text, p_biometric_user_id text, p_staff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_staff public.staff%rowtype;
  v_account_id uuid;
  v_scope public.biometric_employee_scope%rowtype;
  v_updated integer:=0;
  v_inserted integer:=0;
  v_log record;
  v_effective timestamptz;
  v_raw_type text;
  v_decision jsonb;
  v_semantic_type text;
  v_decision_name text;
  v_conf numeric;
  v_reason text;
  v_status text;
  v_rejection text;
  v_source_branch text;
  v_employee_branch text;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception 'not authorized to manage biometric mapping';
  end if;

  select * into v_staff
  from public.staff s
  where s.id=p_staff_id and coalesce(s.active,false)=true
  limit 1;

  if v_staff.id is null then raise exception 'canonical active staff not found'; end if;
  if v_staff.branch not in ('فرع الشامي','فرع شكري','كل الفروع') then
    raise exception 'selected staff is outside Dawaa attendance scope';
  end if;

  select max(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch))
    into v_source_branch
  from public.biometric_attendance_logs b
  where b.provider=trim(p_provider) and b.biometric_user_id=trim(p_biometric_user_id);
  v_employee_branch:=case when v_staff.branch='كل الفروع'
    then v_source_branch else v_staff.branch end;
  if v_employee_branch not in ('فرع الشامي','فرع شكري') or v_employee_branch is null then
    raise exception 'source branch required for all-branch employee mapping';
  end if;

  select * into v_scope
  from public.biometric_employee_scope r
  where r.provider=trim(p_provider)
    and r.biometric_user_id=trim(p_biometric_user_id)
  limit 1;

  if not found then
    select max(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch))
      into v_source_branch
    from public.biometric_attendance_logs b
    where b.provider=trim(p_provider)
      and b.biometric_user_id=trim(p_biometric_user_id);

    insert into public.biometric_employee_scope(
      provider,biometric_user_id,source_branch,canonical_branch,in_scope,source_note,updated_at
    )
    values(
      trim(p_provider),trim(p_biometric_user_id),
      coalesce(v_source_branch,v_employee_branch),
      v_employee_branch,
      true,
      'ربط يدوي: source_branch=مكان الجهاز، canonical_branch=فرع الموظف',
      now()
    )
    returning * into v_scope;
  elsif coalesce(v_scope.in_scope,false)=false then
    raise exception 'biometric employee is outside Dawaa attendance scope';
  else
    update public.biometric_employee_scope
    set canonical_branch=v_employee_branch,
        source_note='ربط يدوي: source_branch=مكان الجهاز، canonical_branch=فرع الموظف',
        updated_at=now()
    where provider=trim(p_provider)
      and biometric_user_id=trim(p_biometric_user_id)
    returning * into v_scope;
  end if;

  select a.id into v_account_id
  from public.staff_accounts a
  where coalesce(a.active,a.is_active,true)=true
    and trim(coalesce(a.staff_id,''))=v_staff.id::text
  order by a.updated_at desc nulls last,a.id
  limit 1;

  insert into public.biometric_staff_mapping(
    provider,device_id,biometric_user_id,staff_account_id,staff_id,branch,active,updated_at
  )
  values(
    trim(p_provider),'*',trim(p_biometric_user_id),v_account_id,v_staff.id,v_employee_branch,true,now()
  )
  on conflict(provider,device_id,biometric_user_id)
  do update set
    staff_account_id=excluded.staff_account_id,
    staff_id=excluded.staff_id,
    branch=excluded.branch,
    active=true,
    updated_at=now();

  update public.biometric_attendance_logs b
  set staff_id=v_staff.id,
      staff_name_snapshot=coalesce(nullif(b.staff_name_snapshot,''),v_staff.name),
      punch_time=public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
  where b.provider=trim(p_provider)
    and b.biometric_user_id=trim(p_biometric_user_id);
  get diagnostics v_updated=row_count;

  for v_log in
    select * from public.biometric_attendance_logs bl
    where bl.provider=trim(p_provider)
      and bl.biometric_user_id=trim(p_biometric_user_id)
      and bl.staff_id=v_staff.id
    order by bl.punch_time
  loop
    v_effective:=public.dawaa_fingerprint_effective_time_v1(v_log.provider,v_log.raw_payload,v_log.punch_time);
    v_raw_type:=case lower(trim(coalesce(v_log.punch_type,'')))
      when 'check_in' then 'check_in' when 'in' then 'check_in'
      when 'check_out' then 'check_out' when 'out' then 'check_out'
      else null end;

    v_decision:=public.dawaa_biometric_semantic_decision_v1(v_staff.id,v_effective,v_raw_type,v_log.id);
    v_semantic_type:=nullif(v_decision->>'semantic_type','');
    v_decision_name:=coalesce(nullif(v_decision->>'decision',''),'review');
    v_conf:=nullif(v_decision->>'confidence','')::numeric;
    v_reason:=v_decision->>'reason';

    insert into public.biometric_semantic_decisions(
      biometric_log_id,staff_id,raw_type,semantic_type,decision,confidence,reason,
      schedule_date,scheduled_start_at,scheduled_end_at,duplicate_of_log_id,updated_at
    ) values(
      v_log.id,v_staff.id,v_raw_type,v_semantic_type,v_decision_name,v_conf,v_reason,
      nullif(v_decision->>'schedule_date','')::date,
      nullif(v_decision->>'scheduled_start_at','')::timestamptz,
      nullif(v_decision->>'scheduled_end_at','')::timestamptz,
      nullif(v_decision->>'duplicate_of_log_id','')::uuid,
      now()
    )
    on conflict (biometric_log_id) do update set
      staff_id=excluded.staff_id,
      raw_type=excluded.raw_type,
      semantic_type=excluded.semantic_type,
      decision=excluded.decision,
      confidence=excluded.confidence,
      reason=excluded.reason,
      schedule_date=excluded.schedule_date,
      scheduled_start_at=excluded.scheduled_start_at,
      scheduled_end_at=excluded.scheduled_end_at,
      duplicate_of_log_id=excluded.duplicate_of_log_id,
      updated_at=now();

    if v_decision_name='duplicate' then
      v_status:='rejected';
      v_rejection:='بصمة تأكيد مكررة خلال دقيقتين — محفوظة كسجل خام ولا تُحسب في الحضور';
    elsif v_decision_name in ('review','manual_review')
       or v_semantic_type is null
       or coalesce(v_conf,0)<0.75 then
      v_status:='manual_review';
      v_rejection:='البصمة تحتاج مراجعة ذكية قبل الاحتساب — '||coalesce(v_reason,'سبب غير محدد');
    else
      v_status:='accepted';
      v_rejection:=null;
    end if;

    insert into public.staff_attendance_logs(
      staff_id,staff_name,role,branch_name,attendance_type,recorded_at,shift_date,
      biometric_verified,biometric_method,device_id,status,rejection_reason,biometric_source_log_id
    ) values(
      v_staff.id,v_staff.name,v_staff.role,v_employee_branch,
      coalesce(v_semantic_type,v_raw_type,'check_in'),
      v_effective,
      coalesce(nullif(v_decision->>'schedule_date','')::date,(v_effective at time zone 'Africa/Cairo')::date),
      true,'fingerprint_terminal',v_log.device_id::text,v_status,v_rejection,v_log.id
    )
    on conflict (biometric_source_log_id) where biometric_source_log_id is not null
    do update set
      attendance_type=excluded.attendance_type,
      recorded_at=excluded.recorded_at,
      shift_date=excluded.shift_date,
      status=excluded.status,
      rejection_reason=excluded.rejection_reason,
      staff_name=excluded.staff_name,
      role=excluded.role,
      branch_name=excluded.branch_name,
      updated_at=now();

    v_inserted:=v_inserted+1;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'provider',trim(p_provider),
    'biometric_user_id',trim(p_biometric_user_id),
    'staff_id',v_staff.id,
    'staff_name',v_staff.name,
    'home_branch',v_staff.branch,
    'source_branch',v_scope.source_branch,
    'cross_branch_mapping',
      nullif(trim(coalesce(v_scope.source_branch,'')),'') is not null
      and trim(v_scope.source_branch)<>trim(v_employee_branch),
    'raw_rows_mapped',v_updated,
    'attendance_events_processed',v_inserted
  );
end;
$function$
