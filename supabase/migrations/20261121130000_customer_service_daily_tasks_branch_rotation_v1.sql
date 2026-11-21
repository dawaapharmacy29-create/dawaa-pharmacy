-- Customer service daily tasks: each member works one branch for the month, and the branches swap every month.
--
-- Owner request 2026-11-21: «خلي نور تبع فرع شكري و هاجر تبع فرع الشامي … الشهر الجاي نعكس و هكذا».
-- A member in settings.members now carries {branch, branch_month}: the branch she works in branch_month; every month
-- after that the two branches swap (odd months away from branch_month = the other branch). The manager sets this
-- month's branch from the page; the database works out the rest.
--
-- How the day is split:
--   * Each branch is served by its owners on duty, plus any member on duty with no branch set (helps both).
--   * Capacity per branch = daily_cap × (owners + helpers / 2); new requests take at most a quarter of it.
--   * If a branch has nobody that day (leave), everyone on duty serves both branches and each branch gets half of
--     the team's capacity, as before.
--   * Pressing «جهّز» again re-routes the day's tasks that have no result yet to the branch's own members, so today's
--     sheet (built before this change) can be redone in place.
-- Also: phones read from yesterday's invoices drop non-digits ('\D'; the previous version stripped the letter D).

begin;

create or replace function public.dawaa_cs_member_branch_v1(p_member jsonb, p_day date)
returns text
language sql immutable
set search_path = public, pg_catalog
as $$
  select case
    when p_member->>'branch' not in ('فرع شكري', 'فرع الشامي') then null
    when mod(abs((extract(year from p_day)::int * 12 + extract(month from p_day)::int)
                 - (extract(year from coalesce((p_member->>'branch_month')::date, p_day))::int * 12
                    + extract(month from coalesce((p_member->>'branch_month')::date, p_day))::int)), 2) = 0
      then p_member->>'branch'
    when p_member->>'branch' = 'فرع شكري' then 'فرع الشامي'
    else 'فرع شكري'
  end;
