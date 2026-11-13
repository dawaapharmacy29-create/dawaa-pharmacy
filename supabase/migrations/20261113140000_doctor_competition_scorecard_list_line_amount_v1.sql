-- Doctor competition scorecard facts: list value from the line amount.
--
-- In sales_invoice_items_v21, unit_price is the amount of the whole line: across invoices with a
-- quantity other than 1, the lines' unit_price adds up to the invoice total, while unit_price x quantity
-- never does. line_total is unit_price x quantity, so it is wrong for those lines. The list value used
-- line_total, so 2 boxes sold for 192 counted 384 and a third of a box sold for 188 counted 62.
-- The value of the eligible units is now unit_price / quantity x units.
--
-- Rollback: re-apply 20261113130000_doctor_competition_scorecard_attendance_counts_v1.sql.

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
           round(coalesce(sum(i.value_per_unit * l.units) filter (where l.kind = 'list'), 0), 2) as list_value,
           round(coalesce(sum(l.units * l.rate) filter (where l.kind = 'list'), 0), 2) as list_incentive,
           count(distinct l.product_code) filter (where l.kind = 'list') as list_products,
           round(coalesce(sum(l.units) filter (where l.kind = 'stagnant'), 0), 2) as stagnant_units,
           round(coalesce(sum(i.value_per_unit * l.units) filter (where l.kind = 'stagnant'), 0), 2) as stagnant_value,
           round(coalesce(sum(l.units * l.rate) filter (where l.kind = 'stagnant'), 0), 2) as stagnant_incentive
    from public.get_list_incentive_invoice_lines_v1(p_start, p_end, null) l
    left join lateral (
      -- unit_price holds the LINE amount (it sums to the invoice total); line_total is unit_price x quantity
      -- and wrong whenever the quantity is not 1 (2 boxes at 192 read 384, a third of a box at 188 read 62).
      select x.unit_price / nullif(x.quantity, 0) as value_per_unit
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
