-- 20261016140000_attendance_legacy_time_off_revoke_client_v1: no client role can execute the seven legacy time-off APIs;
-- service_role and SECURITY DEFINER callers keep working; definitions, the current reader, branch scope and every row
-- are unchanged; the rollback restores the reviewed grants and the migration re-applies.
create or replace function public.test_exec_grantees(p_fn regprocedure) returns text language sql stable as $$
  select string_agg(g.name, ',' order by g.name collate "C")
  from pg_proc p, aclexplode(p.proacl) a,
    lateral (select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end as name) g
  where p.oid = p_fn and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
$$;
create table public.test_legacy_fns (fn regprocedure);
insert into public.test_legacy_fns values
  ('public.attendance_request_time_off_v1(text,date,date,time without time zone,time without time zone,text)'),
  ('public.attendance_branch_review_time_off_v1(uuid,text,text)'),
  ('public.attendance_gm_review_time_off_v1(uuid,text,text)'),
  ('public.attendance_branch_time_off_queue_v1()'),
  ('public.attendance_gm_time_off_queue_v1()'),
  ('public.attendance_my_time_off_requests_v1()'),
  ('public.attendance_cancel_time_off_request_v1(uuid)');

-- 1. Grants: service_role only; definitions unchanged; the current reader and the definer caller keep their grants.
do $$
declare v_fn regprocedure;
begin
  for v_fn in select fn from public.test_legacy_fns loop
    if public.test_exec_grantees(v_fn) is distinct from 'service_role' then
      raise exception '% grants are %, expected service_role only', v_fn, public.test_exec_grantees(v_fn);
    end if;
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'a client role still executes %', v_fn;
    end if;
  end loop;
  if exists (select 1 from public.test_before_defs b join pg_proc p on p.proname = b.proname
             where md5(pg_get_functiondef(p.oid)) <> b.def_md5) then
    raise exception 'a time-off function definition changed';
  end if;
  if public.test_exec_grantees('public.list_staff_time_off_requests_v1(uuid,date,date,text,integer)') is distinct from 'anon,authenticated,service_role' then
    raise exception 'list_staff_time_off_requests_v1 grants changed';
  end if;
  if not has_function_privilege('anon', 'public.attendance_unified_approval_decide_v1(text,uuid,text,text)', 'execute') then
    raise exception 'attendance_unified_approval_decide_v1 grants changed';
  end if;
end;
$$;

