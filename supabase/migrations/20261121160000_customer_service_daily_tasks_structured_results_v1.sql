-- Customer service daily tasks: every answer in the sheet is a choice, so it can be counted and compared.
--
-- Owner request 2026-11-21: «كل كلمه هما يكتبوها تبقا زي اختيار … و يقدر يسجل و تقارن و تعمل بيانات».
-- Instead of one 10-option «النتيجة», the sheet asks four short questions, each a dropdown:
--   contact_channel  اتواصلت إزاي   call | whatsapp | both
--   reach            رد؟            answered | no_answer | busy | phone_off | wrong_number
--   outcome          النتيجة        satisfied | will_buy | ordered | wants_item | complaint | not_needed | registered
--   reason_code      السبب          no_problem | price | item_missing | other_pharmacy | delivery_late | service |
--                                   order_error | treatment_done | moved_away | personal
--   followup_choice  المتابعة الجاية auto | tomorrow | two_days | week | two_weeks | month | none
-- The old single result is still derived from them (dawaa_cs_task_result_from_v1), so the follow-up dates, the
-- doctor points and the overview keep working; old sheets that send only `result` are still accepted.
--
-- The list gains the customer's context for the sheet: last purchase (date, amount), the average invoice over 150
-- days, and the last follow-up (date, what happened, who). The overview gains the reach rate per member and the
-- counts of outcomes and reasons, by kind of call.

begin;

alter table public.customer_service_daily_queue_items
  add column if not exists contact_channel text,
  add column if not exists reach text,
  add column if not exists outcome text,
  add column if not exists reason_code text,
  add column if not exists followup_choice text;

create or replace function public.dawaa_cs_task_result_from_v1(p_reach text, p_outcome text, p_channel text)
returns text
language sql immutable
set search_path = public, pg_catalog
as $$
  select case
    when p_reach = 'wrong_number' then 'wrong_number'
    when p_reach in ('no_answer', 'busy', 'phone_off') then
      case when p_channel in ('whatsapp', 'both') then 'message_sent' else 'no_answer' end
    when p_reach = 'answered' or (p_reach is null and p_outcome is not null) then
      case p_outcome
        when 'will_buy' then 'will_buy'
        when 'ordered' then 'branch_notified'
        when 'wants_item' then 'wants_item'
        when 'complaint' then 'complaint'
        when 'not_needed' then 'not_needed'
        when 'registered' then 'registered'
        else 'done_ok'
      end
  end;
$$;
revoke all on function public.dawaa_cs_task_result_from_v1(text, text, text) from public, anon, authenticated;

-- The day's tasks with the customer's context, for the sheet and the page.
create or replace function public.dawaa_cs_daily_tasks_list_v2(p_date date default null, p_staff_account_id text default null, p_all boolean default false)
returns table (
  id uuid, queue_date date, branch text, source text, priority text, customer_code text, customer_name text,
  customer_phone text, reason text, attempt_no integer, assigned_staff_id text, assigned_name text,
  result text, result_label text, result_note text, next_followup_date date, last_contact text,
  contact_channel text, reach text, outcome text, reason_code text, followup_choice text,
  last_purchase_date date, last_purchase_amount numeric, avg_invoice numeric, invoices_150 integer,
  last_followup_date date, last_followup_by text
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
         prev.day, prev.by_name
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
  where q.queue_date = v_day and (p_all or q.assigned_staff_id = v_target)
  order by q.priority, q.branch, q.customer_name;
end;
$$;

-- The uploaded sheet. Rows with an id update a task; rows without one add a doctor's case for today.
-- A task row carries either the four choices (channel, reach, outcome, reason + followup) or, from an old sheet,
-- a single result label.
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
begin
  a := public.dawaa_cs_tasks_actor_v1(false);
  v_manage := coalesce(public.dawaa_current_actor_can(array['customer_service_daily_tasks_manage']), false);
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
                                                   'outcome', v_outcome, 'reason', v_reason, 'followup', v_follow)));
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

-- The owner's view: what each member did, what came of it, why customers cut back, and what is coming.
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
               count(*) filter (where q.reach = 'answered'
                                  or (q.reach is null and q.result in ('done_ok', 'will_buy', 'wants_item', 'branch_notified',
                                                                       'complaint', 'not_needed', 'registered'))) as reached,
               count(*) filter (where q.result = 'no_answer') as no_answer,
               count(*) filter (where q.result in ('will_buy', 'branch_notified')) as will_buy,
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
        select q.source, count(*) as tasks, count(*) filter (where q.result is not null) as done,
               count(*) filter (where q.reach = 'answered') as reached
        from public.customer_service_daily_queue_items q
        where q.queue_date between p_from and p_to group by 1 order by 1
      ) t
    ),
    'outcomes', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.n desc), '[]'::jsonb) from (
        select q.outcome, count(*) as n
        from public.customer_service_daily_queue_items q
        where q.queue_date between p_from and p_to and q.outcome is not null
        group by 1
      ) t
    ),
    'reasons', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.n desc), '[]'::jsonb) from (
        select q.reason_code, q.source, count(*) as n
        from public.customer_service_daily_queue_items q
        where q.queue_date between p_from and p_to and q.reason_code is not null
        group by 1, 2
      ) t
    ),
    'complaints', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.queue_date desc), '[]'::jsonb) from (
        select q.queue_date, q.branch, q.customer_code, q.customer_name, q.customer_phone, q.result_note, q.reason_code, sa.name as by_name
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

revoke all on function public.dawaa_cs_daily_tasks_list_v2(date, text, boolean) from public;
grant execute on function public.dawaa_cs_daily_tasks_list_v2(date, text, boolean) to anon, authenticated;
grant execute on function public.dawaa_cs_daily_tasks_submit_v1(jsonb) to anon, authenticated;
grant execute on function public.dawaa_cs_daily_tasks_overview_v1(date, date) to anon, authenticated;

commit;
