-- Branch weekly inventory count v1 (owner decision 2026-10-29).
-- Every week a set number of items is counted per branch: the system balance comes from the pharmacy
-- program as an Excel file, the branch assistants enter the counted quantity, the branch manager
-- reviews the differences and closes the count. Reuses inventory_count_sessions / inventory_count_items
-- (empty in Production), adds the missing columns, moves every write behind authorized RPCs and
-- replaces the open policies (anon read/update with `true`) by branch-scoped reads.

alter table public.inventory_count_sessions
  add column if not exists week_start date,
  add column if not exists submitted_at timestamptz,
  add column if not exists submitted_by_staff_id uuid;

alter table public.inventory_count_items
  add column if not exists product_code text,
  add column if not exists counted_by_staff_id uuid,
  add column if not exists counted_at timestamptz,
  add column if not exists reviewed_by_staff_id uuid,
  add column if not exists reviewed_at timestamptz;

-- One weekly count per branch and week.
create unique index if not exists inventory_count_sessions_weekly_branch_week_uidx
  on public.inventory_count_sessions (public.dawaa_customer_request_branch_key(branch), week_start)
  where count_type = 'weekly_items';
create index if not exists inventory_count_items_session_idx on public.inventory_count_items (session_id);

-- Who may do what. Top management and procurement see and plan every branch; the branch manager
-- plans and reviews their branch; assistants, pharmacists and the shift supervisor count it.
create or replace function public.inventory_count_actor_scope_v1(p_action text)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select case p_action
    when 'count' then public.dawaa_current_operational_write_scope_v1(
      array['view_inventory', 'manage_inventory'],
      array['branch_manager', 'assistant', 'pharmacist', 'shift_supervisor_evening'])
    when 'manage' then public.dawaa_current_operational_write_scope_v1(array['manage_inventory'], array['branch_manager'])
    else 'NONE'
  end;
$function$;

