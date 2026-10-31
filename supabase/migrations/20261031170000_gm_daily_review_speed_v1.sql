-- «مراجعتي اليومية» load: the sales-file check read every invoice of the last 10 days (~680 ms on
-- Production); it now takes the newest invoice per branch from the (branch, invoice_date) index (~90 ms).

create or replace function public.get_gm_daily_review_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_yesterday date := v_today - 1;
  v_cycle_start date;
  v_items jsonb := '[]'::jsonb;
  v_detail jsonb;
  v_ok boolean;
  v_n integer;
  v_m integer;
begin
  perform public.gm_daily_review_actor_v1();
  v_cycle_start := case when extract(day from v_today) >= 26
    then make_date(extract(year from v_today)::int, extract(month from v_today)::int, 26)
    else (date_trunc('month', v_today) - interval '1 month')::date + 25 end;

  -- 1) Yesterday's sales file reached both branches. The stored branch names go straight to the
  --    (branch, invoice_date) index: newest invoice per branch, no scan of the last days.
  select jsonb_agg(jsonb_build_object('branch', b.k, 'last_day', x.last_day) order by b.k),
         bool_and(coalesce(x.last_day >= v_yesterday, false))
    into v_detail, v_ok
  from (values ('shokry', 'فرع شكري'), ('elshamy', 'فرع الشامي')) b(k, name)
  left join lateral (
    select (si.invoice_date at time zone 'Africa/Cairo')::date last_day
    from public.sales_invoices si
    where si.branch = b.name and si.invoice_date >= v_today - 10
    order by si.invoice_date desc
    limit 1
  ) x on true;
  v_items := v_items || jsonb_build_object('key', 'sales_upload', 'kind', 'auto', 'ok', v_ok, 'detail', v_detail);

  -- 2) Yesterday's attendance: rows still waiting for review, missing punches, late over 15 minutes.
  select jsonb_agg(jsonb_build_object('branch', b.k, 'pending', coalesce(x.pending, 0),
           'missing', coalesce(x.missing, 0), 'late', coalesce(x.late, 0)) order by b.k),
         bool_and(coalesce(x.pending, 0) = 0)
    into v_detail, v_ok
  from (values ('shokry'), ('elshamy')) b(k)
  left join lateral (
    select count(*) filter (where a.status = 'pending_review') pending,
           count(*) filter (where a.missing_punch) missing,
           count(*) filter (where coalesce(a.late_minutes, 0) > 15) late
    from public.attendance_daily_summary a
    where a.attendance_date = v_yesterday and public.dawaa_customer_request_branch_key(a.branch) = b.k
  ) x on true;
  v_items := v_items || jsonb_build_object('key', 'attendance', 'kind', 'auto', 'ok', v_ok, 'detail', v_detail,
    'data_day', v_yesterday);

  -- 3) Branch managers closed yesterday's floor checks.
  select jsonb_agg(jsonb_build_object('branch', b.k, 'checks_done', coalesce(x.checks, 0), 'checks_total', 3,
           'issues', coalesce(x.issues, 0)) order by b.k),
         bool_and(coalesce(x.checks, 0) >= 3)
    into v_detail, v_ok
  from (values ('shokry'), ('elshamy')) b(k)
  left join lateral (
    select count(*) filter (where m.item_key in ('cash_reconciliation', 'appearance_cleanliness', 'shelves_fridge')) checks,
           count(*) filter (where m.state = 'issue') issues
    from public.branch_manager_agenda_marks m
    where m.branch_key = b.k and m.agenda_day = v_yesterday
  ) x on true;
  v_items := v_items || jsonb_build_object('key', 'managers', 'kind', 'auto', 'ok', v_ok, 'detail', v_detail,
    'data_day', v_yesterday);

  -- 4) Cleaning was rated yesterday in each branch.
  select jsonb_agg(jsonb_build_object('branch', b.k, 'ratings', coalesce(x.n, 0), 'last_day', x.last_day) order by b.k),
         bool_and(coalesce(x.n, 0) > 0)
    into v_detail, v_ok
  from (values ('shokry'), ('elshamy')) b(k)
  left join lateral (
    select count(*) filter (where c.rating_date = v_yesterday) n, max(c.rating_date) last_day
    from public.cleaning_daily_ratings c
    where public.dawaa_customer_request_branch_key(c.branch) = b.k
  ) x on true;
  v_items := v_items || jsonb_build_object('key', 'cleaning', 'kind', 'auto', 'ok', v_ok, 'detail', v_detail,
    'data_day', v_yesterday);

  -- 5) This week's inventory count is planned and on time in each branch.
  select jsonb_agg(jsonb_build_object('branch', b.k, 'status', coalesce(case
             when x.status in ('planned', 'counting') and x.due_date < v_today then 'late' else x.status end, 'not_planned'),
           'due_date', x.due_date) order by b.k),
         bool_and(x.status is not null and not (x.status in ('planned', 'counting') and x.due_date < v_today)
                  and x.status <> 'submitted')
    into v_detail, v_ok
  from (values ('shokry'), ('elshamy')) b(k)
  left join lateral (
    select s.status, s.due_date
    from public.inventory_count_sessions s
    where s.count_type = 'weekly_items' and public.dawaa_customer_request_branch_key(s.branch) = b.k
      and s.week_start <= v_today and s.week_start > v_today - 7
    order by s.week_start desc
    limit 1
  ) x on true;
  v_items := v_items || jsonb_build_object('key', 'inventory', 'kind', 'auto', 'ok', coalesce(v_ok, false), 'detail', v_detail);

  -- 6) Purchases and shift handovers (purchasing app): closed by hand; local counts as a hint.
  select count(*) into v_n from public.purchase_invoices
   where invoice_date = v_yesterday and reviewed_at is null;
  v_items := v_items || jsonb_build_object('key', 'purchases_handover', 'kind', 'external', 'ok', false,
    'detail', jsonb_build_object('unreviewed_yesterday', v_n,
      'last_handover', (select max(shift_date)::text from public.shift_handovers)),
    'url', (select url from public.gm_daily_review_links where item_key = 'purchases_handover'));

  -- 7) Delivery (delivery app): closed by hand.
  v_items := v_items || jsonb_build_object('key', 'delivery', 'kind', 'external', 'ok', false,
    'detail', '{}'::jsonb,
    'url', (select url from public.gm_daily_review_links where item_key = 'delivery'));

  -- 8) Customers: requests of this cycle open over a day, and yesterday's 500+ customers.
  select count(*) into v_n from public.customer_requests cr
   where cr.status not in ('delivered', 'closed', 'cancelled', 'not_available')
     and cr.created_at >= (v_cycle_start::timestamp at time zone 'Africa/Cairo')
     and cr.created_at < now() - interval '24 hours';
  select count(*) into v_m from public.sales_invoices si
   where si.invoice_date >= v_yesterday and si.invoice_date < v_yesterday + 1
     and coalesce(si.net_amount, si.net_total, si.amount) >= 500;
  v_items := v_items || jsonb_build_object('key', 'customers', 'kind', 'auto', 'ok', v_n = 0,
    'detail', jsonb_build_object('open_requests', v_n, 'big_customers_yesterday', v_m));

  -- Today's marks; an item is done when its data is clean or it was closed by hand.
  select jsonb_agg(i || jsonb_build_object(
           'state', m.state, 'note', m.note, 'marked_at', m.marked_at, 'marked_by', sa.name,
           'done', m.state is not null or (i->>'ok')::boolean)
         order by o.ord)
    into v_items
  from jsonb_array_elements(v_items) with ordinality o(i, ord)
  left join public.gm_daily_review_marks m on m.review_day = v_today and m.item_key = o.i->>'key'
  left join public.staff_accounts sa on sa.id = m.staff_account_id;

  return jsonb_build_object(
    'day', v_today,
    'yesterday', v_yesterday,
    'items', v_items,
    'done', (select count(*) from jsonb_array_elements(v_items) e where (e->>'done')::boolean),
    'total', jsonb_array_length(v_items),
    -- The general manager's own record: how many items were closed by hand on each of the last 14 days.
    'history', (select coalesce(jsonb_agg(jsonb_build_object('day', g.d::date,
                  'marked', (select count(*) from public.gm_daily_review_marks m where m.review_day = g.d::date))
                  order by g.d desc), '[]'::jsonb)
                from generate_series(v_today - 13, v_today, interval '1 day') g(d))
  );
end;
$function$;
