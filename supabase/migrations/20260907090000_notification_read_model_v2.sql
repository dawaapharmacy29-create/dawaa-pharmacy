-- Canonical notification read model.
-- Keeps the legacy storage table compatible while exposing one stable shape to the app.

create or replace view public.notification_events_v2
with (security_invoker = true)
as
select
  n.id,
  coalesce(nullif(n.recipient_user_id, ''), n.user_id::text) as recipient_user_id,
  coalesce(nullif(n.recipient_staff_id, ''), nullif(n.staff_id, '')) as recipient_staff_id,
  nullif(n.recipient_role, '') as recipient_role,
  nullif(n.branch, '') as branch,
  coalesce(nullif(n.notification_type, ''), nullif(n.type, ''), 'system') as type,
  coalesce(nullif(n.title, ''), 'إشعار') as title,
  coalesce(nullif(n.message, ''), nullif(n.body, ''), nullif(n.description, ''), '') as message,
  coalesce(nullif(n.priority, ''), 'normal') as priority,
  coalesce(nullif(n.status, ''), case when coalesce(n.is_read, n.read, false) then 'read' else 'new' end) as status,
  coalesce(nullif(n.entity_type, ''), nullif(n.target_type, ''), nullif(n.related_table, '')) as target_type,
  coalesce(nullif(n.entity_id, ''), nullif(n.target_id, ''), nullif(n.related_id, '')) as target_id,
  coalesce(nullif(n.action_url, ''), nullif(n.target_route, ''), nullif(n.route, ''), nullif(n.link, '')) as route,
  coalesce(n.is_read, n.read, false) as is_read,
  n.read_at,
  coalesce(n.requires_action, false) as requires_action,
  coalesce(nullif(n.action_status, ''), case when n.status in ('completed','dismissed','escalated','in_progress') then n.status else 'new' end) as action_status,
  n.completed_at,
  coalesce(n.metadata, n.details, '{}'::jsonb) as metadata,
  n.dedupe_key,
  n.is_global,
  n.created_by,
  n.created_by_name,
  n.created_at
from public.notifications n;

revoke all on public.notification_events_v2 from public;
grant select on public.notification_events_v2 to anon, authenticated, service_role;

comment on view public.notification_events_v2 is
  'Canonical read-only notification projection. All writes must continue through notification command RPCs.';
