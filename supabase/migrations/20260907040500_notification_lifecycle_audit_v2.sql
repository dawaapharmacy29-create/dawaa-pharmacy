-- Canonical notification lifecycle audit and read-model normalization.
-- One notification row stores current state; this append-only table stores every action transition.

create table if not exists public.notification_action_events (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  action_state text not null check (action_state in ('in_progress','completed','dismissed','escalated')),
  note text null,
  actor_staff_account_id uuid null references public.staff_accounts(id) on delete set null,
  actor_staff_id text null,
  actor_name text null,
  actor_role text null,
  actor_branch text null,
  notification_type text null,
  notification_branch text null,
  created_at timestamptz not null default now()
);

create index if not exists notification_action_events_notification_created_idx
  on public.notification_action_events(notification_id, created_at desc);
create index if not exists notification_action_events_actor_created_idx
  on public.notification_action_events(actor_staff_id, created_at desc);
create index if not exists notification_action_events_state_created_idx
  on public.notification_action_events(action_state, created_at desc);

alter table public.notification_action_events enable row level security;

drop policy if exists notification_action_events_select_visible_v1 on public.notification_action_events;
create policy notification_action_events_select_visible_v1
on public.notification_action_events
for select
using (
  exists (
    select 1
    from public.notifications n
    where n.id = notification_action_events.notification_id
      and public.dawaa_notification_visible_to_current_user_v2(
        n.recipient_user_id,
        n.user_id::text,
        n.recipient_staff_id,
        n.staff_id,
        n.recipient_role,
        n.branch
      )
  )
);

revoke all on public.notification_action_events from public;
revoke insert, update, delete on public.notification_action_events from anon, authenticated;
grant select on public.notification_action_events to anon, authenticated, service_role;

-- Normalize legacy unread/new states at the read boundary without rewriting history.
create or replace view public.notification_events_v2
with (security_invoker = true)
as
select
  n.id,
  coalesce(nullif(n.recipient_user_id,''), n.user_id::text) as recipient_user_id,
  coalesce(nullif(n.recipient_staff_id,''), nullif(n.staff_id,'')) as recipient_staff_id,
  nullif(n.recipient_role,'') as recipient_role,
  nullif(n.branch,'') as branch,
  coalesce(nullif(n.notification_type,''), nullif(n.type,''), 'system') as type,
  coalesce(nullif(n.title,''), 'إشعار') as title,
  coalesce(nullif(n.message,''), nullif(n.body,''), nullif(n.description,''), '') as message,
  coalesce(nullif(n.priority,''), 'normal') as priority,
  case
    when coalesce(n.is_read, n.read, false) then 'read'
    when lower(coalesce(nullif(n.status,''),'new')) in ('unread','new') then 'new'
    when lower(coalesce(nullif(n.status,''),'new')) in ('in_progress','completed','dismissed','escalated') then lower(n.status)
    else 'new'
  end as status,
  coalesce(nullif(n.entity_type,''), nullif(n.target_type,''), nullif(n.related_table,'')) as target_type,
  coalesce(nullif(n.entity_id,''), nullif(n.target_id,''), nullif(n.related_id,'')) as target_id,
  coalesce(nullif(n.action_url,''), nullif(n.target_route,''), nullif(n.route,''), nullif(n.link,'')) as route,
  coalesce(n.is_read, n.read, false) as is_read,
  n.read_at,
  coalesce(n.requires_action, false) as requires_action,
  case
    when lower(coalesce(nullif(n.action_status,''),'new')) in ('in_progress','completed','dismissed','escalated')
      then lower(n.action_status)
    when lower(coalesce(nullif(n.status,''),'new')) in ('in_progress','completed','dismissed','escalated')
      then lower(n.status)
    else 'new'
  end as action_status,
  n.completed_at,
  coalesce(n.metadata, n.details, '{}'::jsonb) as metadata,
  n.dedupe_key,
  n.is_global,
  n.created_by,
  n.created_by_name,
  n.created_at
