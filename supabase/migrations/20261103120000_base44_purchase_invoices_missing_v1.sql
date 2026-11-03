-- Invoices deleted in DawaaWael stay in base44_purchase_invoice_sync (the sync only upserts), so the general
-- manager's review counted them as still «انتظار المراجعة». A full sync now marks every invoice it did not
-- receive (base44_missing_at) instead of deleting it; an invoice that comes back is synced again after the
-- mark and counts again. Only the review reads the mark — reviews, points and payroll are unchanged.

alter table public.base44_purchase_invoice_sync add column if not exists base44_missing_at timestamptz;

-- Called by base44-purchase-invoice-sync after a full sync that started at p_since and received p_seen invoices.
-- A short read (fewer than 90% of the invoices we hold) marks nothing.
create or replace function public.mark_base44_purchase_invoices_missing_v1(p_since timestamptz, p_seen integer)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_present integer;
  v_marked integer;
begin
  select count(*) into v_present from public.base44_purchase_invoice_sync
   where base44_missing_at is null or synced_at > base44_missing_at;
  if p_since is null or coalesce(p_seen, 0) < v_present * 0.9 then
    raise exception using errcode = '22023', message = 'full sync too short to mark missing invoices';
  end if;

  update public.base44_purchase_invoice_sync
     set base44_missing_at = now()
   where synced_at < p_since and (base44_missing_at is null or synced_at > base44_missing_at);
  get diagnostics v_marked = row_count;
  return v_marked;
