-- Keep customer metrics synchronized with the canonical operational invoice truth
-- without running a full customer-summary rebuild after every invoice import.

create or replace function public.refresh_customer_metrics_for_codes_v1(p_customer_codes text[])
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_codes text[];
  v_rows integer := 0;
begin
  select array_agg(distinct btrim(code))
    into v_codes
  from unnest(coalesce(p_customer_codes, array[]::text[])) as t(code)
  where nullif(btrim(code), '') is not null;

  if coalesce(cardinality(v_codes), 0) = 0 then
    return 0;
  end if;

  delete from public.customer_metrics_summary cms
  where nullif(btrim(cms.customer_code), '') = any(v_codes)
    and not exists (
      select 1
      from public.dawaa_sales_invoices_dashboard_v1 si
      where nullif(btrim(si.customer_code), '') = nullif(btrim(cms.customer_code), '')
        and si.invoice_date is not null
    );

  insert into public.customer_metrics_summary (
    final_customer_key,
    customer_id,
    customer_code,
    customer_name,
    customer_phone,
    branch,
    invoices_count,
    total_spent,
    avg_invoice,
    first_purchase,
    last_purchase,
    active_months,
    avg_monthly,
    segment_value,
    segment,
    customer_status,
    total_purchases,
    updated_at
  )
  with invoice_base as (
    select
      btrim(si.customer_code) as customer_code,
      si.customer_id::text as customer_id,
      nullif(btrim(si.customer_name), '') as invoice_customer_name,
      public.dawaa_clean_customer_phone(si.customer_phone, si.customer_code) as invoice_customer_phone,
      nullif(btrim(si.branch), '') as branch,
      si.invoice_number,
      si.invoice_date::date as sale_date,
      coalesce(
        nullif(si.net_total, 0),
        nullif(si.net_amount, 0),
        nullif(si.discounted_amount, 0),
        nullif(si.total_amount, 0),
        nullif(si.amount, 0),
        0
      )::numeric as net_value
    from public.dawaa_sales_invoices_dashboard_v1 si
    where si.invoice_date is not null
      and nullif(btrim(si.customer_code), '') = any(v_codes)
  ),
  invoice_rollup as (
    select
      customer_code,
      (array_agg(customer_id order by sale_date desc) filter (where customer_id is not null))[1] as customer_id,
      (array_agg(invoice_customer_name order by sale_date desc) filter (where invoice_customer_name is not null))[1] as invoice_customer_name,
      (array_agg(invoice_customer_phone order by sale_date desc) filter (where invoice_customer_phone is not null))[1] as invoice_customer_phone,
      count(distinct nullif(branch, '')) as branch_count,
      (array_agg(branch order by sale_date desc) filter (where branch is not null))[1] as latest_branch,
      count(distinct concat_ws('|', coalesce(invoice_number::text, ''), coalesce(branch, ''), sale_date::text))::bigint as invoices_count,
      sum(net_value)::numeric as total_spent,
      min(sale_date) as first_purchase,
      max(sale_date) as last_purchase,
      greatest(1, count(distinct date_trunc('month', sale_date)))::integer as active_months
    from invoice_base
    group by customer_code
  ),
  resolved as (
    select
      ir.customer_code as final_customer_key,
      coalesce(ir.customer_id, c.id::text) as customer_id,
      ir.customer_code,
      coalesce(nullif(btrim(c.name), ''), ir.invoice_customer_name, 'عميل غير مسجل') as customer_name,
      coalesce(
        public.dawaa_clean_customer_phone(c.whatsapp_phone, ir.customer_code),
        public.dawaa_clean_customer_phone(c.phone, ir.customer_code),
        public.dawaa_clean_customer_phone(c.phone_alt, ir.customer_code),
        ir.invoice_customer_phone
      ) as customer_phone,
      case
        when ir.branch_count > 1 then 'متعدد الفروع'
        else coalesce(ir.latest_branch, nullif(btrim(c.branch), ''))
      end as branch,
      ir.invoices_count,
      ir.total_spent,
      case when ir.invoices_count > 0 then ir.total_spent / ir.invoices_count::numeric else 0::numeric end as avg_invoice,
      ir.first_purchase,
      ir.last_purchase,
      ir.active_months,
      case when ir.active_months > 0 then ir.total_spent / ir.active_months::numeric else 0::numeric end as avg_monthly
    from invoice_rollup ir
    left join lateral (
      select c.*
      from public.customers c
      where nullif(btrim(c.customer_code), '') = ir.customer_code
      order by c.updated_at desc nulls last, c.id desc
      limit 1
    ) c on true
  )
  select
    final_customer_key,
    customer_id,
    customer_code,
    customer_name,
    customer_phone,
    branch,
    invoices_count,
    total_spent,
    avg_invoice,
    first_purchase,
    last_purchase,
    active_months,
    avg_monthly,
    avg_monthly,
    public.dawaa_customer_segment_from_avg_monthly(avg_monthly),
    public.dawaa_customer_status_from_dates(invoices_count::integer, first_purchase, last_purchase),
    total_spent,
    now()
  from resolved
  on conflict (final_customer_key) do update set
    customer_id = excluded.customer_id,
    customer_code = excluded.customer_code,
    customer_name = excluded.customer_name,
    customer_phone = excluded.customer_phone,
    branch = excluded.branch,
    invoices_count = excluded.invoices_count,
    total_spent = excluded.total_spent,
    avg_invoice = excluded.avg_invoice,
    first_purchase = excluded.first_purchase,
    last_purchase = excluded.last_purchase,
    active_months = excluded.active_months,
    avg_monthly = excluded.avg_monthly,
    segment_value = excluded.segment_value,
    segment = excluded.segment,
    customer_status = excluded.customer_status,
    total_purchases = excluded.total_purchases,
    updated_at = excluded.updated_at;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

