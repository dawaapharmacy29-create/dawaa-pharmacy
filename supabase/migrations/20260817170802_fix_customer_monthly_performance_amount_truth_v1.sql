do $$
declare
  v_oid oid;
  v_def text;
  v_old text := 'coalesce(si.net_total,si.net_amount,si.discounted_amount,si.total_amount,si.amount,0)';
  v_new text := 'coalesce(si.net_amount,si.discounted_amount,si.total_amount,si.amount,si.net_total,0)';
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'calculate_customer_monthly_performance'
    and pg_get_function_identity_arguments(p.oid) = 'p_branch text, p_period_start date, p_period_end date, p_prev_period_start date, p_prev_period_end date';

  if v_oid is null then
    raise exception 'calculate_customer_monthly_performance not found';
  end if;

  v_def := pg_get_functiondef(v_oid);
  if position(v_old in v_def) = 0 then
    if position(v_new in v_def) > 0 then
      raise notice 'customer monthly performance amount truth already fixed';
      return;
    end if;
    raise exception 'expected legacy amount precedence not found; refusing unsafe rewrite';
  end if;

  execute replace(v_def, v_old, v_new);
end $$;
