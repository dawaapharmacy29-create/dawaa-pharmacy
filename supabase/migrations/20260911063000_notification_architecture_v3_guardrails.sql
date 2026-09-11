-- Notification Architecture V3 guardrails
-- Purpose: one producer boundary, one admin-scoped canonical read model,
-- lifecycle/read/action parity, deterministic deep links, and safe duplicate archival.

alter table public.notifications
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

create index if not exists idx_notifications_archived_at
  on public.notifications(archived_at)
  where archived_at is not null;

create or replace function public.notification_requires_action_v3(
  p_notification_type text,
  p_entity_type text default null,
  p_priority text default 'normal',
  p_metadata jsonb default '{}'::jsonb
) returns boolean
language sql
immutable
set search_path=public,pg_catalog
as $$
  select case
    when lower(coalesce(p_metadata->>'slaGenerated','false'))='true' then false
    when lower(coalesce(p_metadata->>'requiresAction','')) in ('true','1','yes') then true
    when lower(coalesce(p_metadata->>'requiresFollowup','')) in ('true','1','yes') then true
    when lower(trim(coalesce(p_entity_type,''))) in ('vip_customer','customer_vip_silence','staff_task','customer_request') then true
    when public.canonical_notification_type_v2(p_notification_type) in ('staff_task','customer_request','customer_data_review','welcome_task') then true
    when public.canonical_notification_type_v2(p_notification_type)='vip_customer_silence'
      and lower(trim(coalesce(p_entity_type,''))) <> 'daily_customer_attention' then true
    else false
  end;
$$;

create or replace function public.create_staff_notification(
  p_recipient_staff_id uuid,
  p_notification_type text,
  p_title text,
  p_message text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_action_url text default null,
  p_priority text default 'normal',
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key text default null,
  p_created_by_staff_id uuid default null,
  p_branch text default null
) returns uuid
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_metadata jsonb := coalesce(p_metadata,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'createdByStaffId',p_created_by_staff_id,
    'legacyBoundaryDelegated',true
  ));
  v_requires_action boolean;
begin
  if p_recipient_staff_id is null then raise exception 'recipient_staff_id is required'; end if;
  v_requires_action := public.notification_requires_action_v3(p_notification_type,p_entity_type,p_priority,v_metadata);
  return public.emit_system_notification_v2(
    p_recipient_staff_id => p_recipient_staff_id::text,
    p_branch => p_branch,
    p_notification_type => p_notification_type,
    p_title => p_title,
    p_message => p_message,
    p_entity_type => p_entity_type,
    p_entity_id => p_entity_id,
    p_action_url => p_action_url,
    p_priority => p_priority,
    p_metadata => v_metadata,
    p_dedupe_key => p_dedupe_key,
    p_requires_action => v_requires_action,
    p_sound_enabled => lower(coalesce(p_priority,'normal')) in ('urgent','critical')
  );
end;
$$;

create or replace function public.create_staff_notification(
  p_recipient_staff_id uuid,
  p_notification_type text,
  p_title text,
  p_message text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_action_url text default null,
  p_priority text default 'normal',
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key text default null,
  p_created_by_staff_id uuid default null
) returns uuid
language sql
security definer
set search_path=public,pg_catalog
as $$
  select public.create_staff_notification(
    p_recipient_staff_id,p_notification_type,p_title,p_message,p_entity_type,p_entity_id,
    p_action_url,p_priority,p_metadata,p_dedupe_key,p_created_by_staff_id,null
  );
$$;

