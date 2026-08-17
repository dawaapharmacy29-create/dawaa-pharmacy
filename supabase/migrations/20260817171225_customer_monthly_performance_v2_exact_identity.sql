do $$
declare
  v_oid oid;
  v_def text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='calculate_customer_monthly_performance_v2'
    and pg_get_function_identity_arguments(p.oid)='p_branch text, p_period_start date, p_period_end date, p_prev_period_start date, p_prev_period_end date';
  if v_oid is null then raise exception 'v2 function missing'; end if;
  v_def := pg_get_functiondef(v_oid);
  v_def := replace(v_def,
    'coalesce(max(canonical_code) filter(where invoice_date between p_period_start and p_period_end),
             max(canonical_code) filter(where invoice_date between p_prev_period_start and p_prev_period_end)) as customer_code,',
    'case when count(*) filter(where invoice_date between p_period_start and p_period_end) > 0
          then max(canonical_code) filter(where invoice_date between p_period_start and p_period_end)
          else max(canonical_code) filter(where invoice_date between p_prev_period_start and p_prev_period_end) end as customer_code,');
  v_def := replace(v_def,
    'coalesce(max(customer_name) filter(where invoice_date between p_period_start and p_period_end),
             max(customer_name) filter(where invoice_date between p_prev_period_start and p_prev_period_end)) as customer_name,',
    'case when count(*) filter(where invoice_date between p_period_start and p_period_end) > 0
          then max(customer_name) filter(where invoice_date between p_period_start and p_period_end)
          else max(customer_name) filter(where invoice_date between p_prev_period_start and p_prev_period_end) end as customer_name,');
  v_def := replace(v_def,
    'coalesce(max(phone) filter(where invoice_date between p_period_start and p_period_end),
             max(phone) filter(where invoice_date between p_prev_period_start and p_prev_period_end)) as phone,',
    'case when count(*) filter(where invoice_date between p_period_start and p_period_end) > 0
          then max(phone) filter(where invoice_date between p_period_start and p_period_end)
          else max(phone) filter(where invoice_date between p_prev_period_start and p_prev_period_end) end as phone,');
  execute v_def;
end $$;
