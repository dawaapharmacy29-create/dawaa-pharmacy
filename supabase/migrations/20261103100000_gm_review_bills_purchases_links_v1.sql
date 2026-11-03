-- «مراجعتي اليومية»: purchases, riders and collection transfers read from the other apps.
--
-- * Purchases: invoices still «انتظار المراجعة» in DawaaWael (base44_purchase_invoice_sync.base44_status).
-- * Riders: Dawaa Bills trips (Trip / TripStop) — stops left pending after their day, trips left open.
-- * Collection transfers: the Dawaa Bills «تسوية التحصيلات» ledger (CollectionSettlementBatch events):
--   vodafone / insta / visa collected in the shifts and not yet transferred, and transfers the accountant
--   has not confirmed. Balance = opening + collected − transferred, the figure the Bills page shows.
-- Each item still opens its app; the general manager can close it by hand as before.

create table if not exists public.bills_collection_batches (
  base44_id text primary key,
  sequence integer not null,
  action text,
  actor_name text,
  recorded_at timestamptz,
  events jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now()
);
create table if not exists public.bills_trips (
  base44_id text primary key,
  rider_name text,
  branch text,
  start_time timestamptz,
  end_time timestamptz,
  base44_updated_at timestamptz,
  synced_at timestamptz not null default now()
);
create table if not exists public.bills_trip_stops (
  base44_id text primary key,
  trip_id text,
  rider_name text,
  branch text,
  stop_type text,
  destination text,
  stop_start_time timestamptz,
  stop_end_time timestamptz,
  approval_status text,
  approved_by text,
  approved_at timestamptz,
  base44_updated_at timestamptz,
  synced_at timestamptz not null default now()
);
create index if not exists idx_bills_trip_stops_pending on public.bills_trip_stops (stop_start_time) where approval_status = 'pending';
create index if not exists idx_bills_trips_open on public.bills_trips (start_time) where end_time is null;

-- Read only through the functions below; nothing for the browser roles.
alter table public.bills_collection_batches enable row level security;
alter table public.bills_trips enable row level security;
alter table public.bills_trip_stops enable row level security;
revoke all on public.bills_collection_batches, public.bills_trips, public.bills_trip_stops from public, anon, authenticated;

