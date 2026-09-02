create table if not exists public.biometric_employee_scope (
  provider text not null,
  biometric_user_id text not null,
  source_branch text,
  canonical_branch text,
  in_scope boolean not null default false,
  source_note text,
  updated_at timestamptz not null default now(),
  primary key(provider, biometric_user_id)
);

revoke all on table public.biometric_employee_scope from public, anon, authenticated;
grant all on table public.biometric_employee_scope to service_role;

insert into public.biometric_employee_scope(provider,biometric_user_id,source_branch,canonical_branch,in_scope,source_note)
values
('fingerprint_vendor_primary','165','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','171','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','176','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','179','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','181','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','182','بسيسه',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','185','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','186','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','188','بسيسه',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','195','المنشية',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','196','زكريا',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','197','زكريا',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','198','بسيسه',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','205','زكريا',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','207','المنشية',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','211','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','213','بسيسه',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','214','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','215','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','216','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','224','بسيسه',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','225','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','226','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','227','المنشية',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','230','المنشية',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','232','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','234','المنشية',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','236','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','237','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','238','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','239','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','241','بسيسه',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','243','بسيسه',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','245','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','246','المنشية',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','250','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','256','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','258','زكريا',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','263','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','265','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','267','زكريا',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','272','المنشية',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','273','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','274','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','278','زكريا',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','279','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','281','المنشية',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','282','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','283','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','285','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','286','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','287','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','290','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','291','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','293','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','294','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','295','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','296','الشامي','فرع الشامي',true,'vendor monthly summary 2026-08-26 to 2026-09-25'),
('fingerprint_vendor_primary','299','المنشية',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','301','زكريا',null,false,'outside Dawaa shamy/shokry scope'),
('fingerprint_vendor_primary','302','شكري القوائم','فرع شكري',true,'vendor monthly summary 2026-08-26 to 2026-09-25')
on conflict(provider,biometric_user_id) do update set source_branch=excluded.source_branch,canonical_branch=excluded.canonical_branch,in_scope=excluded.in_scope,source_note=excluded.source_note,updated_at=now();

create or replace function public.list_unmapped_biometric_staff_v1(p_limit integer default 100)
returns table(provider text,biometric_user_id text,source_name text,raw_rows bigint,semantic_events bigint,first_event timestamptz,last_event timestamptz)
language plpgsql stable security definer set search_path=public,pg_catalog
as $$
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then raise exception 'not authorized to manage biometric mapping'; end if;
  return query
  select b.provider,b.biometric_user_id,max(nullif(trim(b.staff_name_snapshot),'')),count(*)::bigint,
    count(distinct concat_ws('|',b.biometric_user_id,coalesce(b.raw_payload->>'event_time',b.punch_time::text),lower(trim(coalesce(b.punch_type,'')))))::bigint,
    min(public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)),
    max(public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time))
  from public.biometric_attendance_logs b
  join public.biometric_employee_scope sc on sc.provider=b.provider and sc.biometric_user_id=b.biometric_user_id and sc.in_scope=true
  where b.staff_id is null and nullif(trim(b.biometric_user_id),'') is not null
    and not exists (select 1 from public.biometric_staff_mapping m where m.active=true and m.provider=b.provider and m.biometric_user_id=b.biometric_user_id and (m.device_id='*' or m.device_id=coalesce(b.device_id::text,'*')))
  group by b.provider,b.biometric_user_id
  order by max(public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)) desc,count(*) desc
  limit greatest(1,least(coalesce(p_limit,100),500));
end;
$$;

