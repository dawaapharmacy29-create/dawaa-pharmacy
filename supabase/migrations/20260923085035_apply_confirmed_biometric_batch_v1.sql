-- One reviewed batch from the owner-provided terminal-code list. This is an
-- authenticated command, not a background guess from matching numeric codes.
create or replace function public.apply_confirmed_biometric_batch_v1()
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  v_specs jsonb := '[
    {"provider":"zk_shami_direct_bridge","code":"245","staff_name":"يوسف عصام"},
    {"provider":"zk_shami_direct_bridge","code":"179","staff_name":"د/ علا"},
    {"provider":"zk_shami_direct_bridge","code":"303","staff_name":"احمد السيد"},
    {"provider":"zk_shami_direct_bridge","code":"308","staff_name":"دعاء ابراهيم"},
    {"provider":"zk_shami_direct_bridge","code":"232","staff_name":"أحمد أبو نور"},
    {"provider":"zk_shami_direct_bridge","code":"165","staff_name":"د وائل"},
    {"provider":"zk_shami_direct_bridge","code":"239","staff_name":"اسلام السبع"},
    {"provider":"zk_shami_direct_bridge","code":"263","staff_name":"يوسف عيد"},
    {"provider":"zk_shami_direct_bridge","code":"211","staff_name":"د اميرة"},
    {"provider":"zk_shami_direct_bridge","code":"171","staff_name":"عم محمد سالم"},
    {"provider":"zk_shokry_direct_bridge","code":"296","staff_name":"محمد الديب"},
    {"provider":"zk_shokry_direct_bridge","code":"201","staff_name":"د محمد العجوز"},
    {"provider":"zk_shokry_direct_bridge","code":"236","staff_name":"د هدي"},
    {"provider":"zk_shokry_direct_bridge","code":"181","staff_name":"د احمد حافظ"},
    {"provider":"zk_shokry_direct_bridge","code":"302","staff_name":"محمد الالفي"},
    {"provider":"zk_shokry_direct_bridge","code":"179","staff_name":"د/ علا"},
    {"provider":"zk_shokry_direct_bridge","code":"226","staff_name":"محمد حافظ"},
    {"provider":"zk_shokry_direct_bridge","code":"186","staff_name":"احمد وجيه"},
    {"provider":"zk_shokry_direct_bridge","code":"237","staff_name":"د/ علياء"},
    {"provider":"zk_shokry_direct_bridge","code":"303","staff_name":"احمد السيد"},
    {"provider":"zk_shokry_direct_bridge","code":"214","staff_name":"يوسف زكي"}
  ]'::jsonb;
  v_item record;
  v_staff_id uuid;
  v_applied integer := 0;
  v_already integer := 0;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception 'not authorized to confirm biometric mappings';
  end if;

  -- Check all identities and raw source rows before any mapping changes.
  for v_item in select * from jsonb_to_recordset(v_specs)
    as x(provider text,code text,staff_name text) loop
    if (select count(*) from public.staff s where trim(s.name)=v_item.staff_name
      and coalesce(s.active,false)=true) <> 1 then
      raise exception 'unique active staff identity missing for %',v_item.staff_name;
    end if;
    select s.id into v_staff_id from public.staff s
      where trim(s.name)=v_item.staff_name and coalesce(s.active,false)=true;
    if not exists (select 1 from public.biometric_attendance_logs b
      where b.provider=v_item.provider and b.biometric_user_id=v_item.code) then
      raise exception 'no device punches for % / %',v_item.provider,v_item.code;
    end if;
    if exists (select 1 from public.biometric_staff_mapping m
      where m.active=true and m.provider=v_item.provider
        and m.biometric_user_id=v_item.code and m.staff_id is distinct from v_staff_id) then
      raise exception 'conflicting device mapping for % / %',v_item.provider,v_item.code;
    end if;
    if exists (select 1 from public.biometric_attendance_logs b
      where b.provider=v_item.provider and b.biometric_user_id=v_item.code
        and b.staff_id is not null and b.staff_id<>v_staff_id) then
      raise exception 'conflicting historical punch identity for % / %',v_item.provider,v_item.code;
    end if;
  end loop;

  for v_item in select * from jsonb_to_recordset(v_specs)
    as x(provider text,code text,staff_name text) loop
    select s.id into v_staff_id from public.staff s
      where trim(s.name)=v_item.staff_name and coalesce(s.active,false)=true;
    if exists (select 1 from public.biometric_staff_mapping m
      where m.active=true and m.provider=v_item.provider
        and m.biometric_user_id=v_item.code and m.staff_id=v_staff_id) then
      v_already:=v_already+1;
    else
      perform public.assign_biometric_staff_mapping_v3(v_item.provider,v_item.code,v_staff_id);
      v_applied:=v_applied+1;
    end if;
  end loop;
  return jsonb_build_object('applied',v_applied,'already_mapped',v_already,
    'reviewed',jsonb_array_length(v_specs));
end; $$;
revoke all on function public.apply_confirmed_biometric_batch_v1() from public;
grant execute on function public.apply_confirmed_biometric_batch_v1() to authenticated,service_role;
