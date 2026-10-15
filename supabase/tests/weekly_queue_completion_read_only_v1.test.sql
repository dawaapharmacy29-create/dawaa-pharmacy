-- 20261015140100_weekly_queue_completion_read_only_v1.

-- 1) Reproduce the Production failure: the VOLATILE cached reader cannot refresh a stale cache inside the
--    READ ONLY transaction PostgREST uses for STABLE RPCs (HTTP 405).
begin transaction read only;
do $$
begin
  perform * from public.get_customer_service_recent_top50_cached('all');
  raise exception 'expected the cached reader to fail in a read-only transaction';
exception when read_only_sql_transaction then
  null;
end;
$$;
commit;

-- 2) The canonical queue read now succeeds in a READ ONLY transaction with a cold cache and never writes it.
begin transaction read only;
do $$
declare v record;
begin
  select * into v from public.get_customer_service_weekly_queue_completion_v1('all', date '2026-10-10', date '2026-10-16');
  if v.total_items is null or v.total_items = 0 then
    raise exception 'read-only queue read returned no items: %', row_to_json(v);
  end if;
  if exists (select 1 from public.customer_service_top50_cache) then
    raise exception 'read-only queue read wrote the cache';
  end if;
end;
$$;
commit;

-- 3) Parity with the previous path: stale cache (old path refreshes it) and fresh cache (both read it).
do $$
declare
  v_scope text;
  v_new record;
  v_old record;
  v_round integer;
begin
  foreach v_scope in array array['all', 'فرع شكري'] loop
    for v_round in 1..2 loop
      -- round 1: cold/stale cache; round 2: fresh cache written by the old path in round 1.
      select * into v_new from public.get_customer_service_weekly_queue_completion_v1(v_scope, date '2026-10-10', date '2026-10-16');
      select * into v_old from public.test_old_weekly_queue_completion(v_scope, date '2026-10-10', date '2026-10-16');
      if row_to_json(v_new)::text is distinct from row_to_json(v_old)::text then
        raise exception 'queue parity broken for scope % round %: new % old %', v_scope, v_round, row_to_json(v_new), row_to_json(v_old);
      end if;
    end loop;
  end loop;

  -- A fresh cache is served as-is by the read-only reader (no recomputation drift).
  update public.customer_service_top50_cache
     set payload = jsonb_build_array(jsonb_build_object('customer_rank', 1, 'branch', 'فرع الشامي', 'customer_code', 'CACHED-ONLY'))
   where scope = 'all';
  if not exists (select 1 from public.get_customer_service_recent_top50_read_v1('all') where customer_code = 'CACHED-ONLY') then
    raise exception 'read-only reader ignored a fresh cache';
  end if;

  -- A stale cache falls back to the core calculation, exactly like the cached reader.
  update public.customer_service_top50_cache set computed_at = now() - interval '3 hours' where scope = 'all';
  if exists (select 1 from public.get_customer_service_recent_top50_read_v1('all') where customer_code = 'CACHED-ONLY') then
    raise exception 'read-only reader served a stale cache';
  end if;
end;
$$;

-- 4) Contract: STABLE, no DML, not callable by client roles directly; queue function keeps its grants.
do $$
declare
  v_reader regprocedure := 'public.get_customer_service_recent_top50_read_v1(text)'::regprocedure;
  v_queue regprocedure := 'public.get_customer_service_weekly_queue_completion_v1(text,date,date)'::regprocedure;
begin
  if (select provolatile from pg_proc where oid = v_reader) <> 's' then raise exception 'reader must be STABLE'; end if;
  if pg_get_functiondef(v_reader) ~* '(insert\s+into|update\s+[a-z_.]+\s+set|delete\s+from)' then raise exception 'reader must not write'; end if;
  if pg_get_functiondef(v_queue) ~ 'get_customer_service_recent_top50_cached' then raise exception 'queue still calls the VOLATILE cached reader'; end if;
  if has_function_privilege('anon', v_reader, 'execute') or has_function_privilege('authenticated', v_reader, 'execute') then
    raise exception 'reader must stay internal';
  end if;
  if not has_function_privilege('anon', v_queue, 'execute') or not has_function_privilege('authenticated', v_queue, 'execute') then
    raise exception 'queue function grants changed';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5) No writer is reachable from the weekly read path (functions called qualified or unqualified).
-- ---------------------------------------------------------------------------------------------------
create function pg_temp.reachable_writers(p_root text) returns text[] language sql as $$
  with recursive fns as (
    select p.proname::text collate "default" as name, lower(pg_get_functiondef(p.oid)) as body
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  ), graph(name) as (
    select p_root collate "default"
    union
    select f2.name from graph g join fns f1 on f1.name = g.name
    join fns f2 on f2.name <> g.name and f1.body ~ ('(^|[^a-z0-9_])' || f2.name || '\s*\(')
  )
  select coalesce(array_agg(f.name order by f.name), '{}')
  from graph g join fns f on f.name = g.name
  where f.body ~ '(insert\s+into|update\s+[a-z_."]+\s+set|delete\s+from|truncate\s|on\s+conflict)'
