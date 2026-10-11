create role anon;
create role authenticated;
create role service_role bypassrls;
create schema extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.staff_accounts (
  id uuid primary key,
  staff_id text,
  role text,
  branch text,
  active boolean,
  is_active boolean,
  can_login boolean,
  status text
);

create table public.staff_login_sessions (
  staff_account_id uuid not null references public.staff_accounts(id),
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create or replace function public.dawaa_current_staff_account_id_strict()
returns uuid
language sql
stable
security definer
set search_path = public, extensions, pg_catalog
as $function$
  with token as (
    select btrim(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-dawaa-session-token') as value
  )
  select a.id
  from token t
  join public.staff_login_sessions s
    on s.token_hash = encode(extensions.digest(t.value, 'sha256'), 'hex')
  join public.staff_accounts a on a.id = s.staff_account_id
  where length(t.value) between 32 and 512
    and s.revoked_at is null
    and s.expires_at > now()
    and a.active is true
    and a.is_active is true
    and a.can_login is true
    and a.status = 'active'
  limit 1
$function$;

create or replace function public.dawaa_notification_visible_to_current_user_v2(
  p_recipient_user_id text,
  p_user_id text,
  p_recipient_staff_id text,
  p_legacy_staff_id text,
  p_recipient_role text,
  p_branch text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with ctx as (
    select a.id::text as account_id, a.staff_id, a.role, a.branch
    from public.staff_accounts a
    where a.id = public.dawaa_current_staff_account_id_strict()
  )
  select exists (
    select 1
    from ctx
    where (p_recipient_user_id is null or p_recipient_user_id = ctx.account_id)
      and (p_user_id is null or p_user_id = ctx.account_id)
      and (coalesce(p_recipient_staff_id, p_legacy_staff_id) is null
        or coalesce(p_recipient_staff_id, p_legacy_staff_id) = ctx.staff_id)
      and (p_recipient_role is null or lower(p_recipient_role) = lower(ctx.role))
      and (p_branch is null or lower(p_branch) = lower(ctx.branch))
  )
$function$;

create table public.notifications (
  id uuid primary key,
  recipient_user_id text,
  user_id uuid,
  recipient_staff_id text,
  staff_id text,
  recipient_role text,
  branch text
);

create table public.notification_sla_policies (
  policy_key text primary key
);

create table public.notification_sla_events (
  id uuid primary key,
  notification_id uuid not null references public.notifications(id)
);

alter table public.notification_sla_policies enable row level security;
alter table public.notification_sla_events enable row level security;
alter table public.notifications enable row level security;

create policy notification_sla_policies_authenticated_read_v2
on public.notification_sla_policies
for select to authenticated
using (true);

create policy notification_sla_events_visible_v1
on public.notification_sla_events
for select to authenticated
using (true);

create policy notifications_select_visible_v2
on public.notifications
for select to anon, authenticated
using (
  public.dawaa_notification_visible_to_current_user_v2(
    recipient_user_id, user_id::text, recipient_staff_id, staff_id, recipient_role, branch
  )
);

grant usage on schema public to anon, authenticated, service_role;
grant execute on function public.dawaa_current_staff_account_id_strict()
  to anon, authenticated, service_role;
grant execute on function public.dawaa_notification_visible_to_current_user_v2(text,text,text,text,text,text)
  to anon, authenticated, service_role;
grant select on public.notification_sla_policies to authenticated, service_role;
grant select on public.notification_sla_events to anon, authenticated, service_role;
grant select on public.notifications to anon, authenticated, service_role;
grant select on public.staff_accounts to service_role;

insert into public.staff_accounts (id, staff_id, role, branch, active, is_active, can_login, status) values
  ('00000000-0000-4000-8000-000000000001', 'staff-a', 'branch_manager', 'branch-a', true, true, true, 'active'),
  ('00000000-0000-4000-8000-000000000002', 'staff-b', 'branch_manager', 'branch-b', true, true, true, 'active'),
  ('00000000-0000-4000-8000-000000000003', 'staff-c', 'branch_manager', 'branch-a', false, false, true, 'active'),
  ('00000000-0000-4000-8000-000000000004', 'staff-d', 'branch_manager', 'branch-a', true, true, false, 'active'),
  ('00000000-0000-4000-8000-000000000005', 'staff-e', 'branch_manager', 'branch-a', null, null, false, 'disabled');

insert into public.staff_login_sessions (staff_account_id, token_hash, expires_at) values
  (
    '00000000-0000-4000-8000-000000000001',
    encode(extensions.digest('verified-session-token-for-staff-a-0000000000000001', 'sha256'), 'hex'),
    now() + interval '1 hour'
  );

insert into public.notifications (
  id, recipient_user_id, user_id, recipient_staff_id, staff_id, recipient_role, branch
) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000001', 'staff-a', 'staff-a', 'branch_manager', 'branch-a'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000002', 'staff-b', 'staff-b', 'branch_manager', 'branch-b'),
  ('10000000-0000-4000-8000-000000000003', null, null, null, null, 'branch_manager', 'branch-a'),
  ('10000000-0000-4000-8000-000000000004', null, null, null, null, 'branch_manager', 'branch-b');

insert into public.notification_sla_policies (policy_key) values ('urgent_any');

insert into public.notification_sla_events (id, notification_id) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004');

create or replace function public.get_dashboard_staff_ops_summary_v171()
returns table (
  active_accounts bigint,
  disabled_accounts bigint,
  pending_time_off bigint,
  absences_today bigint,
  late_today bigint
)
language sql
stable
security definer
set search_path = public
as $function$
  select 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint
$function$;

grant execute on function public.get_dashboard_staff_ops_summary_v171()
  to anon, authenticated, service_role;
revoke all on function public.get_dashboard_staff_ops_summary_v171() from public;
