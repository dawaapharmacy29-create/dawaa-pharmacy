-- Put SLA state inside canonical notification metadata so every UI consumer receives it
-- through the existing notification contract; no second client-side SLA reader is needed.

create or replace view public.notification_events_v2
with (security_invoker = true)
as
select
  n.id,
  coalesce(nullif(n.recipient_user_id,''),n.user_id::text) as recipient_user_id,
  coalesce(nullif(n.recipient_staff_id,''),nullif(n.staff_id,'')) as recipient_staff_id,
  nullif(n.recipient_role,'') as recipient_role,
  nullif(n.branch,'') as branch,
  coalesce(nullif(n.notification_type,''),nullif(n.type,''),'system') as type,
  coalesce(nullif(n.title,''),'إشعار') as title,
  coalesce(nullif(n.message,''),nullif(n.body,''),nullif(n.description,''),'') as message,
  coalesce(nullif(n.priority,''),'normal') as priority,
  case
    when coalesce(nullif(n.status,''),'') in ('unread','') then
      case when coalesce(n.is_read,n.read,false) then 'read' else 'new' end
    else coalesce(nullif(n.status,''),case when coalesce(n.is_read,n.read,false) then 'read' else 'new' end)
  end as status,
  coalesce(nullif(n.entity_type,''),nullif(n.target_type,''),nullif(n.related_table,'')) as target_type,
  coalesce(nullif(n.entity_id,''),nullif(n.target_id,''),nullif(n.related_id,'')) as target_id,
  coalesce(nullif(n.action_url,''),nullif(n.target_route,''),nullif(n.route,''),nullif(n.link,'')) as route,
  coalesce(n.is_read,n.read,false) as is_read,
  n.read_at,
  coalesce(n.requires_action,false) as requires_action,
  coalesce(nullif(n.action_status,''),case when n.status in ('completed','dismissed','escalated','in_progress') then n.status else 'new' end) as action_status,
  n.completed_at,
  public.normalize_notification_metadata_v2(
    coalesce(nullif(n.notification_type,''),nullif(n.type,''),'system'),
    coalesce(n.metadata,n.details,'{}'::jsonb),
    coalesce(nullif(n.action_url,''),nullif(n.target_route,''),nullif(n.route,''),nullif(n.link,'')),
    n.branch,
    coalesce(nullif(n.recipient_staff_id,''),nullif(n.staff_id,''))
  ) || jsonb_strip_nulls(jsonb_build_object(
    'slaPolicyKey',sla.policy_key,
    'slaAckDeadlineAt',case when sla.policy_key is not null then n.created_at + make_interval(mins=>sla.ack_minutes) end,
    'slaResolutionDeadlineAt',case when sla.policy_key is not null then n.created_at + make_interval(mins=>sla.resolve_minutes) end,
    'slaAckBreached',coalesce(sla_events.ack_breached,false),
    'slaResolutionBreached',coalesce(sla_events.resolution_breached,false),
    'slaBreachStage',case when coalesce(sla_events.resolution_breached,false) then 'resolution' when coalesce(sla_events.ack_breached,false) then 'ack' else null end,
    'slaBreachedAt',greatest(sla_events.ack_detected_at,sla_events.resolution_detected_at)
  )) as metadata,
  n.dedupe_key,
  n.is_global,
  n.created_by,
  n.created_by_name,
  n.created_at,
  sla.policy_key as sla_policy_key,
  case when sla.policy_key is not null then n.created_at + make_interval(mins=>sla.ack_minutes) end as sla_ack_deadline_at,
  case when sla.policy_key is not null then n.created_at + make_interval(mins=>sla.resolve_minutes) end as sla_resolution_deadline_at,
  coalesce(sla_events.ack_breached,false) as sla_ack_breached,
  coalesce(sla_events.resolution_breached,false) as sla_resolution_breached,
  case when coalesce(sla_events.resolution_breached,false) then 'resolution' when coalesce(sla_events.ack_breached,false) then 'ack' else null end as sla_breach_stage,
  greatest(sla_events.ack_detected_at,sla_events.resolution_detected_at) as sla_breached_at
from public.notifications n
left join lateral (
  select p.policy_key,p.ack_minutes,p.resolve_minutes
  from public.notification_sla_policies p
  where p.enabled=true
    and coalesce(n.requires_action,false)=true
    and coalesce(n.metadata->>'schemaVersion','')='2'
    and coalesce(n.metadata->>'slaGenerated','false') <> 'true'
    and (p.canonical_type is null or p.canonical_type=public.canonical_notification_type_v2(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'system')))
    and (p.match_priority is null or p.match_priority=lower(coalesce(n.priority,'normal')))
  order by ((p.canonical_type is not null)::int + (p.match_priority is not null)::int) desc,p.precedence desc,p.policy_key
  limit 1
) sla on true
left join lateral (
  select
    bool_or(e.breach_stage='ack') as ack_breached,
    bool_or(e.breach_stage='resolution') as resolution_breached,
    max(e.detected_at) filter (where e.breach_stage='ack') as ack_detected_at,
    max(e.detected_at) filter (where e.breach_stage='resolution') as resolution_detected_at
  from public.notification_sla_events e
  where e.notification_id=n.id
) sla_events on true;

grant select on public.notification_events_v2 to authenticated;
