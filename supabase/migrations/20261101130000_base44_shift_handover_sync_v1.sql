-- Shift handovers from the purchasing app (Base44 ShiftDelivery) every 15 minutes, and a «تسليم الشيفتات»
-- item in the general manager's daily review: each branch closes three shifts a day, and a shift still
-- open two hours after its usual close turns the item red with the branch, day and shift.
--
-- Usual close (Cairo, 2026-10): night ≈ 08:00, morning ≈ 17:00, evening ≈ 01:00 the next day.
-- Deadlines: night 10:00, morning 19:00, evening 03:00 the next day.

-- 1) The local copy keeps the whole closing: payment split, cash variance, notes, who and when.
alter table public.shift_handovers
  add column if not exists base44_id text,
  add column if not exists shift_type text,
  add column if not exists submitted_by text,
  add column if not exists total_sales numeric not null default 0,
  add column if not exists total_expenses numeric not null default 0,
  add column if not exists net_amount numeric not null default 0,
  add column if not exists expenses jsonb not null default '[]'::jsonb,
  add column if not exists status text,
  add column if not exists recorded_at timestamptz,
  add column if not exists calculation_date date,
  add column if not exists cash_sales numeric,
  add column if not exists visa_sales numeric,
  add column if not exists insta_sales numeric,
  add column if not exists vodafone_sales numeric,
  add column if not exists other_sales numeric,
  add column if not exists cash_handover numeric,
  add column if not exists cash_variance numeric,
  add column if not exists notes text,
  add column if not exists submitted_by_staff_id uuid,
  add column if not exists is_archived boolean not null default false,
  add column if not exists base44_created_at timestamptz,
  add column if not exists base44_updated_at timestamptz,
  add column if not exists synced_at timestamptz not null default now();
create unique index if not exists shift_handovers_base44_id_key on public.shift_handovers (base44_id);
create index if not exists idx_shift_handovers_branch_date on public.shift_handovers (branch, shift_date desc);

-- The browser reads through RLS only; writes come from the sync.
revoke insert, update, delete, truncate, references, trigger on public.shift_handovers from anon, authenticated;
revoke all on public.shift_handovers from anon;

-- 2) One sync log for both Base44 feeds.
alter table public.base44_sync_run_log add column if not exists source text not null default 'purchase_invoices';

