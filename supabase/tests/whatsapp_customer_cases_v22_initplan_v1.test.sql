-- 20261015150000_whatsapp_customer_cases_v22_initplan_v1: identical visibility for every actor, the actor
-- scope planned once per statement, and a mutation of the branch rule is detected.
create function pg_temp.assert_cases_equivalence() returns integer language plpgsql as $$
declare v_actor text; v_new int[]; v_old int[]; v_checked integer := 0; v_nonempty integer := 0;
begin
  for v_actor in
    select '' union all select 'c0000000-0000-4000-8000-0000000000aa' union all select id::text from public.staff_accounts
  loop
    perform set_config('test.account_id', v_actor, true);
    set local role anon;
    select coalesce(array_agg(id order by id), '{}') into v_new from public.whatsapp_customer_cases_v22;
    reset role;
    v_old := public.test_oracle_whatsapp_customer_cases_v22();
    if v_new is distinct from v_old then
      raise exception 'whatsapp case visibility changed for actor [%]: new % old %', v_actor, v_new, v_old;
    end if;
    if cardinality(v_new) > 0 then v_nonempty := v_nonempty + 1; end if;
    v_checked := v_checked + 1;
  end loop;
  if v_nonempty < 5 then raise exception 'whatsapp case matrix too weak: % actors saw rows', v_nonempty; end if;
  return v_checked;
end;
$$;

do $$
declare v_checked integer; v int[];
begin
  v_checked := pg_temp.assert_cases_equivalence();
  if v_checked < 14 then raise exception 'whatsapp case matrix too small: %', v_checked; end if;

  -- Anchors: a Shokry branch manager sees the Shokry-keyed sources; no session sees nothing.
  perform set_config('test.account_id', 'a0000000-0000-4000-8000-000000000004', true);
  set local role anon;
  select array_agg(id order by id) into v from public.whatsapp_customer_cases_v22;
  reset role;
  if v is distinct from array[1,2] then raise exception 'branch manager case scope: %', v; end if;
  perform set_config('test.account_id', '', true);
  set local role anon;
  select array_agg(id order by id) into v from public.whatsapp_customer_cases_v22;
  reset role;
  if v is not null then raise exception 'no-session actor saw cases: %', v; end if;
end;
$$;

do $$
declare v_plan text := ''; v_line text;
begin
  perform set_config('test.account_id', 'a0000000-0000-4000-8000-000000000004', true);
  set local role anon;
  for v_line in execute 'explain (costs off) select * from public.whatsapp_customer_cases_v22' loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  reset role;
  if v_plan !~ 'InitPlan' then raise exception 'case policy is not planned with an InitPlan:%', E'\n' || v_plan; end if;
  if v_plan ~ 'dawaa_can_read_conversation_review_row_v2\(|dawaa_current_staff_account_id_strict\(' then
    raise exception 'case policy still resolves the actor per row:%', E'\n' || v_plan;
  end if;
end;
$$;

-- Mutation (rolled back): dropping the branch rule must be detected.
do $$
begin
  begin
    alter policy whatsapp_customer_cases_v22_select on public.whatsapp_customer_cases_v22 using (
      exists (select 1 from public.whatsapp_review_sources src
              where src.id = whatsapp_customer_cases_v22.root_source_id
                and ((select conv_scope.read_mode from public.dawaa_conversation_review_read_scope_v1() conv_scope) = 'all'
                     or src.staff_id::text = (select conv_scope.actor_staff_id from public.dawaa_conversation_review_read_scope_v1() conv_scope))));
    perform pg_temp.assert_cases_equivalence();
    raise exception using errcode = 'P0901', message = 'mutation (branch rule dropped) was not detected';
  exception
    when sqlstate 'P0901' then raise;
    when others then
      if sqlerrm !~ '^whatsapp case visibility changed' then raise; end if;
  end;
  perform pg_temp.assert_cases_equivalence();
end;
$$;
