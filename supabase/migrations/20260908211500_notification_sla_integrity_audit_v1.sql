-- Read-only integrity audit for the SLA escalation chain.
-- A generated escalation must be a reference to exactly one original notification,
-- must not create a second workflow item, and should be linked to its SLA event.

create or replace view public.notification_sla_integrity_audit_v1
with (security_invoker = true)
as
select
  n.id as escalation_notification_id,
  nullif(n.metadata->>'sourceNotificationId','') as source_notification_id,
  src.id as resolved_source_notification_id,
  e.id as sla_event_id,
  e.breach_stage,
  n.branch,
  n.priority,
  n.created_at,
  coalesce(n.requires_action,false) as escalation_requires_action,
  case
    when nullif(n.metadata->>'sourceNotificationId','') is null then 'missing_source_id'
    when src.id is null then 'orphan_source'
    when coalesce(n.requires_action,false) then 'duplicate_workflow'
    when e.id is null then 'missing_sla_event_link'
    else 'valid'
  end as integrity_state
from public.notifications n
left join public.notifications src
  on src.id::text = nullif(n.metadata->>'sourceNotificationId','')
left join public.notification_sla_events e
  on e.escalation_notification_id = n.id
where lower(coalesce(n.metadata->>'slaGenerated','false')) = 'true';

grant select on public.notification_sla_integrity_audit_v1 to authenticated;

create or replace function public.notification_sla_integrity_health_v1()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'checkedAt', now(),
    'totalEscalations', count(*),
    'valid', count(*) filter (where integrity_state='valid'),
    'invalid', count(*) filter (where integrity_state<>'valid'),
    'missingSourceId', count(*) filter (where integrity_state='missing_source_id'),
    'orphanSource', count(*) filter (where integrity_state='orphan_source'),
    'duplicateWorkflow', count(*) filter (where integrity_state='duplicate_workflow'),
    'missingSlaEventLink', count(*) filter (where integrity_state='missing_sla_event_link')
  )
  from public.notification_sla_integrity_audit_v1;
$$;

revoke all on function public.notification_sla_integrity_health_v1() from public, anon;
grant execute on function public.notification_sla_integrity_health_v1() to authenticated, service_role;
