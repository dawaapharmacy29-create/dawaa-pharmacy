begin;

-- Deep audit stage 7
-- Finish the remaining audited invoice_date predicates that wrap/cast the
-- indexed timestamp column. Production checks before this migration showed:
--   * sales_invoices.invoice_date: 0 NULL rows
--   * dashboard invoice_date: 0 NULL rows
--   * sale_date never disagrees with invoice_date::date when both are present
-- Therefore the direct timestamp ranges preserve current semantics while
-- allowing the invoice_date indexes to be used as index conditions.
do $migration$
declare
  target record;
  fn_oid oid;
  definition text;
  patched text;
  hits integer;
begin
  for target in
    select * from (values
      ('compute_app_data_health_v2', '',
       'where\s+invoice_date::date\s+between\s+v_cycle_start\s+and\s+least\(v_cycle_end,current_date\)',
       'where invoice_date >= v_cycle_start::timestamp and invoice_date < (least(v_cycle_end,current_date) + 1)::timestamp', 2),

      ('get_daily_high_value_customers', 'p_branch text, p_date date, p_min_total numeric',
       'and\s+coalesce\(si\.sale_date,\s*si\.invoice_date::date,\s*si\.date::date\)\s*=\s*p_date',
       'and si.invoice_date >= p_date::timestamp and si.invoice_date < (p_date + 1)::timestamp', 1),

      ('run_quarterly_cashback_batch_for_branch', 'p_branch text, p_period_start date, p_period_end date, p_reward_rate numeric, p_actor_name text',
       'where\s+coalesce\(sale_date,\s*invoice_date::date,\s*invoice_datetime::date\)\s+between\s+p_period_start\s+and\s+p_period_end',
       'where invoice_date >= p_period_start::timestamp and invoice_date < (p_period_end + 1)::timestamp', 1),

      ('settle_target_achievement_bonus_v1_internal', 'p_cycle_start date, p_cycle_end date',
       'and\s+i\.invoice_date::date\s+between\s+p_cycle_start\s+and\s+p_cycle_end',
       'and i.invoice_date >= p_cycle_start::timestamp and i.invoice_date < (p_cycle_end + 1)::timestamp', 1),

      ('refresh_doctor_metrics_daily', '',
       'and\s+i\.invoice_date::date\s+>=\s+v_month_start',
       'and i.invoice_date >= v_month_start::timestamp', 1),
      ('refresh_doctor_metrics_daily', '',
       'and\s+i\.invoice_date::date\s+<=\s+v_today',
       'and i.invoice_date < (v_today + 1)::timestamp', 1),
      ('refresh_doctor_metrics_daily', '',
       'and\s+i\.invoice_date::date\s*=\s*v_today',
       'and i.invoice_date >= v_today::timestamp and i.invoice_date < (v_today + 1)::timestamp', 1),

      ('settle_doctor_invoice_quality_points', '',
       'and\s+i\.invoice_date::date\s+>=\s+v_month_start',
       'and i.invoice_date >= v_month_start::timestamp', 1),
      ('settle_doctor_invoice_quality_points', '',
       'and\s+i\.invoice_date::date\s+<=\s+v_today',
       'and i.invoice_date < (v_today + 1)::timestamp', 1),
      ('settle_doctor_invoice_quality_points', '',
       'where\s+invoice_date::date\s+>=\s+v_today\s*-\s*interval\s+''90 days''',
       'where invoice_date >= (v_today - interval ''90 days'')', 1),

      ('reconcile_followup_purchases', '',
       'on\s+si\.invoice_date::date\s*>\s*cf\.followup_date',
       'on si.invoice_date >= (cf.followup_date + 1)::timestamp', 1),
      ('reconcile_followup_purchases', '',
       'and\s+si\.invoice_date::date\s*<=\s*cf\.followup_date\s*\+\s*interval\s+''14 days''',
       'and si.invoice_date < (cf.followup_date + interval ''15 days'')', 1)
    ) as x(function_name, identity_args, pattern, replacement, expected_hits)
  loop
    select p.oid into fn_oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = target.function_name
      and pg_get_function_identity_arguments(p.oid) = target.identity_args;

    if fn_oid is null then
      raise exception 'Stage 7 aborted: public.%(%) not found', target.function_name, target.identity_args;
    end if;

    definition := pg_get_functiondef(fn_oid);
    hits := regexp_count(definition, target.pattern, 1, 'i');
    if hits <> target.expected_hits then
      raise exception 'Stage 7 aborted: %.% expected % predicate occurrence(s), found %',
        'public', target.function_name, target.expected_hits, hits;
    end if;

    patched := regexp_replace(definition, target.pattern, target.replacement, 1, 0, 'gi');
    if patched = definition then
      raise exception 'Stage 7 aborted: %.% definition unchanged', 'public', target.function_name;
    end if;

    execute patched;
  end loop;
end
$migration$;

commit;
