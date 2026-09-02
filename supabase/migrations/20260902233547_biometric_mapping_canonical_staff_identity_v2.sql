alter table public.biometric_staff_mapping add column if not exists staff_id uuid references public.staff(id);
alter table public.biometric_staff_mapping alter column staff_account_id drop not null;
create index if not exists idx_biometric_staff_mapping_staff_id_fk on public.biometric_staff_mapping(staff_id);

update public.biometric_staff_mapping m
set staff_id = trim(a.staff_id)::uuid
from public.staff_accounts a
where m.staff_id is null and a.id=m.staff_account_id
  and trim(coalesce(a.staff_id,'')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

create or replace function public.list_biometric_mapping_staff_candidates_v1(p_search text default '',p_limit integer default 30)
returns table(staff_account_id uuid,staff_id uuid,staff_name text,branch text,role text)
language plpgsql stable security definer set search_path=public,pg_catalog as $$
declare v_q text:=trim(coalesce(p_search,''));
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then raise exception 'not authorized to manage biometric mapping'; end if;
  return query
  select a.id,s.id,s.name,s.branch,coalesce(nullif(s.role,''),a.role)
  from public.staff s
  left join lateral (
    select sa.* from public.staff_accounts sa
    where coalesce(sa.active,sa.is_active,true)=true and trim(coalesce(sa.staff_id,''))=s.id::text
    order by sa.updated_at desc nulls last,sa.id limit 1
  ) a on true
  where coalesce(s.active,false)=true and s.branch in ('فرع الشامي','فرع شكري')
    and (v_q='' or s.name ilike '%'||v_q||'%' or coalesce(a.staff_name,a.name,a.username,'') ilike '%'||v_q||'%' or s.branch ilike '%'||v_q||'%')
  order by case when v_q<>'' and lower(trim(s.name))=lower(v_q) then 0 else 1 end,s.name
  limit greatest(1,least(coalesce(p_limit,30),100));
end;$$;
revoke all on function public.list_biometric_mapping_staff_candidates_v1(text,integer) from public;
grant execute on function public.list_biometric_mapping_staff_candidates_v1(text,integer) to anon,authenticated,service_role;

create or replace function public.assign_biometric_staff_mapping_v2(p_provider text,p_biometric_user_id text,p_staff_id uuid)
returns jsonb
language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_staff public.staff%rowtype; v_account_id uuid; v_scope record; v_updated integer:=0; v_inserted integer:=0;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then raise exception 'not authorized to manage biometric mapping'; end if;
  select * into v_staff from public.staff s where s.id=p_staff_id and coalesce(s.active,false)=true limit 1;
  if v_staff.id is null then raise exception 'canonical active staff not found'; end if;
  if v_staff.branch not in ('فرع الشامي','فرع شكري') then raise exception 'selected staff is outside Dawaa attendance scope'; end if;
  select * into v_scope from public.biometric_employee_scope_registry r where r.provider=trim(p_provider) and r.biometric_user_id=trim(p_biometric_user_id) limit 1;
  if not found or coalesce(v_scope.in_scope,false)=false then raise exception 'biometric employee is outside Dawaa attendance scope'; end if;
  if trim(coalesce(v_scope.canonical_branch,''))<>trim(coalesce(v_staff.branch,'')) then raise exception 'biometric branch does not match selected staff branch'; end if;
  select a.id into v_account_id from public.staff_accounts a where coalesce(a.active,a.is_active,true)=true and trim(coalesce(a.staff_id,''))=v_staff.id::text order by a.updated_at desc nulls last,a.id limit 1;
  insert into public.biometric_staff_mapping(provider,device_id,biometric_user_id,staff_account_id,staff_id,branch,active,updated_at)
  values(trim(p_provider),'*',trim(p_biometric_user_id),v_account_id,v_staff.id,v_staff.branch,true,now())
  on conflict(provider,device_id,biometric_user_id) do update set staff_account_id=excluded.staff_account_id,staff_id=excluded.staff_id,branch=excluded.branch,active=true,updated_at=now();
  update public.biometric_attendance_logs b
  set staff_id=v_staff.id,staff_name_snapshot=coalesce(nullif(b.staff_name_snapshot,''),v_staff.name),branch=v_staff.branch,punch_time=public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
  where b.provider=trim(p_provider) and b.biometric_user_id=trim(p_biometric_user_id);
  get diagnostics v_updated=row_count;
  with semantic as (
    select distinct on (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time),lower(trim(coalesce(b.punch_type,''))))
      b.id,public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) effective_time,
      case lower(trim(coalesce(b.punch_type,''))) when 'check_in' then 'check_in' when 'in' then 'check_in' when 'check_out' then 'check_out' when 'out' then 'check_out' else null end attendance_type,b.device_id::text terminal_id
    from public.biometric_attendance_logs b
    where b.provider=trim(p_provider) and b.biometric_user_id=trim(p_biometric_user_id)
    order by public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time),lower(trim(coalesce(b.punch_type,''))),b.ingested_at,b.id
  )
  insert into public.staff_attendance_logs(staff_id,staff_name,role,branch_name,attendance_type,recorded_at,shift_date,biometric_verified,biometric_method,device_id,status,biometric_source_log_id)
  select v_staff.id,v_staff.name,v_staff.role,v_staff.branch,s.attendance_type,s.effective_time,(s.effective_time at time zone 'Africa/Cairo')::date,true,'fingerprint_terminal',s.terminal_id,'accepted',s.id
  from semantic s
  where s.attendance_type is not null and s.effective_time is not null
    and not exists(select 1 from public.staff_attendance_logs l where l.staff_id=v_staff.id and l.attendance_type=s.attendance_type and l.recorded_at=s.effective_time and l.biometric_method='fingerprint_terminal')
  on conflict(biometric_source_log_id) where biometric_source_log_id is not null do nothing;
  get diagnostics v_inserted=row_count;
  return jsonb_build_object('ok',true,'provider',trim(p_provider),'biometric_user_id',trim(p_biometric_user_id),'staff_id',v_staff.id,'staff_name',v_staff.name,'branch',v_staff.branch,'raw_rows_mapped',v_updated,'attendance_events_added',v_inserted);
