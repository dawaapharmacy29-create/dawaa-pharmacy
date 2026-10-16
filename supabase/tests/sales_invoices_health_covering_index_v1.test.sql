-- 20261015150400_sales_invoices_health_classification_covering_index_v1: the new index covers the RLS branch
-- filter, so the planner answers the missing-classification count and sample index-only (natural choice, no
-- planner overrides, after VACUUM ANALYZE as in Production); without it the RLS filter forces heap access.
create function pg_temp.classification_plan(p_sql text) returns text language plpgsql as $$
declare v_plan text := ''; v_line text;
begin
  perform set_config('test.invoice_scope', 'فرع شكري', true);
  set local role anon;
  for v_line in execute 'explain (costs off) ' || p_sql loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  reset role;
  return v_plan;
end;
$$;

do $$
declare v_def text;
begin
  select pg_get_indexdef(i.indexrelid) into v_def
  from pg_index i join pg_class c on c.oid = i.indexrelid
  where c.relname = 'idx_sales_invoices_health_missing_classification_branch_v1';
  if v_def is null then raise exception 'covering classification index missing'; end if;
  if v_def !~ '\(id\) INCLUDE \(branch\) WHERE \(\(customer_segment IS NULL\) AND \(customer_type IS NULL\)\)' then
    raise exception 'covering index definition changed: %', v_def;
  end if;
  if (select indisunique from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = 'idx_sales_invoices_health_missing_classification_branch_v1') then
    raise exception 'covering index must not be unique';
  end if;
  if to_regclass('public.idx_sales_invoices_health_missing_classification_v1') is null then
    raise exception 'existing classification index must be kept';
  end if;
end;
$$;

do $$
declare v_count_plan text; v_sample_plan text;
begin
  v_count_plan := pg_temp.classification_plan('select count(*) from public.sales_invoices where customer_segment is null and customer_type is null');
  v_sample_plan := pg_temp.classification_plan('select id from public.sales_invoices where customer_segment is null and customer_type is null order by id limit 100');
  if v_count_plan !~ 'Index Only Scan using idx_sales_invoices_health_missing_classification_branch_v1' then
    raise exception 'count is not answerable index-only under RLS:%', E'\n' || v_count_plan;
  end if;
  if v_sample_plan !~ 'Index Only Scan using idx_sales_invoices_health_missing_classification_branch_v1' then
    raise exception 'sample is not answerable index-only under RLS:%', E'\n' || v_sample_plan;
  end if;
end;
$$;

-- Mutation (rolled back): without the covering index the RLS branch filter forces heap access.
do $$
declare v_plan text;
begin
  begin
    drop index public.idx_sales_invoices_health_missing_classification_branch_v1;
    v_plan := pg_temp.classification_plan('select count(*) from public.sales_invoices where customer_segment is null and customer_type is null');
    if v_plan ~ 'Index Only Scan' then
      raise exception using errcode = 'P0901', message = 'index-only plan possible without the covering index; test is vacuous';
    end if;
    raise exception using errcode = 'P0902', message = 'detected';
  exception
    when sqlstate 'P0901' then raise;
    when sqlstate 'P0902' then null;
  end;
  if to_regclass('public.idx_sales_invoices_health_missing_classification_branch_v1') is null then
    raise exception 'rolled-back mutation removed the covering index';
  end if;
end;
$$;

-- Results are unchanged: the index alters plans only.
do $$
declare v_count bigint;
begin
  perform set_config('test.invoice_scope', 'فرع شكري', true);
  set local role anon;
  select count(*) into v_count from public.sales_invoices where customer_segment is null and customer_type is null;
  reset role;
  if v_count <> (select count(*) from public.sales_invoices where branch = 'فرع شكري' and customer_segment is null and customer_type is null) then
    raise exception 'index changed visible results';
  end if;
end;
$$;
