-- A biometric promotion is a system identity. The normal login normalization
-- must never replace it with the manager who happened to run the import.
create or replace function public.dawaa_normalize_staff_attendance_log_identity_v1()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  v_account_id uuid;
  v_subject_id uuid;
  v_source_staff_id uuid;
  v_name text;
  v_role text;
  v_branch text;
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
end; $$;

-- The raw event and an active device mapping must agree before reassigning an
-- attendance row. Persist the old identity to make the correction auditable.
create table if not exists public.biometric_attendance_identity_repair_audit_v1 (
  attendance_log_id uuid primary key,
  biometric_log_id uuid not null,
  old_staff_id uuid not null,
  new_staff_id uuid not null,
  shift_date date not null,
  repaired_at timestamptz not null default now(),
  reason text not null default 'biometric source identity overwrote manager login identity'
);
alter table public.biometric_attendance_identity_repair_audit_v1 enable row level security;
revoke all on public.biometric_attendance_identity_repair_audit_v1 from public,anon,authenticated;

do $$ begin
  if exists (
    select 1 from public.staff_attendance_logs a
    join public.biometric_attendance_logs b on b.id=a.biometric_source_log_id
    join public.attendance_daily_summary d on d.staff_id=a.staff_id and d.attendance_date=a.shift_date
    where b.staff_id is not null and a.staff_id is distinct from b.staff_id
      and d.status='approved' and coalesce(d.resolution_version,0)>=2
  ) then raise exception 'approved attendance identity conflict needs manual review'; end if;
end $$;

insert into public.biometric_attendance_identity_repair_audit_v1
  (attendance_log_id,biometric_log_id,old_staff_id,new_staff_id,shift_date)
select a.id,b.id,a.staff_id,b.staff_id,a.shift_date
from public.staff_attendance_logs a
join public.biometric_attendance_logs b on b.id=a.biometric_source_log_id
join public.biometric_staff_mapping m on m.provider=b.provider
  and m.biometric_user_id=b.biometric_user_id and m.active and m.staff_id=b.staff_id
  and (m.device_id='*' or m.device_id=coalesce(b.device_id::text,'*'))
where a.staff_id is distinct from b.staff_id and b.staff_id is not null
  and a.staff_id is not null and a.shift_date is not null
on conflict(attendance_log_id) do nothing;

update public.staff_attendance_logs a
set staff_id=r.new_staff_id,
    staff_name=s.name,
    role=s.role,
    branch_name=coalesce(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch),s.branch),
    updated_at=now()
from public.biometric_attendance_identity_repair_audit_v1 r
join public.biometric_attendance_logs b on b.id=r.biometric_log_id
join public.staff s on s.id=r.new_staff_id
where a.id=r.attendance_log_id and a.staff_id=r.old_staff_id;

-- A pending summary for the mistaken employee must never keep payroll hours.
update public.attendance_daily_summary d
set payroll_eligible_hours=null,review_required=true,
    resolution_status='identity_repair_review_required',updated_at=now()
where d.status<>'approved' and exists (
  select 1 from public.biometric_attendance_identity_repair_audit_v1 r
  where r.old_staff_id=d.staff_id and r.shift_date=d.attendance_date
);

do $$ declare v_day record; begin
  for v_day in
    select distinct staff_id,shift_date from (
      select r.old_staff_id as staff_id,r.shift_date from public.biometric_attendance_identity_repair_audit_v1 r
      union all select r.new_staff_id,r.shift_date from public.biometric_attendance_identity_repair_audit_v1 r
    ) affected
    where shift_date between (now() at time zone 'Africa/Cairo')::date-45
      and (now() at time zone 'Africa/Cairo')::date+1
  loop
    perform public.dawaa_materialize_attendance_day_internal_v2(v_day.staff_id,v_day.shift_date);
  end loop;
end $$;

-- Do not let a future insert/update reintroduce a conflicting source identity.
create or replace function public.dawaa_guard_biometric_attendance_identity_v1()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_source_staff_id uuid;
begin
  if new.biometric_source_log_id is null then return new; end if;
  select b.staff_id into v_source_staff_id
  from public.biometric_attendance_logs b where b.id=new.biometric_source_log_id;
  if v_source_staff_id is null or new.staff_id is distinct from v_source_staff_id then
    raise exception 'biometric attendance staff identity does not match source';
  end if;
  return new;
