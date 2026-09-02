create or replace function public.dawaa_can_manage_biometric_mapping_v1()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.staff_accounts a
    where a.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(a.active, a.is_active, true) = true
      and coalesce(a.can_login, true) = true
      and a.role in ('general_manager','executive_manager','branches_manager')
  );
$$;
revoke all on function public.dawaa_can_manage_biometric_mapping_v1() from public;
grant execute on function public.dawaa_can_manage_biometric_mapping_v1() to anon, authenticated, service_role;

create or replace function public.dawaa_fingerprint_effective_time_v1(p_provider text,p_raw_payload jsonb,p_punch_time timestamptz)
returns timestamptz
language sql
stable
set search_path = public, pg_catalog
as $$
  select case
    when p_provider = 'fingerprint_vendor_primary'
      and coalesce(p_raw_payload->>'event_time','') ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$'
    then (p_raw_payload->>'event_time')::timestamp at time zone 'Africa/Cairo'
    else p_punch_time
  end;
$$;

create or replace function public.list_unmapped_biometric_staff_v1(p_limit integer default 100)
returns table(provider text,biometric_user_id text,source_name text,raw_rows bigint,semantic_events bigint,first_event timestamptz,last_event timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then raise exception 'not authorized to manage biometric mapping'; end if;
  return query
  select b.provider,b.biometric_user_id,max(nullif(trim(b.staff_name_snapshot),'')),count(*)::bigint,
    count(distinct concat_ws('|',b.biometric_user_id,coalesce(b.raw_payload->>'event_time',b.punch_time::text),lower(trim(coalesce(b.punch_type,'')))))::bigint,
    min(public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)),
    max(public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time))
  from public.biometric_attendance_logs b
  where b.staff_id is null and nullif(trim(b.biometric_user_id),'') is not null
    and not exists (select 1 from public.biometric_staff_mapping m where m.active=true and m.provider=b.provider and m.biometric_user_id=b.biometric_user_id and (m.device_id='*' or m.device_id=coalesce(b.device_id::text,'*')))
  group by b.provider,b.biometric_user_id
  order by max(public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)) desc,count(*) desc
  limit greatest(1,least(coalesce(p_limit,100),500));
end;
$$;
revoke all on function public.list_unmapped_biometric_staff_v1(integer) from public;
grant execute on function public.list_unmapped_biometric_staff_v1(integer) to anon, authenticated, service_role;

