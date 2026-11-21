-- Customer service: a monthly credit per branch for customer coupons, and the team competition.
--
-- Owner request 2026-11-21: each branch's customer service has 10,000 ج of credit a cycle (26 → 25) to give customers
-- coupons, at most 200 ج a customer a cycle; the competition rewards bringing customers back (active customers) and
-- raising what contacted customers buy, measured against what would have happened anyway, and using the credit well.
--
-- Coupons: the member picks «العرض» in the sheet (50/100/150/200 ج or free delivery). The coupon is made on the POS on the
-- customer's code; the POS export has no coupon field, so a coupon counts as used when the same customer buys in the
-- same branch within its validity with «ق.الخصم» (discount_amount) of at least its value. A purchase in the window with a
-- smaller or no discount is «review» for the manager. Only used coupons are spent; active ones hold the budget.
--
-- Competition (100 points, each item = min(achieved / target, 1.2) × weight):
--   returned   25  lost/declining customers she reached who bought within 14 days, ÷ those reached (target per branch)
--   new_second 15  new customers she contacted who bought again within 30 days, ÷ those contacted (target per branch)
--   uplift     35  for each customer she reached: spend in 30 days from the contact − their usual month
--                  (150 days before ÷ 5), clamped to 0..3000 ج; summed (target 15,000 ج)
--   credit     15  0.6 × return on the coupons used (extra spend ÷ cost, target 4) + 0.4 × budget use (60–100% = full)
--   work       10  4 sheet completion (target 90%) + 3 days uploaded + 3 reasons chosen where needed
-- Entry: completion ≥ 70% and at least 15 working days. Internal codes 5, 10, 20, 54, 170, 4902, 12820 never count;
-- staff purchases count like any sale.

begin;

alter table public.customer_service_daily_task_settings
  add column if not exists credit_budget numeric not null default 10000,
  add column if not exists coupon_cap numeric not null default 200,
  add column if not exists coupon_days integer not null default 10,
  add column if not exists competition_targets jsonb not null default
    '{"returned": {"فرع الشامي": 0.20, "فرع شكري": 0.12}, "new_second": {"فرع الشامي": 0.45, "فرع شكري": 0.35}, "uplift": 15000, "roi": 4, "completion": 0.9}'::jsonb;

