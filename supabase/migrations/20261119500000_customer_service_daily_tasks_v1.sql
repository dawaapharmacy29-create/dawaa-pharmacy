-- Customer service daily tasks v1: one Excel sheet a day per team member.
--
-- The tasks live in the existing daily queue (customer_service_daily_queue_items) and every result is appended to
-- customer_service_followup_events, so there is one queue and one contact log. The owner opens the page to anyone
-- with the canonical permission keys customer_service_daily_tasks (work) and customer_service_daily_tasks_manage
-- (settings, the whole team, the overview); general managers and admins pass through dawaa_current_actor_can.
-- Unlike the branch-scoped queue RPCs, these work across both branches because the team serves both.

begin;

alter table public.customer_service_daily_queue_items
  add column if not exists result text,
  add column if not exists result_note text,
  add column if not exists attempt_no integer not null default 1;

create index if not exists customer_service_daily_queue_assignee_idx
  on public.customer_service_daily_queue_items (queue_date, assigned_staff_id);

create table if not exists public.customer_service_daily_task_settings (
  id smallint primary key default 1 check (id = 1),
  big_invoice_min numeric not null default 500 check (big_invoice_min >= 100),
  daily_cap integer not null default 45 check (daily_cap between 10 and 150),
  members jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.customer_service_daily_task_settings (id) values (1) on conflict (id) do nothing;
alter table public.customer_service_daily_task_settings enable row level security;
revoke all on public.customer_service_daily_task_settings from anon, authenticated;

-- The signed-in actor, or an error. p_manage asks for the manage key.
create or replace function public.dawaa_cs_tasks_actor_v1(p_manage boolean default false)
returns public.staff_accounts
language plpgsql stable security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_id uuid;
  a public.staff_accounts;
begin
  v_id := public.dawaa_current_staff_account_id_strict();
  if v_id is null then raise exception 'يجب تسجيل الدخول بحساب موظف نشط'; end if;
  select * into a from public.staff_accounts where id = v_id and coalesce(active, false) and coalesce(can_login, false);
  if not found then raise exception 'حساب الموظف غير نشط'; end if;
  if p_manage then
    if not coalesce(public.dawaa_current_actor_can(array['customer_service_daily_tasks_manage']), false) then
      raise exception 'إدارة مهام خدمة العملاء غير مسموحة لهذا الحساب';
    end if;
  elsif not coalesce(public.dawaa_current_actor_can(array['customer_service_daily_tasks', 'customer_service_daily_tasks_manage']), false) then
    raise exception 'مهام خدمة العملاء غير مسموحة لهذا الحساب';
  end if;
  return a;
end;
$$;

-- Result codes and the default next contact. Kept here only, so the sheet never recomputes it.
create or replace function public.dawaa_cs_task_result_label_v1(p_result text)
returns text language sql immutable as $$
  select case p_result
    when 'registered' then 'اتسجل واتبعتت الترحيب'
    when 'done_ok' then 'اتكلم وتمام'
    when 'no_answer' then 'مردش'
    when 'message_sent' then 'اتبعتت رسالة'
    when 'will_buy' then 'هيشتري'
    when 'wants_item' then 'عاوز صنف'
    when 'branch_notified' then 'اتبلغ الفرع'
    when 'complaint' then 'شكوى'
    when 'not_needed' then 'مش محتاج'
    when 'wrong_number' then 'رقم غلط'
    else null end;
$$;

create or replace function public.dawaa_cs_task_result_code_v1(p_label text)
returns text language sql immutable as $$
  select case btrim(coalesce(p_label, ''))
    when 'اتسجل واتبعتت الترحيب' then 'registered'
    when 'اتكلم وتمام' then 'done_ok'
    when 'مردش' then 'no_answer'
    when 'اتبعتت رسالة' then 'message_sent'
    when 'هيشتري' then 'will_buy'
    when 'عاوز صنف' then 'wants_item'
    when 'اتبلغ الفرع' then 'branch_notified'
    when 'شكوى' then 'complaint'
    when 'مش محتاج' then 'not_needed'
    when 'رقم غلط' then 'wrong_number'
    else null end;
$$;

create or replace function public.dawaa_cs_task_next_date_v1(p_source text, p_result text, p_attempt integer, p_day date)
returns date language sql immutable as $$
  select case
    when p_result = 'no_answer' then case when coalesce(p_attempt, 1) < 3 then p_day + 1 end
    when p_result in ('wrong_number', 'not_needed') then null
    when p_result = 'complaint' then p_day + 1
    when p_result in ('will_buy', 'wants_item', 'branch_notified') then p_day + 2
    when p_result in ('registered', 'message_sent') and p_source = 'new_customer' then p_day + 7
    when p_result = 'message_sent' then p_day + 2
    when p_result = 'done_ok' and p_source = 'declining' then p_day + 14
    when p_result = 'done_ok' and p_source = 'lost' then p_day + 30
    when p_result = 'done_ok' and p_source = 'request' then p_day + 2
    else null end;
$$;

-- A customer's latest invoice in a branch: name, phone, and whether it is an individual customer.
create or replace function public.dawaa_cs_latest_customer_invoice_v1(p_branch text, p_code text)
returns table (customer_name text, phone text, is_person boolean)
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select o.customer_name,
         nullif(regexp_replace(coalesce(nullif(o.whatsapp_phone, ''), nullif(o.customer_phone, ''), o.phone, ''), '\D', '', 'g'), ''),
         coalesce(o.customer_name, '') !~ '(صيدلي|مستشف|مصنع|شرك|دواء |عياد|مركز|معمل|مستوصف)'
           and coalesce(o.invoice_category, '') not like 'internal%'
           and coalesce(o.customer_type, '') <> 'internal_account'
  from public.sales_invoices o
  where o.customer_code = p_code and o.branch = p_branch
  order by o.invoice_date desc
  limit 1;
$$;

-- Builds (or tops up) the day's tasks and spreads the unassigned ones over the team. Safe to run again after the
-- day's invoices arrive: nothing already there is touched.
create or replace function public.dawaa_cs_daily_tasks_build_v1(p_date date default null)
returns jsonb
language plpgsql security definer
set search_path = public, auth, pg_catalog
as $$
declare
  a public.staff_accounts;
  v_day date := coalesce(p_date, (now() at time zone 'Africa/Cairo')::date);
  v_yesterday date;
  s public.customer_service_daily_task_settings;
  v_members text[];
  v_high integer;
  v_slots integer;
  v_y_from timestamptz;
  v_y_to timestamptz;
  v_hist_from timestamptz;
  v_counts jsonb;
begin
  a := public.dawaa_cs_tasks_actor_v1(false);
  if v_day <> (now() at time zone 'Africa/Cairo')::date then raise exception 'بناء المهام لليوم الحالي فقط'; end if;
  v_yesterday := v_day - 1;
  v_y_from := v_yesterday::timestamp at time zone 'Africa/Cairo';
  v_y_to := v_day::timestamp at time zone 'Africa/Cairo';
  v_hist_from := (v_day - 150)::timestamp at time zone 'Africa/Cairo';

  select * into s from public.customer_service_daily_task_settings where id = 1;
  select coalesce(array_agg(m->>'staff_account_id' order by ord), '{}')
    into v_members
  from jsonb_array_elements(coalesce(s.members, '[]'::jsonb)) with ordinality as t(m, ord)
  where not coalesce((m->>'on_leave')::boolean, false) and nullif(m->>'staff_account_id', '') is not null;

  -- 1. Follow-ups that fall due today (carried with their source, assignee and attempt).
  insert into public.customer_service_daily_queue_items
    (queue_date, branch, customer_key, customer_id, customer_code, customer_name, customer_phone, source, priority, reason,
     status, next_followup_date, assigned_staff_id, attempt_no, created_by, created_by_name, metadata)
  select v_day, q.branch, q.customer_key, q.customer_id, q.customer_code, q.customer_name, q.customer_phone, q.source, '1',
         'متابعة: ' || coalesce(public.dawaa_cs_task_result_label_v1(q.result), '') ||
           coalesce(' — ' || nullif(q.result_note, ''), ''),
         'not_started', null,
         case when q.assigned_staff_id = any(v_members) then q.assigned_staff_id end,
         case when q.result = 'no_answer' then q.attempt_no + 1 else 1 end,
         a.id::text, coalesce(a.name, a.username),
         q.metadata || jsonb_build_object('carried_from', q.id, 'carried_from_date', q.queue_date)
  from (
    select distinct on (branch, customer_key) *
    from public.customer_service_daily_queue_items
    where queue_date between v_day - 60 and v_day - 1 and result is not null
    order by branch, customer_key, queue_date desc
  ) q
  where q.next_followup_date is not null and q.next_followup_date <= v_day
  on conflict (queue_date, branch, customer_key) do nothing;

  -- Customer days for yesterday, read from the covering branch/date index; name, phone and the individual-customer
  -- check come from each customer's latest invoice (pharmacies, hospitals, companies and internal accounts are left
  -- to the managers).
  create temporary table cs_y on commit drop as
  select y.branch, y.raw, btrim(y.raw) as code, y.net, li.customer_name as name, li.phone
  from (
    select v.branch, v.customer_code as raw, sum(coalesce(v.net_amount, v.total_amount, 0)) as net
    from public.dawaa_sales_invoices_dashboard_v1 v
    where v.invoice_date >= v_y_from and v.invoice_date < v_y_to
      and v.branch in ('فرع شكري', 'فرع الشامي')
      and nullif(btrim(v.customer_code), '') is not null and btrim(v.customer_code) <> '7'
    group by 1, 2
  ) y
  cross join lateral public.dawaa_cs_latest_customer_invoice_v1(y.branch, y.raw) li
  where li.is_person;

  -- 2. New customers: first invoice in the branch was yesterday.
  insert into public.customer_service_daily_queue_items
    (queue_date, branch, customer_key, customer_code, customer_name, customer_phone, source, priority, reason, status,
     created_by, created_by_name, metadata)
  select v_day, y.branch, 'c:' || y.code, y.code, coalesce(nullif(y.name, ''), y.code), y.phone, 'new_customer', '2',
         'أول شرا امبارح بـ ' || round(y.net) || ' ج: سجّله على التليفون وابعت الترحيب', 'not_started',
         a.id::text, coalesce(a.name, a.username), jsonb_build_object('value', round(y.net))
  from cs_y y
  where not exists (
    select 1 from public.sales_invoices o
    where o.customer_code = y.raw and o.branch = y.branch and o.invoice_date < v_y_from
  )
  on conflict (queue_date, branch, customer_key) do nothing;

  -- 3. A check-in after a big invoice yesterday.
  insert into public.customer_service_daily_queue_items
    (queue_date, branch, customer_key, customer_code, customer_name, customer_phone, source, priority, reason, status,
     created_by, created_by_name, metadata)
  select v_day, y.branch, 'c:' || y.code, y.code, coalesce(nullif(y.name, ''), y.code), y.phone, 'big_invoice', '3',
         'اشترى امبارح بـ ' || round(y.net) || ' ج: اطمّن عليه واسأله عن الخدمة', 'not_started',
         a.id::text, coalesce(a.name, a.username), jsonb_build_object('value', round(y.net))
  from cs_y y
  where y.net >= s.big_invoice_min
    and not exists (
      select 1 from public.customer_service_daily_queue_items r
      where r.branch = y.branch and r.customer_key = 'c:' || y.code
        and r.queue_date between v_day - 7 and v_day - 1 and r.result is not null
    )
  order by y.net desc
  on conflict (queue_date, branch, customer_key) do nothing;

  -- 4. Customer requests: the item arrived, or the request sat open two days.
  insert into public.customer_service_daily_queue_items
    (queue_date, branch, customer_key, customer_code, customer_name, customer_phone, source, priority, reason, status,
     created_by, created_by_name, metadata)
  select v_day, r.branch, 'r:' || r.id, nullif(btrim(r.customer_code), ''), coalesce(nullif(r.customer_name, ''), 'عميل'),
         nullif(regexp_replace(coalesce(r.customer_phone, ''), '\D', '', 'g'), ''), 'request', '4',
         case when r.status = 'available' then 'الصنف اتوفر: بلّغ الفرع يكلم العميل ويعمل الأوردر — '
              else 'طلب مفتوح من ' || to_char(r.created_at at time zone 'Africa/Cairo', 'DD/MM') || ': تابع توفيره — ' end
           || coalesce(r.medicine_name, ''),
         'not_started', a.id::text, coalesce(a.name, a.username), jsonb_build_object('request_id', r.id, 'request_status', r.status)
  from public.customer_requests r
  where r.branch in ('فرع شكري', 'فرع الشامي')
    and r.created_at >= now() - interval '45 days'
    and (r.status = 'available'
         or (r.status in ('new', 'searching_suppliers', 'sourcing') and r.created_at < now() - interval '2 days'))
    and not exists (
      select 1 from public.customer_service_daily_queue_items x
      where x.branch = r.branch and x.customer_key = 'r:' || r.id
        and x.queue_date between v_day - 2 and v_day - 1 and x.result is not null
    )
  on conflict (queue_date, branch, customer_key) do nothing;

  select count(*) into v_high from public.customer_service_daily_queue_items where queue_date = v_day;
  v_slots := greatest(0, coalesce(s.daily_cap, 45) * greatest(cardinality(v_members), 1) - v_high);

  if v_slots > 0 then
    -- Customer histories for the last 150 days (individual customers only).
    create temporary table cs_h on commit drop as
    with d as (
      select v.branch, v.customer_code as raw, (v.invoice_date at time zone 'Africa/Cairo')::date as day,
             sum(coalesce(v.net_amount, v.total_amount, 0)) as net
      from public.dawaa_sales_invoices_dashboard_v1 v
      where v.invoice_date >= v_hist_from and v.invoice_date < v_y_to
        and v.branch in ('فرع شكري', 'فرع الشامي')
        and nullif(btrim(v.customer_code), '') is not null and btrim(v.customer_code) <> '7'
      group by 1, 2, 3
    ), g as (
      select *, day - lag(day) over (partition by branch, raw order by day) as gap from d
    )
    select branch, raw, btrim(raw) as code, count(*) as visits, max(day) as last_day,
           v_day - max(day) as since,
           percentile_cont(0.5) within group (order by gap) as med_gap,
           sum(net) as total,
           coalesce(sum(net) filter (where day >= v_day - 30), 0) as spend30,
           coalesce(sum(net) filter (where day >= v_day - 90 and day < v_day - 30), 0) / 2.0 as prev_month
    from g group by 1, 2;

    create temporary table cs_c on commit drop as
    select h.*
    from (
      select h.*,
        case
          when h.visits >= 3 and h.med_gap between 3 and 45 and h.since between h.med_gap and h.med_gap + 5 then 'regular_due'
          when h.since <= 30 and h.prev_month >= 300 and h.spend30 < 0.5 * h.prev_month then 'declining'
          when h.visits >= 2 and h.total >= 1000 and h.since >= greatest(coalesce(2 * h.med_gap, 45), 45) then 'lost'
        end as seg,
        case
          when h.visits >= 3 and h.med_gap between 3 and 45 and h.since between h.med_gap and h.med_gap + 5 then h.total / h.visits
          when h.since <= 30 and h.prev_month >= 300 and h.spend30 < 0.5 * h.prev_month then h.prev_month - h.spend30
          else h.total
        end as rank_value
      from cs_h h
    ) h
    where seg is not null
      and not exists (
        select 1 from public.customer_service_daily_queue_items r
        where r.branch = h.branch and r.customer_key = 'c:' || h.code
          and r.queue_date between v_day - case h.seg when 'lost' then 30 when 'declining' then 14 else 7 end and v_day - 1
          and r.result is not null
      );

    insert into public.customer_service_daily_queue_items
      (queue_date, branch, customer_key, customer_code, customer_name, customer_phone, source, priority, reason, status,
       created_by, created_by_name, metadata)
    select v_day, c.branch, 'c:' || c.code, c.code, coalesce(nullif(c.name, ''), c.code), c.phone, c.seg,
           case c.seg when 'regular_due' then '5' when 'declining' then '6' else '7' end,
           case c.seg
             when 'regular_due' then 'بيرجع كل ' || round(c.med_gap::numeric) || ' يوم وآخر شرا من ' || c.since || ' يوم: فكّره واعرض نجهزله الطلب'
             when 'declining' then 'صرف آخر ٣٠ يوم ' || round(c.spend30) || ' ج مقابل ' || round(c.prev_month) || ' ج في الشهر قبلها'
             else 'مااشتراش من ' || c.since || ' يوم (اشترى بـ ' || round(c.total) || ' ج في ٥ شهور)'
           end,
           'not_started', a.id::text, coalesce(a.name, a.username),
           jsonb_build_object('value', round(c.rank_value), 'last_day', c.last_day)
    from (
      select c.*, li.customer_name as name, li.phone,
             row_number() over (partition by c.seg order by c.rank_value desc) as rn2
      from (
        select c.*, row_number() over (partition by seg order by rank_value desc) as rn from cs_c c
      ) c
      cross join lateral public.dawaa_cs_latest_customer_invoice_v1(c.branch, c.raw) li
      where li.is_person
        and c.rn <= 2 * ceil(v_slots * case c.seg when 'regular_due' then 0.5 else 0.25 end)
    ) c
    where c.rn2 <= ceil(v_slots * case c.seg when 'regular_due' then 0.5 else 0.25 end)
    on conflict (queue_date, branch, customer_key) do nothing;
  end if;

  -- Fill missing phones from the customer master.
  update public.customer_service_daily_queue_items q
     set customer_phone = p.phone
  from (
    select distinct on (q2.id) q2.id,
           nullif(regexp_replace(coalesce(nullif(c.normalized_phone, ''), nullif(c.whatsapp_phone, ''), nullif(c.phone, ''),
                  nullif(c.mobile, ''), nullif(c.customer_phone, ''), ''), '\D', '', 'g'), '') as phone
    from public.customer_service_daily_queue_items q2
    join public.customers c
      on btrim(coalesce(c.effective_customer_code, c.customer_code, c.code)) = q2.customer_code
     and (coalesce(c.effective_branch, c.branch, c.branch_name) is null or coalesce(c.effective_branch, c.branch, c.branch_name) = q2.branch)
    where q2.queue_date = v_day and nullif(q2.customer_phone, '') is null and q2.customer_code is not null
    order by q2.id, (coalesce(c.effective_branch, c.branch, c.branch_name) is null)
  ) p
  where q.id = p.id and p.phone is not null;

  -- Spread what is unassigned over the members on duty, the busiest last.
  if cardinality(v_members) > 0 then
    with pending as (
      select id, row_number() over (order by priority, coalesce((metadata->>'value')::numeric, 0) desc, id) as rn
      from public.customer_service_daily_queue_items
      where queue_date = v_day and (assigned_staff_id is null or not (assigned_staff_id = any(v_members)))
    ), load as (
      select m, ord, (select count(*) from public.customer_service_daily_queue_items x
                      where x.queue_date = v_day and x.assigned_staff_id = m) as n
      from unnest(v_members) with ordinality as u(m, ord)
    ), slots as (
      select m, row_number() over (order by n, ord) - 1 as slot from load
    )
    update public.customer_service_daily_queue_items q
       set assigned_staff_id = sl.m
    from pending p
    join slots sl on sl.slot = (p.rn - 1) % cardinality(v_members)
    where q.id = p.id;
  end if;

  select jsonb_object_agg(source, n) into v_counts
  from (select source, count(*) as n from public.customer_service_daily_queue_items where queue_date = v_day group by 1) t;

  return jsonb_build_object('date', v_day, 'counts', coalesce(v_counts, '{}'::jsonb), 'members', cardinality(v_members),
    'yesterday_invoices', (select count(*) from public.sales_invoices where invoice_date >= v_y_from and invoice_date < v_y_to));
