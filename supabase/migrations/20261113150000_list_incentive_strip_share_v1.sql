-- List incentive: a strip sold out of a box earns a strip's share, from the 2026-10-26 cycle on.
--
-- Strips are often typed as quantity 1 at the strip's price: flamotal 400 at 15.5 of a 46.5 box,
-- OMEGAL WOMAN at 130 of a 390 box. get_list_incentive_invoice_lines_v1 counted each as a whole box,
-- so it paid a whole box's incentive. Now a list line priced under 80% of the list's box price
-- (incentive_medicines.product_price) counts units x line price / box price. Lines at or near the box
-- price, discounts up to 20%, stagnant lines and every sale before 2026-10-26 are unchanged.
--
-- The competition scorecard's list value now takes each line's own amount (less any returned part)
-- instead of value per unit x units, so it keeps the money the strip brought in.
--
-- Rollback: re-apply the get_list_incentive_invoice_lines_v1 definition in
-- 20261109120000_schedule_actuals_and_list_invoice_lines_v1.sql, then
-- 20261113140000_doctor_competition_scorecard_list_line_amount_v1.sql.

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
           i.line_no, btrim(i.product_code) as product_code, i.quantity, i.unit_price as line_amount,
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
           greatest(min(quantity - returned), 0) as units, min(quantity) as quantity, min(line_amount) as line_amount
    from line_candidates
    group by id, invoice_number, seller, seller_label, sale_date, branch_key, line_no, product_code
    having count(*) filter (where quantity is null or returned is null) = 0
       and count(distinct (quantity, returned)) = 1
  ), catalog as (
    select m.id::text as medicine_id, btrim(m.product_code) as product_code, m.branch,
           m.effective_date as starts, m.expiry_date as ends, m.incentive_value as rate, 'list' as kind,
           m.product_price as box_price
    from public.incentive_medicines m
    where m.active and coalesce(m.incentive_type, 'fixed') = 'fixed' and m.incentive_value > 0
    union all
    select null::text, btrim(m.product_code), coalesce(nullif(m.branch_name, ''), m.branch),
           coalesce(m.stagnant_file_date, m.source_file_date, m.upload_date),
           null::date, m.incentive_per_unit, 'stagnant', null::numeric
    from public.stagnant_medicines m
    where m.incentive_per_unit > 0
      and coalesce(m.stagnant_file_date, m.source_file_date, m.upload_date) is not null
      and coalesce(m.status, '') not in ('inactive','archived','cancelled')
  ), ranked as (
    select l.*, c.kind, c.rate, c.medicine_id, c.box_price,
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
           kind, units, min(quantity) as quantity, min(line_amount) as line_amount,
           min(box_price) as box_price, min(rate) as rate, min(medicine_id) as medicine_id
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
         p.product_code, p.medicine_id, p.kind,
         -- A strip sold out of a box is often typed as quantity 1 at the strip's price (flamotal 400 at
         -- 15.5 of a 46.5 box). From the 2026-10-26 cycle on, a list line priced under 80% of the list's
         -- box price counts the share of a box it was sold for, so a strip earns a strip's incentive.
         case when p.kind = 'list' and p.sale_date >= date '2026-10-26' and p.box_price > 0
                   and p.quantity > 0 and p.line_amount > 0
                   and p.line_amount / p.quantity < p.box_price * 0.8
              then round(p.units * (p.line_amount / p.quantity) / p.box_price, 2)
              else p.units end,
         p.rate
  from priced p
$function$;


revoke all on function public.get_list_incentive_invoice_lines_v1(date, date, text) from public;
grant execute on function public.get_list_incentive_invoice_lines_v1(date, date, text) to anon, authenticated, service_role;

create or replace function public.get_doctor_competition_scorecard_facts_v1(p_start date, p_end date)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_list jsonb;
  v_followups jsonb;
  v_requests jsonb;
  v_attendance jsonb := null;
  v_full_attendance boolean := coalesce(public.dawaa_current_actor_can(array['view_attendance_leaves', 'view_schedule', 'manage_payroll']), false);