create or replace function public.inventory_count_actor_allows_branch_v1(p_action text, p_branch text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select case
    when public.inventory_count_actor_scope_v1(p_action) = 'ALL' then true
    when public.inventory_count_actor_scope_v1(p_action) = 'NONE' then false
    else public.inventory_count_actor_scope_v1(p_action) = public.dawaa_customer_request_branch_key(p_branch)
  end;
$function$;

-- Plan a weekly count from the program's Excel: [{product_code, item_name, expected_qty, unit_price}].
create or replace function public.create_inventory_weekly_count_v1(
  p_branch text, p_week_start date, p_due_date date, p_items jsonb, p_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_actor_name text;
  v_session uuid;
  v_count integer;
begin
  if v_actor is null or not public.inventory_count_actor_allows_branch_v1('manage', p_branch) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.dawaa_customer_request_branch_key(p_branch) not in ('shokry', 'elshamy') then
    raise exception 'invalid_branch';
  end if;
  if p_week_start is null or p_due_date is null or p_due_date < p_week_start then
    raise exception 'invalid_dates';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'no_items';
  end if;
  if jsonb_array_length(p_items) > 1000 then
    raise exception 'too_many_items';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where nullif(btrim(coalesce(e->>'item_name', '')), '') is null
       or (e->>'expected_qty') is null
       or (e->>'expected_qty') !~ '^-?[0-9]+(\.[0-9]+)?$'
  ) then
    raise exception 'invalid_items';
  end if;
  if exists (
    select 1 from public.inventory_count_sessions s
    where s.count_type = 'weekly_items' and s.week_start = p_week_start
      and public.dawaa_customer_request_branch_key(s.branch) = public.dawaa_customer_request_branch_key(p_branch)
  ) then
    raise exception 'week_already_planned';
  end if;

  select sa.name into v_actor_name from public.staff_accounts sa where sa.id = v_actor;

  insert into public.inventory_count_sessions
    (title, branch, count_type, week_start, due_date, status, created_by, created_by_name, created_at, updated_at)
  values
    (coalesce(nullif(btrim(p_title), ''), 'جرد أسبوع ' || to_char(p_week_start, 'YYYY-MM-DD')),
     p_branch, 'weekly_items', p_week_start, p_due_date, 'planned', v_actor, v_actor_name, now(), now())
  returning id into v_session;

  insert into public.inventory_count_items (session_id, product_code, item_name, expected_qty, unit_price, created_at, updated_at)
  select v_session,
         nullif(btrim(coalesce(e->>'product_code', '')), ''),
         btrim(e->>'item_name'),
         (e->>'expected_qty')::numeric,
         case when (e->>'unit_price') ~ '^[0-9]+(\.[0-9]+)?$' then (e->>'unit_price')::numeric end,
         now(), now()
  from jsonb_array_elements(p_items) e;
  get diagnostics v_count = row_count;

  insert into public.inventory_count_events (session_id, event_type, description, staff_id, staff_name, created_at)
  values (v_session, 'planned', v_count || ' صنف', v_actor, v_actor_name, now());

  return jsonb_build_object('session_id', v_session, 'items', v_count);
end;
$function$;

-- Assistants save counted quantities: [{item_id, actual_qty, expiry_date?, notes?}]. Allowed until submitted.
create or replace function public.save_inventory_count_quantities_v1(p_session_id uuid, p_counts jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_session public.inventory_count_sessions%rowtype;
  v_count integer;
begin
  select * into v_session from public.inventory_count_sessions where id = p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if v_actor is null or not public.inventory_count_actor_allows_branch_v1('count', v_session.branch) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_session.status not in ('planned', 'counting') then
    raise exception 'session_not_open';
  end if;
  if jsonb_typeof(p_counts) <> 'array' or exists (
    select 1 from jsonb_array_elements(p_counts) e
    where (e->>'actual_qty') is null or (e->>'actual_qty') !~ '^[0-9]+(\.[0-9]+)?$'
  ) then
    raise exception 'invalid_counts';
  end if;

  update public.inventory_count_items i
  set actual_qty = (e->>'actual_qty')::numeric,
      difference = (e->>'actual_qty')::numeric - coalesce(i.expected_qty, 0),
      expiry_date = case when (e->>'expiry_date') ~ '^\d{4}-\d{2}-\d{2}$' then (e->>'expiry_date')::date else i.expiry_date end,
      notes = coalesce(nullif(btrim(coalesce(e->>'notes', '')), ''), i.notes),
      counted_by_staff_id = v_actor,
      counted_at = now(),
      updated_at = now()
  from jsonb_array_elements(p_counts) e
  where i.session_id = p_session_id and i.id = (e->>'item_id')::uuid;
  get diagnostics v_count = row_count;

  update public.inventory_count_sessions set status = 'counting', updated_at = now()
  where id = p_session_id and status = 'planned';
  return v_count;
end;
$function$;

-- The counter submits once every item has a counted quantity.
create or replace function public.submit_inventory_count_v1(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_session public.inventory_count_sessions%rowtype;
  v_missing integer;
begin
  select * into v_session from public.inventory_count_sessions where id = p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if v_actor is null or not public.inventory_count_actor_allows_branch_v1('count', v_session.branch) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_session.status not in ('planned', 'counting') then raise exception 'session_not_open'; end if;
  select count(*) into v_missing from public.inventory_count_items where session_id = p_session_id and actual_qty is null;
  if v_missing > 0 then raise exception 'items_not_counted:%', v_missing; end if;

  update public.inventory_count_sessions
  set status = 'submitted', submitted_at = now(), submitted_by_staff_id = v_actor, updated_at = now()
  where id = p_session_id;
  insert into public.inventory_count_events (session_id, event_type, description, staff_id, staff_name, created_at)
  select p_session_id, 'submitted', null, v_actor, sa.name, now() from public.staff_accounts sa where sa.id = v_actor;
  return jsonb_build_object('session_id', p_session_id, 'status', 'submitted');
end;
$function$;

-- The branch manager reviews the differences: [{item_id, reviewed_qty?, review_result, reason?}],
-- then approves (closed) or returns the count to the assistants.
create or replace function public.review_inventory_count_v1(p_session_id uuid, p_reviews jsonb, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_actor_name text;
  v_session public.inventory_count_sessions%rowtype;
begin
  if p_decision not in ('approve', 'return') then raise exception 'invalid_decision'; end if;
  select * into v_session from public.inventory_count_sessions where id = p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if v_actor is null or not public.inventory_count_actor_allows_branch_v1('manage', v_session.branch) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_session.status <> 'submitted' then raise exception 'session_not_submitted'; end if;
  if jsonb_typeof(coalesce(p_reviews, '[]'::jsonb)) <> 'array' or exists (
    select 1 from jsonb_array_elements(coalesce(p_reviews, '[]'::jsonb)) e
    where coalesce(e->>'review_result', '') not in ('confirmed', 'corrected', 'recount')
       or ((e->>'reviewed_qty') is not null and (e->>'reviewed_qty') !~ '^[0-9]+(\.[0-9]+)?$')
  ) then
    raise exception 'invalid_reviews';
  end if;

  select sa.name into v_actor_name from public.staff_accounts sa where sa.id = v_actor;

  update public.inventory_count_items i
  set review_result = e->>'review_result',
      reviewed_qty = case when (e->>'reviewed_qty') is not null then (e->>'reviewed_qty')::numeric else i.reviewed_qty end,
      reason = coalesce(nullif(btrim(coalesce(e->>'reason', '')), ''), i.reason),
      reviewed_by_staff_id = v_actor,
      reviewed_at = now(),
      updated_at = now()
  from jsonb_array_elements(coalesce(p_reviews, '[]'::jsonb)) e
  where i.session_id = p_session_id and i.id = (e->>'item_id')::uuid;

  update public.inventory_count_sessions
  set status = case when p_decision = 'approve' then 'closed' else 'counting' end,
      closed_at = case when p_decision = 'approve' then now() end,
      submitted_at = case when p_decision = 'approve' then submitted_at end,
      reviewer_staff_id = v_actor,
      reviewer_staff_name = v_actor_name,
      updated_at = now()
  where id = p_session_id;
  insert into public.inventory_count_events (session_id, event_type, description, staff_id, staff_name, created_at)
  values (p_session_id, case when p_decision = 'approve' then 'approved' else 'returned' end, null, v_actor, v_actor_name, now());
  return jsonb_build_object('session_id', p_session_id, 'status', case when p_decision = 'approve' then 'closed' else 'counting' end);
end;
$function$;

-- Reads: the branch's own counts; writes only through the functions above.
do $$
declare
  r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('inventory_count_sessions', 'inventory_count_items', 'inventory_count_events')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end;
$$;

alter table public.inventory_count_sessions enable row level security;
alter table public.inventory_count_items enable row level security;
alter table public.inventory_count_events enable row level security;

-- Browser requests run as anon with a verified staff session token: identity is resolved by
-- dawaa_current_staff_account_id_strict() inside the policies and functions, never by the role.
revoke insert, update, delete, truncate on public.inventory_count_sessions, public.inventory_count_items, public.inventory_count_events from anon, authenticated;
grant select on public.inventory_count_sessions, public.inventory_count_items, public.inventory_count_events to anon, authenticated;

create policy inventory_count_sessions_branch_read_v1 on public.inventory_count_sessions
  for select to anon, authenticated
  using (public.inventory_count_actor_allows_branch_v1('count', branch));
create policy inventory_count_items_branch_read_v1 on public.inventory_count_items
  for select to anon, authenticated
  using (exists (
    select 1 from public.inventory_count_sessions s
    where s.id = inventory_count_items.session_id and public.inventory_count_actor_allows_branch_v1('count', s.branch)
  ));
create policy inventory_count_events_branch_read_v1 on public.inventory_count_events
  for select to anon, authenticated
  using (exists (
    select 1 from public.inventory_count_sessions s
    where s.id = inventory_count_events.session_id and public.inventory_count_actor_allows_branch_v1('count', s.branch)
  ));

revoke all on function public.inventory_count_actor_scope_v1(text) from public;
revoke all on function public.inventory_count_actor_allows_branch_v1(text, text) from public;
revoke all on function public.create_inventory_weekly_count_v1(text, date, date, jsonb, text) from public;
revoke all on function public.save_inventory_count_quantities_v1(uuid, jsonb) from public;
revoke all on function public.submit_inventory_count_v1(uuid) from public;
revoke all on function public.review_inventory_count_v1(uuid, jsonb, text) from public;
grant execute on function public.inventory_count_actor_scope_v1(text) to anon, authenticated;
grant execute on function public.inventory_count_actor_allows_branch_v1(text, text) to anon, authenticated;
grant execute on function public.create_inventory_weekly_count_v1(text, date, date, jsonb, text) to anon, authenticated;
grant execute on function public.save_inventory_count_quantities_v1(uuid, jsonb) to anon, authenticated;
grant execute on function public.submit_inventory_count_v1(uuid) to anon, authenticated;
grant execute on function public.review_inventory_count_v1(uuid, jsonb, text) to anon, authenticated;
