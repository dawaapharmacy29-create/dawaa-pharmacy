-- Weekly random review samples (owner 2026-11-17) and per-cycle branch targets for the v7.1 evaluation.
--
-- Invoices: the cameras keep 5 days, so cash invoices are sampled twice a week. The Sat–Tue batch is
-- drawn on Wednesday (up to 2 per seller), the Wed–Fri batch on Saturday (1 per seller): 2–3 a week,
-- about 10–12 a cycle. Each slot takes the stratum (small / medium / big) the seller has least of in
-- the cycle, so small invoices are watched too, and a random invoice inside it (stable md5 order).
-- A sample can be reviewed until the invoice day + 4; after that it expires and counts for nobody.
--
-- Conversations: once a week (Sat–Fri, drawn on Saturday) up to 3 home-delivery customers per seller.
-- The seller uploads that customer's WhatsApp chat to the Master Brain within 2 days; the owner reviews
-- it with the official conversation review. No upload after the deadline scores 0 in the cycle.
--
-- Everything goes through security-definer functions: the tables are closed to clients.

create table if not exists public.evaluation_review_batches_v1 (
  kind text not null check (kind in ('invoice', 'conversation')),
  batch_start date not null,
  batch_end date not null,
  created_at timestamptz not null default now(),
  created_by text,
  samples integer not null default 0,
  primary key (kind, batch_start)
);

create table if not exists public.evaluation_review_samples_v1 (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('invoice', 'conversation')),
  batch_start date not null,
  cycle_start date not null,
  staff_id uuid not null references public.staff (id),
  branch text,
  invoice_id text not null,
  invoice_number text,
  invoice_at timestamptz not null,
  net numeric not null,
  items integer,
  stratum text not null check (stratum in ('small', 'medium', 'big')),
  customer_code text,
  customer_name text,
  customer_phone text,
  -- invoice: last day the camera still has it; conversation: last day to upload the chat.
  deadline date not null,
  created_at timestamptz not null default now(),
  unique (kind, invoice_id)
);
create index if not exists evaluation_review_samples_v1_cycle_idx on public.evaluation_review_samples_v1 (cycle_start, kind, staff_id);

create table if not exists public.evaluation_invoice_reviews_v1 (
  sample_id uuid primary key references public.evaluation_review_samples_v1 (id) on delete cascade,
  staff_id uuid not null references public.staff (id),
  -- {"greeting": 2, "consultation": 1, ...}: 2 excellent, 1 acceptable, 0 weak, null not visible.
  criteria jsonb not null default '{}'::jsonb,
  score numeric check (score between 0 and 100),
  skipped boolean not null default false,
  notes text,
  reviewed_by text,
  reviewed_at timestamptz not null default now()
);

-- Monthly branch targets for follow-ups and complete customer requests (suggested by the app from
-- the previous cycle, approved by the owner). Missing rows fall back to the engine's defaults.
create table if not exists public.evaluation_branch_cycle_targets_v1 (
  branch text not null,
  cycle_start date not null,
  followups integer check (followups > 0),
  requests integer check (requests > 0),
  note text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (branch, cycle_start)
);

alter table public.evaluation_review_batches_v1 enable row level security;
alter table public.evaluation_review_samples_v1 enable row level security;
alter table public.evaluation_invoice_reviews_v1 enable row level security;
alter table public.evaluation_branch_cycle_targets_v1 enable row level security;
revoke all on public.evaluation_review_batches_v1 from anon, authenticated;
revoke all on public.evaluation_review_samples_v1 from anon, authenticated;
revoke all on public.evaluation_invoice_reviews_v1 from anon, authenticated;
revoke all on public.evaluation_branch_cycle_targets_v1 from anon, authenticated;