end;
$$;

-- The day's tasks: the caller's own, or (manage) anyone's / everyone's.
create or replace function public.dawaa_cs_daily_tasks_list_v1(p_date date default null, p_staff_account_id text default null, p_all boolean default false)
returns table (
  id uuid, queue_date date, branch text, source text, priority text, customer_code text, customer_name text,
  customer_phone text, reason text, attempt_no integer, assigned_staff_id text, assigned_name text,
  result text, result_label text, result_note text, next_followup_date date, last_contact text
)
language plpgsql stable security definer
set search_path = public, auth, pg_catalog
as $$
declare
  a public.staff_accounts;
  v_day date := coalesce(p_date, (now() at time zone 'Africa/Cairo')::date);
  v_target text;
  v_manage boolean;
begin
  a := public.dawaa_cs_tasks_actor_v1(false);
  v_manage := coalesce(public.dawaa_current_actor_can(array['customer_service_daily_tasks_manage']), false);
  if (p_all or (p_staff_account_id is not null and p_staff_account_id <> a.id::text)) and not v_manage then
    raise exception 'عرض مهام الفريق للمسؤول فقط';
  end if;
  v_target := coalesce(p_staff_account_id, a.id::text);
  return query
  select q.id, q.queue_date, q.branch, q.source, q.priority, q.customer_code, q.customer_name, q.customer_phone, q.reason,
         q.attempt_no, q.assigned_staff_id, sa.name, q.result, public.dawaa_cs_task_result_label_v1(q.result), q.result_note,
         q.next_followup_date,
         (select to_char(p.queue_date, 'DD/MM') || ' ' || coalesce(public.dawaa_cs_task_result_label_v1(p.result), '') ||
                 coalesce(': ' || nullif(p.result_note, ''), '')
          from public.customer_service_daily_queue_items p
          where p.branch = q.branch and p.customer_key = q.customer_key and p.queue_date < q.queue_date and p.result is not null
          order by p.queue_date desc limit 1)
  from public.customer_service_daily_queue_items q
  left join public.staff_accounts sa on sa.id::text = q.assigned_staff_id
  where q.queue_date = v_day and (p_all or q.assigned_staff_id = v_target)
  order by q.priority, q.branch, q.customer_name;
