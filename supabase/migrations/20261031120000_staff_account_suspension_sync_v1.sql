-- Suspending a login account (staff_accounts.active = false) must take the employee out of the app
-- everywhere, not only out of login. Until now the legacy staff row stayed active and its weekly
-- schedule stayed open, so a suspended employee kept showing in «الموجودون الآن» and the schedules.
--
-- On suspension (when no other active account is linked to the same staff row):
--   * staff.active / is_active / visible_in_schedule -> false, status -> 'موقوف' (an existing
--     terminated/archived/inactive status is kept);
--   * open shift_schedules rows get effective_to = yesterday (Cairo); nothing is deleted;
--   * open staff_login_sessions are revoked.
-- On reactivation only a staff row this sync suspended ('موقوف') is reactivated; the schedule is
-- re-entered by hand. Every change is logged in staff_account_suspension_sync_log (closed schedule ids
-- included) so it can be reviewed or reverted.

create table if not exists public.staff_account_suspension_sync_log (
  id bigserial primary key,
  staff_account_id uuid not null,
  staff_id uuid,
  action text not null check (action in ('suspend', 'reactivate', 'backfill')),
  previous_staff jsonb,
  closed_schedule_ids uuid[] not null default '{}',
  revoked_sessions integer not null default 0,
  synced_at timestamptz not null default now()
);
alter table public.staff_account_suspension_sync_log enable row level security;
revoke all on public.staff_account_suspension_sync_log from public, anon, authenticated;
revoke all on sequence public.staff_account_suspension_sync_log_id_seq from public, anon, authenticated;

create or replace function public.dawaa_sync_staff_account_suspension_v1(p_account_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_staff public.staff%rowtype;
  v_yesterday date := (now() at time zone 'Africa/Cairo')::date - 1;
  v_closed uuid[] := '{}';
  v_revoked integer := 0;
begin
  select * into v_account from public.staff_accounts where id = p_account_id;
  if not found then return; end if;

  if v_account.active is not true then
    update public.staff_login_sessions set revoked_at = now()
     where staff_account_id = p_account_id and revoked_at is null and expires_at > now();
    get diagnostics v_revoked = row_count;
  end if;

  if nullif(trim(v_account.staff_id::text), '') is not null then
    select * into v_staff from public.staff where id::text = trim(v_account.staff_id::text);
  end if;

  if v_staff.id is not null and v_account.active is not true
     and not exists (select 1 from public.staff_accounts o
                      where o.id <> p_account_id and o.active is true
                        and trim(o.staff_id::text) = v_staff.id::text) then
    update public.staff
       set active = false, is_active = false, visible_in_schedule = false,
           status = case when coalesce(status, '') ~* '(terminated|archived|inactive|غير نشط|موقوف)'
                         then status else 'موقوف' end
     where id = v_staff.id
       and (active is not false or is_active is not false or visible_in_schedule is not false
            or coalesce(status, '') !~* '(terminated|archived|inactive|غير نشط|موقوف)');

    with closed as (
      update public.shift_schedules
         set effective_to = greatest(coalesce(effective_from, v_yesterday), v_yesterday)
       where staff_id = v_staff.id and effective_to is null
      returning id
    )
    select coalesce(array_agg(id), '{}') into v_closed from closed;
  elsif v_staff.id is not null and v_account.active is true and v_staff.status = 'موقوف' then
    update public.staff
       set active = true, is_active = true, visible_in_schedule = true, status = 'نشط'
     where id = v_staff.id;
  else
    if v_revoked = 0 then return; end if;
  end if;

  insert into public.staff_account_suspension_sync_log(staff_account_id, staff_id, action, previous_staff,
                                                       closed_schedule_ids, revoked_sessions)
  values (p_account_id, v_staff.id, p_action,
          case when v_staff.id is null then null else jsonb_build_object(
            'status', v_staff.status, 'active', v_staff.active, 'is_active', v_staff.is_active,
            'visible_in_schedule', v_staff.visible_in_schedule) end,
          v_closed, v_revoked);
end;
$function$;
revoke all on function public.dawaa_sync_staff_account_suspension_v1(uuid, text) from public, anon, authenticated;

create or replace function public.dawaa_staff_account_suspension_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if new.active is distinct from old.active then
    perform public.dawaa_sync_staff_account_suspension_v1(
      new.id, case when new.active is true then 'reactivate' else 'suspend' end);
  end if;
  return new;
end;
$function$;
revoke all on function public.dawaa_staff_account_suspension_trigger_v1() from public, anon, authenticated;

drop trigger if exists trg_staff_account_suspension_sync_v1 on public.staff_accounts;
create trigger trg_staff_account_suspension_sync_v1
  after update of active on public.staff_accounts
  for each row execute function public.dawaa_staff_account_suspension_trigger_v1();

-- One-time backfill: accounts already suspended whose staff row or schedule is still open.
do $$
declare
  r record;
begin
  for r in
    select sa.id
      from public.staff_accounts sa
      join public.staff s on s.id::text = trim(sa.staff_id::text)
     where sa.active is not true
       and (s.active is not false or s.is_active is not false or s.visible_in_schedule is not false
            or exists (select 1 from public.shift_schedules ss where ss.staff_id = s.id and ss.effective_to is null))
  loop
    perform public.dawaa_sync_staff_account_suspension_v1(r.id, 'backfill');
  end loop;
end;
$$;
