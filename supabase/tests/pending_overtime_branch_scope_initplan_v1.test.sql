-- 20261015150200_pending_overtime_branch_scope_initplan_v1: identical rows for every actor and branch filter,
-- branch access planned once per statement, and a mutation of the scope rules is detected.
create function pg_temp.assert_pending_overtime_equivalence() returns integer language plpgsql as $$
declare v_actor text; v_filter text; v_new int[]; v_old int[]; v_checked integer := 0;
begin
  for v_actor in
    select '' union all select 'c0000000-0000-4000-8000-0000000000aa' union all select id::text from public.staff_accounts
  loop
    perform set_config('test.account_id', v_actor, true);
    foreach v_filter in array array['<null>', 'فرع شكري', 'شكري', 'كل الفروع', ''] loop
      set local role anon;
      if v_filter = '<null>' then
        select coalesce(array_agg(id order by id), '{}') into v_new from public.list_pending_overtime_v1(null);
        select coalesce(array_agg(id order by id), '{}') into v_old from public.test_old_list_pending_overtime_v1(null);
      else
        select coalesce(array_agg(id order by id), '{}') into v_new from public.list_pending_overtime_v1(v_filter);
        select coalesce(array_agg(id order by id), '{}') into v_old from public.test_old_list_pending_overtime_v1(v_filter);
      end if;
      reset role;
      if v_new is distinct from v_old then
        raise exception 'pending overtime visibility changed for actor [%] filter [%]: new % old %', v_actor, v_filter, v_new, v_old;
      end if;
      v_checked := v_checked + 1;
    end loop;
  end loop;
  return v_checked;
end;
$$;

do $$
declare v_checked integer; v int[];
begin
  v_checked := pg_temp.assert_pending_overtime_equivalence();
  if v_checked < 80 then raise exception 'pending overtime matrix too small: %', v_checked; end if;

  -- Anchors: a branch manager sees own normalized branch plus global rows; no session sees nothing.
  perform set_config('test.account_id', 'a0000000-0000-4000-8000-000000000004', true);
  set local role anon;
  select array_agg(id order by id) into v from public.list_pending_overtime_v1(null);
  reset role;
  if v is distinct from array[1,2,5,6,7,8,9] then raise exception 'branch manager scope: %', v; end if;
  perform set_config('test.account_id', '', true);
  set local role anon;
  select array_agg(id order by id) into v from public.list_pending_overtime_v1(null);
  reset role;
  if v is not null then raise exception 'no-session actor saw pending overtime: %', v; end if;
end;
$$;

-- The branch access is an InitPlan; the per-row helper is gone from the RPC.
do $$
declare v_body text := pg_get_functiondef('public.list_pending_overtime_v1(text)'::regprocedure);
begin
  if v_body ~ 'current_user_branch_access_v1\(' then raise exception 'list_pending_overtime_v1 still calls the per-row helper'; end if;
  if (select provolatile from pg_proc where oid = 'public.list_pending_overtime_v1(text)'::regprocedure) <> 'v'
     or not (select prosecdef from pg_proc where oid = 'public.list_pending_overtime_v1(text)'::regprocedure) then
    raise exception 'list_pending_overtime_v1 attributes changed';
  end if;
  if (select provolatile from pg_proc where oid = 'public.current_user_branch_access_scope_v1()'::regprocedure) <> 's'
     or not (select prosecdef from pg_proc where oid = 'public.current_user_branch_access_scope_v1()'::regprocedure) then
    raise exception 'scope function must be STABLE SECURITY DEFINER';
  end if;
end;
$$;

-- Mutation (rolled back): treating 'admin' as global must be detected.
do $$
begin
  begin
    create or replace function public.current_user_branch_access_scope_v1()
    returns table(access_mode text, user_branch_key text) language sql stable security definer set search_path to 'public'
    as $m$ select case when sa.role in ('admin','general_manager','executive_manager','branches_manager','procurement_manager') then 'all' else 'branch' end,
                  lower(btrim(regexp_replace(coalesce(sa.branch,''), '^\s*فرع\s+', '', 'i')))
           from public.staff_accounts sa
           where sa.id = public.dawaa_current_staff_account_id_strict() and coalesce(sa.active,false) and coalesce(sa.can_login,false) $m$;
    perform pg_temp.assert_pending_overtime_equivalence();
    raise exception using errcode = 'P0901', message = 'mutation (admin treated as global) was not detected';
  exception
    when sqlstate 'P0901' then raise;
    when others then
      if sqlerrm !~ '^pending overtime visibility changed' then raise; end if;
  end;
  perform pg_temp.assert_pending_overtime_equivalence();
end;
$$;