end;
$$;

-- The uploaded sheet. Rows with an id update a task; rows without one add a doctor's case for today.
create or replace function public.dawaa_cs_daily_tasks_submit_v1(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, auth, pg_catalog
as $$
declare
  a public.staff_accounts;
  v_manage boolean;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  r jsonb;
  q public.customer_service_daily_queue_items;
  v_result text;
  v_next date;
  v_updated integer := 0;
  v_added integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_branch text;
  v_code text;
  v_name text;
  v_phone text;
begin
  a := public.dawaa_cs_tasks_actor_v1(false);
  v_manage := coalesce(public.dawaa_current_actor_can(array['customer_service_daily_tasks_manage']), false);
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 400 then
    raise exception 'الشيت فيه صفوف أكتر من المسموح';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_result := coalesce(public.dawaa_cs_task_result_code_v1(r->>'result'),
                         case when public.dawaa_cs_task_result_label_v1(r->>'result') is not null then r->>'result' end);
    v_next := nullif(btrim(coalesce(r->>'next_date', '')), '')::date;

    if nullif(r->>'id', '') is not null then
      select * into q from public.customer_service_daily_queue_items where id = (r->>'id')::uuid for update;
      if not found then v_skipped := v_skipped || jsonb_build_object('id', r->>'id', 'why', 'المهمة مش موجودة'); continue; end if;
      if q.queue_date < v_today - 3 then v_skipped := v_skipped || jsonb_build_object('id', q.id, 'why', 'شيت قديم'); continue; end if;
      if q.assigned_staff_id is distinct from a.id::text and not v_manage then
        v_skipped := v_skipped || jsonb_build_object('id', q.id, 'why', 'المهمة مش عليك'); continue;
      end if;
      if v_result is null then continue; end if;
      update public.customer_service_daily_queue_items
         set result = v_result,
             result_note = nullif(btrim(coalesce(r->>'note', '')), ''),
             next_followup_date = coalesce(v_next, public.dawaa_cs_task_next_date_v1(q.source, v_result, q.attempt_no, q.queue_date)),
             status = case when v_result = 'no_answer' then 'attempted' else 'completed' end,
             started_at = coalesce(started_at, now()),
             completed_at = now(),
             last_action_at = now(),
             assigned_staff_id = coalesce(assigned_staff_id, a.id::text)
       where id = q.id;
      insert into public.customer_service_followup_events (queue_item_id, event_type, event_status, actor_staff_id, actor_name, notes, metadata)
      values (q.id, 'daily_task_result', v_result, a.id::text, coalesce(a.name, a.username),
              nullif(btrim(coalesce(r->>'note', '')), ''), jsonb_build_object('source', q.source, 'via', 'sheet'));
      v_updated := v_updated + 1;
    else
      v_branch := case when coalesce(r->>'branch', '') like '%شامي%' then 'فرع الشامي'
                       when coalesce(r->>'branch', '') like '%شكري%' then 'فرع شكري' end;
      v_code := nullif(btrim(coalesce(r->>'customer_code', '')), '');
      if v_branch is null or v_code is null or nullif(btrim(coalesce(r->>'reason', '')), '') is null then
        if coalesce(r->>'customer_code', r->>'reason', '') <> '' then
          v_skipped := v_skipped || jsonb_build_object('code', r->>'customer_code', 'why', 'حالة الدكتور محتاجة فرع وكود وسبب');
        end if;
        continue;
      end if;
      select max(v.customer_name), max(nullif(regexp_replace(coalesce(nullif(v.whatsapp_phone, ''), nullif(v.customer_phone, ''), ''), '\D', '', 'g'), ''))
        into v_name, v_phone
      from public.sales_invoices v where btrim(v.customer_code) = v_code and v.branch = v_branch;
      insert into public.customer_service_daily_queue_items
        (queue_date, branch, customer_key, customer_code, customer_name, customer_phone, source, priority, reason, status,
         assigned_staff_id, result, result_note, next_followup_date, completed_at, created_by, created_by_name, metadata)
      values (v_today, v_branch, 'c:' || v_code, v_code,
              coalesce(nullif(btrim(coalesce(r->>'customer_name', '')), ''), v_name, v_code),
              coalesce(nullif(regexp_replace(coalesce(r->>'phone', ''), '\D', '', 'g'), ''), v_phone),
              'doctor_case', '1', btrim(r->>'reason'),
              case when v_result is null then 'not_started' when v_result = 'no_answer' then 'attempted' else 'completed' end,
              a.id::text, v_result, nullif(btrim(coalesce(r->>'note', '')), ''),
              coalesce(v_next, case when v_result is null then v_today end, public.dawaa_cs_task_next_date_v1('doctor_case', v_result, 1, v_today)),
              case when v_result is not null then now() end,
              a.id::text, coalesce(a.name, a.username), jsonb_build_object('doctor', nullif(btrim(coalesce(r->>'doctor', '')), '')))
      on conflict (queue_date, branch, customer_key) do update
        set reason = customer_service_daily_queue_items.reason || ' | حالة دكتور: ' || excluded.reason,
            priority = '1';
      v_added := v_added + 1;
    end if;
  end loop;

  return jsonb_build_object('updated', v_updated, 'added', v_added, 'skipped', v_skipped);
end;
$$;

-- Settings, the team and the accounts that can be added to it.
create or replace function public.dawaa_cs_daily_tasks_settings_v1()
returns jsonb
language plpgsql stable security definer
set search_path = public, auth, pg_catalog
as $$
declare
  a public.staff_accounts;
  s public.customer_service_daily_task_settings;
  v_manage boolean;
begin
  a := public.dawaa_cs_tasks_actor_v1(false);
  v_manage := coalesce(public.dawaa_current_actor_can(array['customer_service_daily_tasks_manage']), false);
  select * into s from public.customer_service_daily_task_settings where id = 1;
  return jsonb_build_object(
    'big_invoice_min', s.big_invoice_min,
    'daily_cap', s.daily_cap,
    'can_manage', v_manage,
    'me', a.id,
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'staff_account_id', m->>'staff_account_id',
        'name', sa.name,
        'on_leave', coalesce((m->>'on_leave')::boolean, false),
        'has_permission', coalesce(public.dawaa_jsonb_has_true_any(public.get_user_permissions(sa.id),
                                     array['customer_service_daily_tasks', 'customer_service_daily_tasks_manage']), false)
                          or lower(coalesce(sa.role, '')) in ('general_manager', 'admin')
      ) order by ord), '[]'::jsonb)
      from jsonb_array_elements(coalesce(s.members, '[]'::jsonb)) with ordinality as t(m, ord)
      left join public.staff_accounts sa on sa.id::text = m->>'staff_account_id'
    ),
    'candidates', case when v_manage then (
      select coalesce(jsonb_agg(jsonb_build_object('staff_account_id', sa.id, 'name', sa.name, 'branch', sa.branch) order by sa.name), '[]'::jsonb)
      from public.staff_accounts sa where coalesce(sa.active, false) and coalesce(sa.can_login, false)
    ) end
  );