create or replace function public.list_biometric_mapping_staff_candidates_v1(p_search text default '',p_limit integer default 30)
returns table(staff_account_id uuid,staff_id uuid,staff_name text,branch text,role text)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare v_q text:=trim(coalesce(p_search,''));
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then raise exception 'not authorized to manage biometric mapping'; end if;
  return query
  select a.id,s.id,s.name,s.branch,coalesce(nullif(s.role,''),a.role)
  from public.staff_accounts a
  join public.staff s on trim(coalesce(a.staff_id,'')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and s.id=trim(a.staff_id)::uuid
  where coalesce(a.active,a.is_active,true)=true and coalesce(s.active,false)=true
    and (v_q='' or s.name ilike '%'||v_q||'%' or coalesce(a.staff_name,a.name,a.username,'') ilike '%'||v_q||'%' or coalesce(s.branch,'') ilike '%'||v_q||'%')
  order by case when v_q<>'' and lower(trim(s.name))=lower(v_q) then 0 else 1 end,s.name
  limit greatest(1,least(coalesce(p_limit,30),100));
end;
$$;
revoke all on function public.list_biometric_mapping_staff_candidates_v1(text,integer) from public;
grant execute on function public.list_biometric_mapping_staff_candidates_v1(text,integer) to anon, authenticated, service_role;

create or replace function public.assign_biometric_staff_mapping_v1(p_provider text,p_biometric_user_id text,p_staff_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_account public.staff_accounts%rowtype; v_staff public.staff%rowtype; v_updated integer:=0; v_inserted integer:=0;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then raise exception 'not authorized to manage biometric mapping'; end if;
  if nullif(trim(p_provider),'') is null or nullif(trim(p_biometric_user_id),'') is null then raise exception 'provider and biometric user id are required'; end if;
  select * into v_account from public.staff_accounts a where a.id=p_staff_account_id and coalesce(a.active,a.is_active,true)=true limit 1;
  if v_account.id is null then raise exception 'active staff account not found'; end if;
  if not (trim(coalesce(v_account.staff_id,'')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then raise exception 'selected account is not linked to canonical staff'; end if;
  select * into v_staff from public.staff s where s.id=trim(v_account.staff_id)::uuid and coalesce(s.active,false)=true limit 1;
  if v_staff.id is null then raise exception 'canonical active staff not found'; end if;
  insert into public.biometric_staff_mapping(provider,device_id,biometric_user_id,staff_account_id,branch,active,updated_at)
  values(trim(p_provider),'*',trim(p_biometric_user_id),v_account.id,v_staff.branch,true,now())
  on conflict(provider,device_id,biometric_user_id) do update set staff_account_id=excluded.staff_account_id,branch=excluded.branch,active=true,updated_at=now();
  update public.biometric_attendance_logs b
  set staff_id=v_staff.id,branch=coalesce(v_staff.branch,b.branch),punch_time=public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
  where b.provider=trim(p_provider) and b.biometric_user_id=trim(p_biometric_user_id);
  get diagnostics v_updated=row_count;
  with semantic as (
    select distinct on (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time),lower(trim(coalesce(b.punch_type,''))))
      b.id,public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) effective_time,
      case lower(trim(coalesce(b.punch_type,''))) when 'check_in' then 'check_in' when 'in' then 'check_in' when 'check_out' then 'check_out' when 'out' then 'check_out' else null end attendance_type,
      b.device_id::text terminal_id
    from public.biometric_attendance_logs b
    where b.provider=trim(p_provider) and b.biometric_user_id=trim(p_biometric_user_id)
    order by public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time),lower(trim(coalesce(b.punch_type,''))),b.ingested_at,b.id
  )
  insert into public.staff_attendance_logs(staff_id,staff_name,role,branch_name,attendance_type,recorded_at,shift_date,biometric_verified,biometric_method,device_id,status,biometric_source_log_id)
  select v_staff.id,v_staff.name,coalesce(nullif(v_staff.role,''),v_account.role),v_staff.branch,s.attendance_type,s.effective_time,(s.effective_time at time zone 'Africa/Cairo')::date,true,'fingerprint_terminal',s.terminal_id,'accepted',s.id
  from semantic s
  where s.attendance_type is not null and s.effective_time is not null
    and not exists (select 1 from public.staff_attendance_logs l where l.staff_id=v_staff.id and l.attendance_type=s.attendance_type and l.recorded_at=s.effective_time and l.biometric_method='fingerprint_terminal')
  on conflict(biometric_source_log_id) where biometric_source_log_id is not null do nothing;
  get diagnostics v_inserted=row_count;
  return jsonb_build_object('ok',true,'provider',trim(p_provider),'biometric_user_id',trim(p_biometric_user_id),'staff_id',v_staff.id,'staff_name',v_staff.name,'branch',v_staff.branch,'raw_rows_mapped',v_updated,'attendance_events_added',v_inserted);
end;
$$;
revoke all on function public.assign_biometric_staff_mapping_v1(text,text,uuid) from public;
grant execute on function public.assign_biometric_staff_mapping_v1(text,text,uuid) to anon, authenticated, service_role;

-- Future raw events use the generalized Cairo-time helper and semantic de-duplication.
create or replace function public.dawaa_promote_biometric_attendance_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_map record; v_account public.staff_accounts%rowtype; v_type text; v_account_id uuid; v_subject_id uuid; v_branch text:=new.branch; v_device_key text:=coalesce(new.device_id::text,'*'); v_staff_id_text text; v_effective_punch_time timestamptz:=public.dawaa_fingerprint_effective_time_v1(new.provider,new.raw_payload,new.punch_time);
begin
  if new.staff_id is not null then select a.* into v_account from public.staff_accounts a where a.id=new.staff_id or trim(coalesce(a.staff_id,''))=new.staff_id::text order by (a.id=new.staff_id) desc limit 1; end if;
  if v_account.id is null and nullif(trim(new.biometric_user_id),'') is not null then
    select m.staff_account_id,m.branch into v_map from public.biometric_staff_mapping m where m.active=true and m.provider=new.provider and m.biometric_user_id=new.biometric_user_id and (m.device_id=v_device_key or m.device_id='*') order by (m.device_id=v_device_key) desc,m.updated_at desc limit 1;
    v_account_id:=v_map.staff_account_id; if v_branch is null then v_branch:=v_map.branch; end if;
    if v_account_id is not null then select a.* into v_account from public.staff_accounts a where a.id=v_account_id limit 1; end if;
  end if;
  if v_account.id is null and nullif(trim(new.biometric_user_id),'') is not null then select a.* into v_account from public.staff_accounts a where coalesce(a.active,a.is_active,true)=true and trim(coalesce(a.staff_id,''))=trim(new.biometric_user_id) limit 1; end if;
  if v_account.id is null then return null; end if;
  v_staff_id_text:=nullif(trim(coalesce(v_account.staff_id,'')),'');
  if v_staff_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then v_subject_id:=v_staff_id_text::uuid;
  else select (array_agg(s.id order by s.id))[1] into v_subject_id from public.staff s where coalesce(s.active,false)=true and trim(coalesce(s.branch,''))=trim(coalesce(v_account.branch,'')) and lower(trim(coalesce(s.name,'')))=lower(trim(coalesce(v_account.staff_name,v_account.name,''))) having count(*)=1; end if;
  if v_subject_id is null then v_subject_id:=v_account.id; end if;
  select coalesce(nullif(s.branch,''),v_branch,v_account.branch),coalesce(nullif(s.name,''),v_account.staff_name,v_account.name,v_account.username) into v_branch,v_staff_id_text from public.staff s where s.id=v_subject_id limit 1;
  v_branch:=coalesce(v_branch,v_account.branch);
  update public.biometric_attendance_logs set staff_id=v_subject_id,staff_name_snapshot=coalesce(nullif(staff_name_snapshot,''),v_staff_id_text),branch=coalesce(v_branch,branch),punch_time=v_effective_punch_time where id=new.id;
  v_type:=case lower(trim(coalesce(new.punch_type,''))) when 'check_in' then 'check_in' when 'in' then 'check_in' when 'check_out' then 'check_out' when 'out' then 'check_out' else null end;
  if v_type is not null and v_effective_punch_time is not null and not exists (select 1 from public.staff_attendance_logs l where l.staff_id=v_subject_id and l.attendance_type=v_type and l.recorded_at=v_effective_punch_time and l.biometric_method='fingerprint_terminal') then
    insert into public.staff_attendance_logs(staff_id,staff_name,role,branch_name,attendance_type,recorded_at,shift_date,biometric_verified,biometric_method,device_id,status,biometric_source_log_id)
    values(v_subject_id,v_staff_id_text,v_account.role,v_branch,v_type,v_effective_punch_time,(v_effective_punch_time at time zone 'Africa/Cairo')::date,true,'fingerprint_terminal',new.device_id::text,'accepted',new.id)
    on conflict(biometric_source_log_id) where biometric_source_log_id is not null do nothing;
  end if;
  return null;
end;
$$;