-- Ramp approved by the owner 2026-11-17: follow-ups climb to 1000 (Shokry ~580, Shami ~360 a cycle now).
insert into public.evaluation_branch_cycle_targets_v1 (branch, cycle_start, followups, requests, note, updated_by)
values
  ('فرع شكري', '2026-11-26', 800, 225, 'أول دورة v7.1: متابعات ٥٨٠ → ٨٠٠ ثم ١٠٠٠، طلبات ١٩٦ × ١٫١٥', 'owner 2026-11-17'),
  ('فرع الشامي', '2026-11-26', 550, 95, 'أول دورة v7.1: متابعات ٣٦٠ → ٥٥٠ ثم ٧٥٠ ثم ١٠٠٠، طلبات ٨٢ × ١٫١٥', 'owner 2026-11-17')
on conflict (branch, cycle_start) do nothing;

create or replace function public.dawaa_review_cycle_start_v1(p_day date)
returns date
language sql
immutable
as $function$
  select case when extract(day from p_day) >= 26
    then make_date(extract(year from p_day)::int, extract(month from p_day)::int, 26)
    else (make_date(extract(year from p_day)::int, extract(month from p_day)::int, 26) - interval '1 month')::date end;
$function$;

-- Sellers who are reviewed: pharmacists and branch managers, plus the assistants the owner evaluates as
-- doctors (keep in sync with EVALUATED_AS_DOCTOR_IDS in catalog.ts). The purchasing manager is not.
create or replace function public.dawaa_review_sample_pool_v1()
returns table (staff_id uuid, branch text)
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
  select s.id, s.branch
  from public.staff s
  where coalesce(s.is_active, true)
    and (s.role in ('pharmacist', 'صيدلاني', 'branch_manager', 'مدير فرع', 'doctor', 'دكتور')
      or s.id in ('d40cb3d7-9548-46eb-b001-2754ab692e97', '819cd80a-4105-41c6-899f-d4def52c9510'));
$function$;

create or replace function public.generate_evaluation_review_batch_v1(p_kind text, p_batch_start date, p_batch_end date)
returns integer
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_from timestamptz := (p_batch_start::timestamp) at time zone 'Africa/Cairo';
  v_to timestamptz := ((p_batch_end + 1)::timestamp) at time zone 'Africa/Cairo';
  v_cycle date := public.dawaa_review_cycle_start_v1(p_batch_start);
  v_seller record;
  v_slots integer;
  v_stratum text;
  v_pick record;
  v_added integer := 0;