create or replace function public.list_biometric_mapping_staff_candidates_v1(p_search text default '',p_limit integer default 30)
returns table(staff_account_id uuid,staff_id uuid,staff_name text,branch text,role text)
language plpgsql stable security definer set search_path=public,pg_catalog
as $$
declare v_q text:=trim(coalesce(p_search,''));
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then raise exception 'not authorized to manage biometric mapping'; end if;
  return query
  select a.id,s.id,s.name,s.branch,coalesce(nullif(s.role,''),a.role)
  from public.staff_accounts a
  join public.staff s on trim(coalesce(a.staff_id,'')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and s.id=trim(a.staff_id)::uuid
  where coalesce(a.active,a.is_active,true)=true and coalesce(s.active,false)=true
    and s.branch in ('فرع الشامي','فرع شكري')
    and (v_q='' or s.name ilike '%'||v_q||'%' or coalesce(a.staff_name,a.name,a.username,'') ilike '%'||v_q||'%' or coalesce(s.branch,'') ilike '%'||v_q||'%')
  order by case when v_q<>'' and lower(trim(s.name))=lower(v_q) then 0 else 1 end,s.name
  limit greatest(1,least(coalesce(p_limit,30),100));
end;
$$;

create or replace function public.assign_biometric_staff_mapping_v1(p_provider text,p_biometric_user_id text,p_staff_account_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog
as $$
declare v_account public.staff_accounts%rowtype; v_staff public.staff%rowtype; v_scope public.biometric_employee_scope%rowtype; v_updated integer:=0; v_inserted integer:=0;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then raise exception 'not authorized to manage biometric mapping'; end if;
  if nullif(trim(p_provider),'') is null or nullif(trim(p_biometric_user_id),'') is null then raise exception 'provider and biometric user id are required'; end if;
  select * into v_scope from public.biometric_employee_scope sc where sc.provider=trim(p_provider) and sc.biometric_user_id=trim(p_biometric_user_id) limit 1;
  if v_scope.provider is null or not v_scope.in_scope then raise exception 'biometric employee is outside shamy/shokry scope'; end if;
  select * into v_account from public.staff_accounts a where a.id=p_staff_account_id and coalesce(a.active,a.is_active,true)=true limit 1;
  if v_account.id is null then raise exception 'active staff account not found'; end if;
  if not (trim(coalesce(v_account.staff_id,'')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then raise exception 'selected account is not linked to canonical staff'; end if;
  select * into v_staff from public.staff s where s.id=trim(v_account.staff_id)::uuid and coalesce(s.active,false)=true limit 1;
  if v_staff.id is null then raise exception 'canonical active staff not found'; end if;
  if v_staff.branch not in ('فرع الشامي','فرع شكري') then raise exception 'selected employee is outside shamy/shokry scope'; end if;
  if v_scope.canonical_branch is not null and v_staff.branch<>v_scope.canonical_branch then raise exception 'selected employee branch does not match vendor branch scope'; end if;
  insert into public.biometric_staff_mapping(provider,device_id,biometric_user_id,staff_account_id,branch,active,updated_at)
  values(trim(p_provider),'*',trim(p_biometric_user_id),v_account.id,v_staff.branch,true,now())
  on conflict(provider,device_id,biometric_user_id) do update set staff_account_id=excluded.staff_account_id,branch=excluded.branch,active=true,updated_at=now();
  update public.biometric_attendance_logs b
  set staff_id=v_staff.id,branch=v_staff.branch,punch_time=public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
  where b.provider=trim(p_provider) and b.biometric_user_id=trim(p_biometric_user_id);
  get diagnostics v_updated=row_count;
  with semantic as (
    select distinct on (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time),lower(trim(coalesce(b.punch_type,''))))
      b.id,public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) effective_time,
      case lower(trim(coalesce(b.punch_type,''))) when 'check_in' then 'check_in' when 'in' then 'check_in' when 'check_out' then 'check_out' when 'out' then 'check_out' else null end attendance_type,
      b.device_id::text terminal_id
    from public.biometric_attendance_logs b where b.provider=trim(p_provider) and b.biometric_user_id=trim(p_biometric_user_id)
    order by public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time),lower(trim(coalesce(b.punch_type,''))),b.ingested_at,b.id
  )
  insert into public.staff_attendance_logs(staff_id,staff_name,role,branch_name,attendance_type,recorded_at,shift_date,biometric_verified,biometric_method,device_id,status,biometric_source_log_id)
  select v_staff.id,v_staff.name,coalesce(nullif(v_staff.role,''),v_account.role),v_staff.branch,s.attendance_type,s.effective_time,(s.effective_time at time zone 'Africa/Cairo')::date,true,'fingerprint_terminal',s.terminal_id,'accepted',s.id
  from semantic s where s.attendance_type is not null and s.effective_time is not null
    and not exists (select 1 from public.staff_attendance_logs l where l.staff_id=v_staff.id and l.attendance_type=s.attendance_type and l.recorded_at=s.effective_time and l.biometric_method='fingerprint_terminal')
  on conflict(biometric_source_log_id) where biometric_source_log_id is not null do nothing;
  get diagnostics v_inserted=row_count;
  return jsonb_build_object('ok',true,'provider',trim(p_provider),'biometric_user_id',trim(p_biometric_user_id),'staff_id',v_staff.id,'staff_name',v_staff.name,'branch',v_staff.branch,'raw_rows_mapped',v_updated,'attendance_events_added',v_inserted);
end;
$$;

create or replace function public.attendance_sync_health_v1()
returns jsonb language plpgsql stable security definer set search_path=public,pg_catalog
as $$
declare v_actor public.staff_accounts%rowtype; v_role text; v_result jsonb;
begin
  select * into v_actor from public.staff_accounts sa where sa.id=public.dawaa_current_staff_account_id_strict() and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;
  if not found then raise exception using errcode='42501',message='active staff actor required'; end if;
  v_role:=lower(trim(coalesce(v_actor.role,'')));
  if v_role not in ('general_manager','executive_manager','branches_manager') then raise exception using errcode='42501',message='attendance sync health permission required'; end if;
  select jsonb_build_object(
    'raw_events',count(*) filter(where sc.in_scope=true),
    'mapped_events',count(*) filter(where sc.in_scope=true and b.staff_id is not null),
    'unmapped_events',count(*) filter(where sc.in_scope=true and b.staff_id is null),
    'out_of_scope_events',count(*) filter(where sc.in_scope=false),
    'unknown_scope_events',count(*) filter(where sc.provider is null),
    'last_ingested_at',max(b.ingested_at) filter(where sc.in_scope=true),
    'last_punch_time',max(b.punch_time) filter(where sc.in_scope=true),
    'events_last_24h',count(*) filter(where sc.in_scope=true and b.ingested_at>=now()-interval '24 hours'),
    'unmapped_last_24h',count(*) filter(where sc.in_scope=true and b.ingested_at>=now()-interval '24 hours' and b.staff_id is null),
    'provider_count',count(distinct b.provider) filter(where sc.in_scope=true)
  ) into v_result
  from public.biometric_attendance_logs b
  left join public.biometric_employee_scope sc on sc.provider=b.provider and sc.biometric_user_id=b.biometric_user_id;
  return coalesce(v_result,'{}'::jsonb);
end;
$$;
