create or replace function public.rebuild_sales_daily_summary(
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
  v_gross_expr text;
  v_relkind text;
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'start_date and end_date are required';
  end if;

  if p_end_date < p_start_date then
    raise exception 'end_date must be greater than or equal to start_date';
  end if;

  select c.relkind
  into v_relkind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'sales_daily_summary';

  if v_relkind = 'm' then
    refresh materialized view public.sales_daily_summary;

    select count(*)::integer
    into v_inserted
    from public.sales_daily_summary
    where sale_date between p_start_date and p_end_date;

    return query select 0, v_inserted;
    return;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sales_invoices'
      and column_name = 'original_amount'
  ) then
    v_gross_expr := 'coalesce(gross_amount, original_amount, net_amount, discounted_amount, amount, 0)';
  else
    v_gross_expr := 'coalesce(gross_amount, net_amount, discounted_amount, amount, 0)';
  end if;

  delete from public.sales_daily_summary
  where sale_date between p_start_date and p_end_date;

  get diagnostics v_deleted = row_count;

  execute format($sql$
    insert into public.sales_daily_summary (
      sale_date,
      branch,
      shift_name,
      seller_name,
      invoice_type,
      invoices_count,
      net_total,
      gross_total,
      discount_total,
      avg_invoice,
      unique_customers,
      delivery_invoices_count
    )
    select
      invoice_date::date as sale_date,
      nullif(trim(coalesce(branch, '')), '') as branch,
      nullif(trim(coalesce(shift_name, '')), '') as shift_name,
      nullif(trim(coalesce(seller_name, '')), '') as seller_name,
      nullif(trim(coalesce(invoice_type, '')), '') as invoice_type,
      count(distinct concat_ws('|', coalesce(invoice_number::text, ''), coalesce(branch, ''), invoice_date::date::text))::integer as invoices_count,
      sum(coalesce(net_amount, discounted_amount, amount, 0))::numeric as net_total,
      sum(%s)::numeric as gross_total,
      sum(coalesce(discount_amount, 0))::numeric as discount_total,
      (
        sum(coalesce(net_amount, discounted_amount, amount, 0))
        / nullif(count(distinct concat_ws('|', coalesce(invoice_number::text, ''), coalesce(branch, ''), invoice_date::date::text)), 0)
      )::numeric as avg_invoice,
      count(distinct nullif(customer_code, ''))::integer as unique_customers,
      count(distinct case
        when coalesce(invoice_type, '') ilike '%%توصيل%%'
          or coalesce(invoice_type, '') ilike '%%دليفري%%'
          or coalesce(invoice_type, '') ilike '%%delivery%%'
        then concat_ws('|', coalesce(invoice_number::text, ''), coalesce(branch, ''), invoice_date::date::text)
      end)::integer as delivery_invoices_count
    from public.sales_invoices
    where invoice_date::date between $1 and $2
    group by
      invoice_date::date,
      nullif(trim(coalesce(branch, '')), ''),
      nullif(trim(coalesce(shift_name, '')), ''),
      nullif(trim(coalesce(seller_name, '')), ''),
      nullif(trim(coalesce(invoice_type, '')), '')
  $sql$, v_gross_expr)
  using p_start_date, p_end_date;

  get diagnostics v_inserted = row_count;

  return query select v_deleted, v_inserted;
end;
$$;

drop function if exists public.check_sales_daily_summary_gaps(date, date);

create or replace function public.check_sales_daily_summary_gaps(
  p_start_date date,
  p_end_date date
)
returns table (
  sale_date date,
  branch text,
  raw_invoices_count integer,
  summary_invoices_count integer,
  raw_net_total numeric,
  summary_net_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with raw as (
    select
      invoice_date::date as sale_date,
      nullif(trim(coalesce(branch, '')), '') as branch,
      count(distinct concat_ws('|', coalesce(invoice_number::text, ''), coalesce(branch, ''), invoice_date::date::text))::integer as raw_invoices_count,
      sum(coalesce(net_amount, discounted_amount, amount, 0))::numeric as raw_net_total
    from public.sales_invoices
    where invoice_date::date between p_start_date and p_end_date
    group by
      invoice_date::date,
      nullif(trim(coalesce(branch, '')), '')
  ),
  summary as (
    select
      sale_date,
      nullif(trim(coalesce(branch, '')), '') as branch,
      sum(coalesce(invoices_count, 0))::integer as summary_invoices_count,
      sum(coalesce(net_total, 0))::numeric as summary_net_total
    from public.sales_daily_summary
    where sale_date between p_start_date and p_end_date
    group by
      sale_date,
      nullif(trim(coalesce(branch, '')), '')
  )
  select
    raw.sale_date,
    raw.branch,
    raw.raw_invoices_count,
    coalesce(summary.summary_invoices_count, 0) as summary_invoices_count,
    raw.raw_net_total,
    coalesce(summary.summary_net_total, 0) as summary_net_total
  from raw
  left join summary
    on summary.sale_date = raw.sale_date
   and coalesce(summary.branch, '') = coalesce(raw.branch, '')
  where coalesce(summary.summary_invoices_count, 0) <> raw.raw_invoices_count
     or abs(coalesce(summary.summary_net_total, 0) - raw.raw_net_total) > 1
  order by raw.sale_date, raw.branch;
$$;
