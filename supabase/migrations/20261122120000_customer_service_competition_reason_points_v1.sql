-- Customer service competition: «اختارت السبب» gave its 3 points to a member who had not uploaded anything yet.
-- The reason rate is now 0 until she has results; with results and no call that needs a reason it stays full.

begin;

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
               case when mb.need_reason > 0 then mb.with_reason::numeric / mb.need_reason
                    when mb.done > 0 then 1 else 0 end as reason_rate
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

commit;