create table if not exists public.customer_service_coupons (
  id uuid primary key default gen_random_uuid(),
  queue_item_id uuid unique references public.customer_service_daily_queue_items(id) on delete set null,
  branch text not null,
  customer_code text not null,
  customer_name text,
  kind text not null check (kind in ('amount', 'free_delivery')),
  amount numeric not null default 0 check (amount >= 0),
  min_invoice numeric not null default 0,
  issued_by text not null,
  issued_by_name text,
  issued_on date not null,
  expires_on date not null,
  manual_status text check (manual_status in ('used', 'not_used', 'cancelled')),
  manual_by text,
  manual_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists customer_service_coupons_branch_day_idx on public.customer_service_coupons (branch, issued_on);
create index if not exists customer_service_coupons_customer_idx on public.customer_service_coupons (customer_code, branch);
alter table public.customer_service_coupons enable row level security;
revoke all on table public.customer_service_coupons from anon, authenticated;

-- The competition cycle that holds a day: 26th of a month to the 25th of the next.
create or replace function public.dawaa_cs_cycle_start_v1(p_day date)
returns date
language sql immutable
set search_path = public, pg_catalog
as $$
  select case when extract(day from p_day) >= 26
              then (date_trunc('month', p_day) + interval '25 days')::date
              else (date_trunc('month', p_day) - interval '1 month' + interval '25 days')::date end;
$$;

-- Each coupon issued in [p_from, p_to] and what became of it.
create or replace function public.dawaa_cs_coupon_states_v1(p_from date, p_to date)
returns table (id uuid, status text, cost numeric, committed numeric, used_on date, used_discount numeric, used_net numeric)
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select c.id, st.status,
         case when st.status = 'used' then c.amount else 0 end,
         case when st.status in ('used', 'active') then c.amount else 0 end,
         m.d, m.disc, m.net
  from public.customer_service_coupons c
  left join lateral (
    select (v.invoice_date at time zone 'Africa/Cairo')::date as d, coalesce(v.discount_amount, 0) as disc,
           coalesce(v.net_amount, v.total_amount, 0) as net
    from public.sales_invoices v
    where c.kind = 'amount' and v.customer_code = c.customer_code and v.branch = c.branch
      and v.invoice_date >= (c.issued_on::timestamp at time zone 'Africa/Cairo')
      and v.invoice_date < ((c.expires_on + 1)::timestamp at time zone 'Africa/Cairo')
      and coalesce(v.discount_amount, 0) >= c.amount - 1
    order by v.invoice_date limit 1
  ) m on true
  left join lateral (
    select true as bought
    from public.sales_invoices v
    where c.kind = 'amount' and m.d is null and v.customer_code = c.customer_code and v.branch = c.branch
      and v.invoice_date >= (c.issued_on::timestamp at time zone 'Africa/Cairo')
      and v.invoice_date < ((c.expires_on + 1)::timestamp at time zone 'Africa/Cairo')
    limit 1
  ) b on true
  cross join lateral (
    select case
      when c.manual_status = 'cancelled' then 'cancelled'
      when c.manual_status = 'used' then 'used'
      when c.manual_status = 'not_used' then 'expired'
      when c.kind = 'free_delivery' then 'free_delivery'
      when m.d is not null then 'used'
      when (now() at time zone 'Africa/Cairo')::date <= c.expires_on then 'active'
      when b.bought then 'review'
      else 'expired' end as status
  ) st
  where c.issued_on between p_from and p_to;
$$;
revoke all on function public.dawaa_cs_coupon_states_v1(date, date) from public, anon, authenticated;
revoke all on function public.dawaa_cs_cycle_start_v1(date) from public, anon, authenticated;

-- The day's tasks as in list_v2, plus the coupon offered in the sheet («العرض»).
create or replace function public.dawaa_cs_daily_tasks_list_v3(p_date date default null, p_staff_account_id text default null, p_all boolean default false)
returns table (
  id uuid, queue_date date, branch text, source text, priority text, customer_code text, customer_name text,
  customer_phone text, reason text, attempt_no integer, assigned_staff_id text, assigned_name text,
  result text, result_label text, result_note text, next_followup_date date, last_contact text,
  contact_channel text, reach text, outcome text, reason_code text, followup_choice text,
  last_purchase_date date, last_purchase_amount numeric, avg_invoice numeric, invoices_150 integer,
  last_followup_date date, last_followup_by text, offer text
)
language plpgsql stable security definer
set search_path = public, auth, pg_catalog
as $$
declare
  a public.staff_accounts;
  v_day date := coalesce(p_date, (now() at time zone 'Africa/Cairo')::date);
  v_target text;
  v_manage boolean;
  v_from timestamptz := ((coalesce(p_date, (now() at time zone 'Africa/Cairo')::date) - 150)::timestamp at time zone 'Africa/Cairo');
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
         prev.label,
         q.contact_channel, q.reach, q.outcome, q.reason_code, q.followup_choice,
         buy.last_day, buy.last_amount, buy.avg_amount, buy.n::integer,
         prev.day, prev.by_name,
         case when cp.kind = 'free_delivery' then 'free_delivery' when cp.kind = 'amount' then 'c' || round(cp.amount)::text end
  from public.customer_service_daily_queue_items q
  left join public.staff_accounts sa on sa.id::text = q.assigned_staff_id
  left join lateral (
    select p.queue_date as day,
           coalesce(public.dawaa_cs_task_result_label_v1(p.result), '') || coalesce(': ' || nullif(p.result_note, ''), '') as label,
           ps.name as by_name
    from public.customer_service_daily_queue_items p
    left join public.staff_accounts ps on ps.id::text = p.assigned_staff_id
    where p.branch = q.branch and p.customer_key = q.customer_key and p.queue_date < q.queue_date and p.result is not null
    order by p.queue_date desc limit 1
  ) prev on true
  left join lateral (
    select max((v.invoice_date at time zone 'Africa/Cairo')::date) as last_day,
           (array_agg(coalesce(v.net_amount, v.total_amount, 0) order by v.invoice_date desc))[1] as last_amount,
           round(avg(coalesce(v.net_amount, v.total_amount, 0))) as avg_amount,
           count(*) as n
    from public.sales_invoices v
    where q.customer_code is not null and v.customer_code = q.customer_code and v.branch = q.branch
      and v.invoice_date >= v_from
  ) buy on true
  left join public.customer_service_coupons cp on cp.queue_item_id = q.id and coalesce(cp.manual_status, '') <> 'cancelled'
  where q.queue_date = v_day and (p_all or q.assigned_staff_id = v_target)
  order by q.priority, q.branch, q.customer_name;
end;
$$;


-- The uploaded sheet, as before, plus «العرض»: a coupon for the customer when the budget and the cap allow it.
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
  v_channel text;
  v_reach text;
  v_outcome text;
  v_reason text;
  v_follow text;
  v_offer text;
  v_coupon public.customer_service_coupons;
  v_amount numeric;
  v_cfrom date;
  v_cto date;
  v_cust numeric;
  v_committed numeric;
  v_coupons integer := 0;
  v_budget numeric;
  v_cap numeric;
  v_days integer;
begin
  a := public.dawaa_cs_tasks_actor_v1(false);
  v_manage := coalesce(public.dawaa_current_actor_can(array['customer_service_daily_tasks_manage']), false);
  select credit_budget, coupon_cap, coupon_days into v_budget, v_cap, v_days from public.customer_service_daily_task_settings where id = 1;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 400 then
    raise exception 'الشيت فيه صفوف أكتر من المسموح';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_channel := case when r->>'channel' in ('call', 'whatsapp', 'both') then r->>'channel' end;
    v_reach := case when r->>'reach' in ('answered', 'no_answer', 'busy', 'phone_off', 'wrong_number') then r->>'reach' end;
    v_outcome := case when r->>'outcome' in ('satisfied', 'will_buy', 'ordered', 'wants_item', 'complaint', 'not_needed', 'registered')
                      then r->>'outcome' end;
    v_reason := case when r->>'reason_code' in ('no_problem', 'price', 'item_missing', 'other_pharmacy', 'delivery_late', 'service',
                                                'order_error', 'treatment_done', 'moved_away', 'personal')
                     then r->>'reason_code' end;
    v_follow := case when r->>'followup' in ('auto', 'tomorrow', 'two_days', 'week', 'two_weeks', 'month', 'none')
                     then r->>'followup' end;
    if v_reach is not null and v_reach <> 'answered' then v_outcome := null; end if;
    v_result := coalesce(
      public.dawaa_cs_task_result_from_v1(v_reach, v_outcome, v_channel),
      public.dawaa_cs_task_result_code_v1(r->>'result'),
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
             contact_channel = v_channel,
             reach = coalesce(v_reach, case when v_outcome is not null then 'answered' end),
             outcome = v_outcome,
             reason_code = v_reason,
             followup_choice = v_follow,
             next_followup_date = case
               when v_next is not null then v_next
               when v_follow = 'none' then null
               when v_follow = 'tomorrow' then q.queue_date + 1
               when v_follow = 'two_days' then q.queue_date + 2
               when v_follow = 'week' then q.queue_date + 7
               when v_follow = 'two_weeks' then q.queue_date + 14
               when v_follow = 'month' then q.queue_date + 30
               else public.dawaa_cs_task_next_date_v1(q.source, v_result, q.attempt_no, q.queue_date)
             end,
             status = case when v_result in ('no_answer', 'message_sent') and coalesce(v_reach, '') <> 'answered' then 'attempted' else 'completed' end,
             started_at = coalesce(started_at, now()),
             completed_at = now(),
             last_action_at = now(),
             assigned_staff_id = coalesce(assigned_staff_id, a.id::text)
       where id = q.id;
      insert into public.customer_service_followup_events (queue_item_id, event_type, event_status, actor_staff_id, actor_name, notes, metadata)
      values (q.id, 'daily_task_result', v_result, a.id::text, coalesce(a.name, a.username),
              nullif(btrim(coalesce(r->>'note', '')), ''),
              jsonb_strip_nulls(jsonb_build_object('source', q.source, 'via', 'sheet', 'channel', v_channel, 'reach', v_reach,
                                                   'outcome', v_outcome, 'reason', v_reason, 'followup', v_follow, 'offer', r->>'offer')));
      -- «العرض»: a coupon for this customer, within the customer's cap and the branch's credit for the cycle.
      v_offer := case when r->>'offer' in ('none', 'c50', 'c100', 'c150', 'c200', 'free_delivery') then r->>'offer' end;
      if v_offer is not null then
        select * into v_coupon from public.customer_service_coupons c where c.queue_item_id = q.id;
        if v_offer = 'none' then
          if found and v_coupon.manual_status is null and v_coupon.issued_on >= v_today - 1 then
            update public.customer_service_coupons
               set manual_status = 'cancelled', manual_by = a.id::text, manual_at = now()
             where id = v_coupon.id;
          end if;
        elsif not found then
          v_amount := case v_offer when 'c50' then 50 when 'c100' then 100 when 'c150' then 150 when 'c200' then 200 else 0 end;
          v_cfrom := public.dawaa_cs_cycle_start_v1(v_today);
          v_cto := (v_cfrom + interval '1 month' - interval '1 day')::date;
          select coalesce(sum(c.amount), 0) into v_cust
          from public.customer_service_coupons c
          where c.branch = q.branch and c.customer_code = q.customer_code and c.issued_on between v_cfrom and v_cto
            and coalesce(c.manual_status, '') <> 'cancelled';
          select coalesce(sum(st.committed), 0) into v_committed
          from public.dawaa_cs_coupon_states_v1(v_cfrom, v_cto) st
          join public.customer_service_coupons c on c.id = st.id
          where c.branch = q.branch;
          if q.customer_code is null or q.customer_code = any (array['5', '10', '20', '54', '170', '4902', '12820']) then
            v_skipped := v_skipped || jsonb_build_object('id', q.id, 'why', 'الكوبون اترفض: العميل مالوش كود عميل');
          elsif v_cust + v_amount > v_cap then
            v_skipped := v_skipped || jsonb_build_object('id', q.id,
              'why', format('الكوبون اترفض: %s خد %s ج كوبونات الدورة دي والحد %s ج', q.customer_name, round(v_cust), round(v_cap)));
          elsif v_committed + v_amount > v_budget then
            v_skipped := v_skipped || jsonb_build_object('id', q.id,
              'why', format('الكوبون اترفض: كريديت %s فاضل منه %s ج', q.branch, round(greatest(v_budget - v_committed, 0))));
          else
            insert into public.customer_service_coupons
              (queue_item_id, branch, customer_code, customer_name, kind, amount, min_invoice, issued_by, issued_by_name,
               issued_on, expires_on)
            values (q.id, q.branch, q.customer_code, q.customer_name,
                    case when v_offer = 'free_delivery' then 'free_delivery' else 'amount' end, v_amount, v_amount * 6,
                    a.id::text, coalesce(a.name, a.username), v_today, v_today + greatest(v_days, 1) - 1);
            v_coupons := v_coupons + 1;
          end if;
        end if;
      end if;
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

  return jsonb_build_object('updated', v_updated, 'added', v_added, 'coupons', v_coupons, 'skipped', v_skipped);
end;
$$;


-- The competition for one cycle: each member's points, the branches' credit and (for the manager) the coupons.
create or replace function public.dawaa_cs_competition_v1(p_cycle_start date default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public, auth, pg_catalog
as $$
declare
  a public.staff_accounts;
  s public.customer_service_daily_task_settings;
  v_manage boolean;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_from date := public.dawaa_cs_cycle_start_v1(coalesce(p_cycle_start, (now() at time zone 'Africa/Cairo')::date));
  v_to date;
  v_upto date;
  t jsonb;
  v_internal text[] := array['5', '10', '20', '54', '170', '4902', '12820'];
  v_members jsonb;
  v_branches jsonb;
  v_coupons jsonb;
  v_team jsonb;
begin
  a := public.dawaa_cs_tasks_actor_v1(false);
  v_manage := coalesce(public.dawaa_current_actor_can(array['customer_service_daily_tasks_manage']), false);
  select * into s from public.customer_service_daily_task_settings where id = 1;
  t := s.competition_targets;
  v_to := (v_from + interval '1 month' - interval '1 day')::date;
  v_upto := least(v_to, v_today);

  drop table if exists cs_q, cs_c, cs_m, cs_k;

  create temp table cs_q on commit drop as
  select q.id, q.queue_date, q.branch, q.source, q.customer_code, q.assigned_staff_id as member, q.result, q.reach,
         q.outcome, q.reason_code,
         coalesce(q.reach = 'answered' or (q.reach is null and q.result in
           ('done_ok', 'will_buy', 'wants_item', 'branch_notified', 'complaint', 'not_needed', 'registered')), false) as answered
  from public.customer_service_daily_queue_items q
  where q.queue_date between v_from and v_upto and q.assigned_staff_id is not null and q.status <> 'archived'
    and q.source <> 'doctor_case';

  -- One customer belongs to the member who reached them last in the cycle.
  create temp table cs_c on commit drop as
  select distinct on (x.branch, x.customer_code) x.member, x.branch, x.customer_code, x.source, x.d, x.answered
  from (
    select member, branch, customer_code, source, queue_date as d, answered
    from cs_q where customer_code is not null and not (customer_code = any (v_internal)) and result is not null
  ) x
  order by x.branch, x.customer_code, x.answered desc, x.d desc;

  create temp table cs_m on commit drop as
  select c.*,
         exists (select 1 from public.sales_invoices v where v.customer_code = c.customer_code and v.branch = c.branch
                 and v.invoice_date >= (c.d::timestamp at time zone 'Africa/Cairo')
                 and v.invoice_date < ((c.d + 14)::timestamp at time zone 'Africa/Cairo')) as bought14,
         exists (select 1 from public.sales_invoices v where v.customer_code = c.customer_code and v.branch = c.branch
                 and v.invoice_date >= (c.d::timestamp at time zone 'Africa/Cairo')
                 and v.invoice_date < ((c.d + 30)::timestamp at time zone 'Africa/Cairo')) as bought30,
         (select coalesce(sum(coalesce(v.net_amount, v.total_amount, 0)), 0) from public.sales_invoices v
           where v.customer_code = c.customer_code and v.branch = c.branch
             and v.invoice_date >= (c.d::timestamp at time zone 'Africa/Cairo')
             and v.invoice_date < ((c.d + 30)::timestamp at time zone 'Africa/Cairo')) as after30,
         (select coalesce(sum(coalesce(v.net_amount, v.total_amount, 0)), 0) / 5.0 from public.sales_invoices v
           where v.customer_code = c.customer_code and v.branch = c.branch
             and v.invoice_date >= ((c.d - 150)::timestamp at time zone 'Africa/Cairo')
             and v.invoice_date < (c.d::timestamp at time zone 'Africa/Cairo')) as usual,
         c.d + 29 > v_today as pending
  from cs_c c;

  create temp table cs_k on commit drop as
  select c.id, c.issued_by as member, c.branch, c.customer_code, c.customer_name, c.kind, c.amount, c.issued_on,
         c.expires_on, c.issued_by_name, st.status, st.cost, st.committed, st.used_on, st.used_discount, st.used_net,
         case when st.status = 'used' then least(greatest(coalesce(m.after30 - m.usual, 0), 0), 3000) else 0 end as extra
  from public.dawaa_cs_coupon_states_v1(v_from, v_to) st
  join public.customer_service_coupons c on c.id = st.id
  left join cs_m m on m.branch = c.branch and m.customer_code = c.customer_code;

  select coalesce(jsonb_agg(row_to_json(b)::jsonb order by b.branch), '[]'::jsonb) into v_branches from (
    select br.branch, s.credit_budget as budget, s.coupon_cap as cap, s.coupon_days as days,
           coalesce(sum(k.cost), 0) as used, coalesce(sum(k.committed) - sum(k.cost), 0) as active,
           greatest(s.credit_budget - coalesce(sum(k.committed), 0), 0) as remaining,
           count(k.id) filter (where k.status <> 'cancelled') as issued,
           count(k.id) filter (where k.status = 'used') as used_n,
           count(k.id) filter (where k.status = 'review') as review_n,
           coalesce(sum(k.extra), 0) as extra
    from (values ('فرع الشامي'), ('فرع شكري')) br(branch)
    left join cs_k k on k.branch = br.branch
    group by br.branch
  ) b;

  select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.score desc), '[]'::jsonb) into v_members from (
    select x.*,
           round(x.p_returned + x.p_new + x.p_uplift + x.p_credit + x.p_work, 1) as score,
           (x.completion >= 0.7 and x.work_days >= 15) as eligible
    from (
      select w.*,
             round(least(case when w.reached_back > 0 and w.t_returned > 0
                        then (w.returned::numeric / w.reached_back) / w.t_returned else 0 end, 1.2) * 25, 1) as p_returned,
             round(least(case when w.new_n > 0 and w.t_new > 0
                        then (w.new_back::numeric / w.new_n) / w.t_new else 0 end, 1.2) * 15, 1) as p_new,
             round(coalesce(least(w.uplift / nullif((t->>'uplift')::numeric, 0), 1.2), 0) * 35, 1) as p_uplift,
             round(15 * (0.6 * coalesce(least(case when w.coupon_cost > 0
                                   then (w.coupon_extra / w.coupon_cost) / nullif((t->>'roi')::numeric, 0) else 0 end, 1.2), 0)
                   + 0.4 * case when w.budget_use >= 0.6 then 1 else w.budget_use / 0.6 end), 1) as p_credit,
             round(4 * coalesce(least(w.completion / nullif((t->>'completion')::numeric, 0), 1.2), 0)
               + 3 * w.upload_rate + 3 * w.reason_rate, 1) as p_work
      from (
        select mb.member as staff_account_id, sa.name, mb.branch,
               coalesce((t->'returned'->>mb.branch)::numeric, 0.15) as t_returned,
               coalesce((t->'new_second'->>mb.branch)::numeric, 0.4) as t_new,
               (select count(*) from cs_m m where m.member = mb.member and m.source in ('lost', 'declining') and m.answered) as reached_back,
               (select count(*) from cs_m m where m.member = mb.member and m.source in ('lost', 'declining') and m.answered and m.bought14) as returned,
               (select count(*) from cs_m m where m.member = mb.member and m.source = 'new_customer') as new_n,
               (select count(*) from cs_m m where m.member = mb.member and m.source = 'new_customer' and m.bought30) as new_back,
               (select coalesce(round(sum(least(greatest(m.after30 - m.usual, 0), 3000))), 0) from cs_m m where m.member = mb.member and m.answered) as uplift,
               (select count(*) from cs_m m where m.member = mb.member and m.answered and m.pending) as uplift_pending,
               (select count(*) from cs_m m where m.member = mb.member and m.answered and m.after30 > m.usual) as spent_more,
               (select coalesce(sum(k.cost), 0) from cs_k k where k.member = mb.member) as coupon_cost,
               (select coalesce(sum(k.extra), 0) from cs_k k where k.member = mb.member) as coupon_extra,
               (select count(*) from cs_k k where k.member = mb.member and k.status <> 'cancelled') as coupons_issued,
               (select count(*) from cs_k k where k.member = mb.member and k.status = 'used') as coupons_used,
               least(coalesce((select sum(case when v_to <= v_today then k.cost else k.committed end) from cs_k k where k.member = mb.member), 0)
                     / nullif(s.credit_budget, 0), 1) as budget_use,
               mb.tasks, mb.done, mb.answered_n,
               coalesce(mb.done::numeric / nullif(mb.tasks, 0), 0) as completion,
               mb.work_days,
               coalesce(mb.upload_days::numeric / nullif(mb.work_days, 0), 0) as upload_rate,
               coalesce(mb.with_reason::numeric / nullif(mb.need_reason, 0), 1) as reason_rate
        from (
          select q.member,
                 mode() within group (order by q.branch) as branch,
                 count(*) as tasks,
                 count(*) filter (where q.result is not null) as done,
                 count(*) filter (where q.answered) as answered_n,
                 count(distinct q.queue_date) as work_days,
                 count(distinct q.queue_date) filter (where q.result is not null) as upload_days,
                 count(*) filter (where q.answered and (q.source in ('lost', 'declining') or q.outcome in ('complaint', 'not_needed'))) as need_reason,
                 count(*) filter (where q.answered and (q.source in ('lost', 'declining') or q.outcome in ('complaint', 'not_needed'))
                                    and q.reason_code is not null) as with_reason
          from cs_q q group by q.member
        ) mb
        left join public.staff_accounts sa on sa.id::text = mb.member
      ) w
    ) x
  ) r;

  -- The team goal: customers active in the last 30 days, now against the cycle start.
  select coalesce(jsonb_agg(jsonb_build_object('branch', br.branch, 'now', n.now_n, 'start', n.start_n) order by br.branch), '[]'::jsonb)
    into v_team
  from (values ('فرع الشامي'), ('فرع شكري')) br(branch)
  cross join lateral (
    select count(distinct v.customer_code) filter (where v.invoice_date >= ((v_upto - 29)::timestamp at time zone 'Africa/Cairo')) as now_n,
           count(distinct v.customer_code) filter (where v.invoice_date < (v_from::timestamp at time zone 'Africa/Cairo')) as start_n
    from public.sales_invoices v
    where v.branch = br.branch
      and v.invoice_date >= ((least(v_from, v_upto - 29) - 30)::timestamp at time zone 'Africa/Cairo')
      and v.invoice_date < ((v_upto + 1)::timestamp at time zone 'Africa/Cairo')
      and (v.invoice_date >= ((v_upto - 29)::timestamp at time zone 'Africa/Cairo')
           or (v.invoice_date < (v_from::timestamp at time zone 'Africa/Cairo')
               and v.invoice_date >= ((v_from - 30)::timestamp at time zone 'Africa/Cairo')))
      and nullif(v.customer_code, '') is not null and not (v.customer_code = any (v_internal))
  ) n;

  if v_manage then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', k.id, 'branch', k.branch, 'customer_code', k.customer_code, 'customer_name', k.customer_name,
             'kind', k.kind, 'amount', k.amount, 'issued_on', k.issued_on, 'expires_on', k.expires_on,
             'issued_by_name', k.issued_by_name, 'status', k.status, 'used_on', k.used_on,
             'used_discount', k.used_discount, 'used_net', k.used_net, 'extra', k.extra)
           order by (k.status = 'review') desc, k.issued_on desc), '[]'::jsonb)
      into v_coupons from cs_k k;
  end if;

  return jsonb_build_object(
    'cycle_start', v_from, 'cycle_end', v_to, 'as_of', v_upto, 'can_manage', v_manage, 'targets', t,
    'members', v_members, 'branches', v_branches, 'team', v_team, 'coupons', v_coupons);
