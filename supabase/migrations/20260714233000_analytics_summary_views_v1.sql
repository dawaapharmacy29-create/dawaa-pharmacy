-- Safe, non-destructive analytics support layer.
-- No DROP/TRUNCATE and no automatic customer updates.

create index if not exists idx_sales_invoices_invoice_date_branch
  on public.sales_invoices (invoice_date, branch);

create index if not exists idx_sales_invoices_invoice_date_seller
  on public.sales_invoices (invoice_date, seller_name);

create index if not exists idx_sales_invoices_customer_code
  on public.sales_invoices (customer_code);

create index if not exists idx_customers_segment_status
  on public.customers (segment, status);

create or replace view public.sales_daily_summary as
select
  si.invoice_date::date as sale_date,
  case
    when lower(coalesce(si.branch_name::text, si.branch::text, '')) ~ 'شامي|shamy|shami' then 'فرع الشامي'
    when lower(coalesce(si.branch_name::text, si.branch::text, '')) ~ 'شكري|شكرى|shokry|shoukry' then 'فرع شكري'
    else nullif(trim(coalesce(si.branch_name::text, si.branch::text)), '')
  end as branch,
  count(*)::bigint as invoices_count,
  sum(
    coalesce(
      si.net_total,
      si.net_amount,
      si.discounted_amount,
      si.total_amount,
      si.amount,
      si.gross_total,
      si.gross_amount,
      0
    )
  )::numeric as net_total,
  avg(
    coalesce(
      si.net_total,
      si.net_amount,
      si.discounted_amount,
      si.total_amount,
      si.amount,
      si.gross_total,
      si.gross_amount,
      0
    )
  )::numeric as avg_invoice,
  count(
    distinct nullif(
      trim(
        coalesce(
          si.customer_code::text,
          si.customer_phone::text,
          si.customer_name::text,
          ''
        )
      ),
      ''
    )
  )::bigint as unique_customers
from public.sales_invoices si
where si.invoice_date is not null
group by 1, 2;

comment on view public.sales_daily_summary is
'Aggregated daily sales summary by normalized branch for analytics pages.';

grant select on public.sales_daily_summary to authenticated;

create or replace view public.staff_sales_summary as
select
  si.invoice_date::date as sale_date,
  nullif(trim(coalesce(si.normalized_seller_name::text, si.seller_name::text, si.staff_name::text, '')), '') as seller_name,
  case
    when lower(coalesce(si.branch_name::text, si.branch::text, '')) ~ 'شامي|shamy|shami' then 'فرع الشامي'
    when lower(coalesce(si.branch_name::text, si.branch::text, '')) ~ 'شكري|شكرى|shokry|shoukry' then 'فرع شكري'
    else nullif(trim(coalesce(si.branch_name::text, si.branch::text)), '')
  end as branch,
  count(*)::bigint as invoices_count,
  sum(
    coalesce(
      si.net_total,
      si.net_amount,
      si.discounted_amount,
      si.total_amount,
      si.amount,
      si.gross_total,
      si.gross_amount,
      0
    )
  )::numeric as net_total,
  avg(
    coalesce(
      si.net_total,
      si.net_amount,
      si.discounted_amount,
      si.total_amount,
      si.amount,
      si.gross_total,
      si.gross_amount,
      0
    )
  )::numeric as avg_invoice,
  count(
    distinct nullif(
      trim(
        coalesce(
          si.customer_code::text,
          si.customer_phone::text,
          si.customer_name::text,
          ''
        )
      ),
      ''
    )
  )::bigint as unique_customers
from public.sales_invoices si
where si.invoice_date is not null
group by 1, 2, 3;

comment on view public.staff_sales_summary is
'Aggregated daily staff sales summary by normalized branch for analytics pages.';

grant select on public.staff_sales_summary to authenticated;

create or replace view public.analytics_customer_cards_v1 as
select
  count(*) filter (
    where coalesce(c.avg_monthly, 0) >= 4000
       or c.segment in ('مهم', 'مهم جدًا', 'VIP', 'vip')
  )::bigint as important,
  count(*) filter (
    where c.status = 'متوقف'
       or c.is_active is false
  )::bigint as stopped,
  count(*) filter (
    where c.status in ('مهدد بالتوقف', 'يحتاج متابعة', 'At Risk', 'at_risk')
  )::bigint as threatened,
  count(*) filter (
    where nullif(trim(coalesce(c.phone::text, '')), '') is null
      and nullif(trim(coalesce(c.mobile::text, '')), '') is null
      and nullif(trim(coalesce(c.whatsapp::text, '')), '') is null
  )::bigint as invalid_phone
from public.customers c;

comment on view public.analytics_customer_cards_v1 is
'Customer analytics cards computed from the customers master table.';

grant select on public.analytics_customer_cards_v1 to authenticated;

create or replace view public.sales_invoices_missing_customer_code_v1 as
select
  si.id,
  si.invoice_number,
  si.invoice_no,
  si.invoice_date,
  si.sale_date,
  coalesce(si.branch_name, si.branch) as branch,
  coalesce(si.normalized_seller_name, si.seller_name, si.staff_name) as seller_name,
  si.customer_name,
  si.customer_phone,
  coalesce(
    si.net_total,
    si.net_amount,
    si.discounted_amount,
    si.total_amount,
    si.amount,
    si.gross_total,
    si.gross_amount,
    0
  )::numeric as invoice_amount
from public.sales_invoices si
where nullif(trim(coalesce(si.customer_code::text, '')), '') is null;

comment on view public.sales_invoices_missing_customer_code_v1 is
'Read-only list of invoices with no customer code for review and reconciliation.';

grant select on public.sales_invoices_missing_customer_code_v1 to authenticated;
