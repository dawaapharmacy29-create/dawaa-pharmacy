create or replace function public.assign_biometric_staff_mapping_v2(p_provider text,p_biometric_user_id text,p_staff_id uuid)
returns jsonb
language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_staff public.staff%rowtype; v_account_id uuid; v_scope public.biometric_employee_scope%rowtype; v_updated integer:=0; v_inserted integer:=0;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then raise exception 'not authorized to manage biometric mapping'; end if;
  select * into v_staff from public.staff s where s.id=p_staff_id and coalesce(s.active,false)=true limit 1;
  if v_staff.id is null then raise exception 'canonical active staff not found'; end if;
  if v_staff.branch not in ('فرع الشامي','فرع شكري') then raise exception 'selected staff is outside Dawaa attendance scope'; end if;
  select * into v_scope from public.biometric_employee_scope r where r.provider=trim(p_provider) and r.biometric_user_id=trim(p_biometric_user_id) limit 1;
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