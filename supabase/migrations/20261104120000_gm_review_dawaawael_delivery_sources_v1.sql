-- «مراجعتي اليومية»: every item now reads from the app the work really happens in.
--   * المناديب: the delivery app (dawaa-delivery-os) — orders and errands of «فرع شكري» / «فرع الشامي»,
--     errands still waiting for approval on /admin/trips. Snapshot pulled by the delivery-invoice-sync edge
--     function (it already holds the bridge key) into delivery_daily_review_snapshot.
--   * تحويلات التحصيل: DawaaWael shift handovers (vodafone / insta / visa / other per shift), not Dawaa Bills.
--   * المشتريات / تسليم الشيفتات: unchanged sources (DawaaWael), app links now fixed in the front end.
-- Dawaa Bills (bills_* tables) is no longer read by the daily review.

create table if not exists public.delivery_daily_review_snapshot (
  id smallint primary key default 1 check (id = 1),
  snapshot jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.delivery_daily_review_snapshot enable row level security;
revoke all on public.delivery_daily_review_snapshot from anon, authenticated;

create or replace function public.store_delivery_daily_review_snapshot_v1(p_snapshot jsonb)
returns void
language sql
security definer
set search_path to ''
as $$
  insert into public.delivery_daily_review_snapshot (id, snapshot, fetched_at)
  values (1, p_snapshot, now())
  on conflict (id) do update set snapshot = excluded.snapshot, fetched_at = excluded.fetched_at;
$$;
revoke all on function public.store_delivery_daily_review_snapshot_v1(jsonb) from public, anon, authenticated;
grant execute on function public.store_delivery_daily_review_snapshot_v1(jsonb) to service_role;

create or replace function public.delivery_daily_review_snapshot_age_v1()
returns interval
language sql
stable
security definer
set search_path to ''
as $$ select now() - fetched_at from public.delivery_daily_review_snapshot where id = 1 $$;
revoke all on function public.delivery_daily_review_snapshot_age_v1() from public, anon, authenticated;
grant execute on function public.delivery_daily_review_snapshot_age_v1() to service_role;

CREATE OR REPLACE FUNCTION public.get_gm_daily_review_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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

  -- المشتريات (DawaaWael /pending-invoices): invoices of the last 45 days still «انتظار المراجعة» after their day.
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
    'detail', jsonb_build_object('branches', v_detail, 'synced_at', v_synced));

  -- تسليم الشيفتات (DawaaWael /shift-delivery).
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

  -- المناديب (delivery app /admin/trips): yesterday's orders and errands, errands waiting for approval from
  -- before today, orders still «registered» from before today. Fresh = pulled within the last hour.
  select s.snapshot, s.fetched_at into v_detail, v_synced
  from public.delivery_daily_review_snapshot s where s.id = 1;
  v_ok := v_detail is not null and (v_detail->>'day')::date = v_today
    and not exists (select 1 from jsonb_array_elements(v_detail->'branches') b
                    where coalesce((b->>'pending_errands')::int, 0) > 0 or coalesce((b->>'stuck')::int, 0) > 0);
  v_items := v_items || jsonb_build_object('key', 'delivery', 'kind', 'external',
    'ok', coalesce(v_ok and v_synced > now() - interval '1 hour', false),
    'detail', jsonb_build_object('branches', coalesce(v_detail->'branches', '[]'::jsonb), 'synced_at', v_synced),
    'data_day', v_yesterday);

  -- تحويلات التحصيل (DawaaWael shift handovers): yesterday's vodafone / insta / visa / other per branch, the
  -- cash the accountant should receive, and any shift with a cash variance.
  select max(l.ran_at) into v_synced from public.base44_sync_run_log l
   where l.source = 'shift_deliveries' and l.status = 'success';
  select jsonb_agg(jsonb_build_object('branch', b.k, 'shifts', coalesce(x.shifts, 0),
           'vodafone', coalesce(x.vodafone, 0), 'insta', coalesce(x.insta, 0), 'visa', coalesce(x.visa, 0),
           'other', coalesce(x.other, 0), 'cash', coalesce(x.cash, 0), 'variance', coalesce(x.variance, 0)) order by b.k),
         bool_and(coalesce(x.shifts, 0) > 0 and coalesce(x.variance, 0) = 0)
    into v_detail, v_ok
  from (values ('shokry', 'فرع شكري'), ('elshamy', 'فرع الشامي')) b(k, name)
  left join lateral (
    select count(*) shifts, sum(h.vodafone_sales) vodafone, sum(h.insta_sales) insta, sum(h.visa_sales) visa,
           sum(h.other_sales) other, sum(coalesce(h.cash_handover, h.cash_sales)) cash,
           count(*) filter (where coalesce(h.cash_variance, 0) <> 0) variance
    from public.shift_handovers h
    where h.branch = b.name and h.shift_date = v_yesterday and not h.is_archived
  ) x on true;
  v_items := v_items || jsonb_build_object('key', 'collection_transfers', 'kind', 'external',
    'ok', coalesce(v_ok and v_synced > now() - interval '1 hour', false),
    'detail', jsonb_build_object('branches', v_detail, 'synced_at', v_synced), 'data_day', v_yesterday);

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