$$;

do $$
declare v text[];
begin
  v := pg_temp.reachable_writers('get_customer_service_weekly_queue_completion_v1');
  if cardinality(v) <> 0 then raise exception 'writers reachable from the weekly queue read path: %', v; end if;
  v := pg_temp.reachable_writers('get_customer_service_recent_top50_read_v1');
  if cardinality(v) <> 0 then raise exception 'writers reachable from the read-only top50 reader: %', v; end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 6) Mutation tests (rolled back): reverting the queue to the VOLATILE cached writer must be detected
--    statically (a writer becomes reachable) and dynamically (a read writes the cache).
-- ---------------------------------------------------------------------------------------------------
do $$
declare v text[];
begin
  -- M2-a: static detection.
  begin
    create or replace function public.get_customer_service_weekly_queue_completion_v1(p_branch text, p_week_start date, p_week_end date)
    returns table(days_counted integer, total_items integer, total_handled integer, completion_rate numeric)
    language sql stable security definer set search_path to 'public', 'pg_catalog'
    as $q$ select 0, (select count(*)::integer from public.get_customer_service_recent_top50_cached('all')), 0, null::numeric $q$;
    v := pg_temp.reachable_writers('get_customer_service_weekly_queue_completion_v1');
    if cardinality(v) = 0 then
      raise exception using errcode = 'P0901', message = 'mutation M2-a (cached writer path) was not detected statically';
    end if;
    raise exception using errcode = 'P0902', message = 'M2-a detected: ' || array_to_string(v, ',');
  exception
    when sqlstate 'P0901' then raise;
    when sqlstate 'P0902' then
      if sqlerrm !~ 'get_customer_service_recent_top50_cached' then raise; end if;
  end;

  -- M2-b: dynamic detection, with a cold cache the reverted path writes customer_service_top50_cache.
  begin
    delete from public.customer_service_top50_cache;
    create or replace function public.get_customer_service_weekly_queue_completion_v1(p_branch text, p_week_start date, p_week_end date)
    returns table(days_counted integer, total_items integer, total_handled integer, completion_rate numeric)
    language sql stable security definer set search_path to 'public', 'pg_catalog'
    as $q$ select * from public.test_old_weekly_queue_completion(p_branch, p_week_start, p_week_end) $q$;
    perform * from public.get_customer_service_weekly_queue_completion_v1('all', date '2026-10-10', date '2026-10-16');
    if not exists (select 1 from public.customer_service_top50_cache) then
      raise exception using errcode = 'P0901', message = 'mutation M2-b (cached writer path) did not write; detection is vacuous';
    end if;
    raise exception using errcode = 'P0902', message = 'M2-b detected: the reverted read path wrote the cache';
  exception
    when sqlstate 'P0901' then raise;
    when sqlstate 'P0902' then null;
  end;
end;
$$;

-- The rolled-back mutations left the migrated read-only path intact and writer-free.
do $$
begin
  if pg_get_functiondef('public.get_customer_service_weekly_queue_completion_v1(text,date,date)'::regprocedure) !~ 'get_customer_service_recent_top50_read_v1' then
    raise exception 'weekly queue no longer uses the read-only reader after the rolled-back mutations';
  end if;
  if cardinality(pg_temp.reachable_writers('get_customer_service_weekly_queue_completion_v1')) <> 0 then
    raise exception 'writer reachable after the rolled-back mutations';
  end if;
end;
$$;

-- 7) The new read path performs no INSERT/UPDATE/DELETE at runtime: cold and stale caches stay untouched.
do $$
declare v_before text; v_after text;
begin
  update public.customer_service_top50_cache set computed_at = now() - interval '5 hours';
  select coalesce(string_agg(scope || '@' || computed_at::text || '#' || md5(payload::text), ',' order by scope), '') into v_before
  from public.customer_service_top50_cache;
  perform * from public.get_customer_service_weekly_queue_completion_v1('all', date '2026-10-10', date '2026-10-16');
  perform * from public.get_customer_service_weekly_queue_completion_v1('فرع شكري', date '2026-10-10', date '2026-10-16');
  perform * from public.get_customer_service_recent_top50_read_v1('missing-scope');
  select coalesce(string_agg(scope || '@' || computed_at::text || '#' || md5(payload::text), ',' order by scope), '') into v_after
  from public.customer_service_top50_cache;
  if v_before is distinct from v_after then
    raise exception 'read-only path modified customer_service_top50_cache';
  end if;
end;
$$;