end;
$$;

create or replace function public.dawaa_cs_daily_tasks_settings_save_v1(p_big_invoice_min numeric, p_daily_cap integer, p_members jsonb)
returns void
language plpgsql security definer
set search_path = public, auth, pg_catalog
as $$
declare
  a public.staff_accounts;
  v_members jsonb;
begin
  a := public.dawaa_cs_tasks_actor_v1(true);
  if jsonb_typeof(coalesce(p_members, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_members, '[]'::jsonb)) > 20 then
    raise exception 'قايمة الفريق غير صحيحة';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('staff_account_id', sa.id::text, 'on_leave', coalesce((m->>'on_leave')::boolean, false)) order by ord), '[]'::jsonb)
    into v_members
  from jsonb_array_elements(coalesce(p_members, '[]'::jsonb)) with ordinality as t(m, ord)
  join public.staff_accounts sa on sa.id::text = m->>'staff_account_id';
  update public.customer_service_daily_task_settings
     set big_invoice_min = p_big_invoice_min, daily_cap = p_daily_cap, members = v_members,
         updated_at = now(), updated_by = coalesce(a.name, a.username)
   where id = 1;
end;
$$;

-- The owner's view: what each member did, what came of it, and what is coming.
create or replace function public.dawaa_cs_daily_tasks_overview_v1(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer
set search_path = public, auth, pg_catalog
as $$
declare
  a public.staff_accounts;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
begin
  a := public.dawaa_cs_tasks_actor_v1(true);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then raise exception 'الفترة غير صحيحة'; end if;
  return jsonb_build_object(
    'members', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.name), '[]'::jsonb) from (
        select coalesce(sa.name, 'مش متوزع') as name, q.assigned_staff_id as staff_account_id,
               count(*) as tasks,
               count(*) filter (where q.result is not null) as done,
               count(*) filter (where q.result = 'no_answer') as no_answer,
               count(*) filter (where q.result = 'complaint') as complaints,
               count(*) filter (where q.result is not null and q.customer_code is not null and exists (
                 select 1 from public.sales_invoices v
                 where btrim(v.customer_code) = q.customer_code and v.branch = q.branch
                   and v.invoice_date >= ((q.queue_date + 1)::timestamp at time zone 'Africa/Cairo')
                   and v.invoice_date < ((q.queue_date + 8)::timestamp at time zone 'Africa/Cairo'))) as bought_after
        from public.customer_service_daily_queue_items q
        left join public.staff_accounts sa on sa.id::text = q.assigned_staff_id
        where q.queue_date between p_from and p_to and q.status <> 'archived'
        group by 1, 2
      ) t
    ),
    'by_source', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) from (
        select q.source, count(*) as tasks, count(*) filter (where q.result is not null) as done
        from public.customer_service_daily_queue_items q
        where q.queue_date between p_from and p_to group by 1 order by 1
      ) t
    ),
    'complaints', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.queue_date desc), '[]'::jsonb) from (
        select q.queue_date, q.branch, q.customer_code, q.customer_name, q.customer_phone, q.result_note, sa.name as by_name
        from public.customer_service_daily_queue_items q
        left join public.staff_accounts sa on sa.id::text = q.assigned_staff_id
        where q.queue_date between p_from and p_to and q.result = 'complaint'
        limit 100
      ) t
    ),
    'upcoming', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.day), '[]'::jsonb) from (
        select x.next_followup_date as day, count(*) as n
        from (
          select distinct on (branch, customer_key) next_followup_date, result
          from public.customer_service_daily_queue_items
          where queue_date between v_today - 60 and v_today and result is not null
          order by branch, customer_key, queue_date desc
        ) x
        where x.next_followup_date between v_today + 1 and v_today + 7
        group by 1
      ) t
    ),
    'chat_exports', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.day desc, t.branch), '[]'::jsonb) from (
        select (w.created_at at time zone 'Africa/Cairo')::date as day, coalesce(w.branch, 'من غير فرع') as branch, count(*) as n
        from public.whatsapp_review_sources w
        where w.deleted_at is null and w.created_at >= ((v_today - 6)::timestamp at time zone 'Africa/Cairo')
        group by 1, 2
      ) t
    )
  );