-- 3) Import (service role only): upsert by the Base44 id. The edge function maps the branch names.
create or replace function public.import_base44_shift_deliveries_v1(p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_n integer;
begin
  if jsonb_typeof(p_records) is distinct from 'array' then raise exception 'records_must_be_array'; end if;
  insert into public.shift_handovers as h (
    base44_id, branch, shift_type, shift_date, submitted_by, total_sales, total_expenses, net_amount, expenses,
    status, recorded_at, calculation_date, cash_sales, visa_sales, insta_sales, vodafone_sales, other_sales,
    cash_handover, cash_variance, notes, submitted_by_staff_id, is_archived, base44_created_at, base44_updated_at, synced_at)
  select r->>'id', r->>'branch', r->>'shift_type', (r->>'shift_date')::date, r->>'submitted_by',
         coalesce((r->>'total_sales')::numeric, 0), coalesce((r->>'total_expenses')::numeric, 0),
         coalesce((r->>'net_amount')::numeric, 0),
         case when jsonb_typeof(r->'expenses') = 'array' then r->'expenses' else '[]'::jsonb end,
         r->>'status', (r->>'recorded_at')::timestamptz, (r->>'calculation_date')::date,
         (r->>'cash_sales')::numeric, (r->>'visa_sales')::numeric, (r->>'insta_sales')::numeric,
         (r->>'vodafone_sales')::numeric, (r->>'other_sales')::numeric, (r->>'cash_handover')::numeric,
         (r->>'cash_variance')::numeric, nullif(btrim(r->>'notes'), ''),
         case when r->>'submitted_by_staff_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (r->>'submitted_by_staff_id')::uuid end,
         coalesce((r->>'is_archived')::boolean, false),
         -- Base44 dates come without a zone and are UTC.
         ((r->>'created_date') || 'Z')::timestamptz, ((r->>'updated_date') || 'Z')::timestamptz, now()
  from jsonb_array_elements(p_records) r
  where r->>'id' is not null and r->>'branch' in ('فرع شكري', 'فرع الشامي')
    and r->>'shift_type' in ('ليلي', 'صباحي', 'مسائي') and r->>'shift_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  on conflict (base44_id) do update set
    branch = excluded.branch, shift_type = excluded.shift_type, shift_date = excluded.shift_date,
    submitted_by = excluded.submitted_by, total_sales = excluded.total_sales, total_expenses = excluded.total_expenses,
    net_amount = excluded.net_amount, expenses = excluded.expenses, status = excluded.status,
    recorded_at = excluded.recorded_at, calculation_date = excluded.calculation_date, cash_sales = excluded.cash_sales,
    visa_sales = excluded.visa_sales, insta_sales = excluded.insta_sales, vodafone_sales = excluded.vodafone_sales,
    other_sales = excluded.other_sales, cash_handover = excluded.cash_handover, cash_variance = excluded.cash_variance,
    notes = excluded.notes, submitted_by_staff_id = excluded.submitted_by_staff_id, is_archived = excluded.is_archived,
    base44_created_at = excluded.base44_created_at, base44_updated_at = excluded.base44_updated_at, synced_at = now();
  get diagnostics v_n = row_count;
  return jsonb_build_object('total', jsonb_array_length(p_records), 'upserted', v_n);
end;
$function$;
revoke all on function public.import_base44_shift_deliveries_v1(jsonb) from public, anon, authenticated;
grant execute on function public.import_base44_shift_deliveries_v1(jsonb) to service_role;

-- 4) The shifts due at a moment: every branch × shift whose deadline passed in the 48 hours before it.
create or replace function public.shift_handover_due_v1(p_at timestamptz)
returns table(branch text, shift_date date, shift_type text, due_at timestamptz, closed boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select b.name, d.day, s.type, x.due_at,
         exists (select 1 from public.shift_handovers h
                  where h.branch = b.name and h.shift_date = d.day and h.shift_type = s.type and not h.is_archived)
  from (values ('فرع شكري'), ('فرع الشامي')) b(name)
  cross join (select ((p_at at time zone 'Africa/Cairo')::date - g)::date as day from generate_series(0, 2) g) d
  cross join (values ('ليلي', 10), ('صباحي', 19), ('مسائي', 27)) s(type, due_hour)
  cross join lateral (select (d.day::timestamp + make_interval(hours => s.due_hour)) at time zone 'Africa/Cairo' as due_at) x
  where x.due_at <= p_at and x.due_at > p_at - interval '48 hours';
$function$;
revoke all on function public.shift_handover_due_v1(timestamptz) from public, anon, authenticated;

-- 5) The review item.
alter table public.gm_daily_review_marks drop constraint if exists gm_daily_review_marks_item_key_check;
alter table public.gm_daily_review_marks add constraint gm_daily_review_marks_item_key_check
  check (item_key in ('sales_upload', 'attendance', 'managers', 'cleaning', 'inventory',
                      'purchases_handover', 'shifts', 'delivery', 'customers'));

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

  -- 6) Purchases (purchasing app): closed by hand; local counts as a hint.
  select count(*) into v_n from public.purchase_invoices
   where invoice_date = v_yesterday and reviewed_at is null;
  v_items := v_items || jsonb_build_object('key', 'purchases_handover', 'kind', 'external', 'ok', false,
    'detail', jsonb_build_object('unreviewed_yesterday', v_n,
      'last_handover', (select max(shift_date)::text from public.shift_handovers)),
    'url', (select url from public.gm_daily_review_links where item_key = 'purchases_handover'));

  -- 6b) Shift handovers synced from the purchasing app: every shift whose deadline passed in the last
  --     48 hours is closed in each branch, and the sync itself ran within the hour.
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
    select jsonb_agg(jsonb_build_object('day', s.shift_date, 'shift', s.shift_type, 'due_at', s.due_at)
             order by s.due_at) missing
    from public.shift_handover_due_v1(now()) s
    where s.branch = b.name and not s.closed
  ) m on true;
  v_items := v_items || jsonb_build_object('key', 'shifts', 'kind', 'auto',
    'ok', coalesce(v_ok and v_synced > now() - interval '1 hour', false),
    'detail', jsonb_build_object('branches', v_detail, 'synced_at', v_synced), 'data_day', v_yesterday);

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
                        'purchases_handover', 'shifts', 'delivery', 'customers') then
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
