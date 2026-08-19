begin;

-- Deep audit stage 4C
-- Patch only the remaining production functions where net_total is the first
-- fallback candidate and a stored zero can hide a valid later monetary value.
-- The migration is fail-closed: every target must match the audited signature
-- and the exact expected number of fallback occurrences before any definition
-- is replaced.
do $migration$
declare
  target record;
  fn_oid oid;
  definition text;
  patched text;
  hit_count integer;
  pattern text := 'coalesce\(si\.net_total,\s*si\.net_amount,\s*si\.discounted_amount,\s*si\.total_amount,\s*si\.amount,\s*0\)';
  replacement text := 'coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0)';
begin
  for target in
    select *
    from (values
      ('calculate_manager_cycle_sales_target_v1', 'p_evaluation_type text, p_branch text, p_cycle_start date, p_as_of date', 1),
      ('calculate_weekly_manager_metrics_v4', 'p_evaluation_type text, p_branch text, p_week_start date, p_week_end date', 1),
      ('dawaa_compute_customer_service_cycle_cohorts', 'p_branch text, p_as_of_date date, p_cycles integer', 1),
      ('dawaa_compute_customer_service_watchlist_performance', 'p_branch text, p_as_of_date date, p_cycles integer', 1),
      ('get_customer_service_cycle_cohorts', 'p_branch text, p_as_of_date date, p_cycles integer', 1),
      ('get_customer_service_watchlist_performance', 'p_branch text, p_as_of_date date, p_cycles integer', 1),
      ('get_customer_spend_decline_alerts', 'p_branch text', 2)
    ) as x(function_name, identity_args, expected_hits)
  loop
    select p.oid
      into fn_oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = target.function_name
      and pg_get_function_identity_arguments(p.oid) = target.identity_args;

    if fn_oid is null then
      raise exception 'Stage 4C aborted: function %.%(%) was not found with the audited signature',
        'public', target.function_name, target.identity_args;
    end if;

    definition := pg_get_functiondef(fn_oid);
    hit_count := regexp_count(definition, pattern, 1, 'i');

    if hit_count <> target.expected_hits then
      raise exception 'Stage 4C aborted: %.% expected % audited fallback occurrence(s), found %',
        'public', target.function_name, target.expected_hits, hit_count;
    end if;

    patched := regexp_replace(definition, pattern, replacement, 1, 0, 'gi');

    if patched = definition then
      raise exception 'Stage 4C aborted: %.% definition was not changed', 'public', target.function_name;
    end if;

    execute patched;
  end loop;
end
$migration$;

commit;