end;$$;
revoke all on function public.assign_biometric_staff_mapping_v2(text,text,uuid) from public;
grant execute on function public.assign_biometric_staff_mapping_v2(text,text,uuid) to anon,authenticated,service_role;

create or replace function public.assign_biometric_staff_mapping_v1(p_provider text,p_biometric_user_id text,p_staff_account_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_staff_id uuid;
begin
  select trim(a.staff_id)::uuid into v_staff_id from public.staff_accounts a
  where a.id=p_staff_account_id and coalesce(a.active,a.is_active,true)=true
    and trim(coalesce(a.staff_id,'')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  if v_staff_id is null then raise exception 'selected account is not linked to canonical staff'; end if;
  return public.assign_biometric_staff_mapping_v2(p_provider,p_biometric_user_id,v_staff_id);
end;$$;
revoke all on function public.assign_biometric_staff_mapping_v1(text,text,uuid) from public;
grant execute on function public.assign_biometric_staff_mapping_v1(text,text,uuid) to anon,authenticated,service_role;

create or replace function public.dawaa_promote_biometric_attendance_v1()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_map record; v_staff public.staff%rowtype; v_account public.staff_accounts%rowtype; v_type text; v_effective timestamptz:=public.dawaa_fingerprint_effective_time_v1(new.provider,new.raw_payload,new.punch_time);
begin
  if new.staff_id is not null then select * into v_staff from public.staff s where s.id=new.staff_id and coalesce(s.active,false)=true limit 1; end if;
  if v_staff.id is null and nullif(trim(new.biometric_user_id),'') is not null then
    select m.staff_id,m.staff_account_id into v_map from public.biometric_staff_mapping m where m.active=true and m.provider=new.provider and m.biometric_user_id=new.biometric_user_id and (m.device_id=coalesce(new.device_id::text,'*') or m.device_id='*') order by (m.device_id=coalesce(new.device_id::text,'*')) desc,m.updated_at desc limit 1;
    if v_map.staff_id is not null then select * into v_staff from public.staff s where s.id=v_map.staff_id and coalesce(s.active,false)=true limit 1; end if;
    if v_staff.id is null and v_map.staff_account_id is not null then
      select * into v_account from public.staff_accounts a where a.id=v_map.staff_account_id limit 1;
      if trim(coalesce(v_account.staff_id,'')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then select * into v_staff from public.staff s where s.id=trim(v_account.staff_id)::uuid and coalesce(s.active,false)=true limit 1; end if;
    end if;
  end if;
  if v_staff.id is null then return null; end if;
  update public.biometric_attendance_logs set staff_id=v_staff.id,staff_name_snapshot=coalesce(nullif(staff_name_snapshot,''),v_staff.name),branch=v_staff.branch,punch_time=v_effective where id=new.id;
  v_type:=case lower(trim(coalesce(new.punch_type,''))) when 'check_in' then 'check_in' when 'in' then 'check_in' when 'check_out' then 'check_out' when 'out' then 'check_out' else null end;
  if v_type is not null and v_effective is not null and not exists(select 1 from public.staff_attendance_logs l where l.staff_id=v_staff.id and l.attendance_type=v_type and l.recorded_at=v_effective and l.biometric_method='fingerprint_terminal') then
    insert into public.staff_attendance_logs(staff_id,staff_name,role,branch_name,attendance_type,recorded_at,shift_date,biometric_verified,biometric_method,device_id,status,biometric_source_log_id)
    values(v_staff.id,v_staff.name,v_staff.role,v_staff.branch,v_type,v_effective,(v_effective at time zone 'Africa/Cairo')::date,true,'fingerprint_terminal',new.device_id::text,'accepted',new.id)
    on conflict(biometric_source_log_id) where biometric_source_log_id is not null do nothing;
  end if;
  return null;
end;$$;