set role anon;
select set_config('request.headers', '{}', false);

do $$
declare
  v_count bigint;
  v_rpc record;
begin
  select count(*) into v_count from public.notification_sla_policies;
  if v_count <> 0 then
    raise exception 'anon without verified session read SLA policies';
  end if;

  select count(*) into v_count from public.notification_sla_events;
  if v_count <> 0 then
    raise exception 'anon without verified session read SLA events';
  end if;

  if not has_table_privilege('anon', 'public.notification_sla_events', 'select') then
    raise exception 'notification_sla_events anon SELECT ACL was unexpectedly removed';
  end if;

  if has_table_privilege('anon', 'public.notification_sla_policies', 'insert')
     or has_table_privilege('anon', 'public.notification_sla_policies', 'update')
     or has_table_privilege('anon', 'public.notification_sla_policies', 'delete')
     or has_table_privilege('anon', 'public.notification_sla_events', 'insert')
     or has_table_privilege('anon', 'public.notification_sla_events', 'update')
     or has_table_privilege('anon', 'public.notification_sla_events', 'delete') then
    raise exception 'anon SLA read repair widened DML privileges';
  end if;

  if not has_table_privilege('service_role', 'public.notification_sla_events', 'select')
     or not has_table_privilege('service_role', 'public.notification_sla_policies', 'select') then
    raise exception 'service_role notification read privileges changed';
  end if;

  if not has_function_privilege('anon', 'public.get_dashboard_staff_ops_summary_v171()', 'execute')
     or not has_function_privilege('authenticated', 'public.get_dashboard_staff_ops_summary_v171()', 'execute')
     or not has_function_privilege('service_role', 'public.get_dashboard_staff_ops_summary_v171()', 'execute') then
    raise exception 'dashboard RPC execute grants are incomplete';
  end if;

  if (select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang
      where p.oid = 'public.get_dashboard_staff_ops_summary_v171()'::regprocedure) <> 'sql'
     or (select provolatile from pg_proc where oid = 'public.get_dashboard_staff_ops_summary_v171()'::regprocedure) <> 's'
     or not (select prosecdef from pg_proc where oid = 'public.get_dashboard_staff_ops_summary_v171()'::regprocedure)
     or not (select proconfig @> array['search_path=public'] from pg_proc where oid = 'public.get_dashboard_staff_ops_summary_v171()'::regprocedure) then
    raise exception 'dashboard RPC execution properties changed';
  end if;

  if position('dawaa_staff_permissions_audit_v166' in pg_get_functiondef('public.get_dashboard_staff_ops_summary_v171()'::regprocedure)) > 0 then
    raise exception 'dashboard RPC retains the retired relation dependency';
  end if;

  if exists (
    select 1
    from aclexplode(coalesce(
      (select proacl from pg_proc where oid = 'public.get_dashboard_staff_ops_summary_v171()'::regprocedure),
      acldefault('f', (select proowner from pg_proc where oid = 'public.get_dashboard_staff_ops_summary_v171()'::regprocedure))
    )) acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'dashboard RPC remains executable by PUBLIC';
  end if;
end
$$;

select set_config(
  'request.headers',
  '{"x-dawaa-session-token":"verified-session-token-for-staff-a-0000000000000001"}',
  false
);

do $$
declare
  v_count bigint;
  v_rpc record;
  v_expected_active bigint;
  v_expected_disabled bigint;
begin
  select count(*) into v_count from public.notification_sla_policies;
  if v_count <> 1 then
    raise exception 'verified staff session did not read SLA policies';
  end if;

  select count(*) into v_count from public.notification_sla_events;
  if v_count <> 2 then
    raise exception 'event visibility did not preserve recipient/role/branch scope; expected 2, got %', v_count;
  end if;

  select * into v_rpc from public.get_dashboard_staff_ops_summary_v171();
  if v_rpc.active_accounts <> 2
     or v_rpc.disabled_accounts <> 3
     or v_rpc.pending_time_off <> 0
     or v_rpc.absences_today <> 0
     or v_rpc.late_today <> 0 then
    raise exception 'dashboard RPC returned unexpected values: active %, disabled %, pending %, absent %, late %',
      v_rpc.active_accounts, v_rpc.disabled_accounts, v_rpc.pending_time_off,
      v_rpc.absences_today, v_rpc.late_today;
  end if;
end
$$;

reset role;
select set_config('request.headers', '{}', false);

set role service_role;
do $$
declare
  v_count bigint;
  v_rpc record;
  v_expected_active bigint;
  v_expected_disabled bigint;
begin
  select count(*) into v_count from public.notification_sla_policies;
  if v_count <> 1 then
    raise exception 'service_role SLA policy read changed';
  end if;
  select count(*) into v_count from public.notification_sla_events;
  if v_count <> 4 then
    raise exception 'service_role event read changed';
  end if;

  select count(*) into v_expected_active
  from public.staff_accounts
  where active = true and coalesce(can_login, true) = true;
  select count(*) into v_expected_disabled
  from public.staff_accounts
  where active = false or coalesce(can_login, true) = false;
  select * into v_rpc from public.get_dashboard_staff_ops_summary_v171();
  if v_rpc.active_accounts <> v_expected_active
     or v_rpc.disabled_accounts <> v_expected_disabled
     or v_rpc.pending_time_off <> 0
     or v_rpc.absences_today <> 0
     or v_rpc.late_today <> 0 then
    raise exception 'dashboard RPC does not match canonical staff_accounts semantics';
  end if;
end
$$;
reset role;
