-- 1) Weekly schedule page: actual attendance next to the published plan.
-- Same authorization and staff scope as hr_canonical_schedule_week_v2; bounded to 7 days.
create or replace function public.hr_schedule_week_actual_v1(p_week_start date, p_branch text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_result jsonb;
begin
  if p_week_start is null then raise exception 'week_start_required' using errcode = '22023'; end if;
  if not public.dawaa_current_actor_can(array['view_schedule','view_attendance_leaves']) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with scoped as (
    select s.id
    from public.staff s
    where coalesce(s.active, s.is_active, true)
      and coalesce(s.visible_in_schedule, true)
      and lower(trim(coalesce(s.status, 'active'))) in ('active', 'نشط')
      and (p_branch is null or trim(p_branch) = '' or p_branch = 'الكل' or trim(s.branch) = trim(p_branch))
      and public.dawaa_can_read_staff_attendance_log(s.id, s.branch)
  ), days as (
    select (p_week_start + g)::date as d from generate_series(0, 6) g
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'staff_id', sc.id,
    'date', dy.d,
    'has_summary', a.id is not null,
    'first_in', a.first_in,
    'last_out', a.last_out,
    'status', a.status,
    'resolution_status', a.resolution_status,
    'time_off_kind', t.request_kind
  )), '[]'::jsonb)
  into v_result
  from scoped sc
  cross join days dy
  left join public.attendance_daily_summary a on a.staff_id = sc.id and a.attendance_date = dy.d
  left join lateral (
    select r.request_kind
    from public.staff_time_off_requests r
    where r.staff_id = sc.id
      and r.status = 'approved'
      and r.request_kind in ('annual_leave','sick_leave','exceptional_leave','approved_absence')
      and dy.d between r.start_date and r.end_date
    order by r.start_date desc
    limit 1
  ) t on true;

  return v_result;
end;
$function$;

revoke all on function public.hr_schedule_week_actual_v1(date, text) from public;
grant execute on function public.hr_schedule_week_actual_v1(date, text) to anon, authenticated, service_role;