begin
  if not coalesce(public.dawaa_current_actor_can(array['manage_evaluation_rules']), false) then
    raise exception 'review_samples_not_authorized' using errcode = '42501';
  end if;
  if p_kind not in ('invoice', 'conversation') or p_batch_end < p_batch_start or p_batch_end - p_batch_start > 6
     or p_batch_end >= (now() at time zone 'Africa/Cairo')::date then
    raise exception 'review_samples_invalid_batch' using errcode = '22023';
  end if;
  insert into public.evaluation_review_batches_v1 (kind, batch_start, batch_end, created_by)
  values (p_kind, p_batch_start, p_batch_end, public.dawaa_current_staff_account_id_strict()::text)
  on conflict (kind, batch_start) do nothing;
  if not found then
    return 0;
  end if;

  create temporary table if not exists review_candidates (
    invoice_id text, staff_id uuid, branch text, invoice_number text, invoice_at timestamptz, net numeric,
    items integer, customer_code text, customer_name text, customer_phone text, stratum text, rnd text
  ) on commit drop;
  truncate review_candidates;

  insert into review_candidates
  with base as (
    select si.id::text as invoice_id, si.staff_id::uuid as staff_id, si.branch, coalesce(si.invoice_number, si.invoice_no) as invoice_number,
           si.invoice_datetime as invoice_at, coalesce(si.net_amount, si.total_amount)::numeric as net, si.line_items_count as items,
           nullif(btrim(si.customer_code), '') as customer_code, si.customer_name,
           nullif(right(regexp_replace(coalesce(nullif(si.whatsapp_phone, ''), si.customer_phone, ''), '\D', '', 'g'), 10), '') as customer_phone
    from public.sales_invoices si
    join public.dawaa_review_sample_pool_v1() p on p.staff_id::text = si.staff_id
    where si.invoice_datetime >= v_from and si.invoice_datetime < v_to
      and si.invoice_type = case when p_kind = 'invoice' then 'كاش' else 'توصيل منزلى' end
      and coalesce(si.invoice_category, '') not like 'internal%'
      and coalesce(si.customer_type, '') <> 'internal_account'
      and coalesce(btrim(si.customer_code), '') not in ('5', '10', '20', '54', '170', '4902', '12820')
      and coalesce(si.net_amount, si.total_amount, 0) > 0
  ), cuts as (
    select branch, percentile_cont(0.4) within group (order by net) as p40, percentile_cont(0.8) within group (order by net) as p80
    from base group by branch
  )
  select b.invoice_id, b.staff_id, b.branch, b.invoice_number, b.invoice_at, b.net, b.items, b.customer_code, b.customer_name, b.customer_phone,
         case when coalesce(b.items, 0) >= 4 or b.net >= c.p80 then 'big'
              when coalesce(b.items, 1) <= 2 and b.net <= c.p40 then 'small'
              else 'medium' end,
         md5(b.invoice_id || '|' || p_batch_start::text)
  from base b join cuts c on c.branch is not distinct from b.branch
  where p_kind = 'invoice' or b.customer_phone is not null;

  for v_seller in
    select c.staff_id, min(c.branch) as branch, count(distinct (c.invoice_at at time zone 'Africa/Cairo')::date) as days
    from review_candidates c group by c.staff_id
  loop
    v_slots := case
      when p_kind = 'conversation' then least(3, v_seller.days)
      when p_batch_end - p_batch_start >= 3 then case when v_seller.days >= 3 then 2 else 1 end
      else 1 end;
    for i in 1..v_slots loop
      -- The stratum this seller has least of in the cycle (small first, so small invoices are never skipped).
      select s.k into v_stratum
      from (values ('small', 1), ('big', 2), ('medium', 3)) as s(k, o)
      where exists (select 1 from review_candidates c where c.staff_id = v_seller.staff_id and c.stratum = s.k
                      and not exists (select 1 from public.evaluation_review_samples_v1 x where x.kind = p_kind and x.invoice_id = c.invoice_id))
      order by (select count(*) from public.evaluation_review_samples_v1 x
                where x.kind = p_kind and x.cycle_start = v_cycle and x.staff_id = v_seller.staff_id and x.stratum = s.k), s.o
      limit 1;
      exit when v_stratum is null;
      select c.* into v_pick
      from review_candidates c
      where c.staff_id = v_seller.staff_id and c.stratum = v_stratum
        and not exists (select 1 from public.evaluation_review_samples_v1 x where x.kind = p_kind and x.invoice_id = c.invoice_id)
      -- A customer already sampled for this seller in the cycle goes last.
      order by exists (select 1 from public.evaluation_review_samples_v1 x
                       where x.kind = p_kind and x.cycle_start = v_cycle and x.staff_id = v_seller.staff_id
                         and ((c.customer_code is not null and x.customer_code = c.customer_code)
                           or (c.customer_phone is not null and x.customer_phone = c.customer_phone))),
               c.rnd
      limit 1;
      exit when not found;
      insert into public.evaluation_review_samples_v1 (kind, batch_start, cycle_start, staff_id, branch, invoice_id, invoice_number,
        invoice_at, net, items, stratum, customer_code, customer_name, customer_phone, deadline)
      values (p_kind, p_batch_start, v_cycle, v_pick.staff_id, v_pick.branch, v_pick.invoice_id, v_pick.invoice_number,
        v_pick.invoice_at, v_pick.net, v_pick.items, v_pick.stratum, v_pick.customer_code, v_pick.customer_name, v_pick.customer_phone,
        case when p_kind = 'invoice' then (v_pick.invoice_at at time zone 'Africa/Cairo')::date + 4
             else (now() at time zone 'Africa/Cairo')::date + 2 end)
      on conflict (kind, invoice_id) do nothing;
      if found then v_added := v_added + 1; end if;
    end loop;
  end loop;

  update public.evaluation_review_batches_v1 set samples = v_added where kind = p_kind and batch_start = p_batch_start;
  return v_added;
end;
$function$;

