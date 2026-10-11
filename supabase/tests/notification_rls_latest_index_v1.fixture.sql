do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$$;

create table public.staff_accounts (
  id uuid primary key,
  staff_id text not null,
  role text not null,
  branch text not null,
  active boolean not null default true,
  can_login boolean not null default true
);

create table public.staff_login_sessions (
  token text primary key,
  staff_account_id uuid not null references public.staff_accounts(id)
);

create table public.notifications (
  id uuid primary key,
  recipient_user_id text,
  user_id uuid,
  recipient_staff_id text,
  staff_id text,
  recipient_role text,
  notification_type text,
  type text,
  priority text,
  target_type text,
  title text,
  branch text,
  created_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  archived_at timestamptz
);

insert into public.staff_accounts (id, staff_id, role, branch) values
  ('10000000-0000-4000-8000-000000000001', 'staff-gm', 'general_manager', 'branch-gm'),
  ('10000000-0000-4000-8000-000000000002', 'staff-exec', 'executive_manager', 'branch-exec'),
  ('10000000-0000-4000-8000-000000000003', 'staff-branches', 'branches_manager', 'branch-all'),
  ('10000000-0000-4000-8000-000000000004', 'staff-normal', 'branch_manager', 'branch-east');

insert into public.staff_login_sessions (token, staff_account_id) values
  ('verified-gm-session-token-for-notification-index-test', '10000000-0000-4000-8000-000000000001'),
  ('verified-exec-session-token-for-notification-index-test', '10000000-0000-4000-8000-000000000002'),
  ('verified-branches-session-token-for-notification-index-test', '10000000-0000-4000-8000-000000000003'),
  ('verified-normal-session-token-for-notification-index-test', '10000000-0000-4000-8000-000000000004');

create or replace function public.dawaa_current_notification_account_id_v1()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select a.id::text
  from public.staff_login_sessions s
  join public.staff_accounts a on a.id = s.staff_account_id
  where s.token = nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-dawaa-session-token'
    and a.active
    and a.can_login
$$;

create or replace function public.dawaa_current_notification_role_v1()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select a.role
  from public.staff_accounts a
  where a.id::text = public.dawaa_current_notification_account_id_v1()
$$;

create or replace function public.dawaa_current_staff_id_v1()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select a.staff_id
  from public.staff_accounts a
  where a.id::text = public.dawaa_current_notification_account_id_v1()
$$;

create or replace function public.dawaa_current_notification_branch_v1()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select a.branch
  from public.staff_accounts a
  where a.id::text = public.dawaa_current_notification_account_id_v1()
$$;

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
as $$
  with ctx as (
    select
      public.dawaa_current_notification_account_id_v1() as account_id,
      public.dawaa_current_staff_id_v1() as staff_id,
      lower(public.dawaa_current_notification_role_v1()) as role,
      lower(public.dawaa_current_notification_branch_v1()) as branch
  ), target as (
    select
      nullif(trim(p_recipient_user_id), '') as recipient_user_id,
      nullif(trim(p_user_id), '') as user_id,
      nullif(trim(coalesce(p_recipient_staff_id, p_legacy_staff_id)), '') as staff_id,
      nullif(lower(trim(p_recipient_role)), '') as role,
      nullif(lower(trim(p_branch)), '') as branch
  )
  select case
    when ctx.account_id is null then false
    when ctx.role in ('general_manager', 'executive_manager', 'branches_manager') then true
    when target.recipient_user_id is null
      and target.user_id is null
      and target.staff_id is null
      and target.role is null
      and target.branch is null then false
    else
      (target.recipient_user_id is null or target.recipient_user_id = ctx.account_id)
      and (target.user_id is null or target.user_id = ctx.account_id)
      and (target.staff_id is null or target.staff_id = ctx.staff_id)
      and (target.role is null or target.role = ctx.role)
      and (target.branch is null or target.branch = ctx.branch)
  end
  from ctx cross join target
$$;

