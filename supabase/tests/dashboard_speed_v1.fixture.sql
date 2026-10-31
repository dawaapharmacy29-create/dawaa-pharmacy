-- Synthetic isolated fixture (no production IDs).
create role anon;
create role authenticated;

create function public.dawaa_customer_request_branch_key(p_branch text) returns text language sql immutable
set search_path to 'public', 'pg_catalog' as $$ select lower(trim(p_branch)) $$;

create table public.sales_invoices(id uuid primary key default gen_random_uuid(), branch text, invoice_date timestamptz,
  customer_code text, save_status text, invoice_type text, net_total numeric, net_amount numeric,
  discounted_amount numeric, total_amount numeric, amount numeric, invoice_no text, seller_name text,
  analysis_datetime timestamptz, customer_name text, whatsapp_phone text, invoice_datetime timestamptz,
  staff_id text, customer_phone text, phone text);
create index idx_sales_invoices_invoice_no_key on public.sales_invoices(invoice_no, invoice_date, branch);
create index sales_invoices_customer_phone_idx on public.sales_invoices(customer_phone);

create view public.dawaa_sales_invoices_dashboard_v1 as
  select * from public.sales_invoices si
  where lower(coalesce(save_status, '')) !~ '(pending|draft)' and btrim(coalesce(customer_code, '')) <> all (array['5']);

-- Three closed months, the current month, a pending invoice and an internal customer that never count.
insert into public.sales_invoices(branch, invoice_date, customer_code, save_status, net_total, amount)
select case when g % 2 = 0 then 'فرع شكري' else 'فرع الشامي' end,
       date_trunc('month', now()) - make_interval(months => g % 4) + make_interval(days => g % 20),
       'C' || g, 'saved', 100 + g, 0
from generate_series(1, 200) g;
insert into public.sales_invoices(branch, invoice_date, customer_code, save_status, net_total) values
  ('فرع شكري', date_trunc('month', now()) - interval '1 month' + interval '3 days', 'C1', 'pending', 9999),
  ('فرع شكري', date_trunc('month', now()) - interval '1 month' + interval '3 days', '5', 'saved', 9999);

-- The previous definition, kept to compare results.
create function public.old_monthly_sales(p_end date, p_branch text default null, p_months integer default 5)
returns table(month_start date, month_end date, invoices_count bigint, sales_total numeric)
language sql stable as $function$
with months as (
  select m.month_start,
         case when m.month_start = date_trunc('month', p_end)::date
                then least(p_end, (m.month_start + interval '1 month' - interval '1 day')::date)
              else (m.month_start + interval '1 month' - interval '1 day')::date end as month_end
  from (select (date_trunc('month', p_end) - make_interval(months => g))::date as month_start
        from generate_series(0, greatest(1, least(coalesce(p_months, 5), 24)) - 1) g) m
), s as (
  select si.invoice_date,
         coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0) v
  from public.dawaa_sales_invoices_dashboard_v1 si
  where si.invoice_date >= (select min(month_start) from months) and si.invoice_date < (p_end + 1)::timestamp
    and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch)
)
select m.month_start, m.month_end, count(s.v)::bigint, coalesce(sum(s.v),0)::numeric
from months m left join s on s.invoice_date >= m.month_start and s.invoice_date < (m.month_end + 1)::timestamp
group by m.month_start, m.month_end order by m.month_start;
$function$;