end; $$;
drop trigger if exists trg_guard_biometric_attendance_identity_v1 on public.staff_attendance_logs;
create trigger trg_guard_biometric_attendance_identity_v1
  before insert or update of staff_id,biometric_source_log_id on public.staff_attendance_logs
  for each row execute function public.dawaa_guard_biometric_attendance_identity_v1();

-- Both import paths must correct an existing attendance row when a code is remapped.
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
      staff_id=excluded.staff_id,
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
$function$;

CREATE OR REPLACE FUNCTION public.dawaa_promote_biometric_attendance_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_map record;
  v_staff public.staff%rowtype;
  v_account public.staff_accounts%rowtype;
  v_raw_type text;
  v_effective timestamptz:=public.dawaa_fingerprint_effective_time_v1(new.provider,new.raw_payload,new.punch_time);
  v_decision jsonb;
  v_semantic_type text;
  v_decision_name text;
  v_conf numeric;
  v_reason text;
  v_status text;
  v_rejection text;
begin
  if new.staff_id is not null then
    select * into v_staff
    from public.staff s
    where s.id=new.staff_id and coalesce(s.active,false)=true
    limit 1;
  end if;

  if v_staff.id is null and nullif(trim(new.biometric_user_id),'') is not null then
    select m.staff_id,m.staff_account_id into v_map
    from public.biometric_staff_mapping m
    where m.active=true
      and m.provider=new.provider
      and m.biometric_user_id=new.biometric_user_id
      and (m.device_id=coalesce(new.device_id::text,'*') or m.device_id='*')
    order by (m.device_id=coalesce(new.device_id::text,'*')) desc,m.updated_at desc
    limit 1;

    if v_map.staff_id is not null then
      select * into v_staff
      from public.staff s
      where s.id=v_map.staff_id and coalesce(s.active,false)=true
      limit 1;
    end if;

    if v_staff.id is null and v_map.staff_account_id is not null then
      select * into v_account from public.staff_accounts a where a.id=v_map.staff_account_id limit 1;
      if trim(coalesce(v_account.staff_id,'')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        select * into v_staff from public.staff s
        where s.id=trim(v_account.staff_id)::uuid and coalesce(s.active,false)=true
        limit 1;
      end if;
    end if;
  end if;

  if v_staff.id is null then return null; end if;

  update public.biometric_attendance_logs
  set staff_id=v_staff.id,
      staff_name_snapshot=coalesce(nullif(staff_name_snapshot,''),v_staff.name),
      punch_time=v_effective,
      branch=public.dawaa_biometric_source_branch_v1(raw_payload,branch)
  where id=new.id;

  v_raw_type:=case lower(trim(coalesce(new.punch_type,'')))
    when 'check_in' then 'check_in' when 'in' then 'check_in'
    when 'check_out' then 'check_out' when 'out' then 'check_out'
    else null end;

  v_decision:=public.dawaa_biometric_semantic_decision_v1(v_staff.id,v_effective,v_raw_type,new.id);
  v_semantic_type:=nullif(v_decision->>'semantic_type','');
  v_decision_name:=coalesce(nullif(v_decision->>'decision',''),'review');
  v_conf:=nullif(v_decision->>'confidence','')::numeric;
  v_reason:=v_decision->>'reason';

  insert into public.biometric_semantic_decisions(
    biometric_log_id,staff_id,raw_type,semantic_type,decision,confidence,reason,
    schedule_date,scheduled_start_at,scheduled_end_at,duplicate_of_log_id,updated_at
  ) values(
    new.id,v_staff.id,v_raw_type,v_semantic_type,v_decision_name,v_conf,v_reason,
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
    v_staff.id,v_staff.name,v_staff.role,v_staff.branch,
    coalesce(v_semantic_type,v_raw_type,'check_in'),
    v_effective,
    coalesce(nullif(v_decision->>'schedule_date','')::date,(v_effective at time zone 'Africa/Cairo')::date),
    true,'fingerprint_terminal',new.device_id::text,v_status,v_rejection,new.id
  )
  on conflict (biometric_source_log_id) where biometric_source_log_id is not null
  do update set
    staff_id=excluded.staff_id,
    attendance_type=excluded.attendance_type,
    recorded_at=excluded.recorded_at,
    shift_date=excluded.shift_date,
    status=excluded.status,
    rejection_reason=excluded.rejection_reason,
    staff_name=excluded.staff_name,
    role=excluded.role,
    branch_name=excluded.branch_name,
    updated_at=now();

  return null;
end;
$function$;