end;
$$;

-- The manager settles a coupon by hand (e.g. «review»): used, not used, cancelled, or null to go back to automatic.
create or replace function public.dawaa_cs_coupon_mark_v1(p_id uuid, p_status text)
returns void
language plpgsql security definer
set search_path = public, auth, pg_catalog
as $$
declare
  a public.staff_accounts;
begin
  a := public.dawaa_cs_tasks_actor_v1(true);
  if p_status is not null and p_status not in ('used', 'not_used', 'cancelled') then raise exception 'حالة الكوبون غير صحيحة'; end if;
  update public.customer_service_coupons
     set manual_status = p_status, manual_by = a.id::text, manual_at = now()
   where id = p_id;
  if not found then raise exception 'الكوبون مش موجود'; end if;
end;
$$;

create or replace function public.dawaa_cs_credit_settings_save_v1(p_budget numeric, p_cap numeric, p_days integer)
returns void
language plpgsql security definer
set search_path = public, auth, pg_catalog
as $$
declare
  a public.staff_accounts;
begin
  a := public.dawaa_cs_tasks_actor_v1(true);
  if p_budget is null or p_budget < 0 or p_budget > 1000000 or p_cap is null or p_cap < 0 or p_cap > 5000
     or p_days is null or p_days < 1 or p_days > 60 then
    raise exception 'إعدادات الكريديت غير صحيحة';
  end if;
  update public.customer_service_daily_task_settings
     set credit_budget = p_budget, coupon_cap = p_cap, coupon_days = p_days, updated_at = now(), updated_by = a.id::text
   where id = 1;
end;
$$;

revoke all on function public.dawaa_cs_daily_tasks_list_v3(date, text, boolean) from public;
revoke all on function public.dawaa_cs_competition_v1(date) from public;
revoke all on function public.dawaa_cs_coupon_mark_v1(uuid, text) from public;
revoke all on function public.dawaa_cs_credit_settings_save_v1(numeric, numeric, integer) from public;
grant execute on function public.dawaa_cs_daily_tasks_list_v3(date, text, boolean) to anon, authenticated;
grant execute on function public.dawaa_cs_daily_tasks_submit_v1(jsonb) to anon, authenticated;
grant execute on function public.dawaa_cs_competition_v1(date) to anon, authenticated;
grant execute on function public.dawaa_cs_coupon_mark_v1(uuid, text) to anon, authenticated;
grant execute on function public.dawaa_cs_credit_settings_save_v1(numeric, numeric, integer) to anon, authenticated;

commit;
