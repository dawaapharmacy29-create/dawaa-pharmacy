-- 20261016100000_payroll_cycle_staff_scope_shared_v1: the overview and the HR health return exactly what the
-- Production definitions returned (captured in test_before by the fixture), and the health RPC no longer runs any
-- payroll gate.

create function pg_temp.use_scenario(p_scenario text) returns public.test_scenarios language plpgsql as $$
declare v public.test_scenarios;
begin
  select * into v from public.test_scenarios where scenario = p_scenario;
  perform set_config('test.account_id', v.account_id, false);
  perform set_config('test.permissions', v.permissions, false);
  perform set_config('test.read_scope', v.read_scope, false);
  perform set_config('test.payroll_scope', v.payroll_scope, false);
  perform set_config('test.gate_calls', '0', false);
  return v;
end;
$$;

-- The captured baseline is not vacuous: hand-computed counts for the general manager over all branches.
do $$
declare b jsonb;
begin
  select overview into b from public.test_before where scenario = 'gm_all_branches';
  if (b->>'scope_staff_count')::int <> 8 or (b->>'identified_staff_count')::int <> 6
     or (b->>'identity_gap_count')::int <> 2 or (b->>'identity_priority_count')::int <> 1
     or (b->>'configured_staff_count')::int <> 3 or (b->>'unconfigured_staff_count')::int <> 3
     or (b->>'unconfigured_priority_count')::int <> 2 or (b->>'staff_count')::int <> 3 or (b->>'blocked_count')::int <> 1 then
    raise exception 'fixture baseline differs from the hand-computed counts: %', b;
  end if;
  if (select health_gate_calls from public.test_before where scenario = 'gm_all_branches') <> 3 then
    raise exception 'fixture baseline: the Production health definition should run one gate per configured staff';
  end if;
end;
$$;

-- Overview, health and the new counts reader match the Production results for every scenario.
do $$
declare
  v public.test_scenarios; b public.test_before;
  v_overview jsonb; v_overview_error text; v_health jsonb; v_health_error text; v_counts jsonb; v_counts_error text;
  v_og int; v_hg int; k text; v_n int := 0;
begin
  for b in select * from public.test_before order by scenario loop
    v := pg_temp.use_scenario(b.scenario);
    v_overview := null; v_overview_error := null; v_health := null; v_health_error := null; v_counts := null; v_counts_error := null;
    begin
      v_overview := public.payroll_cycle_finalization_overview_v2('2026-10', v.branch, 200) - 'generated_at';
    exception when others then v_overview_error := sqlstate || ' ' || sqlerrm;
    end;
    v_og := current_setting('test.gate_calls')::int;
    if v_overview is distinct from b.overview or v_overview_error is distinct from b.overview_error then
      raise exception '%: overview changed; before: % %; after: % %', b.scenario, b.overview, b.overview_error, v_overview, v_overview_error;
    end if;
    if v_og <> b.overview_gate_calls then
      raise exception '%: overview gate calls changed (% before, % after)', b.scenario, b.overview_gate_calls, v_og;
    end if;

    perform set_config('test.gate_calls', '0', false);
    begin
      v_counts := public.payroll_cycle_configuration_counts_v1('2026-10', v.branch);
    exception when others then v_counts_error := sqlstate || ' ' || sqlerrm;
    end;
    if current_setting('test.gate_calls')::int <> 0 then raise exception '%: counts reader ran payroll gates', b.scenario; end if;
    if v_counts_error is distinct from b.overview_error then
      raise exception '%: counts reader error % differs from the overview error %', b.scenario, v_counts_error, b.overview_error;
    end if;
    if b.overview is not null then
      foreach k in array array['scope_staff_count','identified_staff_count','identity_gap_count','identity_priority_count',
                               'configured_staff_count','unconfigured_staff_count','unconfigured_priority_count'] loop
        if (v_counts->k) is distinct from (b.overview->k) then
          raise exception '%: % is % in the counts reader but % in the overview', b.scenario, k, v_counts->k, b.overview->k;
        end if;
      end loop;
    end if;

    if v.branch is null then
      perform set_config('test.gate_calls', '0', false);
      begin
        v_health := public.hr_canonical_architecture_health_v1() - 'generated_at';
      exception when others then v_health_error := sqlstate || ' ' || sqlerrm;
      end;
      v_hg := current_setting('test.gate_calls')::int;
      if v_health is distinct from b.health or v_health_error is distinct from b.health_error then
        raise exception '%: health changed; before: % %; after: % %', b.scenario, b.health, b.health_error, v_health, v_health_error;
      end if;
      if v_hg <> 0 then raise exception '%: health still ran % payroll gates', b.scenario, v_hg; end if;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> 6 then raise exception 'expected 6 scenarios, ran %', v_n; end if;
end;
$$;

-- Grants: the overview and health keep theirs; the shared scope and counts readers are internal.
do $$
begin
  if (select proacl::text from pg_proc where oid = 'public.payroll_cycle_finalization_overview_v2(text,text,integer)'::regprocedure)
       is distinct from (select overview_acl from public.test_before where scenario = 'gm_all_branches')
     or (select proacl::text from pg_proc where oid = 'public.hr_canonical_architecture_health_v1()'::regprocedure)
       is distinct from (select health_acl from public.test_before where scenario = 'gm_all_branches') then
    raise exception 'overview or health grants changed';
  end if;
  if has_function_privilege('anon', 'public.payroll_cycle_staff_scope_v1(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.payroll_cycle_staff_scope_v1(text,text)', 'execute')
     or has_function_privilege('anon', 'public.payroll_cycle_configuration_counts_v1(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.payroll_cycle_configuration_counts_v1(text,text)', 'execute') then
    raise exception 'internal payroll scope readers must not be executable by anon/authenticated';
  end if;
  if not (select prosecdef and provolatile = 's' from pg_proc where oid = 'public.payroll_cycle_staff_scope_v1(text,text)'::regprocedure)
     or not (select prosecdef and provolatile = 's' from pg_proc where oid = 'public.payroll_cycle_configuration_counts_v1(text,text)'::regprocedure) then
    raise exception 'internal payroll scope readers must be STABLE SECURITY DEFINER';
  end if;
end;
$$;

-- Mutation (rolled back): a health that reads the full overview again runs payroll gates, and is detected.
do $$
begin
  begin
    execute replace(pg_get_functiondef('public.hr_canonical_architecture_health_v1()'::regprocedure),
      'v_config:=public.payroll_cycle_configuration_counts_v1(v_bounds.month_cycle,null);',
      'v_config:=public.payroll_cycle_finalization_overview_v2(v_bounds.month_cycle,null,200);');
    perform pg_temp.use_scenario('gm_all_branches');
    perform public.hr_canonical_architecture_health_v1();
    if current_setting('test.gate_calls')::int = 0 then
      raise exception using errcode = 'P0901', message = 'health reading the full overview made no gate calls; test is vacuous';
    end if;
    raise exception using errcode = 'P0902', message = 'detected';
  exception
    when sqlstate 'P0901' then raise;
    when sqlstate 'P0902' then null;
  end;
  perform pg_temp.use_scenario('gm_all_branches');
  perform public.hr_canonical_architecture_health_v1();
  if current_setting('test.gate_calls')::int <> 0 then raise exception 'rolled-back mutation changed the health RPC'; end if;
end;
$$;