-- Import (service role only). The settlement ledger is small and copied whole; trips and stops arrive
-- as the recently changed ones and are upserted.
create or replace function public.import_base44_bills_ops_v1(p_batches jsonb, p_trips jsonb, p_stops jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_batches integer := 0;
  v_trips integer;
  v_stops integer;
begin
  if jsonb_typeof(p_batches) is distinct from 'array' or jsonb_typeof(p_trips) is distinct from 'array'
     or jsonb_typeof(p_stops) is distinct from 'array' then
    raise exception 'records_must_be_array';
  end if;

  -- An empty answer never wipes the ledger.
  if jsonb_array_length(p_batches) > 0 then
    insert into public.bills_collection_batches as b (base44_id, sequence, action, actor_name, recorded_at, events, synced_at)
    select r->>'id', (r->>'sequence')::integer, r->>'action', r->>'actor_name', nullif(r->>'recorded_at', '')::timestamptz,
           coalesce(nullif(r->>'events_json', '')::jsonb, '[]'::jsonb), now()
    from jsonb_array_elements(p_batches) r
    where r->>'id' is not null and r->>'sequence' ~ '^[0-9]+$' and not coalesce((r->>'is_sample')::boolean, false)
    on conflict (base44_id) do update set sequence = excluded.sequence, action = excluded.action,
      actor_name = excluded.actor_name, recorded_at = excluded.recorded_at, events = excluded.events, synced_at = now();
    get diagnostics v_batches = row_count;
    delete from public.bills_collection_batches b
     where not exists (select 1 from jsonb_array_elements(p_batches) r
                        where r->>'id' = b.base44_id and not coalesce((r->>'is_sample')::boolean, false));
  end if;

  insert into public.bills_trips as t (base44_id, rider_name, branch, start_time, end_time, base44_updated_at, synced_at)
  select r->>'id', r->>'rider_name', r->>'branch', nullif(r->>'start_time', '')::timestamptz,
         nullif(r->>'end_time', '')::timestamptz, ((r->>'updated_date') || 'Z')::timestamptz, now()
  from jsonb_array_elements(p_trips) r
  where r->>'id' is not null and not coalesce((r->>'is_sample')::boolean, false)
  on conflict (base44_id) do update set rider_name = excluded.rider_name, branch = excluded.branch,
    start_time = excluded.start_time, end_time = excluded.end_time, base44_updated_at = excluded.base44_updated_at, synced_at = now();
  get diagnostics v_trips = row_count;

  insert into public.bills_trip_stops as s (base44_id, trip_id, rider_name, branch, stop_type, destination, stop_start_time,
    stop_end_time, approval_status, approved_by, approved_at, base44_updated_at, synced_at)
  select r->>'id', r->>'trip_id', r->>'rider_name', r->>'branch', r->>'stop_type', r->>'destination',
         nullif(r->>'stop_start_time', '')::timestamptz, nullif(r->>'stop_end_time', '')::timestamptz,
         coalesce(nullif(r->>'approval_status', ''), 'pending'), r->>'approved_by', nullif(r->>'approved_at', '')::timestamptz,
         ((r->>'updated_date') || 'Z')::timestamptz, now()
  from jsonb_array_elements(p_stops) r
  where r->>'id' is not null and not coalesce((r->>'is_sample')::boolean, false)
  on conflict (base44_id) do update set trip_id = excluded.trip_id, rider_name = excluded.rider_name, branch = excluded.branch,
    stop_type = excluded.stop_type, destination = excluded.destination, stop_start_time = excluded.stop_start_time,
    stop_end_time = excluded.stop_end_time, approval_status = excluded.approval_status, approved_by = excluded.approved_by,
    approved_at = excluded.approved_at, base44_updated_at = excluded.base44_updated_at, synced_at = now();
  get diagnostics v_stops = row_count;

  return jsonb_build_object('batches', v_batches, 'trips', v_trips, 'stops', v_stops);
end;
$function$;
revoke all on function public.import_base44_bills_ops_v1(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.import_base44_bills_ops_v1(jsonb, jsonb, jsonb) to service_role;

-- The «تسوية التحصيلات» state, replayed from the ledger events (amounts are in piasters there).
--   setup: the start date and the opening balance of each wallet (the latest setup counts);
--   source: a shift's collected amount for one wallet — a reload of the same key replaces it;
--   transfer: money sent to the accountant (delta < 0); historical_transfer: before the start, not in the balance;
--   confirm: the accountant received a transfer; ack_source: a reviewed change, no effect on amounts.
create or replace function public.collection_settlement_state_v1()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with ev as (
    select b.sequence, e.ord, e.x
    from public.bills_collection_batches b, jsonb_array_elements(b.events) with ordinality e(x, ord)
    where jsonb_typeof(b.events) = 'array'
  ),
  setup as (select x from ev where x->>'kind' = 'setup' order by sequence desc, ord desc limit 1),
  src as (
    select distinct on (x->>'key') x->'source'->>'wallet' wallet,
           coalesce((x->'source'->>'amount')::numeric, 0) / 100 amount,
           nullif(x->'source'->>'date', '')::date on_day, x->'source'->>'branch' branch
    from ev where x->>'kind' = 'source' and x->>'key' is not null
    order by x->>'key', sequence desc, ord desc
  ),
  confirmed as (
    select x->>'target' target, max((x->>'at')::timestamptz) at, max(x->'actor'->>'name') by_name
    from ev where x->>'kind' = 'confirm' group by 1
  ),
  tr as (
    select ev.x->>'id' id, ev.x->>'kind' kind, ev.x->>'wallet' wallet, -coalesce((ev.x->>'delta')::numeric, 0) / 100 amount,
           nullif(ev.x->>'date', '')::date on_day, ev.x->>'recipient' recipient, nullif(ev.x->>'notes', '') notes,
           (ev.x->>'at')::timestamptz at, c.at confirmed_at, c.by_name confirmed_by
    from ev left join confirmed c on c.target = ev.x->>'id'
    where ev.x->>'kind' in ('transfer', 'historical_transfer')
  ),
  today as (select (now() at time zone 'Africa/Cairo')::date d)
  select jsonb_build_object(
    'start_date', (select x->'config'->>'start_date' from setup),
    'synced_at', (select max(l.ran_at) from public.base44_sync_run_log l where l.source = 'bills_ops' and l.status = 'success'),
    'wallets', (select coalesce(jsonb_agg(jsonb_build_object('wallet', w.wallet,
                  'opening', coalesce(((select x from setup)->'openings'->>w.wallet)::numeric, 0) / 100,
                  'collected', coalesce((select sum(amount) from src where src.wallet = w.wallet), 0),
                  'transferred', coalesce((select sum(amount) from tr where tr.kind = 'transfer' and tr.wallet = w.wallet), 0),
                  'balance', coalesce(((select x from setup)->'openings'->>w.wallet)::numeric, 0) / 100
                             + coalesce((select sum(amount) from src where src.wallet = w.wallet), 0)
                             - coalesce((select sum(amount) from tr where tr.kind = 'transfer' and tr.wallet = w.wallet), 0))
                  order by w.ord), '[]'::jsonb)
                from unnest(array['vodafone', 'insta', 'visa']) with ordinality w(wallet, ord)),
    'pending', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'wallet', wallet, 'amount', amount, 'date', on_day,
                  'recipient', recipient, 'notes', notes, 'days', (select d from today) - on_day) order by on_day, at), '[]'::jsonb)
                from tr where confirmed_at is null),
    'confirmed', (select coalesce(jsonb_agg(c order by c->>'confirmed_at' desc), '[]'::jsonb)
                  from (select jsonb_build_object('id', id, 'wallet', wallet, 'amount', amount, 'date', on_day, 'recipient', recipient,
                          'notes', notes, 'confirmed_at', confirmed_at, 'confirmed_by', confirmed_by, 'historical', kind = 'historical_transfer') c
                        from tr where confirmed_at is not null order by confirmed_at desc limit 20) x),
    'collected', jsonb_build_object(
      'today', coalesce((select sum(amount) from src where on_day = (select d from today)), 0),
      'yesterday', coalesce((select sum(amount) from src where on_day = (select d from today) - 1), 0),
      'month', coalesce((select sum(amount) from src where on_day >= date_trunc('month', (select d from today))::date), 0),
      'by_branch', (select coalesce(jsonb_agg(jsonb_build_object('branch', branch, 'amount', amount) order by branch), '[]'::jsonb)
                    from (select branch, sum(amount) amount from src
                          where on_day >= date_trunc('month', (select d from today))::date group by branch) b)),
    'unknown_events', (select count(*) from ev
                       where x->>'kind' not in ('setup', 'source', 'transfer', 'historical_transfer', 'confirm', 'ack_source'))
  );