revoke all on function public.refresh_customer_metrics_for_codes_v1(text[]) from public, anon, authenticated;
grant execute on function public.refresh_customer_metrics_for_codes_v1(text[]) to service_role;

create or replace function public.refresh_customer_metrics_after_sales_invoice_insert_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_codes text[];
begin
  select array_agg(distinct btrim(customer_code))
    into v_codes
  from new_rows
  where nullif(btrim(customer_code), '') is not null;

  perform public.refresh_customer_metrics_for_codes_v1(v_codes);
  return null;
end;
$function$;

create or replace function public.refresh_customer_metrics_after_sales_invoice_update_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_codes text[];
begin
  select array_agg(distinct code)
    into v_codes
  from (
    select btrim(customer_code) as code
    from new_rows
    where nullif(btrim(customer_code), '') is not null
    union
    select btrim(customer_code) as code
    from old_rows
    where nullif(btrim(customer_code), '') is not null
  ) s;

  perform public.refresh_customer_metrics_for_codes_v1(v_codes);
  return null;
end;
$function$;

create or replace function public.refresh_customer_metrics_after_sales_invoice_delete_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_codes text[];
begin
  select array_agg(distinct btrim(customer_code))
    into v_codes
  from old_rows
  where nullif(btrim(customer_code), '') is not null;

  perform public.refresh_customer_metrics_for_codes_v1(v_codes);
  return null;
end;
$function$;

revoke all on function public.refresh_customer_metrics_after_sales_invoice_insert_v1() from public, anon, authenticated;
revoke all on function public.refresh_customer_metrics_after_sales_invoice_update_v1() from public, anon, authenticated;
revoke all on function public.refresh_customer_metrics_after_sales_invoice_delete_v1() from public, anon, authenticated;

drop trigger if exists sales_invoices_refresh_customer_metrics_insert_v1 on public.sales_invoices;
create trigger sales_invoices_refresh_customer_metrics_insert_v1
after insert on public.sales_invoices
referencing new table as new_rows
for each statement execute function public.refresh_customer_metrics_after_sales_invoice_insert_v1();

drop trigger if exists sales_invoices_refresh_customer_metrics_update_v1 on public.sales_invoices;
create trigger sales_invoices_refresh_customer_metrics_update_v1
after update on public.sales_invoices
referencing old table as old_rows new table as new_rows
for each statement execute function public.refresh_customer_metrics_after_sales_invoice_update_v1();

drop trigger if exists sales_invoices_refresh_customer_metrics_delete_v1 on public.sales_invoices;
create trigger sales_invoices_refresh_customer_metrics_delete_v1
after delete on public.sales_invoices
referencing old table as old_rows
for each statement execute function public.refresh_customer_metrics_after_sales_invoice_delete_v1();

-- The fast customer batch read must use the same operational invoice truth as
-- customer_metrics_summary. Reading raw sales_invoices can re-introduce pending,
-- internal, or otherwise excluded rows into the customer cards.
create or replace function public.get_customer_invoice_metrics_batch_v1(p_customer_codes text[])
returns table(
  customer_code text,
  invoices_count bigint,
  total_spent numeric,
  first_purchase date,
  last_purchase date,
  active_months bigint
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $function$
  select
    btrim(si.customer_code) as customer_code,
    count(distinct concat_ws('|', coalesce(si.invoice_number::text,''), coalesce(si.branch,''), si.invoice_date::date::text))::bigint as invoices_count,
    coalesce(sum(
      coalesce(
        nullif(si.net_total,0),
        nullif(si.net_amount,0),
        nullif(si.discounted_amount,0),
        nullif(si.total_amount,0),
        nullif(si.amount,0),
        0
      )
    ),0)::numeric as total_spent,
    min(si.invoice_date::date) as first_purchase,
    max(si.invoice_date::date) as last_purchase,
    count(distinct to_char(si.invoice_date, 'YYYY-MM'))::bigint as active_months
  from public.dawaa_sales_invoices_dashboard_v1 si
  where p_customer_codes is not null
    and cardinality(p_customer_codes) > 0
    and nullif(btrim(si.customer_code),'') = any(p_customer_codes)
    and si.invoice_date is not null
  group by btrim(si.customer_code);
$function$;

grant execute on function public.get_customer_invoice_metrics_batch_v1(text[]) to anon, authenticated;