-- 2) One line-level reader for list/stagnant incentives from real invoices.
-- BConnect invoices carry no save_status, so only an explicitly unsaved status is rejected
-- (same rule as dawaa_sales_invoices_dashboard_v1). Owner-excluded customer codes stay out.
-- Lines without a proven eligible doctor are returned and labelled, never credited.
create or replace function public.get_list_incentive_invoice_lines_v1(
  p_start date, p_end date, p_branch text default null
)
returns table(
  invoice_id text, invoice_number text, sale_date date, branch text, line_no integer,
  seller_id text, seller_name text, attribution text,
  product_code text, medicine_id text, kind text, units numeric, rate numeric
)
language sql stable security invoker
set search_path = public, pg_catalog
as $function$
  with headers as (
    select h.id, h.staff_id::text as seller, coalesce(nullif(btrim(h.staff_name), ''), nullif(btrim(h.seller_name), '')) as seller_label,
           h.sale_date, h.invoice_number, h.customer_code,
           public.dawaa_customer_request_branch_key(h.branch) as branch_key,
           count(*) over (partition by h.sale_date, h.invoice_number,
             public.dawaa_customer_request_branch_key(h.branch)) as header_count
    from public.sales_invoices h
    where h.sale_date between p_start and p_end
      and lower(coalesce(h.save_status, '')) !~ '(معلق|قيد|pending|draft|غير محفوظ)'
      and lower(coalesce(h.invoice_type, '')) !~ '(مرتجع|إلغاء|ملغ|معلق|pending|draft)'
      and (p_branch is null or public.dawaa_customer_request_branch_key(h.branch)
        = public.dawaa_customer_request_branch_key(p_branch))
  ), line_candidates as (
    select h.id, h.invoice_number, h.seller, h.seller_label, h.sale_date, h.branch_key,
           i.line_no, btrim(i.product_code) as product_code, i.quantity,
           case when i.raw_data->>'returned' ~ '^[0-9]+([.][0-9]+)?$'
                then (i.raw_data->>'returned')::numeric
                when coalesce(i.raw_data->>'returned', '') in ('', 'false') then 0
           end as returned
    from headers h
    join public.sales_invoice_items_v21 i on i.invoice_id = h.id
      and i.invoice_number = h.invoice_number
      and public.dawaa_customer_request_branch_key(i.branch) = h.branch_key
    where h.header_count = 1
      and h.branch_key in ('shokry', 'elshamy')
      and nullif(btrim(h.customer_code), '') is not null
      and not public.dawaa_is_sales_target_excluded_customer_v1(null, h.customer_code)
      and (nullif(btrim(i.customer_code), '') is null or btrim(i.customer_code) = btrim(h.customer_code))
      and i.line_no > 0 and nullif(btrim(i.product_code), '') is not null
  ), lines as (
    select id, invoice_number, seller, seller_label, sale_date, branch_key, line_no, product_code,
           greatest(min(quantity - returned), 0) as units
    from line_candidates
    group by id, invoice_number, seller, seller_label, sale_date, branch_key, line_no, product_code
    having count(*) filter (where quantity is null or returned is null) = 0
       and count(distinct (quantity, returned)) = 1
  ), catalog as (
    select m.id::text as medicine_id, btrim(m.product_code) as product_code, m.branch,
           m.effective_date as starts, m.expiry_date as ends, m.incentive_value as rate, 'list' as kind
    from public.incentive_medicines m
    where m.active and coalesce(m.incentive_type, 'fixed') = 'fixed' and m.incentive_value > 0
    union all
    select null::text, btrim(m.product_code), coalesce(nullif(m.branch_name, ''), m.branch),
           coalesce(m.stagnant_file_date, m.source_file_date, m.upload_date),
           null::date, m.incentive_per_unit, 'stagnant'
    from public.stagnant_medicines m
    where m.incentive_per_unit > 0
      and coalesce(m.stagnant_file_date, m.source_file_date, m.upload_date) is not null
      and coalesce(m.status, '') not in ('inactive','archived','cancelled')
  ), ranked as (
    select l.*, c.kind, c.rate, c.medicine_id,
           dense_rank() over (partition by l.id, l.line_no, l.product_code
             order by (c.kind = 'list') desc,
                      (public.dawaa_customer_request_branch_key(c.branch) = l.branch_key) desc,
                      c.starts desc nulls last) as priority
    from lines l
    join catalog c on c.product_code = l.product_code
      and (public.dawaa_customer_request_branch_key(c.branch) = l.branch_key or btrim(c.branch) in ('كل الفروع', 'الكل'))
      and (c.starts is null or c.starts <= l.sale_date)
      and (c.ends is null or c.ends >= l.sale_date)
    where l.units > 0
  ), priced as (
    select id, invoice_number, seller, seller_label, sale_date, branch_key, line_no, product_code,
           kind, units, min(rate) as rate, min(medicine_id) as medicine_id
    from ranked where priority = 1
    group by id, invoice_number, seller, seller_label, sale_date, branch_key, line_no, product_code, kind, units
    having count(distinct rate) = 1
  )
  select p.id::text, p.invoice_number::text, p.sale_date,
         case p.branch_key when 'shokry' then 'فرع شكري' else 'فرع الشامي' end,
         p.line_no::integer, p.seller, p.seller_label,
         case when p.seller is null then 'unlinked'
              when exists (select 1 from public.get_eligible_doctor_accounts() a where a.staff_id = p.seller) then 'eligible'
              else 'not_eligible' end,
         p.product_code, p.medicine_id, p.kind, p.units, p.rate
  from priced p
$function$;

revoke all on function public.get_list_incentive_invoice_lines_v1(date, date, text) from public;
grant execute on function public.get_list_incentive_invoice_lines_v1(date, date, text) to anon, authenticated, service_role;

-- The doctor competition now reads the same lines, so both screens cannot disagree.
create or replace function public.get_doctor_competition_invoice_incentives_v1(
  p_start date, p_end date, p_branch text default null
)
returns table(staff_id text, branch text, list_units numeric, stagnant_units numeric, incentive_egp numeric)
language sql stable security invoker
set search_path = public, pg_catalog
as $function$
  select l.seller_id, l.branch,
         coalesce(sum(l.units) filter (where l.kind = 'list'), 0),
         coalesce(sum(l.units) filter (where l.kind = 'stagnant'), 0),
         sum(l.units * l.rate)
  from public.get_list_incentive_invoice_lines_v1(p_start, p_end, p_branch) l
  where l.attribution = 'eligible'
  group by l.seller_id, l.branch
$function$;