-- A conversation sample's upload: the Master Brain source of that customer for that seller, uploaded
-- after the sample was drawn (or with the conversation inside the batch week).
create or replace function public.dawaa_review_sample_source_v1(p_sample_id uuid)
returns uuid
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
  select w.id
  from public.evaluation_review_samples_v1 s
  join public.whatsapp_review_sources w
    on w.deleted_at is null
   and ((s.customer_phone is not null and right(regexp_replace(coalesce(w.customer_phone, ''), '\D', '', 'g'), 10) = s.customer_phone)
     or (s.customer_code is not null and btrim(coalesce(w.customer_code, '')) = s.customer_code))
   and coalesce(w.conversation_ended_at, w.conversation_started_at, w.created_at) >= s.invoice_at - interval '3 days'
  where s.id = p_sample_id and s.kind = 'conversation'
  order by (w.staff_id = s.staff_id) desc, w.official_review_id is not null desc, w.created_at
  limit 1;
$function$;

create or replace function public.list_evaluation_review_samples_v1(p_cycle_start date)
returns table (
  id uuid, kind text, batch_start date, staff_id uuid, staff_name text, branch text, invoice_id text, invoice_number text,
  invoice_at timestamptz, net numeric, items integer, stratum text, customer_code text, customer_name text, customer_phone text,
  deadline date, status text, score numeric, criteria jsonb, notes text, reviewed_at timestamptz, source_id uuid, official_review_id uuid
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
    from public.evaluation_review_samples_v1 s where s.cycle_start = p_cycle_start and s.kind = 'conversation'
  )
  select s.id, s.kind, s.batch_start, s.staff_id, st.name, s.branch, s.invoice_id, s.invoice_number, s.invoice_at, s.net, s.items,
    s.stratum, s.customer_code, s.customer_name, s.customer_phone, s.deadline,
    case
      when s.kind = 'invoice' and r.sample_id is not null then case when r.skipped then 'skipped' else 'reviewed' end
      when s.kind = 'invoice' and (now() at time zone 'Africa/Cairo')::date > s.deadline then 'expired'
      when s.kind = 'invoice' then 'pending'
      when o.id is not null then 'reviewed'
      when src.source_id is not null then 'uploaded'
      when (now() at time zone 'Africa/Cairo')::date > s.deadline then 'missing'
      else 'awaiting_upload' end,
    case when s.kind = 'invoice' then case when r.skipped then null else r.score end else o.final_score end,
    r.criteria, r.notes, coalesce(r.reviewed_at, o.reviewed_at), src.source_id, o.id
  from public.evaluation_review_samples_v1 s
  left join public.staff st on st.id = s.staff_id
  left join public.evaluation_invoice_reviews_v1 r on r.sample_id = s.id
  left join src on src.sample_id = s.id
  left join lateral (
    select v.id, v.final_score, v.reviewed_at from public.conversation_sales_reviews_official_v1 v
    where src.source_id is not null and v.whatsapp_review_source_id = src.source_id
    order by v.reviewed_at desc nulls last limit 1
  ) o on true
  where s.cycle_start = p_cycle_start
  order by s.batch_start desc, st.name, s.invoice_at;
end;
$function$;

-- Six camera criteria, each 2 excellent / 1 acceptable / 0 weak / null not visible. Score = earned ÷ possible.
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
  select * into v_sample from public.evaluation_review_samples_v1 where id = p_sample_id and kind = 'invoice';
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

