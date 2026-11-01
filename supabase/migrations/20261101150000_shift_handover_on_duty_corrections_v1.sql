-- Shift handovers: who was on duty at each closing, and local corrections by top management.
--
-- On duty: the pharmacists and branch managers of the branch whose day (punches, else the schedule)
-- started two hours or more before the shift's usual close — night 08:00, morning 17:00, evening 01:00
-- the next day (Cairo) — and lasted to within the hour before it. The schedule stands in only when
-- nobody on that closing punched.
--
-- Corrections stay here: the Base44 closing is never changed. Each correction is kept with its reason,
-- who made it and the values before it; the latest value of a field wins over the synced one.

-- 1) The doctors on duty at a closing moment (internal).
create or replace function public.shift_on_duty_doctors_v1(p_branch text, p_close_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('staff_id', x.staff_id, 'name', x.name, 'role', x.role,
           'source', x.source, 'first_in', x.first_in, 'last_out', x.last_out)
           order by x.is_manager, x.start_at), '[]'::jsonb)
  from (
    select y.*, count(*) filter (where y.source = 'punch') over () as punched
    from (
      select distinct on (a.staff_id) a.staff_id, btrim(s.name) as name, s.role,
             case when a.first_in is not null or a.last_out is not null then 'punch' else 'schedule' end as source,
             a.first_in, a.last_out, coalesce(a.first_in, a.scheduled_start_at) as start_at,
             lower(btrim(s.role)) in ('مدير فرع', 'branch_manager') as is_manager
      from public.attendance_daily_summary a
      join public.staff s on s.id = a.staff_id
      where a.branch = p_branch
        and a.attendance_date between (p_close_at at time zone 'Africa/Cairo')::date - 1
                                  and (p_close_at at time zone 'Africa/Cairo')::date
        and lower(btrim(coalesce(s.role, ''))) in ('صيدلاني', 'pharmacist', 'مدير فرع', 'branch_manager')
        -- Started at least two hours before the close (not the next shift's doctor) and still there
        -- within the hour before it.
        and coalesce(a.first_in, a.scheduled_start_at) <= p_close_at - interval '2 hours'
        and coalesce(a.last_out, a.scheduled_end_at, a.first_in + interval '12 hours') >= p_close_at - interval '1 hour'
      order by a.staff_id, a.attendance_date desc
    ) y
  ) x
  -- The schedule alone counts only when nobody punched.
  where x.source = 'punch' or x.punched = 0;
$function$;
revoke all on function public.shift_on_duty_doctors_v1(text, timestamptz) from public, anon, authenticated;

-- 2) Every branch × shift in a date range with its close moment and the doctors on duty.
create or replace function public.shift_handover_on_duty_v1(p_from date, p_to date)
returns table(branch text, shift_date date, shift_type text, close_at timestamptz, doctors jsonb)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform public.gm_daily_review_actor_v1();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 45 then raise exception 'invalid_range'; end if;
  return query
    select b.name, d.day::date, s.type, x.close_at, public.shift_on_duty_doctors_v1(b.name, x.close_at)
    from (values ('فرع شكري'), ('فرع الشامي')) b(name)
    cross join generate_series(p_from, p_to, interval '1 day') d(day)
    cross join (values ('ليلي', 8), ('صباحي', 17), ('مسائي', 25)) s(type, close_hour)
    cross join lateral (select (d.day::date::timestamp + make_interval(hours => s.close_hour))
                                 at time zone 'Africa/Cairo' as close_at) x
    order by d.day desc, b.name, s.close_hour;
end;
$function$;
revoke all on function public.shift_handover_on_duty_v1(date, date) from public, anon;
grant execute on function public.shift_handover_on_duty_v1(date, date) to authenticated;

-- 3) Local corrections, readable wherever the handover itself is.
create table if not exists public.shift_handover_corrections_v1 (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.shift_handovers(id) on delete cascade,
  changes jsonb not null,
  previous jsonb not null,
  reason text not null,
  staff_account_id uuid,
  corrected_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_shift_handover_corrections_handover
  on public.shift_handover_corrections_v1 (handover_id, created_at);
alter table public.shift_handover_corrections_v1 enable row level security;
drop policy if exists shift_handover_corrections_select on public.shift_handover_corrections_v1;
create policy shift_handover_corrections_select on public.shift_handover_corrections_v1 for select to authenticated
  using (exists (select 1 from public.shift_handovers h where h.id = handover_id));
revoke all on public.shift_handover_corrections_v1 from anon, authenticated;
grant select on public.shift_handover_corrections_v1 to authenticated;

create or replace function public.correct_shift_handover_v1(p_handover_id uuid, p_changes jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.gm_daily_review_actor_v1();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_numbers text[] := array['total_sales', 'total_expenses', 'net_amount', 'cash_sales', 'visa_sales', 'insta_sales',
                            'vodafone_sales', 'other_sales', 'cash_handover', 'cash_variance'];
  v_texts text[] := array['submitted_by', 'notes'];
  v_current jsonb;
  v_previous jsonb := '{}'::jsonb;
  k text;
  v jsonb;
  c record;
begin
  if v_reason is null then raise exception 'reason_required'; end if;
  if jsonb_typeof(p_changes) is distinct from 'object' or p_changes = '{}'::jsonb then raise exception 'no_changes'; end if;
  for k, v in select * from jsonb_each(p_changes) loop
    if k = any(v_numbers) then
      if jsonb_typeof(v) not in ('number', 'null') then raise exception 'invalid_amount'; end if;
    elsif k = any(v_texts) then
      if jsonb_typeof(v) not in ('string', 'null') then raise exception 'invalid_text'; end if;
    else
      raise exception 'invalid_field';
    end if;
  end loop;

  select to_jsonb(h) into v_current from public.shift_handovers h where h.id = p_handover_id;
  if v_current is null then raise exception 'not_found'; end if;
  for c in select changes from public.shift_handover_corrections_v1
            where handover_id = p_handover_id order by created_at, id loop
    v_current := v_current || c.changes;
  end loop;
  for k in select jsonb_object_keys(p_changes) loop
    v_previous := v_previous || jsonb_build_object(k, v_current->k);
  end loop;

  insert into public.shift_handover_corrections_v1(handover_id, changes, previous, reason, staff_account_id, corrected_by_name)
  values (p_handover_id, p_changes, v_previous, v_reason, v_actor,
          (select sa.name from public.staff_accounts sa where sa.id = v_actor));
  return v_current || p_changes;
end;
$function$;
revoke all on function public.correct_shift_handover_v1(uuid, jsonb, text) from public, anon;
grant execute on function public.correct_shift_handover_v1(uuid, jsonb, text) to authenticated;

-- 4) The review item names the doctors on duty at each closing still missing.
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
    select jsonb_agg(jsonb_build_object('day', s.shift_date, 'shift', s.shift_type, 'due_at', s.due_at,
             'doctors', public.shift_on_duty_doctors_v1(s.branch, s.due_at - interval '2 hours'))
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
