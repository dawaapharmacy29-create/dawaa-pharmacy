-- 20261016090000_staff_actor_session_identity_once_per_call_v1: the verified session identity is resolved once
-- per dawaa_current_staff_account_id_strict() call, and every identity case resolves exactly as before.

-- The pre-migration definition, kept as a reference for equivalence.
create function pg_temp.strict_before() returns uuid language sql stable security definer
set search_path to 'public','auth','pg_catalog'
as $$
  with request_identity as (
    select public.dawaa_request_staff_identifier() as value
  )
  select coalesce(
    (select a.id from public.staff_accounts a
      where auth.uid() is not null and a.auth_user_id = auth.uid()
        and coalesce(a.active,false) and coalesce(a.can_login,false) limit 1),
    (select a.id from public.user_profiles up join public.staff_accounts a on a.id = up.staff_account_id
      where auth.uid() is not null and up.auth_user_id = auth.uid() and coalesce(up.active,false)
        and coalesce(a.active,false) and coalesce(a.can_login,false) limit 1),
    (select a.id from public.staff_accounts a, request_identity r
      where r.value is not null and coalesce(a.active,false) and coalesce(a.can_login,false)
        and (a.id::text = r.value or a.staff_id::text = r.value or lower(trim(coalesce(a.username,''))) = lower(r.value))
      order by case when a.id::text = r.value then 1 when a.staff_id::text = r.value then 2 else 3 end,
        coalesce(a.updated_at,a.created_at) desc nulls last
      limit 1)
  );
$$;

-- Resolve one identity case with the given function; returns the account id and the session lookups it made.
create function pg_temp.resolve(p_fn text, p_token text, p_auth_uid text, out account_id uuid, out lookups int)
language plpgsql as $$
begin
  perform set_config('request.headers',
    case when p_token is null then '' else json_build_object('x-dawaa-session-token', rpad(p_token, 40, 'x'))::text end, false);
  perform set_config('test.auth_uid', coalesce(p_auth_uid, ''), false);
  perform set_config('test.session_lookups', '0', false);
  execute format('select %s()', p_fn) into account_id;
  lookups := current_setting('test.session_lookups')::int;
end;
$$;

do $$
declare
  v_case record;
  v_before record;
  v_after record;
  v_cases int := 0;
begin
  for v_case in
    select * from (values
      ('no identity', null::text, null::text, null::uuid),
      ('verified session, general manager', 'token-valid-gm', null, '00000000-0000-4000-8000-000000000001'::uuid),
      ('verified session, pharmacist', 'token-valid-pharmacist', null, '00000000-0000-4000-8000-000000000005'::uuid),
      ('expired session', 'token-expired', null, null),
      ('revoked session', 'token-revoked', null, null),
      ('session of inactive account', 'token-inactive-account', null, null),
      ('session of account without login', 'token-no-login-account', null, null),
      ('unknown token', 'token-unknown', null, null),
      ('token too short', 'short', null, null),
      ('auth.uid account', null, '20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002'::uuid),
      ('auth.uid wins over session', 'token-valid-gm', '20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'::uuid),
      ('user_profiles mapping', null, '20000000-0000-4000-8000-000000000099', '00000000-0000-4000-8000-000000000004'::uuid),
      ('unmapped auth user falls back to session', 'token-valid-pharmacist', '20000000-0000-4000-8000-000000000077', '00000000-0000-4000-8000-000000000005'::uuid)
    ) c(label, token, auth_uid, expected)
  loop
    -- 'short' must stay below the 32-character minimum.
    if v_case.token = 'short' then
      perform set_config('request.headers', '{"x-dawaa-session-token":"short"}', false);
      perform set_config('test.auth_uid', '', false);
      if public.dawaa_current_staff_account_id_strict() is not null or pg_temp.strict_before() is not null then
        raise exception 'short token resolved an account';
      end if;
      v_cases := v_cases + 1;
      continue;
    end if;
    select * into v_before from pg_temp.resolve('pg_temp.strict_before', v_case.token, v_case.auth_uid);
    select * into v_after from pg_temp.resolve('public.dawaa_current_staff_account_id_strict', v_case.token, v_case.auth_uid);
    if v_after.account_id is distinct from v_case.expected then
      raise exception '%: resolved % (expected %)', v_case.label, v_after.account_id, v_case.expected;
    end if;
    if v_after.account_id is distinct from v_before.account_id then
      raise exception '%: resolution changed (% before, % after)', v_case.label, v_before.account_id, v_after.account_id;
    end if;
    if v_after.lookups > 1 then
      raise exception '%: % session lookups in one call (expected at most 1)', v_case.label, v_after.lookups;
    end if;
    v_cases := v_cases + 1;
  end loop;
  if v_cases <> 13 then raise exception 'expected 13 identity cases, ran %', v_cases; end if;