create or replace function public.notification_route_v3(
  p_type text,
  p_target_type text,
  p_target_id text,
  p_existing_route text,
  p_notification_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns text
language plpgsql
immutable
set search_path=public,pg_catalog
as $$
declare
  v_type text := public.canonical_notification_type_v2(coalesce(p_type,'system'));
  v_target_type text := lower(trim(coalesce(p_target_type,'')));
  v_target_id text := nullif(trim(coalesce(p_target_id,'')),'');
  v_route text := nullif(trim(coalesce(p_existing_route,'')),'');
  v_id text := coalesce(p_notification_id::text,'');
  v_source_id text := nullif(trim(coalesce(p_metadata->>'sourceNotificationId','')),'');
begin
  if v_type='conversation_review' and v_target_id is not null then
    return '/reviews?section=history&id=' || v_target_id;
  end if;
  if v_type='customer_followup' and v_target_type='vip_customer' and v_target_id is not null then
    return '/customer-service?quickFollowup=1&code=' || v_target_id;
  end if;
  if v_type='vip_customer_silence' and v_target_id is not null and v_target_type <> 'daily_customer_attention' then
    return '/customer-service?quickFollowup=1&code=' || v_target_id;
  end if;
  if v_type='manager_alert' and v_target_type='notification_sla' then
    return '/operations-center?notificationId=' || coalesce(v_source_id,v_target_id,v_id);
  end if;
  if v_route is not null and v_route not like '/delivery%' then return v_route; end if;
  return case v_type
    when 'staff_task' then '/operations-center?notificationId=' || v_id
    when 'customer_followup' then '/customer-service'
    when 'customer_request' then case when v_target_id is null then '/customer-requests' else '/customer-service?tab=requests&requestId=' || v_target_id end
    when 'customer_data_review' then '/customer-data-review'
    when 'welcome_task' then '/welcome-messages'
    when 'reward' then '/doctor-dashboard?tab=payroll'
    when 'deduction' then '/doctor-dashboard?tab=payroll'
    when 'payroll' then '/doctor-dashboard?tab=payroll'
    when 'attendance' then '/attendance-report'
    when 'sales_target' then '/daily-target'
    when 'inventory' then case when v_target_id is null then '/shortages' else '/shortages?itemId=' || v_target_id end
    when 'expiry_alert' then case when v_target_id is null then '/medicine-expiry' else '/medicine-expiry?itemId=' || v_target_id end
    when 'shift_issue' then case when v_target_id is null then '/shift-notes' else '/shift-notes?shiftId=' || v_target_id end
    when 'vip_customer_silence' then '/customer-service'
    else '/operations-center?notificationId=' || v_id
  end;
end;
$$;

-- Preserve the original SLA-enriched view once on fresh databases.
do $$
begin
  if to_regclass('public.notification_events_v2_base') is null
     and to_regclass('public.notification_events_v2') is not null then
    alter view public.notification_events_v2 rename to notification_events_v2_base;
  end if;
end $$;

create or replace view public.notification_events_v2
with (security_invoker=true)
as
select
  b.id,b.recipient_user_id,b.recipient_staff_id,b.recipient_role,b.branch,b.type,b.title,b.message,b.priority,
  case
    when lower(coalesce(b.action_status,'')) in ('completed','dismissed') then lower(b.action_status)
    when lower(coalesce(b.status,'')) in ('completed','dismissed') then lower(b.status)
    when coalesce(b.is_read,false) or lower(coalesce(b.status,''))='read' then 'read'
    else 'new'
  end as status,
  b.target_type,b.target_id,
  public.notification_route_v3(b.type,b.target_type,b.target_id,b.route,b.id,b.metadata) as route,
  case
    when lower(coalesce(b.action_status,'')) in ('completed','dismissed') then true
    when lower(coalesce(b.status,'')) in ('completed','dismissed','read') then true
    else coalesce(b.is_read,false)
  end as is_read,
  b.read_at,
  case
    when lower(coalesce(b.action_status,'')) in ('completed','dismissed') then false
    when lower(coalesce(b.status,'')) in ('completed','dismissed') then false
    when coalesce((b.metadata->>'slaGenerated')::boolean,false) then false
    else coalesce(b.requires_action,false)
  end as requires_action,
  case
    when lower(coalesce(b.action_status,'')) in ('new','read','in_progress','completed','dismissed','escalated') then lower(b.action_status)
    when lower(coalesce(b.status,'')) in ('in_progress','completed','dismissed','escalated') then lower(b.status)
    when coalesce(b.is_read,false) then 'read'
    else 'new'
  end as action_status,
  b.completed_at,
  coalesce(b.metadata,'{}'::jsonb) || jsonb_build_object(
    'appScope','admin',
    'canonicalType',public.canonical_notification_type_v2(b.type),
    'route',public.notification_route_v3(b.type,b.target_type,b.target_id,b.route,b.id,b.metadata)
  ) as metadata,
  b.dedupe_key,b.is_global,b.created_by,b.created_by_name,b.created_at,
  b.sla_policy_key,b.sla_ack_deadline_at,b.sla_resolution_deadline_at,
  b.sla_ack_breached,b.sla_resolution_breached,b.sla_breach_stage,b.sla_breached_at
from public.notification_events_v2_base b
join public.notifications n on n.id=b.id
where n.archived_at is null
  and not (
    public.canonical_notification_type_v2(b.type)='delivery_order'
    or lower(coalesce(b.type,'')) in ('delivery','delivery_order')
    or coalesce(b.route,'') like '/delivery%'
  );

grant select on public.notification_events_v2 to authenticated,service_role;
revoke all on public.notification_events_v2 from anon;

create or replace view public.notification_events_v3
with (security_invoker=true)
as
select
  b.*,
  public.canonical_notification_type_v2(b.type) as canonical_type,
  case
    when lower(coalesce(b.action_status,'')) in ('completed','dismissed') then lower(b.action_status)
    when lower(coalesce(b.action_status,'')) in ('in_progress','escalated') then lower(b.action_status)
    when coalesce(b.is_read,false) then 'read'
    else 'new'
  end as lifecycle_state,
  not coalesce(b.is_read,false) as unread,
  coalesce(b.requires_action,false) as open_action,
  'admin'::text as app_scope,
  coalesce(nullif(b.dedupe_key,''),concat_ws(':',
    public.canonical_notification_type_v2(b.type),
    coalesce(nullif(b.target_type,''),'entity'),
    coalesce(nullif(b.target_id,''),'none'),
    coalesce(nullif(b.recipient_staff_id,''),nullif(b.recipient_role,''),'audience'),
    to_char(date_trunc('minute',b.created_at),'YYYYMMDDHH24MI')
  )) as event_key
from public.notification_events_v2 b;

grant select on public.notification_events_v3 to authenticated,service_role;
revoke all on public.notification_events_v3 from anon;

create or replace function public.notification_integrity_health_v3()
returns jsonb
language sql stable security definer
set search_path=public,pg_catalog
as $$
  with x as (
    select count(*) total,
      count(*) filter(where app_scope='admin') admin_total,
      count(*) filter(where app_scope='delivery') delivery_total,
      count(*) filter(where unread) unread_total,
      count(*) filter(where open_action) open_action_total,
      count(*) filter(where lifecycle_state in ('completed','dismissed')) terminal_total,
      count(*) filter(where lifecycle_state in ('completed','dismissed') and unread) terminal_unread_invalid,
      count(*) filter(where lifecycle_state in ('completed','dismissed') and open_action) terminal_open_action_invalid
    from public.notification_events_v3
  )
  select jsonb_build_object('checked_at',now(),'total',total,'admin_total',admin_total,
    'delivery_total',delivery_total,'unread_total',unread_total,'open_action_total',open_action_total,
    'terminal_total',terminal_total,'terminal_unread_invalid',terminal_unread_invalid,
    'terminal_open_action_invalid',terminal_open_action_invalid,
    'healthy',(terminal_unread_invalid=0 and terminal_open_action_invalid=0)) from x;
$$;

create or replace function public.notification_route_health_v3()
returns jsonb
language sql stable security definer
set search_path=public,pg_catalog
as $$
  with x as (
    select count(*) total,
      count(*) filter(where route is null or trim(route)='') missing_route,
      count(*) filter(where route like '/delivery%') delivery_route_leaks,
      count(*) filter(where canonical_type='conversation_review' and route not like '/reviews?section=history&id=%') review_route_mismatch,
      count(*) filter(where target_type='vip_customer' and route not like '/customer-service?quickFollowup=1&code=%') vip_route_mismatch
    from public.notification_events_v3
  )
  select jsonb_build_object('checked_at',now(),'total',total,'missing_route',missing_route,
    'delivery_route_leaks',delivery_route_leaks,'review_route_mismatch',review_route_mismatch,
    'vip_route_mismatch',vip_route_mismatch,
    'healthy',(missing_route=0 and delivery_route_leaks=0 and review_route_mismatch=0 and vip_route_mismatch=0)) from x;
$$;

revoke all on function public.notification_integrity_health_v3() from public,anon;
grant execute on function public.notification_integrity_health_v3() to authenticated,service_role;
revoke all on function public.notification_route_health_v3() from public,anon;
grant execute on function public.notification_route_health_v3() to authenticated,service_role;

notify pgrst,'reload schema';
