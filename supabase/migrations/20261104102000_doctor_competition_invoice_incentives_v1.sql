create or replace function public.get_doctor_competition_invoice_incentives_v1(
  p_start date, p_end date, p_branch text default null
)
returns table(staff_id text, branch text, list_units numeric, stagnant_units numeric, incentive_egp numeric)
language sql stable security invoker
set search_path = public, pg_catalog
as $function$
  with headers as (
    select h.id, h.staff_id::text as seller, h.sale_date, h.invoice_number, h.customer_code,
           h.save_status, h.invoice_type, public.dawaa_customer_request_branch_key(h.branch) as branch_key,
           count(*) over (partition by h.sale_date, h.invoice_number,
             public.dawaa_customer_request_branch_key(h.branch)) as header_count
    from public.sales_invoices h
    where h.sale_date between p_start and p_end
      and (p_branch is null or public.dawaa_customer_request_branch_key(h.branch)
        = public.dawaa_customer_request_branch_key(p_branch))
  ), line_candidates as (
    select h.id, h.seller, h.sale_date, h.branch_key, i.line_no, btrim(i.product_code) as product_code,
           i.quantity,
           case when i.raw_data->>'returned' ~ '^[0-9]+([.][0-9]+)?$'
                then (i.raw_data->>'returned')::numeric
                when coalesce(i.raw_data->>'returned', '') in ('', 'false') then 0
           end as returned
    from headers h
    join public.get_eligible_doctor_accounts() a on a.staff_id = h.seller
    join public.sales_invoice_items_v21 i on i.invoice_id = h.id
      and i.invoice_number = h.invoice_number
      and public.dawaa_customer_request_branch_key(i.branch) = h.branch_key
    where h.header_count = 1 and h.seller is not null
      and h.branch_key in ('shokry', 'elshamy')
      and h.save_status = 'تم حفظها'
      and coalesce(h.invoice_type, '') !~ 'مرتجع|إلغاء|ملغ'
      and nullif(btrim(h.customer_code), '') is not null
      and not public.dawaa_is_sales_target_excluded_customer_v1(null, h.customer_code)
      and (nullif(btrim(i.customer_code), '') is null or btrim(i.customer_code) = btrim(h.customer_code))
      and i.line_no > 0 and nullif(btrim(i.product_code), '') is not null
  ), lines as (
    select id, seller, sale_date, branch_key, line_no, product_code,
           greatest(min(quantity - returned), 0) as units
    from line_candidates
    group by id, seller, sale_date, branch_key, line_no, product_code
    having count(*) filter (where quantity is null or returned is null) = 0
       and count(distinct (quantity, returned)) = 1
  ), catalog as (
    select btrim(m.product_code) as product_code, m.branch,
           m.effective_date as starts, m.expiry_date as ends, m.incentive_value as rate, 'list' as kind
    from public.incentive_medicines m
    where m.active and coalesce(m.incentive_type, 'fixed') = 'fixed' and m.incentive_value > 0
    union all
    select btrim(m.product_code), coalesce(nullif(m.branch_name, ''), m.branch),
           coalesce(m.stagnant_file_date, m.source_file_date, m.upload_date),
           null::date, m.incentive_per_unit, 'stagnant'
    from public.stagnant_medicines m
    where m.incentive_per_unit > 0
      and coalesce(m.stagnant_file_date, m.source_file_date, m.upload_date) is not null
      and coalesce(m.status, '') not in ('inactive','archived','cancelled')
  ), ranked as (
    select l.*, c.kind, c.rate,
           dense_rank() over (partition by l.id, l.line_no, l.product_code
             order by (c.kind = 'list') desc,
                      (public.dawaa_customer_request_branch_key(c.branch) = l.branch_key) desc,
                      c.starts desc nulls last) as priority
    from lines l
    join catalog c on c.product_code = l.product_code
      and (public.dawaa_customer_request_branch_key(c.branch) = l.branch_key or btrim(c.branch) = 'كل الفروع')
      and (c.starts is null or c.starts <= l.sale_date)
      and (c.ends is null or c.ends >= l.sale_date)
    where l.units > 0
  ), priced as (
    select seller, branch_key, id, line_no, product_code, kind, units, min(rate) as rate
    from ranked where priority = 1
    group by seller, branch_key, id, line_no, product_code, kind, units
    having count(distinct rate) = 1
  )
  select seller, case branch_key when 'shokry' then 'فرع شكري' else 'فرع الشامي' end,
         coalesce(sum(units) filter (where kind = 'list'), 0),
         coalesce(sum(units) filter (where kind = 'stagnant'), 0),
         sum(units * rate)
  from priced
  group by seller, branch_key
$function$;

revoke all on function public.get_doctor_competition_invoice_incentives_v1(date,date,text) from public;
grant execute on function public.get_doctor_competition_invoice_incentives_v1(date,date,text) to anon, authenticated, service_role;