$function$;
revoke all on function public.collection_settlement_state_v1() from public, anon, authenticated;

-- «التقارير المجمعة» reads it (top management, the app's anon session like the other reports).
create or replace function public.get_collection_settlement_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform public.gm_daily_review_actor_v1();
  return public.collection_settlement_state_v1();
end;
$function$;
revoke all on function public.get_collection_settlement_v1() from public, anon, authenticated;
grant execute on function public.get_collection_settlement_v1() to anon, authenticated;

-- The new review item.
alter table public.gm_daily_review_marks drop constraint if exists gm_daily_review_marks_item_key_check;
alter table public.gm_daily_review_marks add constraint gm_daily_review_marks_item_key_check
  check (item_key in ('sales_upload', 'attendance', 'managers', 'cleaning', 'inventory',
                      'purchases_handover', 'shifts', 'delivery', 'collection_transfers', 'customers'));
alter table public.gm_daily_review_links drop constraint if exists gm_daily_review_links_item_key_check;
alter table public.gm_daily_review_links add constraint gm_daily_review_links_item_key_check
  check (item_key in ('purchases_handover', 'delivery', 'collection_transfers'));

create or replace function public.mark_gm_daily_review_item_v1(p_item_key text, p_state text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.gm_daily_review_actor_v1();
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_item_key not in ('sales_upload', 'attendance', 'managers', 'cleaning', 'inventory',
                        'purchases_handover', 'shifts', 'delivery', 'collection_transfers', 'customers') then
    raise exception 'invalid_item';
  end if;
  if p_state = 'clear' then
    delete from public.gm_daily_review_marks where review_day = v_today and item_key = p_item_key;
    return;
  end if;
  if p_state not in ('done', 'issue') then raise exception 'invalid_state'; end if;
  if p_state = 'issue' and v_note is null then raise exception 'note_required'; end if;

  insert into public.gm_daily_review_marks(review_day, item_key, state, note, staff_account_id, marked_at)
  values (v_today, p_item_key, p_state, v_note, v_actor, now())
  on conflict (review_day, item_key) do update
    set state = excluded.state, note = excluded.note, staff_account_id = excluded.staff_account_id,
        marked_at = excluded.marked_at;
end;
$function$;

create or replace function public.set_gm_daily_review_link_v1(p_item_key text, p_url text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.gm_daily_review_actor_v1();
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if p_item_key not in ('purchases_handover', 'delivery', 'collection_transfers') then raise exception 'invalid_item'; end if;
  if v_url is null then
    delete from public.gm_daily_review_links where item_key = p_item_key;
    return;
  end if;
  if v_url !~ '^https://[^\s]+$' then raise exception 'invalid_url'; end if;
  insert into public.gm_daily_review_links(item_key, url, updated_by, updated_at)
  values (p_item_key, v_url, v_actor, now())
  on conflict (item_key) do update set url = excluded.url, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$function$;

-- The apps' addresses; the general manager can still change them from the page.
insert into public.gm_daily_review_links(item_key, url) values
  ('purchases_handover', 'https://dawaawael.base44.app'),
  ('delivery', 'https://dawaabill.base44.app'),
  ('collection_transfers', 'https://dawaabill.base44.app/shift-handover')
on conflict (item_key) do nothing;

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
