begin;

-- Deep audit stage 5
-- Keep day-boundary semantics while making invoice_date predicates sargable.
-- Production audit confirmed invoice_date is non-null for every row in both
-- sales_invoices and dawaa_sales_invoices_dashboard_v1 at migration time.
-- Benchmark on the audited 2026-07-26..2026-08-20 range: the cast predicate
-- scanned/filter-checked the broader index in ~4509 ms; the direct timestamp
-- range used sales_invoices_date_idx as an Index Cond in ~51 ms for 7,482 rows.
-- Every replacement is fail-closed against the audited function signature and
-- expected occurrence count.
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
      ('check_sales_daily_summary_gaps', 'p_start_date date, p_end_date date',
       'where\s+coalesce\(invoice_date::date,sale_date\)\s+between\s+p_start_date\s+and\s+p_end_date',
       'where invoice_date >= p_start_date::timestamp and invoice_date < (p_end_date + 1)::timestamp', 1),

      ('get_dashboard_kpis', 'p_start_date date, p_end_date date, p_branch text',
       'where\s+coalesce\(si\.invoice_date::date,si\.sale_date\)\s+between\s+p_start_date\s+and\s+p_end_date',
       'where si.invoice_date >= p_start_date::timestamp and si.invoice_date < (p_end_date + 1)::timestamp', 3),

      ('dawaa_invoice_post_import_refresh_v1', 'p_start_date date, p_end_date date',
       'where\s+invoice_date::date\s+between\s+p_start_date\s+and\s+p_end_date',
       'where invoice_date >= p_start_date::timestamp and invoice_date < (p_end_date + 1)::timestamp', 2),

      ('rebuild_customer_metrics_summary', 'p_start_date date, p_end_date date',
       'or\s+si\.invoice_date::date\s+>=\s+p_start_date',
       'or si.invoice_date >= p_start_date::timestamp', 1),

      ('rebuild_customer_metrics_summary', 'p_start_date date, p_end_date date',
       'or\s+si\.invoice_date::date\s+<=\s+p_end_date',
       'or si.invoice_date < (p_end_date + 1)::timestamp', 1),

      ('rebuild_sales_daily_summary', 'p_start_date date, p_end_date date',
       'where\s+invoice_date::date\s+between\s+\$1\s+and\s+\$2',
       'where invoice_date >= $1::timestamp and invoice_date < ($2 + 1)::timestamp', 1),

      ('rebuild_staff_sales_summary', 'p_start_date date, p_end_date date',
       'where\s+invoice_date::date\s+between\s+p_start_date\s+and\s+p_end_date',
       'where invoice_date >= p_start_date::timestamp and invoice_date < (p_end_date + 1)::timestamp', 1),

      ('calculate_customer_cashback_cycle', 'p_start date, p_end date',
       'where\s+si\.invoice_date::date\s+between\s+p_start\s+and\s+p_end',
       'where si.invoice_date >= p_start::timestamp and si.invoice_date < (p_end + 1)::timestamp', 1),

      ('settle_target_achievement_bonus', '',
       'and\s+i\.invoice_date::date\s+between\s+v_cycle_start\s+and\s+v_cycle_end',
       'and i.invoice_date >= v_cycle_start::timestamp and i.invoice_date < (v_cycle_end + 1)::timestamp', 1)
    ) as x(function_name, identity_args, pattern, replacement, expected_hits)
  loop
    select p.oid into fn_oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = target.function_name
      and pg_get_function_identity_arguments(p.oid) = target.identity_args;

    if fn_oid is null then
      raise exception 'Stage 5 aborted: %.%(%) not found', 'public', target.function_name, target.identity_args;
    end if;

    definition := pg_get_functiondef(fn_oid);
    hits := regexp_count(definition, target.pattern, 1, 'i');
    if hits <> target.expected_hits then
      raise exception 'Stage 5 aborted: %.% expected % date predicate occurrence(s), found %',
        'public', target.function_name, target.expected_hits, hits;
    end if;

    patched := regexp_replace(definition, target.pattern, target.replacement, 1, 0, 'gi');
    if patched = definition then
      raise exception 'Stage 5 aborted: %.% definition unchanged', 'public', target.function_name;
    end if;

    execute patched;
  end loop;
end
$migration$;

commit;