-- Per seller in a cycle: reviewed invoices and their average; conversations reviewed, missing uploads
-- (scored 0) and the average including them. Readable by the evaluation (owner session or service role).
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
    select s.staff_id, o.final_score,
      (o.id is null and public.dawaa_review_sample_source_v1(s.id) is null and (now() at time zone 'Africa/Cairo')::date > s.deadline) as missing
    from public.evaluation_review_samples_v1 s
    left join lateral (
      select v.id, v.final_score from public.conversation_sales_reviews_official_v1 v
      where v.whatsapp_review_source_id = public.dawaa_review_sample_source_v1(s.id)
      order by v.reviewed_at desc nulls last limit 1
    ) o on true
    where s.cycle_start = p_cycle_start and s.kind = 'conversation'
  ), inv as (
    select s.staff_id, r.score
    from public.evaluation_review_samples_v1 s
    join public.evaluation_invoice_reviews_v1 r on r.sample_id = s.id and not r.skipped
    where s.cycle_start = p_cycle_start and s.kind = 'invoice'
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

-- The seller's own conversation uploads still due (shown on the doctor's page).
create or replace function public.list_my_conversation_upload_requests_v1()
returns table (id uuid, customer_name text, customer_phone text, invoice_at timestamptz, deadline date, uploaded boolean)
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
  select s.id, s.customer_name, s.customer_phone, s.invoice_at, s.deadline, public.dawaa_review_sample_source_v1(s.id) is not null
  from public.evaluation_review_samples_v1 s
  join public.staff_accounts a on a.staff_id = s.staff_id and a.id = public.dawaa_current_staff_account_id_strict()
  where s.kind = 'conversation' and s.deadline >= (now() at time zone 'Africa/Cairo')::date - 7
  order by s.deadline, s.invoice_at;
$function$;

create or replace function public.list_evaluation_branch_cycle_targets_v1()
returns setof public.evaluation_branch_cycle_targets_v1
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.dawaa_current_actor_can(array['manage_evaluation_rules']), false) then
    raise exception 'review_samples_not_authorized' using errcode = '42501';
  end if;
  return query select * from public.evaluation_branch_cycle_targets_v1 order by cycle_start desc, branch;
end;
$function$;

create or replace function public.save_evaluation_branch_cycle_target_v1(p_branch text, p_cycle_start date, p_followups integer, p_requests integer, p_note text)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
begin
  if not coalesce(public.dawaa_current_actor_can(array['manage_evaluation_rules']), false) then
    raise exception 'review_samples_not_authorized' using errcode = '42501';
  end if;
  if extract(day from p_cycle_start) <> 26 or coalesce(p_followups, 1) <= 0 or coalesce(p_requests, 1) <= 0 then
    raise exception 'cycle_target_invalid' using errcode = '22023';
  end if;
  insert into public.evaluation_branch_cycle_targets_v1 (branch, cycle_start, followups, requests, note, updated_by, updated_at)
  values (p_branch, p_cycle_start, p_followups, p_requests, left(p_note, 500), public.dawaa_current_staff_account_id_strict()::text, now())
  on conflict (branch, cycle_start) do update set followups = excluded.followups, requests = excluded.requests,
    note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$function$;

revoke all on function public.dawaa_review_sample_pool_v1() from public, anon, authenticated;
revoke all on function public.dawaa_review_sample_source_v1(uuid) from public, anon, authenticated;
revoke all on function public.generate_evaluation_review_batch_v1(text, date, date) from public, anon;
revoke all on function public.list_evaluation_review_samples_v1(date) from public, anon;
revoke all on function public.save_evaluation_invoice_review_v1(uuid, jsonb, text, boolean) from public, anon;
revoke all on function public.get_evaluation_review_scores_v1(date) from public, anon;
revoke all on function public.list_my_conversation_upload_requests_v1() from public, anon;
revoke all on function public.list_evaluation_branch_cycle_targets_v1() from public, anon;
revoke all on function public.save_evaluation_branch_cycle_target_v1(text, date, integer, integer, text) from public, anon;
grant execute on function public.generate_evaluation_review_batch_v1(text, date, date) to authenticated;
grant execute on function public.list_evaluation_review_samples_v1(date) to authenticated;
grant execute on function public.save_evaluation_invoice_review_v1(uuid, jsonb, text, boolean) to authenticated;
grant execute on function public.get_evaluation_review_scores_v1(date) to authenticated, service_role;
grant execute on function public.list_my_conversation_upload_requests_v1() to authenticated;
grant execute on function public.list_evaluation_branch_cycle_targets_v1() to authenticated, service_role;
grant execute on function public.save_evaluation_branch_cycle_target_v1(text, date, integer, integer, text) to authenticated;