from public.notifications n;

grant select on public.notification_events_v2 to anon, authenticated, service_role;

create or replace function public.transition_notification_action_with_note_v1(
  p_notification_id uuid,
  p_next_state text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_notification public.notifications%rowtype;
  v_actor_role text;
  v_is_global_manager boolean := false;
  v_is_branch_manager boolean := false;
  v_allowed boolean := false;
  v_now timestamptz := now();
  v_note text := nullif(trim(coalesce(p_note,'')), '');
  v_actor_name text;
begin
  if p_next_state not in ('in_progress','completed','dismissed','escalated') then
    raise exception 'invalid notification action state';
  end if;

  select * into v_actor
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, is_active, true)
    and coalesce(can_login, true);

  if not found then
    raise exception 'active staff actor required';
  end if;

  select * into v_notification
  from public.notifications
  where id = p_notification_id
  for update;

  if not found then return false; end if;

  v_actor_role := lower(trim(coalesce(v_actor.role, v_actor.staff_role, '')));
  v_actor_name := coalesce(
    nullif(trim(v_actor.staff_name),''),
    nullif(trim(v_actor.name),''),
    nullif(trim(v_actor.username),''),
    'مستخدم النظام'
  );
  v_is_global_manager := v_actor_role in ('general_manager','executive_manager','branches_manager');
  v_is_branch_manager := v_actor_role in ('branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening','procurement_manager');

  v_allowed :=
    v_notification.recipient_staff_id = v_actor.staff_id
    or v_is_global_manager
    or (
      v_is_branch_manager
      and nullif(trim(coalesce(v_notification.branch,'')), '') is not null
      and trim(coalesce(v_notification.branch,'')) = trim(coalesce(v_actor.branch,''))
    );

  if not v_allowed then
    raise exception 'notification action not allowed for current actor';
  end if;

  if coalesce(nullif(v_notification.action_status,''),'new') in ('completed','dismissed')
     and p_next_state <> coalesce(nullif(v_notification.action_status,''),'new') then
    raise exception 'terminal notification action cannot be reopened';
  end if;

  update public.notifications
  set action_status = p_next_state,
      requires_action = p_next_state not in ('completed','dismissed'),
      is_read = true,
      read = true,
      read_at = coalesce(read_at, v_now),
      status = case when p_next_state='in_progress' then 'read' else p_next_state end,
      completed_at = case when p_next_state='completed' then v_now else completed_at end,
      priority = case when p_next_state='escalated' then 'urgent' else priority end,
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'actionState', p_next_state,
        'actionStateUpdatedAt', v_now,
        'actionByStaffId', v_actor.staff_id,
        'actionByStaffAccountId', v_actor.id,
        'actionByName', v_actor_name,
        'actionByRole', coalesce(nullif(trim(v_actor.role),''), nullif(trim(v_actor.staff_role),'')),
        'actionNote', v_note
      ))
  where id = p_notification_id;

  insert into public.notification_action_events (
    notification_id,
    action_state,
    note,
    actor_staff_account_id,
    actor_staff_id,
    actor_name,
    actor_role,
    actor_branch,
    notification_type,
    notification_branch,
    created_at
  ) values (
    p_notification_id,
    p_next_state,
    v_note,
    v_actor.id,
    v_actor.staff_id,
    v_actor_name,
    coalesce(nullif(trim(v_actor.role),''), nullif(trim(v_actor.staff_role),'')),
    v_actor.branch,
    coalesce(nullif(v_notification.notification_type,''), nullif(v_notification.type,''), 'system'),
    v_notification.branch,
    v_now
  );

  return true;
end;
$$;

revoke all on function public.transition_notification_action_with_note_v1(uuid,text,text) from public;
grant execute on function public.transition_notification_action_with_note_v1(uuid,text,text) to anon, authenticated, service_role;