create or replace function public.canonical_notification_type_v2(p_type text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case lower(trim(coalesce(p_type, 'system')))
    when 'task' then 'staff_task'
    when 'employee_task' then 'staff_task'
    when 'followup' then 'customer_followup'
    when 'delivery' then 'delivery_order'
    else lower(trim(coalesce(p_type, 'system')))
  end
$$;

create index notifications_inbox_canonical_lookup_v4_idx
  on public.notifications (
    (coalesce(title, '')),
    (coalesce(branch, '')),
    (public.canonical_notification_type_v2(coalesce(notification_type, type))),
    created_at desc
  ) include (id)
  where archived_at is null;

insert into public.notifications (
  id, type, notification_type, priority, title, branch, created_at, metadata
)
select
  md5('notification-index-bulk-' || g)::uuid,
  'system',
  'system',
  'normal',
  'synthetic latest lookup group',
  'branch-gm',
  timestamptz '2026-10-01 00:00:00+00' + g * interval '1 second',
  '{}'::jsonb
from generate_series(1, 2048) g;

insert into public.notifications (
  id, recipient_staff_id, recipient_role, type, notification_type, priority, target_type,
  title, branch, created_at, metadata
) values
  ('20000000-0000-4000-8000-000000000001', null, null, 'system', 'system', 'normal', null,
   'tie-break notification', 'branch-gm', '2026-10-10 12:00:00+00', '{}'::jsonb),
  ('20000000-0000-4000-8000-000000000002', null, null, 'system', 'system', 'normal', null,
   'tie-break notification', 'branch-gm', '2026-10-10 12:00:00+00', '{}'::jsonb),
  ('20000000-0000-4000-8000-000000000003', 'staff-gm', null, 'staff_task', 'staff_task', 'normal', null,
   'direct recipient notification', 'branch-gm', '2026-10-10 12:01:00+00',
   '{"recipient_staff_id":"staff-gm"}'::jsonb),
  ('20000000-0000-4000-8000-000000000004', null, 'general_manager', 'customer_request', 'customer_request', 'normal', null,
   'role recipient notification', 'branch-gm', '2026-10-10 12:02:00+00',
   '{"recipient_role":"general_manager"}'::jsonb),
  ('20000000-0000-4000-8000-000000000005', null, null, 'customer_request', 'customer_request', 'normal', null,
   'branch recipient notification', 'branch-gm', '2026-10-10 12:03:00+00', '{}'::jsonb),
  ('20000000-0000-4000-8000-000000000006', null, null, 'system', 'system', 'normal', null,
   'SLA generated notification', 'branch-gm', '2026-10-10 12:04:00+00',
   '{"slaGenerated":true}'::jsonb),
  ('20000000-0000-4000-8000-000000000007', null, null, 'customer_followup', 'customer_followup', 'normal', 'vip_customer',
   'VIP notification', 'branch-gm', '2026-10-10 12:05:00+00', '{}'::jsonb),
  ('20000000-0000-4000-8000-000000000008', 'staff-normal', null, 'staff_task', 'staff_task', 'normal', null,
   'normal staff direct notification', 'branch-east', '2026-10-10 12:06:00+00',
   '{"recipient_staff_id":"staff-normal"}'::jsonb),
  ('20000000-0000-4000-8000-000000000009', null, 'branch_manager', 'customer_request', 'customer_request', 'normal', null,
   'normal staff role notification', 'branch-east', '2026-10-10 12:07:00+00',
   '{"recipient_role":"branch_manager"}'::jsonb),
  ('20000000-0000-4000-8000-000000000010', null, null, 'customer_request', 'customer_request', 'normal', null,
   'normal staff branch notification', 'branch-east', '2026-10-10 12:08:00+00', '{}'::jsonb),
  ('20000000-0000-4000-8000-000000000011', null, null, 'system', 'system', 'normal', null,
   'archived notification', 'branch-gm', '2026-10-10 12:09:00+00', '{}'::jsonb);

update public.notifications
set archived_at = now()
where id = '20000000-0000-4000-8000-000000000011';

create view public.notification_events_v2
with (security_invoker = true)
as
select id, type, title, branch, created_at, metadata
from public.notifications;

alter table public.notifications enable row level security;
grant usage on schema public to anon, authenticated, service_role;
grant select on public.notifications, public.notification_events_v2 to anon, authenticated, service_role;
grant execute on function public.dawaa_current_notification_account_id_v1() to anon, authenticated;
grant execute on function public.dawaa_current_notification_role_v1() to anon, authenticated;
grant execute on function public.dawaa_current_staff_id_v1() to anon, authenticated;
grant execute on function public.dawaa_current_notification_branch_v1() to anon, authenticated;
grant execute on function public.dawaa_notification_visible_to_current_user_v2(text, text, text, text, text, text)
  to anon, authenticated;