end;
$$;

revoke all on function public.dawaa_cs_tasks_actor_v1(boolean) from public, anon, authenticated;
revoke all on function public.dawaa_cs_latest_customer_invoice_v1(text, text) from public, anon, authenticated;
revoke all on function public.dawaa_cs_daily_tasks_build_v1(date) from public, anon;
revoke all on function public.dawaa_cs_daily_tasks_list_v1(date, text, boolean) from public, anon;
revoke all on function public.dawaa_cs_daily_tasks_submit_v1(jsonb) from public, anon;
revoke all on function public.dawaa_cs_daily_tasks_settings_v1() from public, anon;
revoke all on function public.dawaa_cs_daily_tasks_settings_save_v1(numeric, integer, jsonb) from public, anon;
revoke all on function public.dawaa_cs_daily_tasks_overview_v1(date, date) from public, anon;
grant execute on function public.dawaa_cs_daily_tasks_build_v1(date) to authenticated;
grant execute on function public.dawaa_cs_daily_tasks_list_v1(date, text, boolean) to authenticated;
grant execute on function public.dawaa_cs_daily_tasks_submit_v1(jsonb) to authenticated;
grant execute on function public.dawaa_cs_daily_tasks_settings_v1() to authenticated;
grant execute on function public.dawaa_cs_daily_tasks_settings_save_v1(numeric, integer, jsonb) to authenticated;
grant execute on function public.dawaa_cs_daily_tasks_overview_v1(date, date) to authenticated;