begin
  if public.dawaa_current_staff_account_id_strict() is null then
    raise exception 'scorecard_not_authorized' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 100 then
    raise exception 'scorecard_invalid_range' using errcode = '22023';
  end if;

  -- List and stagnant lines: units, their share of the line's value, and the incentive.
  select coalesce(jsonb_agg(jsonb_build_object(
           'staff_id', x.seller_id, 'branch', x.branch,
           'list_units', x.list_units, 'list_value', x.list_value, 'list_incentive', x.list_incentive,
           'list_products', x.list_products,
           'stagnant_units', x.stagnant_units, 'stagnant_value', x.stagnant_value,
           'stagnant_incentive', x.stagnant_incentive)), '[]'::jsonb)
    into v_list
  from (
    select l.seller_id, l.branch,
           round(coalesce(sum(l.units) filter (where l.kind = 'list'), 0), 2) as list_units,
           round(coalesce(sum(i.line_value) filter (where l.kind = 'list'), 0), 2) as list_value,
           round(coalesce(sum(l.units * l.rate) filter (where l.kind = 'list'), 0), 2) as list_incentive,
           count(distinct l.product_code) filter (where l.kind = 'list') as list_products,
           round(coalesce(sum(l.units) filter (where l.kind = 'stagnant'), 0), 2) as stagnant_units,
           round(coalesce(sum(i.line_value) filter (where l.kind = 'stagnant'), 0), 2) as stagnant_value,
           round(coalesce(sum(l.units * l.rate) filter (where l.kind = 'stagnant'), 0), 2) as stagnant_incentive
    from public.get_list_incentive_invoice_lines_v1(p_start, p_end, null) l
    left join lateral (
      -- unit_price holds the LINE amount (it sums to the invoice total). The line's value is that amount
      -- less any returned part; it no longer follows l.units, which counts a strip as a share of a box.
      select x.unit_price * greatest(0, 1 - coalesce(case when x.raw_data->>'returned' ~ '^[0-9]+([.][0-9]+)?$'
               then (x.raw_data->>'returned')::numeric end, 0) / nullif(x.quantity, 0)) as line_value
      from public.sales_invoice_items_v21 x
      where x.invoice_id::text = l.invoice_id
        and x.line_no = l.line_no
        and btrim(x.product_code) = l.product_code
      order by x.updated_at desc nulls last
      limit 1
    ) i on true
    where l.attribution = 'eligible'
    group by l.seller_id, l.branch
  ) x;

  -- Follow-up requests, credited to the branch the doctor worked in that day.
  with logd as (
    select l.staff_id, l.request_day, btrim(s.branch) as home, count(*) as requests
    from public.doctor_followup_request_log_v1 l
    join public.staff s on s.id = l.staff_id
    where l.request_day between p_start and p_end
    group by 1, 2, 3
  ), sold as (
    select distinct on (v.staff_id, v.sale_date) v.staff_id, v.sale_date, btrim(v.branch) as branch
    from public.dawaa_sales_invoices_dashboard_v1 v
    where v.sale_date between p_start and p_end
      and nullif(v.staff_id, '') is not null
      and public.dawaa_customer_request_branch_key(v.branch) in ('shokry', 'elshamy')
    group by v.staff_id, v.sale_date, v.branch
    order by v.staff_id, v.sale_date, count(*) desc
  ), att as (
    select distinct on (a.staff_id, a.attendance_date) a.staff_id, a.attendance_date, btrim(a.branch) as branch
    from public.attendance_daily_summary a
    where a.attendance_date between p_start and p_end
      and public.dawaa_customer_request_branch_key(a.branch) in ('shokry', 'elshamy')
      and coalesce(a.resolution_status, '') not in ('off_day', 'approved_time_off', 'employment_ended', 'absence_review')
    order by a.staff_id, a.attendance_date, a.first_in nulls last
  )
  select coalesce(jsonb_agg(jsonb_build_object('staff_id', f.staff_id, 'branch', f.branch, 'requests', f.requests,
           'days', f.days)), '[]'::jsonb)
    into v_followups
  from (
    select l.staff_id::text as staff_id, coalesce(sold.branch, att.branch, l.home) as branch,
           sum(l.requests)::int as requests, count(distinct l.request_day)::int as days
    from logd l
    left join sold on sold.staff_id = l.staff_id::text and sold.sale_date = l.request_day
    left join att on att.staff_id = l.staff_id and att.attendance_date = l.request_day
    group by 1, 2
  ) f;

  -- Customer requests, credited to the doctor who recorded them.
  select coalesce(jsonb_agg(jsonb_build_object('staff_id', q.staff_id, 'branch', q.branch, 'requests', q.requests,
           'fulfilled', q.fulfilled)), '[]'::jsonb)
    into v_requests
  from (
    select coalesce(nullif(r.source_recorded_staff_id::text, ''), nullif(r.created_by::text, '')) as staff_id,
           btrim(r.branch) as branch,
           count(*)::int as requests,
           count(*) filter (where r.status in ('delivered', 'available'))::int as fulfilled
    from public.customer_requests r
    where r.created_at >= (p_start::timestamp at time zone 'Africa/Cairo')
      and r.created_at < ((p_end + 1)::timestamp at time zone 'Africa/Cairo')
      and coalesce(r.status, '') <> 'cancelled'
    group by 1, 2
  ) q
  where q.staff_id is not null;

  -- Attendance commitment. Everyone gets the day counts the score is made of, so the ranking is the
  -- same for every viewer; minutes late, on-time days and days under review stay with people allowed
  -- to see attendance.
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'staff_id', a.staff_id, 'shift_days', a.shift_days,
             'on_time_days', case when v_full_attendance then a.on_time_days end,
             'late_days', a.late_days, 'late_minutes', case when v_full_attendance then a.late_minutes end,
             'early_leave_days', a.early_leave_days, 'absence_days', a.absence_days,
             'under_review_days', case when v_full_attendance then a.under_review_days end)), '[]'::jsonb)
      into v_attendance
    from (
      select s.staff_id::text as staff_id,
             count(*) filter (where s.worked)::int as shift_days,
             count(*) filter (where s.worked and coalesce(s.late_minutes, 0) <= 15
               and s.resolution_status <> 'early_leave_review')::int as on_time_days,
             count(*) filter (where s.worked and coalesce(s.late_minutes, 0) > 15)::int as late_days,
             coalesce(sum(s.late_minutes) filter (where s.worked and coalesce(s.late_minutes, 0) > 15), 0)::int as late_minutes,
             count(*) filter (where s.worked and s.resolution_status = 'early_leave_review')::int as early_leave_days,
             count(*) filter (where s.status = 'approved' and s.resolution_status = 'absence_review')::int as absence_days,
             count(*) filter (where s.status = 'pending_review')::int as under_review_days
      from (
        select a.staff_id, a.status, coalesce(a.resolution_status, '') as resolution_status, a.late_minutes,
               (a.status = 'approved'
                 and coalesce(a.resolution_status, '') not in ('off_day', 'approved_time_off', 'employment_ended', 'absence_review', 'flexible_no_activity')) as worked
        from public.attendance_daily_summary a
        where a.attendance_date between p_start and p_end
      ) s
      group by s.staff_id
    ) a;
  end;

  return jsonb_build_object('list', v_list, 'followups', v_followups, 'requests', v_requests,
    'attendance', v_attendance);
end;
$function$;

revoke all on function public.get_doctor_competition_scorecard_facts_v1(date, date) from public;
grant execute on function public.get_doctor_competition_scorecard_facts_v1(date, date) to authenticated, service_role;
