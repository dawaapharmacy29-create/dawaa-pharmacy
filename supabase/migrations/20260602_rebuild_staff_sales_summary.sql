create or replace function public.rebuild_staff_sales_summary(
  p_start_date date,
  p_end_date date
)
returns table (
  deleted_rows integer,
  inserted_rows integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
  v_inserted integer := 0;
  v_relkind text;
begin
  select c.relkind
    into v_relkind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'staff_sales_summary';

  if v_relkind is null then
    raise exception 'staff_sales_summary does not exist';
  end if;

  if v_relkind = 'm' then
    refresh materialized view public.staff_sales_summary;
    select count(*) into v_inserted
    from public.staff_sales_summary
    where sale_date between p_start_date and p_end_date;
    return query select 0, v_inserted;
    return;
  end if;

  if v_relkind = 'v' then
    select count(*) into v_inserted
    from public.staff_sales_summary
    where sale_date between p_start_date and p_end_date;
    return query select 0, v_inserted;
    return;
  end if;

  delete from public.staff_sales_summary
  where sale_date between p_start_date and p_end_date;
  get diagnostics v_deleted = row_count;

  insert into public.staff_sales_summary (
    sale_date,
    branch,
    seller_name,
    invoices_count,
    net_total,
    avg_invoice,
    unique_customers
  )
  select
    invoice_date::date as sale_date,
    nullif(trim(coalesce(branch, '')), '') as branch,
    nullif(trim(coalesce(seller_name, '')), '') as seller_name,
    count(distinct concat_ws('|', coalesce(invoice_number::text, ''), coalesce(branch, ''), invoice_date::date::text))::integer as invoices_count,
    sum(coalesce(net_amount, discounted_amount, amount, 0))::numeric as net_total,
    (
      sum(coalesce(net_amount, discounted_amount, amount, 0))
      / nullif(count(distinct concat_ws('|', coalesce(invoice_number::text, ''), coalesce(branch, ''), invoice_date::date::text)), 0)
    )::numeric as avg_invoice,
    count(distinct nullif(customer_code, ''))::integer as unique_customers
  from public.sales_invoices
  where invoice_date::date between p_start_date and p_end_date
  group by
    invoice_date::date,
    nullif(trim(coalesce(branch, '')), ''),
    nullif(trim(coalesce(seller_name, '')), '');
  get diagnostics v_inserted = row_count;

  perform pg_notify('pgrst', 'reload schema');
  return query select v_deleted, v_inserted;
end;
$$;
