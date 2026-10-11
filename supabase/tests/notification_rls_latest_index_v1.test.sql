drop policy if exists notifications_select_visible_v2 on public.notifications;
create policy notifications_select_visible_v2
on public.notifications
for select
to anon, authenticated
using (
  public.dawaa_notification_visible_to_current_user_v2(
    recipient_user_id, user_id::text, recipient_staff_id, staff_id, recipient_role, branch
  )
  and public.dawaa_notification_inbox_visible_v3(
    public.dawaa_current_notification_role_v1(),
    public.dawaa_current_notification_account_id_v1(),
    public.dawaa_current_staff_id_v1(),
    id::text,
    recipient_user_id,
    user_id::text,
    recipient_staff_id,
    staff_id,
    recipient_role,
    coalesce(notification_type, type),
    priority,
    target_type,
    title,
    branch,
    created_at,
    metadata
  )
);

create index if not exists notifications_created_at_idx
  on public.notifications (created_at desc);
create index if not exists notifications_pkey_idx on public.notifications (id);
analyze public.notifications;

set role anon;
select set_config('request.headers', '{}', false);
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count from public.notification_events_v2;
  if v_count <> 0 then raise exception 'anon without verified session saw notifications'; end if;
end
$$;

select set_config(
  'request.headers',
  '{"x-dawaa-session-token":"verified-gm-session-token-for-notification-index-test"}',
  false
);
do $$
declare
  v_count bigint;
  v_id text;
begin
  select count(*) into v_count
  from public.notification_events_v2
  where title = 'tie-break notification';
  if v_count <> 1 then raise exception 'general_manager latest duplicate suppression expected one row, got %', v_count; end if;
  select id::text into v_id from public.notification_events_v2 where title = 'tie-break notification';
  if v_id <> '20000000-0000-4000-8000-000000000002' then
    raise exception 'tie-break must use highest id::text DESC, got %', v_id;
  end if;
  if not exists (select 1 from public.notification_events_v2 where title = 'direct recipient notification')
     or not exists (select 1 from public.notification_events_v2 where title = 'role recipient notification')
     or not exists (select 1 from public.notification_events_v2 where title = 'branch recipient notification') then
    raise exception 'general_manager direct, role, or branch recipient visibility changed';
  end if;
  if exists (select 1 from public.notification_events_v2 where title in ('SLA generated notification','VIP notification')) then
    raise exception 'general_manager SLA/VIP suppression changed';
  end if;
end
$$;

select set_config(
  'request.headers',
  '{"x-dawaa-session-token":"verified-exec-session-token-for-notification-index-test"}',
  false
);
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count from public.notification_events_v2 where title = 'tie-break notification';
  if v_count <> 1 then raise exception 'executive_manager latest duplicate suppression changed'; end if;
  if exists (select 1 from public.notification_events_v2 where title in ('SLA generated notification','VIP notification')) then
    raise exception 'executive_manager SLA/VIP suppression changed';
  end if;
end
$$;

select set_config(
  'request.headers',
  '{"x-dawaa-session-token":"verified-branches-session-token-for-notification-index-test"}',
  false
);
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count from public.notification_events_v2 where title = 'tie-break notification';
  if v_count <> 1 then raise exception 'branches_manager latest duplicate suppression changed'; end if;
  if exists (select 1 from public.notification_events_v2 where title in ('SLA generated notification','VIP notification')) then
    raise exception 'branches_manager SLA/VIP suppression changed';
  end if;
end
$$;

select set_config(
  'request.headers',
  '{"x-dawaa-session-token":"verified-normal-session-token-for-notification-index-test"}',
  false
);
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from public.notification_events_v2
  where title in (
    'normal staff direct notification',
    'normal staff role notification',
    'normal staff branch notification'
  );
  if v_count <> 3 then raise exception 'normal staff direct/role/branch visibility expected 3 rows, got %', v_count; end if;
  if exists (select 1 from public.notification_events_v2 where title like 'normal staff %' and branch <> 'branch-east') then
    raise exception 'normal staff branch isolation changed';
  end if;
end
$$;

reset role;
select set_config(
  'request.headers',
  '{"x-dawaa-session-token":"verified-gm-session-token-for-notification-index-test"}',
  false
);

explain (analyze, buffers)
select *
from public.notification_events_v2
order by created_at desc
limit 500 offset 0;

explain (analyze, buffers)
select nx.id::text
from public.notifications nx
where nx.archived_at is null
  and coalesce(nx.title, '') = 'synthetic latest lookup group'
  and coalesce(nx.branch, '') = 'branch-gm'
  and public.canonical_notification_type_v2(coalesce(nx.notification_type, nx.type)) = 'system'
order by nx.created_at desc, nx.id::text desc
limit 1;