end;
$function$;
revoke all on function public.mark_base44_purchase_invoices_missing_v1(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.mark_base44_purchase_invoices_missing_v1(timestamptz, integer) to service_role;

-- The review as in 20261103100000, without the invoices DawaaWael no longer has.
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
  v_synced timestamptz;
begin
  perform public.gm_daily_review_actor_v1();
  v_cycle_start := case when extract(day from v_today) >= 26
    then make_date(extract(year from v_today)::int, extract(month from v_today)::int, 26)
    else (date_trunc('month', v_today) - interval '1 month')::date + 25 end;

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

  -- Purchases: DawaaWael invoices of the last 45 days still waiting for review after their day.
  select max(l.ran_at) into v_synced from public.base44_sync_run_log l
   where coalesce(l.source, 'purchase_invoices') = 'purchase_invoices' and l.status = 'success';
  select jsonb_agg(jsonb_build_object('branch', b.k, 'pending', coalesce(x.pending, 0), 'value', coalesce(x.value, 0),
           'oldest', x.oldest, 'yesterday', coalesce(x.yesterday, 0)) order by b.k),
         bool_and(coalesce(x.pending, 0) = 0)
    into v_detail, v_ok
  from (values ('shokry', 'فرع شكري'), ('elshamy', 'فرع الشامي')) b(k, name)
  left join lateral (
    select count(*) filter (where p.base44_status = 'انتظار المراجعة' and p.invoice_date < v_today) pending,
           sum(p.total_value) filter (where p.base44_status = 'انتظار المراجعة' and p.invoice_date < v_today) value,
           min(p.invoice_date) filter (where p.base44_status = 'انتظار المراجعة' and p.invoice_date < v_today) oldest,
           count(*) filter (where p.invoice_date = v_yesterday) yesterday
    from public.base44_purchase_invoice_sync p
    where p.branch = b.name and p.invoice_date >= v_today - 45 and p.invoice_date <= v_today
      and (p.base44_missing_at is null or p.synced_at > p.base44_missing_at)
  ) x on true;
  v_items := v_items || jsonb_build_object('key', 'purchases_handover', 'kind', 'external',
    'ok', coalesce(v_ok and v_synced > now() - interval '1 hour', false),
    'detail', jsonb_build_object('branches', v_detail, 'synced_at', v_synced),
    'url', (select url from public.gm_daily_review_links where item_key = 'purchases_handover'));

  select max(l.ran_at) into v_synced from public.base44_sync_run_log l
   where l.source = 'shift_deliveries' and l.status = 'success';
  select jsonb_agg(jsonb_build_object('branch', b.k,
           'yesterday_done', (select count(distinct h.shift_type) from public.shift_handovers h
                               where h.branch = b.name and h.shift_date = v_yesterday and not h.is_archived),
           'missing', coalesce(m.missing, '[]'::jsonb)) order by b.k),
         bool_and(m.missing is null)
    into v_detail, v_ok
  from (values ('shokry', 'فرع شكري'), ('elshamy', 'فرع الشامي')) b(k, name)
  left join lateral (
    select jsonb_agg(jsonb_build_object('day', s.shift_date, 'shift', s.shift_type, 'due_at', s.due_at,
             'doctors', public.shift_on_duty_doctors_v1(s.branch, s.due_at - interval '2 hours'))
             order by s.due_at) missing
    from public.shift_handover_due_v1(now()) s
    where s.branch = b.name and not s.closed
  ) m on true;
  v_items := v_items || jsonb_build_object('key', 'shifts', 'kind', 'auto',
    'ok', coalesce(v_ok and v_synced > now() - interval '1 hour', false),
    'detail', jsonb_build_object('branches', v_detail, 'synced_at', v_synced), 'data_day', v_yesterday);

  -- Riders (Dawaa Bills): yesterday's stops, stops still pending after their day, trips open over 12 hours.
  select max(l.ran_at) into v_synced from public.base44_sync_run_log l
   where l.source = 'bills_ops' and l.status = 'success';
  select jsonb_agg(jsonb_build_object('branch', b.name,
           'orders', coalesce(s.orders, 0), 'errands', coalesce(s.errands, 0),
           'pending', coalesce(s.pending, 0), 'open_trips', coalesce(t.open_trips, 0)) order by b.ord),
         bool_and(coalesce(s.pending, 0) = 0 and coalesce(t.open_trips, 0) = 0)
    into v_detail, v_ok
  from (values (1, 'فرع زكريا'), (2, 'فرع بسيسة'), (3, 'فرع المنشية')) b(ord, name)
  left join lateral (
    select count(*) filter (where x.on_day = v_yesterday and x.stop_type = 'أوردر' and x.approval_status <> 'cancelled') orders,
           count(*) filter (where x.on_day = v_yesterday and x.stop_type = 'مشوار' and x.approval_status <> 'cancelled') errands,
           count(*) filter (where x.approval_status = 'pending' and x.on_day < v_today) pending
    from (select st.*, (st.stop_start_time at time zone 'Africa/Cairo')::date on_day
          from public.bills_trip_stops st
          where st.branch = b.name and st.stop_start_time >= (v_today - 30)::timestamp at time zone 'Africa/Cairo') x
  ) s on true
  left join lateral (
    select count(*) open_trips from public.bills_trips tr
    where tr.branch = b.name and tr.end_time is null
      and tr.start_time < now() - interval '12 hours' and tr.start_time > now() - interval '30 days'
  ) t on true;
  v_items := v_items || jsonb_build_object('key', 'delivery', 'kind', 'external',
    'ok', coalesce(v_ok and v_synced > now() - interval '1 hour', false),
    'detail', jsonb_build_object('branches', v_detail, 'synced_at', v_synced), 'data_day', v_yesterday,
    'url', (select url from public.gm_daily_review_links where item_key = 'delivery'));

  -- Collection transfers (Dawaa Bills): transfers the accountant has not confirmed for over a day.
  v_detail := public.collection_settlement_state_v1();
  select count(*) into v_n from jsonb_array_elements(v_detail->'pending') p where (p->>'days')::integer > 1;
  v_items := v_items || jsonb_build_object('key', 'collection_transfers', 'kind', 'external',
    'ok', coalesce(v_n = 0 and v_synced > now() - interval '1 hour', false),
    'detail', jsonb_build_object(
      'balance', (select coalesce(sum((w->>'balance')::numeric), 0) from jsonb_array_elements(v_detail->'wallets') w),
      'wallets', v_detail->'wallets',
      'pending', jsonb_array_length(v_detail->'pending'),
      'pending_amount', (select coalesce(sum((p->>'amount')::numeric), 0) from jsonb_array_elements(v_detail->'pending') p),
      'late', v_n,
      'oldest_days', (select max((p->>'days')::integer) from jsonb_array_elements(v_detail->'pending') p),
      'synced_at', v_synced),
    'url', (select url from public.gm_daily_review_links where item_key = 'collection_transfers'));

  select count(*) into v_n from public.customer_requests cr
   where cr.status not in ('delivered', 'closed', 'cancelled', 'not_available')
     and cr.created_at >= (v_cycle_start::timestamp at time zone 'Africa/Cairo')
     and cr.created_at < now() - interval '24 hours';
  select count(*) into v_m from public.sales_invoices si
   where si.invoice_date >= v_yesterday and si.invoice_date < v_yesterday + 1
     and coalesce(si.net_amount, si.net_total, si.amount) >= 500;
  v_items := v_items || jsonb_build_object('key', 'customers', 'kind', 'auto', 'ok', v_n = 0,
    'detail', jsonb_build_object('open_requests', v_n, 'big_customers_yesterday', v_m));

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
    'history', (select coalesce(jsonb_agg(jsonb_build_object('day', g.d::date,
                  'marked', (select count(*) from public.gm_daily_review_marks m where m.review_day = g.d::date))
                  order by g.d desc), '[]'::jsonb)
                from generate_series(v_today - 13, v_today, interval '1 day') g(d))
  );
end;
$function$;
