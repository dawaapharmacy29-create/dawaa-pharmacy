-- Stage 4B: patch only the exact zero-blocked amount fallback inside the
-- existing production function definitions. Each patch asserts exactly one
-- matching occurrence so schema drift fails closed instead of rewriting the
-- wrong text.

do $audit_patch$
declare
  v_def text;
  v_old text := 'coalesce(si.net_total, si.net_amount, si.discounted_amount, si.total_amount, si.amount, 0)';
  v_new text := 'coalesce(nullif(si.net_total,0), nullif(si.net_amount,0), nullif(si.discounted_amount,0), nullif(si.total_amount,0), nullif(si.amount,0), 0)';
  v_hits integer;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='rebuild_customer_metrics_summary'
    and pg_get_function_identity_arguments(p.oid)='p_start_date date, p_end_date date';

  if v_def is null then
    raise exception 'rebuild_customer_metrics_summary definition not found';
  end if;

  v_hits := (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old);
  if v_hits <> 1 then
    raise exception 'rebuild_customer_metrics_summary expected 1 unsafe fallback, found %', v_hits;
  end if;

  execute replace(v_def,v_old,v_new);
end;
$audit_patch$;

do $audit_patch$
declare
  v_def text;
  v_old text := 'coalesce(si.net_total,si.net_amount,si.discounted_amount,si.total_amount,si.amount,0)';
  v_new text := 'coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0)';
  v_hits integer;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='dawaa_customer_sales_truth_refresh_v2'
    and pg_get_function_identity_arguments(p.oid)='';

  if v_def is null then
    raise exception 'dawaa_customer_sales_truth_refresh_v2 definition not found';
  end if;

  v_hits := (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old);
  if v_hits <> 1 then
    raise exception 'dawaa_customer_sales_truth_refresh_v2 expected 1 unsafe fallback, found %', v_hits;
  end if;

  execute replace(v_def,v_old,v_new);
end;
$audit_patch$;

do $audit_patch$
declare
  v_def text;
  v_old text := 'coalesce(net_total,net_amount,discounted_amount,total_amount,amount,0)';
  v_new text := 'coalesce(nullif(net_total,0),nullif(net_amount,0),nullif(discounted_amount,0),nullif(total_amount,0),nullif(amount,0),0)';
  v_hits integer;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='dawaa_invoice_post_import_refresh_v1'
    and pg_get_function_identity_arguments(p.oid)='p_start_date date, p_end_date date';

  if v_def is null then
    raise exception 'dawaa_invoice_post_import_refresh_v1 definition not found';
  end if;

  v_hits := (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old);
  if v_hits <> 1 then
    raise exception 'dawaa_invoice_post_import_refresh_v1 expected 1 unsafe fallback, found %', v_hits;
  end if;

  execute replace(v_def,v_old,v_new);
end;
$audit_patch$;