end;
$$;

-- The defect this migration removes: before it, a verified session repeated the lookup per active account row.
do $$
declare v_before record; v_after record;
begin
  select * into v_before from pg_temp.resolve('pg_temp.strict_before', 'token-valid-pharmacist', null);
  select * into v_after from pg_temp.resolve('public.dawaa_current_staff_account_id_strict', 'token-valid-pharmacist', null);
  if v_before.lookups < 40 then
    raise exception 'reference definition made only % lookups; the fixture no longer reproduces the defect', v_before.lookups;
  end if;
  if v_after.lookups <> 1 then
    raise exception 'verified session made % lookups per call (expected 1)', v_after.lookups;
  end if;
end;
$$;

-- Per-row callers: 200 rows evaluating the helper make one lookup per row, not one per account per row.
do $$
declare v_lookups int;
begin
  perform set_config('request.headers', json_build_object('x-dawaa-session-token', rpad('token-valid-gm', 40, 'x'))::text, false);
  perform set_config('test.auth_uid', '', false);
  perform set_config('test.session_lookups', '0', false);
  perform count(public.dawaa_current_staff_account_id_strict()) from generate_series(1, 200);
  v_lookups := current_setting('test.session_lookups')::int;
  if v_lookups > 200 then raise exception '200 helper calls made % session lookups', v_lookups; end if;
end;
$$;

-- Attributes and grants are unchanged.
do $$
declare v record;
begin
  select p.provolatile, p.prosecdef, p.proconfig into v
  from pg_proc p where p.oid = 'public.dawaa_current_staff_account_id_strict()'::regprocedure;
  if v.provolatile <> 's' or not v.prosecdef or v.proconfig <> array['search_path=public, auth, pg_catalog'] then
    raise exception 'helper attributes changed: % % %', v.provolatile, v.prosecdef, v.proconfig;
  end if;
  if not has_function_privilege('anon', 'public.dawaa_current_staff_account_id_strict()', 'execute')
     or not has_function_privilege('authenticated', 'public.dawaa_current_staff_account_id_strict()', 'execute') then
    raise exception 'helper grants changed';
  end if;
end;
$$;

-- Mutation (rolled back): restoring the inlined CTE brings back the per-row lookups and is detected.
do $$
declare v record;
begin
  begin
    execute replace(pg_get_functiondef('public.dawaa_current_staff_account_id_strict()'::regprocedure),
      'request_identity as materialized (', 'request_identity as (');
    select * into v from pg_temp.resolve('public.dawaa_current_staff_account_id_strict', 'token-valid-pharmacist', null);
    if v.lookups <= 1 then
      raise exception using errcode = 'P0901', message = 'inlined identity CTE was not detected; test is vacuous';
    end if;
    raise exception using errcode = 'P0902', message = 'detected';
  exception
    when sqlstate 'P0901' then raise;
    when sqlstate 'P0902' then null;
  end;
  select * into v from pg_temp.resolve('public.dawaa_current_staff_account_id_strict', 'token-valid-pharmacist', null);
  if v.lookups <> 1 then raise exception 'rolled-back mutation changed the helper'; end if;
end;
$$;
