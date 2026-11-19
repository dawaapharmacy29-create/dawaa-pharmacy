-- «المراجعات الأسبوعية العشوائية» (owner 2026-11-19): besides the random draw, the owner sometimes watches
-- a sale or a chat on their own and wants to rate it directly, or wants to drop a random sample (wrong
-- customer, an internal sale the filters missed, a chat that isn't a sale…) and get another one.
--
-- * add_evaluation_review_sample_v1: the owner picks a specific invoice (cash, still on the cameras: the
--   last 4 Cairo days including today) or a specific delivery order whose chat the capture folder brought in.
-- * exclude_evaluation_review_sample_v1: drops a sample that has no review yet; optionally the app picks
--   another invoice of the same doctor in the same window (same size first), or the owner picks one with add.
-- * search_evaluation_review_candidates_v1: finds the invoices to pick from (number, customer, phone, code, doctor).
-- Excluded samples stay in the table (who, when, why) but are hidden and count for nobody.

alter table public.evaluation_review_samples_v1
  add column if not exists origin text not null default 'random',
  add column if not exists excluded_at timestamptz,
  add column if not exists excluded_by text,
  add column if not exists excluded_note text;
alter table public.evaluation_review_samples_v1 drop constraint if exists evaluation_review_samples_v1_origin_check;
alter table public.evaluation_review_samples_v1
  add constraint evaluation_review_samples_v1_origin_check check (origin in ('random', 'manual', 'replacement'));

-- The invoices a sample can come from, same filters as generate_evaluation_review_batch_v1 (pool sellers,
-- cash for invoices / home delivery for conversations, no internal codes), with the batch's size strata.
create or replace function public.dawaa_review_candidates_v1(p_kind text, p_from date, p_to date)
returns table (
  invoice_id text, staff_id uuid, staff_name text, branch text, invoice_number text, invoice_at timestamptz, net numeric, items integer,
  customer_code text, customer_name text, customer_phone text, stratum text, has_chat boolean, sampled boolean
)
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
  with base as (
    select si.id::text as invoice_id, si.staff_id::uuid as staff_id, si.branch, coalesce(si.invoice_number, si.invoice_no) as invoice_number,
           si.invoice_datetime as invoice_at, coalesce(si.net_amount, si.total_amount)::numeric as net, si.line_items_count as items,
           nullif(btrim(si.customer_code), '') as customer_code, si.customer_name,
           nullif(right(regexp_replace(coalesce(nullif(si.whatsapp_phone, ''), si.customer_phone, ''), '\D', '', 'g'), 10), '') as customer_phone
    from public.sales_invoices si
    join public.dawaa_review_sample_pool_v1() p on p.staff_id::text = si.staff_id
    where si.invoice_datetime >= (p_from::timestamp at time zone 'Africa/Cairo')
      and si.invoice_datetime < ((p_to + 1)::timestamp at time zone 'Africa/Cairo')
      and si.invoice_type = case when p_kind = 'invoice' then 'كاش' else 'توصيل منزلى' end
      and coalesce(si.invoice_category, '') not like 'internal%'
      and coalesce(si.customer_type, '') <> 'internal_account'
      and coalesce(btrim(si.customer_code), '') not in ('5', '10', '20', '54', '170', '4902', '12820')
      and coalesce(si.net_amount, si.total_amount, 0) > 0
  ), cuts as (
    select branch, percentile_cont(0.4) within group (order by net) as p40, percentile_cont(0.8) within group (order by net) as p80
    from base group by branch
  )
  select b.invoice_id, b.staff_id, st.name, b.branch, b.invoice_number, b.invoice_at, b.net, b.items, b.customer_code, b.customer_name, b.customer_phone,
         case when coalesce(b.items, 0) >= 4 or b.net >= c.p80 then 'big'
              when coalesce(b.items, 1) <= 2 and b.net <= c.p40 then 'small'
              else 'medium' end,
         case when p_kind = 'conversation' then exists (
           select 1 from public.whatsapp_review_sources w
           where w.deleted_at is null
             and ((b.customer_phone is not null and right(regexp_replace(coalesce(w.customer_phone, ''), '\D', '', 'g'), 10) = b.customer_phone)
               or (b.customer_code is not null and btrim(coalesce(w.customer_code, '')) = b.customer_code))
             and coalesce(w.conversation_ended_at, w.conversation_started_at, w.created_at) between b.invoice_at - interval '3 days' and b.invoice_at + interval '3 days')
         end,
         exists (select 1 from public.evaluation_review_samples_v1 x where x.kind = p_kind and x.invoice_id = b.invoice_id)
  from base b
  join cuts c on c.branch is not distinct from b.branch
  left join public.staff st on st.id = b.staff_id;
$function$;

-- How far back the owner can pick: invoices while the cameras keep them, chats about three weeks.
create or replace function public.dawaa_review_pick_from_v1(p_kind text)
returns date
language sql
stable
set search_path = 'public', 'pg_catalog'
as $function$
  select case when p_kind = 'invoice' then (now() at time zone 'Africa/Cairo')::date - 4
              else least(public.dawaa_review_cycle_start_v1((now() at time zone 'Africa/Cairo')::date), (now() at time zone 'Africa/Cairo')::date - 21) end;
$function$;

create or replace function public.dawaa_add_review_sample_v1(p_kind text, p_invoice_id text, p_origin text, p_batch_start date)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_pick record;
  v_day date;
  v_id uuid;
begin
  select c.* into v_pick
  from public.dawaa_review_candidates_v1(p_kind, public.dawaa_review_pick_from_v1(p_kind), v_today) c
  where c.invoice_id = p_invoice_id;
  if not found then
    raise exception 'review_invoice_not_available' using errcode = 'P0002';
  end if;
  if v_pick.sampled then
    raise exception 'review_invoice_already_sampled' using errcode = '23505';
  end if;
  if p_kind = 'conversation' and not coalesce(v_pick.has_chat, false) then
    raise exception 'review_chat_not_captured' using errcode = 'P0002';
  end if;
  v_day := (v_pick.invoice_at at time zone 'Africa/Cairo')::date;
  insert into public.evaluation_review_samples_v1 (kind, batch_start, cycle_start, staff_id, branch, invoice_id, invoice_number,
    invoice_at, net, items, stratum, customer_code, customer_name, customer_phone, deadline, origin)
  values (p_kind, coalesce(p_batch_start, v_day), public.dawaa_review_cycle_start_v1(v_day), v_pick.staff_id, v_pick.branch, v_pick.invoice_id,
    v_pick.invoice_number, v_pick.invoice_at, v_pick.net, v_pick.items, v_pick.stratum, v_pick.customer_code, v_pick.customer_name,
    v_pick.customer_phone, case when p_kind = 'invoice' then v_day + 4 else v_today + 7 end, p_origin)
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.search_evaluation_review_candidates_v1(p_kind text, p_query text)
returns table (
  invoice_id text, staff_id uuid, staff_name text, branch text, invoice_number text, invoice_at timestamptz, net numeric, items integer,
  customer_name text, customer_phone text, stratum text, has_chat boolean, sampled boolean
)
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not coalesce(public.dawaa_current_actor_can(array['manage_evaluation_rules']), false) then
    raise exception 'review_samples_not_authorized' using errcode = '42501';
  end if;
  if p_kind not in ('invoice', 'conversation') then
    raise exception 'review_samples_invalid_batch' using errcode = '22023';
  end if;
  return query
  select c.invoice_id, c.staff_id, c.staff_name, c.branch, c.invoice_number, c.invoice_at, c.net, c.items, c.customer_name, c.customer_phone,
         c.stratum, c.has_chat, c.sampled
  from public.dawaa_review_candidates_v1(p_kind, public.dawaa_review_pick_from_v1(p_kind), (now() at time zone 'Africa/Cairo')::date) c
  where v_q is null
     or c.invoice_number ilike '%' || v_q || '%'
     or c.customer_name ilike '%' || v_q || '%'
     or c.staff_name ilike '%' || v_q || '%'
     or c.customer_code = v_q
     or (length(regexp_replace(v_q, '\D', '', 'g')) >= 4 and c.customer_phone like '%' || regexp_replace(v_q, '\D', '', 'g') || '%')
  order by c.invoice_at desc
  limit 40;
end;
$function$;

create or replace function public.add_evaluation_review_sample_v1(p_kind text, p_invoice_id text)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
begin
  if not coalesce(public.dawaa_current_actor_can(array['manage_evaluation_rules']), false) then
    raise exception 'review_samples_not_authorized' using errcode = '42501';
  end if;
  if p_kind not in ('invoice', 'conversation') then
    raise exception 'review_samples_invalid_batch' using errcode = '22023';
  end if;
  return public.dawaa_add_review_sample_v1(p_kind, p_invoice_id, 'manual', null);
end;
$function$;

-- Returns the replacement sample's id, or null (no replacement asked, or nothing left for that doctor).
create or replace function public.exclude_evaluation_review_sample_v1(p_sample_id uuid, p_auto_replace boolean default true, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_sample public.evaluation_review_samples_v1%rowtype;
  v_from date;
  v_to date;
  v_pick text;
begin
  if not coalesce(public.dawaa_current_actor_can(array['manage_evaluation_rules']), false) then
    raise exception 'review_samples_not_authorized' using errcode = '42501';
  end if;
  select * into v_sample from public.evaluation_review_samples_v1 where id = p_sample_id and excluded_at is null for update;
  if not found then
    raise exception 'review_sample_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.evaluation_invoice_reviews_v1 r where r.sample_id = p_sample_id)
     or (v_sample.kind = 'conversation' and exists (
       select 1 from public.conversation_sales_reviews_official_v1 v
       where v.whatsapp_review_source_id = public.dawaa_review_sample_source_v1(p_sample_id))) then
    raise exception 'review_sample_already_reviewed' using errcode = '22023';
  end if;
  update public.evaluation_review_samples_v1
  set excluded_at = now(), excluded_by = public.dawaa_current_staff_account_id_strict()::text, excluded_note = left(p_note, 500)
  where id = p_sample_id;
  if not coalesce(p_auto_replace, true) then
    return null;
  end if;

  -- Same window as the sample's batch (a picked sample: its own day), still on the cameras for invoices.
  select b.batch_start, b.batch_end into v_from, v_to
  from public.evaluation_review_batches_v1 b where b.kind = v_sample.kind and b.batch_start = v_sample.batch_start;
  if not found or v_sample.origin <> 'random' then
    v_from := (v_sample.invoice_at at time zone 'Africa/Cairo')::date;
    v_to := v_from;
  end if;
  v_from := greatest(v_from, public.dawaa_review_pick_from_v1(v_sample.kind));
  v_to := least(v_to, v_today);
  if v_from > v_to then
    return null;
  end if;
  select c.invoice_id into v_pick
  from public.dawaa_review_candidates_v1(v_sample.kind, v_from, v_to) c
  where c.staff_id = v_sample.staff_id and not c.sampled and (v_sample.kind = 'invoice' or coalesce(c.has_chat, false))
  order by (c.stratum = v_sample.stratum) desc, md5(c.invoice_id || '|' || p_sample_id::text)
  limit 1;
  if v_pick is null then
    return null;
  end if;
  return public.dawaa_add_review_sample_v1(v_sample.kind, v_pick, 'replacement', v_sample.batch_start);
end;
$function$;

-- Listing: hide excluded samples and say where each one came from.
drop function if exists public.list_evaluation_review_samples_v1(date);
create function public.list_evaluation_review_samples_v1(p_cycle_start date)
returns table (
  id uuid, kind text, batch_start date, staff_id uuid, staff_name text, branch text, invoice_id text, invoice_number text,
  invoice_at timestamptz, net numeric, items integer, stratum text, customer_code text, customer_name text, customer_phone text,
  deadline date, status text, score numeric, criteria jsonb, notes text, reviewed_at timestamptz, source_id uuid, official_review_id uuid,
  origin text
)
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
begin
  if not coalesce(public.dawaa_current_actor_can(array['manage_evaluation_rules']), false) then
    raise exception 'review_samples_not_authorized' using errcode = '42501';
  end if;
  return query
  with src as (
    select s.id as sample_id, public.dawaa_review_sample_source_v1(s.id) as source_id
    from public.evaluation_review_samples_v1 s
    where s.cycle_start = p_cycle_start and s.kind = 'conversation' and s.excluded_at is null
  )
  select s.id, s.kind, s.batch_start, s.staff_id, st.name, s.branch, s.invoice_id, s.invoice_number, s.invoice_at, s.net, s.items,
    s.stratum, s.customer_code, s.customer_name, s.customer_phone, s.deadline,
    case
      when s.kind = 'invoice' and r.sample_id is not null then case when r.skipped then 'skipped' else 'reviewed' end
      when s.kind = 'invoice' and (now() at time zone 'Africa/Cairo')::date > s.deadline then 'expired'
      when s.kind = 'invoice' then 'pending'
      when o.id is not null then 'reviewed'
      when src.source_id is not null then 'to_review'
      else 'not_captured' end,
    case when s.kind = 'invoice' then case when r.skipped then null else r.score end else o.final_score end,
    r.criteria, r.notes, coalesce(r.reviewed_at, o.reviewed_at), src.source_id, o.id, s.origin
  from public.evaluation_review_samples_v1 s
  left join public.staff st on st.id = s.staff_id
  left join public.evaluation_invoice_reviews_v1 r on r.sample_id = s.id
  left join src on src.sample_id = s.id
  left join lateral (
    select v.id, v.final_score, v.reviewed_at from public.conversation_sales_reviews_official_v1 v
    where src.source_id is not null and v.whatsapp_review_source_id = src.source_id
    order by v.reviewed_at desc nulls last limit 1
  ) o on true
  where s.cycle_start = p_cycle_start and s.excluded_at is null
  order by s.batch_start desc, st.name, s.invoice_at;
end;
$function$;

-- Scores: excluded samples count for nobody.
create or replace function public.get_evaluation_review_scores_v1(p_cycle_start date)
returns table (staff_id uuid, invoice_reviews integer, invoice_avg numeric, conversation_reviews integer, conversation_missing integer, conversation_avg numeric)
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.dawaa_current_actor_can(array['manage_evaluation_rules']), false) then
    raise exception 'review_samples_not_authorized' using errcode = '42501';
  end if;
  return query
  with conv as (
    select s.staff_id, o.final_score, false as missing
    from public.evaluation_review_samples_v1 s
    left join lateral (
      select v.id, v.final_score from public.conversation_sales_reviews_official_v1 v
      where v.whatsapp_review_source_id = public.dawaa_review_sample_source_v1(s.id)
      order by v.reviewed_at desc nulls last limit 1
    ) o on true
    where s.cycle_start = p_cycle_start and s.kind = 'conversation' and s.excluded_at is null
  ), inv as (
    select s.staff_id, r.score
    from public.evaluation_review_samples_v1 s
    join public.evaluation_invoice_reviews_v1 r on r.sample_id = s.id and not r.skipped
    where s.cycle_start = p_cycle_start and s.kind = 'invoice' and s.excluded_at is null
  ), people as (
    select i.staff_id from inv i union select c.staff_id from conv c
  )
  select p.staff_id,
    (select count(*)::int from inv i where i.staff_id = p.staff_id),
    (select round(avg(i.score), 1) from inv i where i.staff_id = p.staff_id),
    (select count(*)::int from conv c where c.staff_id = p.staff_id and c.final_score is not null),
    (select count(*)::int from conv c where c.staff_id = p.staff_id and c.missing),
    (select round(avg(case when c.missing then 0 else c.final_score end), 1) from conv c
      where c.staff_id = p.staff_id and (c.missing or c.final_score is not null))
  from people p;
end;
$function$;

-- Saving a review: not on an excluded sample.
create or replace function public.save_evaluation_invoice_review_v1(p_sample_id uuid, p_criteria jsonb, p_notes text, p_skip boolean default false)
returns numeric
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_sample public.evaluation_review_samples_v1%rowtype;
  v_earned numeric := 0;
  v_possible numeric := 0;
  v_key text;
  v_value jsonb;
  v_score numeric;
begin
  if not coalesce(public.dawaa_current_actor_can(array['manage_evaluation_rules']), false) then
    raise exception 'review_samples_not_authorized' using errcode = '42501';
  end if;
  select * into v_sample from public.evaluation_review_samples_v1 where id = p_sample_id and kind = 'invoice' and excluded_at is null;
  if not found then
    raise exception 'review_sample_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(p_skip, false) then
    if p_criteria is null or jsonb_typeof(p_criteria) <> 'object' then
      raise exception 'review_criteria_invalid' using errcode = '22023';
    end if;
    for v_key, v_value in select * from jsonb_each(p_criteria) loop
      if v_key not in ('greeting', 'consultation', 'suggestion', 'speed', 'check', 'closing') then
        raise exception 'review_criteria_invalid' using errcode = '22023';
      end if;
      continue when jsonb_typeof(v_value) = 'null';
      if jsonb_typeof(v_value) <> 'number' or (v_value)::numeric not in (0, 1, 2) then
        raise exception 'review_criteria_invalid' using errcode = '22023';
      end if;
      v_earned := v_earned + (v_value)::numeric;
      v_possible := v_possible + 2;
    end loop;
    if v_possible < 6 then
      raise exception 'review_criteria_too_few' using errcode = '22023';
    end if;
    v_score := round(v_earned / v_possible * 100, 1);
  end if;
  insert into public.evaluation_invoice_reviews_v1 (sample_id, staff_id, criteria, score, skipped, notes, reviewed_by, reviewed_at)
  values (p_sample_id, v_sample.staff_id, coalesce(p_criteria, '{}'::jsonb), v_score, coalesce(p_skip, false), left(p_notes, 1000),
          public.dawaa_current_staff_account_id_strict()::text, now())
  on conflict (sample_id) do update set criteria = excluded.criteria, score = excluded.score, skipped = excluded.skipped,
    notes = excluded.notes, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
  return v_score;
end;
$function$;

-- Internal helpers stay closed; the owner-facing functions check the session themselves (anon + staff session, like the rest).
revoke all on function public.dawaa_review_candidates_v1(text, date, date) from public, anon, authenticated;
revoke all on function public.dawaa_review_pick_from_v1(text) from public, anon, authenticated;
revoke all on function public.dawaa_add_review_sample_v1(text, text, text, date) from public, anon, authenticated;
revoke all on function public.search_evaluation_review_candidates_v1(text, text) from public;
revoke all on function public.add_evaluation_review_sample_v1(text, text) from public;
revoke all on function public.exclude_evaluation_review_sample_v1(uuid, boolean, text) from public;
revoke all on function public.list_evaluation_review_samples_v1(date) from public;
grant execute on function public.search_evaluation_review_candidates_v1(text, text) to anon, authenticated;
grant execute on function public.add_evaluation_review_sample_v1(text, text) to anon, authenticated;
grant execute on function public.exclude_evaluation_review_sample_v1(uuid, boolean, text) to anon, authenticated;
grant execute on function public.list_evaluation_review_samples_v1(date) to anon, authenticated;
