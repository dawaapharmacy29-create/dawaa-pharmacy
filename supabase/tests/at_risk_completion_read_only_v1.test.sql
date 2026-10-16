-- 20261016130000_at_risk_completion_read_only_v1: the at-risk completion reader works inside a read-only
-- transaction (as PostgREST runs STABLE functions), returns exactly the Production results, and writes nothing.
do $$
begin
  if (select result from public.test_expected where actor like '%a1') is distinct from 'فرع الشامي:2/0,فرع شكري:3/1'
     or (select result from public.test_expected where actor like '%a2') is distinct from 'فرع شكري:3/1' then
    raise exception 'fixture baseline differs: %', (select string_agg(actor || '=' || coalesce(result, 'null'), ' ') from public.test_expected);
  end if;
end;
$$;

create function pg_temp.completion(p_actor text) returns text language sql as $$
  select string_agg(branch || ':' || at_risk_total || '/' || at_risk_handled, ',' order by branch)
  from public.get_customer_service_at_risk_completion_v1('2026-10-16', p_actor::uuid)
$$;
begin read only;
do $$
declare v record;
begin
  for v in select * from public.test_expected loop
    if pg_temp.completion(v.actor) is distinct from v.result then
      raise exception 'actor %: % (expected %)', v.actor, pg_temp.completion(v.actor), v.result;
    end if;
  end loop;
  -- an unknown actor has no scope and sees nothing
  if pg_temp.completion('00000000-0000-4000-8000-0000000000ff') is not null then raise exception 'unscoped actor saw rows'; end if;
end;
$$;
rollback;

do $$
begin
  if exists (select 1 from public.customer_service_queue_daily_snapshot) then
    raise exception 'the completion reader wrote a snapshot';
  end if;
  -- the queue itself keeps logging its snapshot (unchanged)
  perform * from public.get_customer_service_at_risk_daily_v2('2026-10-16', '00000000-0000-4000-8000-0000000000a2');
  if (select count(*) from public.customer_service_queue_daily_snapshot) <> 3 then
    raise exception 'get_customer_service_at_risk_daily_v2 no longer logs its snapshot';
  end if;
end;
$$;

-- Mutation (rolled back): the Production definition fails in a read-only transaction, which is what this fixes.
do $$
begin
  begin
    execute replace(pg_get_functiondef('public.get_customer_service_at_risk_completion_v1(date,uuid)'::regprocedure),
      'public.get_customer_service_at_risk_daily_core(p_date, public.dawaa_customer_service_queue_scope_v3(p_actor_id))',
      'public.get_customer_service_at_risk_daily_v2(p_date, p_actor_id)');
    set transaction_read_only = on;
    perform * from public.get_customer_service_at_risk_completion_v1('2026-10-16', '00000000-0000-4000-8000-0000000000a1');
    raise exception using errcode = 'P0901', message = 'the Production definition worked read-only; test is vacuous';
  exception
    when sqlstate 'P0901' then raise;
    when read_only_sql_transaction then null;
  end;
end;
$$;
