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
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception 'not authorized to manage biometric mapping';
  end if;

  select * into v_staff
  from public.staff s
  where s.id=p_staff_id and coalesce(s.active,false)=true
  limit 1;

  if v_staff.id is null then raise exception 'canonical active staff not found'; end if;
  if v_staff.branch not in ('فرع الشامي','فرع شكري') then
    raise exception 'selected staff is outside Dawaa attendance scope';
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
      coalesce(v_source_branch,v_staff.branch),
      v_staff.branch,
      true,
      'ربط يدوي: source_branch=مكان الجهاز، canonical_branch=فرع الموظف',
      now()
    )
    returning * into v_scope;
  elsif coalesce(v_scope.in_scope,false)=false then
    raise exception 'biometric employee is outside Dawaa attendance scope';
  else
    update public.biometric_employee_scope
    set canonical_branch=v_staff.branch,
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
    trim(p_provider),'*',trim(p_biometric_user_id),v_account_id,v_staff.id,v_staff.branch,true,now()
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
      v_staff.id,v_staff.name,v_staff.role,v_staff.branch,
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
      and trim(v_scope.source_branch)<>trim(v_staff.branch),
    'raw_rows_mapped',v_updated,
    'attendance_events_processed',v_inserted
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.attendance_daily_intelligence_v2(p_date date DEFAULT ((now() AT TIME ZONE 'Africa/Cairo'::text))::date, p_branch text DEFAULT NULL::text)
 RETURNS TABLE(staff_id uuid, staff_name text, role text, branch text, raw_events integer, effective_events integer, duplicate_events integer, corrected_type_events integer, review_events integer, first_effective_at timestamp with time zone, last_effective_at timestamp with time zone, avg_confidence numeric, intelligence_status text, timeline jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
with scoped_staff as (
  select s.id,s.name,s.role,s.branch
  from public.staff s
  where coalesce(s.active,false)=true
    and s.branch in ('فرع الشامي','فرع شكري')
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or s.branch=p_branch)
    and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
),
ev as (
  select
    b.id,
    b.staff_id,
    public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) event_at,
    lower(trim(coalesce(b.punch_type,''))) raw_type,
    d.semantic_type,
    d.decision,
    d.confidence,
    d.reason,
    d.duplicate_of_log_id,
    coalesce(
      d.schedule_date,
      (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) at time zone 'Africa/Cairo')::date
    ) work_date,
    b.device_id,
    b.provider,
    public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch) source_branch
  from public.biometric_attendance_logs b
  left join public.biometric_semantic_decisions d on d.biometric_log_id=b.id
  where b.staff_id is not null
),
grouped as (
  select
    s.id staff_id,
    s.name staff_name,
    s.role,
    s.branch,
    count(e.id)::int raw_events,
    count(e.id) filter(where coalesce(e.decision,'accepted')='accepted')::int effective_events,
    count(e.id) filter(where e.decision='duplicate')::int duplicate_events,
    count(e.id) filter(
      where e.decision='accepted' and e.semantic_type is not null and e.semantic_type<>e.raw_type
    )::int corrected_type_events,
    count(e.id) filter(
      where e.decision in ('review','manual_review') or coalesce(e.confidence,1)<0.75
    )::int review_events,
    min(e.event_at) filter(where coalesce(e.decision,'accepted')='accepted') first_effective_at,
    max(e.event_at) filter(where coalesce(e.decision,'accepted')='accepted') last_effective_at,
    round(avg(e.confidence) filter(where e.confidence is not null),2) avg_confidence,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id',e.id,
        'time',e.event_at,
        'raw_type',e.raw_type,
        'semantic_type',e.semantic_type,
        'decision',coalesce(e.decision,'accepted'),
        'confidence',e.confidence,
        'reason',e.reason,
        'duplicate_of',e.duplicate_of_log_id,
        'device_id',e.device_id,
        'provider',e.provider,
        'source_branch',e.source_branch,
        'home_branch',s.branch,
        'cross_branch',
          nullif(trim(coalesce(e.source_branch,'')),'') is not null
          and trim(e.source_branch)<>trim(s.branch)
      ) order by e.event_at,e.id
    ) filter(where e.id is not null),'[]'::jsonb) timeline
  from scoped_staff s
  left join ev e on e.staff_id=s.id and e.work_date=p_date
  group by s.id,s.name,s.role,s.branch
)
select
  g.staff_id,g.staff_name,g.role,g.branch,g.raw_events,g.effective_events,g.duplicate_events,
  g.corrected_type_events,g.review_events,g.first_effective_at,g.last_effective_at,g.avg_confidence,
  case
    when g.review_events>0 then 'needs_review'
    when g.duplicate_events>0 or g.corrected_type_events>0 then 'smart_corrected'
    when g.effective_events>0 then 'clean'
    else 'no_events'
  end,
  g.timeline