-- 2. Every legacy API is refused to anon and authenticated, even with a general-manager session (privilege error,
-- not the function's own authorization error).
do $$
declare v_call text; v_role text;
begin
  update public.test_actor set account_id = '00000000-0000-4000-8000-000000000001';
  foreach v_call in array array[
    'select public.attendance_request_time_off_v1(''permission'', date ''2026-11-01'', date ''2026-11-01'')',
    'select public.attendance_branch_review_time_off_v1(''00000000-0000-4000-8000-00000000c002'', ''approve'')',
    'select public.attendance_gm_review_time_off_v1(''00000000-0000-4000-8000-00000000c003'', ''approve'')',
    'select count(*) from public.attendance_branch_time_off_queue_v1()',
    'select count(*) from public.attendance_gm_time_off_queue_v1()',
    'select count(*) from public.attendance_my_time_off_requests_v1()',
    'select public.attendance_cancel_time_off_request_v1(''00000000-0000-4000-8000-00000000c002'')'] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      begin
        execute format('set local role %I', v_role);
        execute v_call;
        raise exception using errcode = 'P0901', message = format('%s still executes: %s', v_role, v_call);
      exception
        when sqlstate 'P0901' then raise;
        when insufficient_privilege then
          if sqlerrm not like 'permission denied for function %' then
            raise exception 'unexpected authorization error for % (%): %', v_role, v_call, sqlerrm;
          end if;
      end;
      reset role;
    end loop;
  end loop;
end;
$$;

-- 3. service_role keeps EXECUTE and reads the legacy queues.
do $$
declare n integer;
begin
  update public.test_actor set account_id = '00000000-0000-4000-8000-000000000001';
  set local role service_role;
  select count(*) into n from public.attendance_gm_time_off_queue_v1();
  if n <> 1 then raise exception 'service_role gm queue returned % rows', n; end if;
  select count(*) into n from public.attendance_branch_time_off_queue_v1();
  if n <> 1 then raise exception 'service_role branch queue returned % rows', n; end if;
  reset role;
end;
$$;

-- 4. A SECURITY DEFINER caller (attendance_unified_approval_decide_v1) still reaches the legacy decision as its owner
-- (rolled back).
do $$
begin
  update public.test_actor set account_id = '00000000-0000-4000-8000-000000000001';
  begin
    set local role anon;
    perform public.attendance_unified_approval_decide_v1('timeoff_gm', '00000000-0000-4000-8000-00000000c003', 'approve', 'test');
    reset role;
    if (select status from public.staff_time_off_requests where id = '00000000-0000-4000-8000-00000000c003') <> 'approved' then
      raise exception 'the definer caller did not reach the legacy decision';
    end if;
    raise exception using errcode = 'P0902', message = 'rollback';
  exception when sqlstate 'P0902' then null;
  end;
  reset role;
end;
$$;

-- 5. The current reader returns exactly what it returned before, per actor: branch scope, self scope and the old
-- requests (legacy statuses included) stay readable; a colleague's requests stay refused.
do $$
declare b record; v_ids text;
begin
  for b in select * from public.test_before_list loop
    update public.test_actor set account_id = b.actor;
    set local role anon;
    select string_agg(l.id::text, ',' order by l.id) into v_ids from public.list_staff_time_off_requests_v1() l;
    reset role;
    if v_ids is distinct from b.ids then raise exception 'list for % changed: % -> %', b.actor, b.ids, v_ids; end if;
  end loop;
  if (select ids from public.test_before_list where actor = '00000000-0000-4000-8000-000000000001') is distinct from
     '00000000-0000-4000-8000-00000000c001,00000000-0000-4000-8000-00000000c002,00000000-0000-4000-8000-00000000c003,00000000-0000-4000-8000-00000000c004' then
    raise exception 'general manager does not see every request';
  end if;
  if (select ids from public.test_before_list where actor = '00000000-0000-4000-8000-000000000002') is distinct from
     '00000000-0000-4000-8000-00000000c001,00000000-0000-4000-8000-00000000c002' then
    raise exception 'branch manager scope is not limited to the branch';
  end if;
  if (select ids from public.test_before_list where actor = '00000000-0000-4000-8000-000000000003') is distinct from
     '00000000-0000-4000-8000-00000000c001,00000000-0000-4000-8000-00000000c002' then
    raise exception 'employee does not see own requests including the legacy pending one';
  end if;
  update public.test_actor set account_id = '00000000-0000-4000-8000-000000000004';
  begin
    set local role anon;
    perform * from public.list_staff_time_off_requests_v1(p_staff_id => '00000000-0000-4000-8000-0000000000a1');
    raise exception using errcode = 'P0901', message = 'employee reads a colleague''s requests';
  exception
    when sqlstate 'P0901' then raise;
    when insufficient_privilege then
      if sqlerrm <> 'not_authorized_for_time_off' then raise; end if;
  end;
  reset role;
  update public.test_actor set account_id = null;
end;
$$;

-- 6. No business row changed.
do $$
begin
  if (select md5(string_agg(r::text, '|' order by r.id)) from public.staff_time_off_requests r)
     is distinct from (select rows_md5 from public.test_before_rows) then
    raise exception 'staff_time_off_requests rows changed';
  end if;
end;
$$;

-- 7. Rollback restores exactly the reviewed grants; the migration then re-applies cleanly.
\ir attendance_legacy_time_off_revoke_client_v1.rollback.sql
do $$
declare v_fn regprocedure;
begin
  for v_fn in select fn from public.test_legacy_fns loop
    if public.test_exec_grantees(v_fn) is distinct from 'PUBLIC,anon,authenticated,service_role' then
      raise exception 'rollback left % with %', v_fn, public.test_exec_grantees(v_fn);
    end if;
  end loop;
  if exists (select 1 from public.test_before_defs b join pg_proc p on p.proname = b.proname
             where md5(pg_get_functiondef(p.oid)) <> b.def_md5) then
    raise exception 'rollback changed a definition';
  end if;
end;
$$;
\ir ../migrations/20261016140000_attendance_legacy_time_off_revoke_client_v1.sql
do $$
declare v_fn regprocedure;
begin
  for v_fn in select fn from public.test_legacy_fns loop
    if public.test_exec_grantees(v_fn) is distinct from 'service_role' then
      raise exception 're-apply after rollback left % with %', v_fn, public.test_exec_grantees(v_fn);
    end if;
  end loop;
end;
$$;
