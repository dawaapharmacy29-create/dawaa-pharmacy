-- Customer service daily tasks: keep shortage requests from swamping the day.
--
-- The first build found 210 requests (173 of them "new" for more than two weeks, never closed), so every member got
-- over 130 tasks and no room was left for regulars, customers who cut back or lost ones. A request now comes in once,
-- only while it is 2–10 days old (or once when the item arrives), and requests take at most a quarter of capacity.
-- The build also got faster: yesterday's customers read name and phone from yesterday's invoice, and phones are matched
-- on the indexed customer identity expression (17.6 s → measured below the 20 s client limit with room to spare).

begin;

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
  drop table if exists pg_temp.cs_y, pg_temp.cs_h, pg_temp.cs_c;

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
  join (
    -- Yesterday's last invoice is the customer's latest one, so name and phone come from it without a history lookup.
    select distinct on (o.branch, o.customer_code) o.branch, o.customer_code, o.customer_name,
           nullif(regexp_replace(coalesce(nullif(o.whatsapp_phone, ''), nullif(o.customer_phone, ''), o.phone, ''), 'D', '', 'g'), '') as phone,
           coalesce(o.customer_name, '') !~ '(صيدلي|مستشف|مصنع|شرك|دواء |عياد|مركز|معمل|مستوصف)'
             and coalesce(o.invoice_category, '') not like 'internal%'
             and coalesce(o.customer_type, '') <> 'internal_account' as is_person
    from public.sales_invoices o
    where o.branch in ('فرع شكري', 'فرع الشامي') and o.invoice_date >= v_y_from and o.invoice_date < v_y_to
    order by o.branch, o.customer_code, o.invoice_date desc
  ) li on li.branch = y.branch and li.customer_code = y.raw
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

  -- 4. Customer requests: the item arrived, or the request has sat open 2–10 days. Each request comes in once (after
  --    that only through its follow-up date), and requests take at most a quarter of the day's capacity.
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
    and ((r.status = 'available' and r.created_at >= now() - interval '45 days')
         or (r.status in ('new', 'searching_suppliers', 'sourcing')
             and r.created_at < now() - interval '2 days' and r.created_at >= now() - interval '10 days'))
    and not exists (
      select 1 from public.customer_service_daily_queue_items x
      where x.branch = r.branch and x.customer_key = 'r:' || r.id
        and x.queue_date between v_day - 45 and v_day - 1
    )
  order by (r.status = 'available') desc, r.created_at desc
  limit greatest(5, ceil(coalesce(s.daily_cap, 45) * greatest(cardinality(v_members), 1) * 0.25)::integer)
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
      on btrim(coalesce(c.effective_customer_code, c.customer_code, c.code, '')) = q2.customer_code
     and btrim(coalesce(c.effective_customer_code, c.customer_code, c.code, '')) <> ''
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

commit;