$$;
revoke all on function public.dawaa_cs_member_branch_v1(jsonb, date) from public, anon, authenticated;

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
  v_on_duty integer;
  v_pooled boolean;
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
  drop table if exists pg_temp.cs_y, pg_temp.cs_h, pg_temp.cs_c, pg_temp.cs_m, pg_temp.cs_cap, pg_temp.cs_s;

  select * into s from public.customer_service_daily_task_settings where id = 1;

  -- Who serves which branch today.
  create temporary table cs_m (branch text, member text, ord integer, owner boolean) on commit drop;
  with duty as (
    select m->>'staff_account_id' as member, ord, public.dawaa_cs_member_branch_v1(m, v_day) as home
    from jsonb_array_elements(coalesce(s.members, '[]'::jsonb)) with ordinality as t(m, ord)
    where not coalesce((m->>'on_leave')::boolean, false) and nullif(m->>'staff_account_id', '') is not null
  )
  insert into cs_m
  select b.branch, d.member, d.ord::integer, d.home = b.branch
  from duty d cross join (values ('فرع شكري'), ('فرع الشامي')) as b(branch)
  where d.home is null or d.home = b.branch;
  select count(distinct member) into v_on_duty from cs_m;
  v_pooled := (select count(distinct branch) from cs_m) < 2;
  if v_pooled then
    delete from cs_m;
    insert into cs_m
    select b.branch, m->>'staff_account_id', ord::integer, false
    from jsonb_array_elements(coalesce(s.members, '[]'::jsonb)) with ordinality as t(m, ord)
    cross join (values ('فرع شكري'), ('فرع الشامي')) as b(branch)
    where not coalesce((m->>'on_leave')::boolean, false) and nullif(m->>'staff_account_id', '') is not null;
  end if;

  create temporary table cs_cap on commit drop as
  select b.branch,
         case when v_pooled then ceil(coalesce(s.daily_cap, 45) * greatest(v_on_duty, 1) / 2.0)
              else coalesce(s.daily_cap, 45) * ((select count(*) from cs_m m where m.branch = b.branch and m.owner)
                                                + (select count(*) from cs_m m where m.branch = b.branch and not m.owner) / 2.0)
         end::integer as cap
  from (values ('فرع شكري'), ('فرع الشامي')) as b(branch);

  -- 1. Follow-ups that fall due today (carried with their source and attempt; the assignee stays when she still
  --    serves that branch).
  insert into public.customer_service_daily_queue_items
    (queue_date, branch, customer_key, customer_id, customer_code, customer_name, customer_phone, source, priority, reason,
     status, next_followup_date, assigned_staff_id, attempt_no, created_by, created_by_name, metadata)
  select v_day, q.branch, q.customer_key, q.customer_id, q.customer_code, q.customer_name, q.customer_phone, q.source, '1',
         'متابعة: ' || coalesce(public.dawaa_cs_task_result_label_v1(q.result), '') ||
           coalesce(' — ' || nullif(q.result_note, ''), ''),
         'not_started', null,
         case when exists (select 1 from cs_m m where m.branch = q.branch and m.member = q.assigned_staff_id)
              then q.assigned_staff_id end,
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

  -- Customer days for yesterday; name, phone and the individual-customer check come from each customer's latest
  -- invoice (pharmacies, hospitals, companies and internal accounts are left to the managers).
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
    select distinct on (o.branch, o.customer_code) o.branch, o.customer_code, o.customer_name,
           nullif(regexp_replace(coalesce(nullif(o.whatsapp_phone, ''), nullif(o.customer_phone, ''), o.phone, ''), '\D', '', 'g'), '') as phone,
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

  -- 4. Customer requests: the item arrived, or the request has sat open 2–10 days. Each request comes in once, and
  --    requests take at most a quarter of each branch's capacity.
  insert into public.customer_service_daily_queue_items
    (queue_date, branch, customer_key, customer_code, customer_name, customer_phone, source, priority, reason, status,
     created_by, created_by_name, metadata)
  select v_day, r.branch, 'r:' || r.id, nullif(btrim(r.customer_code), ''), coalesce(nullif(r.customer_name, ''), 'عميل'),
         nullif(regexp_replace(coalesce(r.customer_phone, ''), '\D', '', 'g'), ''), 'request', '4',
         case when r.status = 'available' then 'الصنف اتوفر: بلّغ الفرع يكلم العميل ويعمل الأوردر — '
              else 'طلب مفتوح من ' || to_char(r.created_at at time zone 'Africa/Cairo', 'DD/MM') || ': تابع توفيره — ' end
           || coalesce(r.medicine_name, ''),
         'not_started', a.id::text, coalesce(a.name, a.username), jsonb_build_object('request_id', r.id, 'request_status', r.status)
  from (
    select r.*, row_number() over (partition by r.branch order by (r.status = 'available') desc, r.created_at desc) as rn
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
  ) r
  join cs_cap c on c.branch = r.branch
  where r.rn <= greatest(3, ceil(c.cap * 0.25))
  on conflict (queue_date, branch, customer_key) do nothing;

  -- What is left of each branch's capacity goes to regulars, customers who cut back and lost ones.
  create temporary table cs_s on commit drop as
  select c.branch, greatest(0, c.cap - (select count(*) from public.customer_service_daily_queue_items q
                                        where q.queue_date = v_day and q.branch = c.branch))::integer as slots
  from cs_cap c;

  if exists (select 1 from cs_s where slots > 0) then
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
             row_number() over (partition by c.branch, c.seg order by c.rank_value desc) as rn2
      from (
        select c.*, sl.slots, row_number() over (partition by c.branch, c.seg order by c.rank_value desc) as rn
        from cs_c c join cs_s sl on sl.branch = c.branch
      ) c
      cross join lateral public.dawaa_cs_latest_customer_invoice_v1(c.branch, c.raw) li
      where li.is_person
        and c.rn <= 2 * ceil(c.slots * case c.seg when 'regular_due' then 0.5 else 0.25 end)
    ) c
    where c.rn2 <= ceil(c.slots * case c.seg when 'regular_due' then 0.5 else 0.25 end)
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

  -- Give each branch's open tasks to the members serving that branch, the least loaded first. Tasks that already have
  -- a result keep their assignee.
  with pending as (
    select q.id, q.branch,
           row_number() over (partition by q.branch order by q.priority, coalesce((q.metadata->>'value')::numeric, 0) desc, q.id) as rn
    from public.customer_service_daily_queue_items q
    where q.queue_date = v_day and q.result is null
      and not exists (select 1 from cs_m m where m.branch = q.branch and m.member = q.assigned_staff_id)
  ), load as (
    select m.branch, m.member, m.ord,
           (select count(*) from public.customer_service_daily_queue_items x
            where x.queue_date = v_day and x.assigned_staff_id = m.member
              and exists (select 1 from cs_m m2 where m2.branch = x.branch and m2.member = m.member)) as n
    from cs_m m
  ), slots as (
    select branch, member, row_number() over (partition by branch order by n, ord) - 1 as slot,
           count(*) over (partition by branch) as k
    from load
  )
  update public.customer_service_daily_queue_items q
     set assigned_staff_id = sl.member
  from pending p
  join slots sl on sl.branch = p.branch and sl.slot = (p.rn - 1) % sl.k
  where q.id = p.id;

  select jsonb_object_agg(source, n) into v_counts
  from (select source, count(*) as n from public.customer_service_daily_queue_items where queue_date = v_day group by 1) t;

  return jsonb_build_object('date', v_day, 'counts', coalesce(v_counts, '{}'::jsonb), 'members', v_on_duty,
    'pooled', v_pooled,
    'branches', (select jsonb_object_agg(c.branch, jsonb_build_object('cap', c.cap,
                   'members', (select coalesce(jsonb_agg(coalesce(sa.name, m.member) order by m.ord), '[]'::jsonb)
                               from cs_m m left join public.staff_accounts sa on sa.id::text = m.member
                               where m.branch = c.branch)))
                 from cs_cap c),
    'yesterday_invoices', (select count(*) from public.sales_invoices where invoice_date >= v_y_from and invoice_date < v_y_to));
