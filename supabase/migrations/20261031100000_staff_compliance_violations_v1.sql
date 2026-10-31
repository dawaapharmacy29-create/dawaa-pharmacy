-- Staff compliance violations v1 (owner decision 2026-10-31: "الأداء بيكسب، والالتزام شرط").
-- The branch manager records a rule violation for one employee (uniform, appearance, the personal PConnect
-- account, ignored instructions) with a note. Violations add points in the cycle; the points give the
-- compliance factor that multiplies the incentive tier (evaluation lab only for now). Missing punches are
-- not recorded here: only the ones above the agreed allowance count, and the lab reads them from attendance.
-- Nothing is deleted: a wrong violation is withdrawn with a reason.

create table if not exists public.staff_compliance_violations (
  id uuid primary key default gen_random_uuid(),
  staff_account_id uuid not null references public.staff_accounts(id),
  branch_key text check (branch_key in ('shokry', 'elshamy')),
  category text not null check (category in ('uniform', 'appearance', 'pconnect', 'instructions')),
  points smallint not null check (points between 1 and 2),
  occurred_on date not null,
  note text not null,
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdraw_reason text
);
create index if not exists staff_compliance_violations_staff_day_idx
  on public.staff_compliance_violations (staff_account_id, occurred_on);
create index if not exists staff_compliance_violations_branch_day_idx
  on public.staff_compliance_violations (branch_key, occurred_on);

alter table public.staff_compliance_violations enable row level security;
revoke all on public.staff_compliance_violations from anon, authenticated;

-- Who may record: the branch manager for the own branch, top management for every branch.
create or replace function public.staff_violation_actor_scope_v1()
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select public.dawaa_current_operational_write_scope_v1(array[]::text[], array['branch_manager']);
$function$;

-- The employees a manager may record for (active accounts of the branch, managers excluded).
create or replace function public.list_branch_staff_for_violations_v1(p_branch text default null)
returns table (staff_account_id uuid, name text, role text, branch_key text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_scope text := public.staff_violation_actor_scope_v1();
  v_branch text := public.dawaa_customer_request_branch_key(p_branch);
begin
  if v_scope = 'NONE' then raise exception 'not_authorized' using errcode = '42501'; end if;
  if v_scope <> 'ALL' then v_branch := v_scope; end if;
  return query
    select sa.id, sa.name, sa.role, public.dawaa_customer_request_branch_key(sa.branch)
    from public.staff_accounts sa
    where coalesce(sa.active, false) and coalesce(sa.can_login, false)
      and sa.id <> public.dawaa_current_staff_account_id_strict()
      and lower(coalesce(sa.role, '')) not in ('general_manager', 'executive_manager', 'admin', 'branches_manager', 'branch_manager')
      and (v_branch is null or public.dawaa_customer_request_branch_key(sa.branch) = v_branch)
    order by sa.name;
end;
$function$;

create or replace function public.record_staff_violation_v1(
  p_staff_account_id uuid, p_category text, p_note text, p_occurred_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_scope text := public.staff_violation_actor_scope_v1();
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_day date := coalesce(p_occurred_on, (now() at time zone 'Africa/Cairo')::date);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_branch text;
  v_points smallint;
  v_id uuid;
begin
  if v_actor is null or v_scope = 'NONE' then raise exception 'not_authorized' using errcode = '42501'; end if;
  v_points := case p_category when 'uniform' then 1 when 'appearance' then 1 when 'pconnect' then 2 when 'instructions' then 2 end;
  if v_points is null then raise exception 'invalid_category'; end if;
  if v_note is null then raise exception 'note_required'; end if;
  if v_day > v_today or v_day < v_today - 7 then raise exception 'invalid_day'; end if;
  if p_staff_account_id = v_actor then raise exception 'not_authorized' using errcode = '42501'; end if;

  select public.dawaa_customer_request_branch_key(sa.branch) into v_branch
  from public.staff_accounts sa
  where sa.id = p_staff_account_id and coalesce(sa.active, false);
  if not found then raise exception 'staff_not_found'; end if;
  if v_scope <> 'ALL' and v_branch is distinct from v_scope then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into public.staff_compliance_violations (staff_account_id, branch_key, category, points, occurred_on, note, recorded_by)
  values (p_staff_account_id, v_branch, p_category, v_points, v_day, v_note, v_actor)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'points', v_points);
end;
$function$;

-- Withdraw a wrong violation (the one who recorded it, or top management), with a reason.
create or replace function public.withdraw_staff_violation_v1(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_scope text := public.staff_violation_actor_scope_v1();
  v_row public.staff_compliance_violations%rowtype;
begin
  if v_actor is null or v_scope = 'NONE' then raise exception 'not_authorized' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'reason_required'; end if;
  select * into v_row from public.staff_compliance_violations where id = p_id for update;
  if not found then raise exception 'violation_not_found'; end if;
  if v_scope <> 'ALL' and v_row.recorded_by <> v_actor then raise exception 'not_authorized' using errcode = '42501'; end if;
  if v_row.withdrawn_at is not null then raise exception 'already_withdrawn'; end if;
  update public.staff_compliance_violations
     set withdrawn_at = now(), withdrawn_by = v_actor, withdraw_reason = btrim(p_reason)
   where id = p_id;
  return jsonb_build_object('id', p_id, 'withdrawn', true);
end;
$function$;

-- Violations in a period: managers see their scope; every employee sees their own.
create or replace function public.list_staff_violations_v1(p_from date, p_to date, p_branch text default null)
returns table (
  id uuid, staff_account_id uuid, staff_name text, branch_key text, category text, points smallint,
  occurred_on date, note text, recorded_by_name text, recorded_at timestamptz, withdrawn boolean, withdraw_reason text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_scope text := public.staff_violation_actor_scope_v1();
  v_branch text := public.dawaa_customer_request_branch_key(p_branch);
begin
  if v_actor is null then raise exception 'not_authorized' using errcode = '42501'; end if;
  return query
    select v.id, v.staff_account_id, sa.name, v.branch_key, v.category, v.points, v.occurred_on, v.note,
           rb.name, v.recorded_at, v.withdrawn_at is not null, v.withdraw_reason
    from public.staff_compliance_violations v
    join public.staff_accounts sa on sa.id = v.staff_account_id
    left join public.staff_accounts rb on rb.id = v.recorded_by
    where v.occurred_on between p_from and p_to
      and (v_branch is null or v.branch_key = v_branch)
      and (v_scope = 'ALL' or (v_scope <> 'NONE' and v.branch_key = v_scope) or v.staff_account_id = v_actor)
    order by v.occurred_on desc, v.recorded_at desc;
end;
$function$;

revoke all on function public.staff_violation_actor_scope_v1() from public;
revoke all on function public.list_branch_staff_for_violations_v1(text) from public;
revoke all on function public.record_staff_violation_v1(uuid, text, text, date) from public;
revoke all on function public.withdraw_staff_violation_v1(uuid, text) from public;
revoke all on function public.list_staff_violations_v1(date, date, text) from public;
grant execute on function public.list_branch_staff_for_violations_v1(text) to anon, authenticated;
grant execute on function public.record_staff_violation_v1(uuid, text, text, date) to anon, authenticated;
grant execute on function public.withdraw_staff_violation_v1(uuid, text) to anon, authenticated;
grant execute on function public.list_staff_violations_v1(date, date, text) to anon, authenticated;