from grouped g
where g.raw_events>0
order by g.branch,g.staff_name;
$function$


CREATE OR REPLACE FUNCTION public.attendance_review_triage_v1(p_start date, p_end date, p_branch text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
with pending as (
  select
    a.staff_id,a.attendance_date,a.status,a.resolution_status,
    a.scheduled_start_at,a.scheduled_end_at,
    s.name staff_name,s.branch home_branch
  from public.attendance_daily_summary a
  join public.staff s on s.id=a.staff_id
  where a.attendance_date between p_start and p_end
    and a.status='pending_review'
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
    and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
),
raw_counts as (
  select
    p.*,
    count(b.id)::int raw_events,
    min(b.punch_time) first_raw,
    max(b.punch_time) last_raw
  from pending p
  left join public.biometric_attendance_logs b
    on b.staff_id=p.staff_id
   and (
     (p.scheduled_start_at is not null and p.scheduled_end_at is not null
      and b.punch_time between p.scheduled_start_at-interval '4 hours'
                           and p.scheduled_end_at+interval '6 hours')
     or
     ((p.scheduled_start_at is null or p.scheduled_end_at is null)
      and (b.punch_time at time zone 'Africa/Cairo')::date between p.attendance_date and p.attendance_date+1)
   )
  group by
    p.staff_id,p.attendance_date,p.status,p.resolution_status,
    p.scheduled_start_at,p.scheduled_end_at,p.staff_name,p.home_branch
),
classified as (
  select *,
    case
      when resolution_status in ('no_schedule','invalid_schedule_time','schedule_conflict') then 'schedule_issue'
      when resolution_status in ('missing_checkin','missing_checkout','absence_review') and raw_events=0 then 'true_no_punch'
      when resolution_status in ('missing_checkin','missing_checkout','absence_review') and raw_events=1 then 'single_punch'
      when resolution_status in ('missing_checkin','missing_checkout','absence_review')
        and raw_events>=2
        and first_raw is not null and last_raw is not null
        and extract(epoch from(last_raw-first_raw))/3600.0 between 0.5 and 18
        then 'system_pairable'
      when resolution_status in ('missing_checkin','missing_checkout','absence_review') and raw_events>=2
        then 'system_interpretation'
      else 'manager_review'
    end cause
  from raw_counts
),
unmapped as (
  select
    count(*)::int unmapped_events,
    count(distinct b.biometric_user_id)::int unmapped_codes
  from public.biometric_attendance_logs b
  where b.staff_id is null
    and (b.punch_time at time zone 'Africa/Cairo')::date between p_start and p_end
    and (
      p_branch is null or trim(p_branch)='' or p_branch='الكل'
      or trim(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch))=trim(p_branch)
    )
),
cross_branch as (
  select
    count(*)::int cross_events,
    count(distinct b.staff_id)::int cross_staff
  from public.biometric_attendance_logs b
  join public.staff s on s.id=b.staff_id
  where (b.punch_time at time zone 'Africa/Cairo')::date between p_start and p_end
    and nullif(trim(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch)),'') is not null
    and nullif(trim(s.branch),'') is not null
    and trim(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch))<>trim(s.branch)
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
)
select jsonb_build_object(
  'total_pending',count(*),
  'needs_manager_decision',count(*) filter(
    where cause in ('true_no_punch','single_punch','manager_review','schedule_issue')
  ),
  'true_no_punch',count(*) filter(where cause='true_no_punch'),
  'single_punch',count(*) filter(where cause='single_punch'),
  'system_pairable',count(*) filter(where cause='system_pairable'),
  'system_interpretation',count(*) filter(where cause='system_interpretation'),
  'schedule_issues',count(*) filter(where cause='schedule_issue'),
  'unmapped_active_codes',(select unmapped_codes from unmapped),
  'unmapped_events',(select unmapped_events from unmapped),
  'cross_branch_events',(select cross_events from cross_branch),
  'cross_branch_staff',(select cross_staff from cross_branch),
  'generated_at',now()
)
from classified;
$function$