end;
$$;

create or replace function public.dawaa_cs_daily_tasks_settings_v1()
returns jsonb
language plpgsql stable security definer
set search_path = public, auth, pg_catalog
as $$
declare
  a public.staff_accounts;
  s public.customer_service_daily_task_settings;
  v_manage boolean;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
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
        'branch', public.dawaa_cs_member_branch_v1(m, v_today),
        'next_month_branch', public.dawaa_cs_member_branch_v1(m, (date_trunc('month', v_today) + interval '1 month')::date),
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

-- p_members[i].branch is the branch she works THIS month (or null = helps both); it is stored with this month so the
-- swap every month follows from it.
create or replace function public.dawaa_cs_daily_tasks_settings_save_v1(p_big_invoice_min numeric, p_daily_cap integer, p_members jsonb)
returns void
language plpgsql security definer
set search_path = public, auth, pg_catalog
as $$
declare
  a public.staff_accounts;
  v_members jsonb;
  v_month date := date_trunc('month', (now() at time zone 'Africa/Cairo')::date)::date;
begin
  a := public.dawaa_cs_tasks_actor_v1(true);
  if jsonb_typeof(coalesce(p_members, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_members, '[]'::jsonb)) > 20 then
    raise exception 'قايمة الفريق غير صحيحة';
  end if;
  select coalesce(jsonb_agg(
           jsonb_build_object('staff_account_id', sa.id::text, 'on_leave', coalesce((m->>'on_leave')::boolean, false))
           || case when m->>'branch' in ('فرع شكري', 'فرع الشامي')
                   then jsonb_build_object('branch', m->>'branch', 'branch_month', v_month) else '{}'::jsonb end
           order by ord), '[]'::jsonb)
    into v_members
  from jsonb_array_elements(coalesce(p_members, '[]'::jsonb)) with ordinality as t(m, ord)
  join public.staff_accounts sa on sa.id::text = m->>'staff_account_id';
  update public.customer_service_daily_task_settings
     set big_invoice_min = p_big_invoice_min, daily_cap = p_daily_cap, members = v_members,
         updated_at = now(), updated_by = coalesce(a.name, a.username)
   where id = 1;
end;
$$;

grant execute on function public.dawaa_cs_daily_tasks_build_v1(date) to anon, authenticated;
grant execute on function public.dawaa_cs_daily_tasks_settings_v1() to anon, authenticated;
grant execute on function public.dawaa_cs_daily_tasks_settings_save_v1(numeric, integer, jsonb) to anon, authenticated;

-- November 2026: نور on فرع شكري, هاجر on فرع الشامي (December swaps them). هبه محمد keeps no branch until she is back.
update public.customer_service_daily_task_settings s
set members = (
  select jsonb_agg(
           m || case sa.staff_id
                  when '82b9c2a1-6139-4b07-9937-ef80a6e926d8' then jsonb_build_object('branch', 'فرع شكري', 'branch_month', '2026-11-01')
                  when 'e3640642-5c60-4815-8001-1bb93193668f' then jsonb_build_object('branch', 'فرع الشامي', 'branch_month', '2026-11-01')
                  else '{}'::jsonb end
           order by ord)
  from jsonb_array_elements(s.members) with ordinality as t(m, ord)
  left join public.staff_accounts sa on sa.id::text = m->>'staff_account_id'
), updated_at = now(), updated_by = 'migration'
where s.id = 1 and jsonb_array_length(coalesce(s.members, '[]'::jsonb)) > 0;

commit;
