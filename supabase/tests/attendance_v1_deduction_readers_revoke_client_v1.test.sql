-- 20261016110000_attendance_v1_deduction_readers_revoke_client_v1: no client role can read pending deductions
-- through the legacy V1 readers; service_role keeps EXECUTE and both definitions are unchanged.
do $$
declare v_fn text; v_role text;
begin
  foreach v_fn in array array['public.attendance_deduction_pending_review_v1()', 'public.attendance_unified_approvals_v1()'] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_fn, 'execute') then raise exception '% still executes %', v_role, v_fn; end if;
    end loop;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = v_fn::regprocedure and a.grantee = 0) then
      raise exception 'PUBLIC still executes %', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then raise exception 'service_role lost EXECUTE on %', v_fn; end if;
  end loop;
  if exists (select 1 from public.test_before b join pg_proc p on p.proname = b.proname where md5(p.prosrc) <> b.src_md5) then
    raise exception 'a V1 reader definition changed';
  end if;
end;
$$;

-- The anonymous read that used to return every pending deduction is now refused.
do $$
begin
  set local role anon;
  begin
    perform * from public.attendance_deduction_pending_review_v1();
    raise exception using errcode = 'P0901', message = 'anon still reads pending deductions';
  exception
    when sqlstate 'P0901' then raise;
    when insufficient_privilege then null;
  end;
  begin
    perform * from public.attendance_unified_approvals_v1();
    raise exception using errcode = 'P0901', message = 'anon still reads unified approvals';
  exception
    when sqlstate 'P0901' then raise;
    when insufficient_privilege then null;
  end;
  reset role;
end;
$$;