CREATE OR REPLACE FUNCTION public.dawaa_biometric_source_branch_v1(p_raw_payload jsonb, p_fallback_branch text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select nullif(trim(coalesce(p_raw_payload->>'branch',p_fallback_branch,'')),'');
$function$


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
$function$


CREATE OR REPLACE FUNCTION public.list_biometric_event_log_v1(p_branch text DEFAULT NULL::text, p_mapping_status text DEFAULT NULL::text, p_search text DEFAULT ''::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, provider text, external_event_id text, biometric_user_id text, staff_id uuid, staff_name text, branch text, punch_time timestamp with time zone, punch_type text, ingested_at timestamp with time zone, ingestion_lag_seconds integer, mapping_status text, device_id uuid, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_branch text:=nullif(trim(coalesce(p_branch,'')),'');
  v_status text:=lower(nullif(trim(coalesce(p_mapping_status,'')),''));
  v_search text:=trim(coalesce(p_search,''));
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception using errcode='42501',message='not authorized to view biometric operations';
  end if;

  return query
  select
    b.id,
    b.provider,
    b.external_event_id,
    b.biometric_user_id,
    b.staff_id,
    coalesce(nullif(trim(s.name),''),nullif(trim(b.staff_name_snapshot),''),'غير مربوط'),
    public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch),
    public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time),
    b.punch_type,
    b.ingested_at,
    case
      when b.ingested_at is null
        or public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) is null
      then null
      else greatest(
        0,
        extract(epoch from(
          b.ingested_at-public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
        ))::int
      )
    end,
    case when b.staff_id is null then 'unmapped' else 'mapped' end,
    b.device_id,
    count(*) over()
  from public.biometric_attendance_logs b
  left join public.staff s on s.id=b.staff_id
  where (
      v_branch is null
      or trim(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch))=v_branch
    )
    and (
      v_status is null
      or (v_status='mapped' and b.staff_id is not null)
      or (v_status='unmapped' and b.staff_id is null)
    )
    and (
      v_search=''
      or coalesce(b.biometric_user_id,'') ilike '%'||v_search||'%'
      or coalesce(b.staff_name_snapshot,'') ilike '%'||v_search||'%'
      or coalesce(s.name,'') ilike '%'||v_search||'%'
      or coalesce(b.external_event_id,'') ilike '%'||v_search||'%'
    )
  order by b.ingested_at desc nulls last,b.id desc
  limit greatest(1,least(coalesce(p_limit,100),200))
  offset greatest(0,coalesce(p_offset,0));
end;
$function$


CREATE OR REPLACE FUNCTION public.list_unmapped_biometric_staff_v2(p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_limit integer DEFAULT 100)
 RETURNS TABLE(provider text, biometric_user_id text, source_name text, source_branch text, raw_rows bigint, cycle_rows bigint, first_event timestamp with time zone, last_event timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_today date:=(now() at time zone 'Africa/Cairo')::date;
  v_start date:=p_start;
  v_end date:=coalesce(p_end,v_today);
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception 'not authorized to manage biometric mapping';
  end if;

  if v_start is null then
    v_start:=case
      when extract(day from v_today)::int>=26
        then make_date(extract(year from v_today)::int,extract(month from v_today)::int,26)
      else (date_trunc('month',v_today)-interval '1 month')::date+25
    end;
  end if;

  return query
  select
    b.provider,
    b.biometric_user_id,
    max(nullif(trim(b.staff_name_snapshot),'')),
    max(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch)),
    count(*)::bigint,
    count(*) filter(
      where (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
        at time zone 'Africa/Cairo')::date between v_start and v_end
    )::bigint,
    min(public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)),
    max(public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time))
  from public.biometric_attendance_logs b
  left join public.biometric_employee_scope sc
    on sc.provider=b.provider and sc.biometric_user_id=b.biometric_user_id
  where b.staff_id is null
    and nullif(trim(b.biometric_user_id),'') is not null
    and coalesce(sc.in_scope,true)=true
    and not exists (
      select 1
      from public.biometric_staff_mapping m
      where m.active=true
        and m.provider=b.provider
        and m.biometric_user_id=b.biometric_user_id
        and (m.device_id='*' or m.device_id=coalesce(b.device_id::text,'*'))
    )
  group by b.provider,b.biometric_user_id
  having count(*) filter(
    where (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
      at time zone 'Africa/Cairo')::date between v_start and v_end
  )>0
  order by
    count(*) filter(
      where (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
        at time zone 'Africa/Cairo')::date between v_start and v_end
    ) desc,
    max(public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)) desc
  limit greatest(1,least(coalesce(p_limit,100),500));
end;
$function$


update public.biometric_attendance_logs b
set branch = public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch)
where public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch) is not null
  and b.branch is distinct from public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch);

grant execute on function public.attendance_review_triage_v1(date,date,text) to anon,authenticated,service_role;
grant execute on function public.list_unmapped_biometric_staff_v2(date,date,integer) to anon,authenticated,service_role;
grant execute on function public.dawaa_biometric_source_branch_v1(jsonb,text) to anon,authenticated,service_role;