-- The current team (هاجر، نور، هبه محمد) gets the work key; anyone else is opened later from صلاحيات الحسابات.
update public.staff_accounts
set permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object('customer_service_daily_tasks', true)
where staff_id in ('82b9c2a1-6139-4b07-9937-ef80a6e926d8', 'e3640642-5c60-4815-8001-1bb93193668f', 'dea91886-1ae8-4766-a166-9952866a5024');

-- Seed the members once (هبه محمد on leave until early December); the manager edits them from the page afterwards.
update public.customer_service_daily_task_settings s
set members = (
  select coalesce(jsonb_agg(jsonb_build_object('staff_account_id', sa.id::text, 'on_leave', sa.staff_id = 'dea91886-1ae8-4766-a166-9952866a5024')
                            order by array_position(array['e3640642-5c60-4815-8001-1bb93193668f', '82b9c2a1-6139-4b07-9937-ef80a6e926d8', 'dea91886-1ae8-4766-a166-9952866a5024'], sa.staff_id::text)), '[]'::jsonb)
  from public.staff_accounts sa
  where sa.staff_id::text in ('82b9c2a1-6139-4b07-9937-ef80a6e926d8', 'e3640642-5c60-4815-8001-1bb93193668f', 'dea91886-1ae8-4766-a166-9952866a5024')
), updated_at = now(), updated_by = 'migration'
where s.id = 1 and s.members = '[]'::jsonb;

commit;
