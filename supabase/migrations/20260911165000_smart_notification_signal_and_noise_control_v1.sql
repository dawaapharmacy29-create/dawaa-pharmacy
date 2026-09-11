-- Smart notification signal layer: keep raw audit rows, but make the admin read model signal-first.

create or replace function public.notification_presentation_priority_v1(
  p_type text,
  p_priority text,
  p_title text,
  p_message text,
  p_target_type text,
  p_metadata jsonb default '{}'::jsonb
) returns text
language plpgsql
immutable
set search_path=public,pg_catalog
as $$
declare
  v_priority text := lower(trim(coalesce(p_priority,'normal')));
  v_text text := lower(coalesce(p_title,'') || ' ' || coalesce(p_message,''));
  v_meta jsonb := coalesce(p_metadata,'{}'::jsonb);
  v_sla boolean := lower(coalesce(v_meta->>'slaGenerated','false'))='true';
  v_stage text := lower(coalesce(v_meta->>'slaStage',''));
  v_original_priority text := lower(coalesce(v_meta->>'originalPriority','normal'));
  v_is_digest boolean := lower(coalesce(v_meta->>'isDigest','false'))='true'
    or lower(coalesce(p_target_type,'')) in ('daily_customer_attention','vip_customer_health','vip_customer_digest','branch_operational_digest')
    or v_text like '%تقرير حركة عملاء vip%'
    or v_text like '%ملخص تشغيل الفرع%';
  v_recovery boolean := v_text like '%تمت استعادة مزامنة%'
    or v_text like '%عادت مزامنة%الحالة الطبيعية%'
    or v_text like '%تمت استعادة الاتصال%';
begin
  if v_sla then
    if v_stage='resolution' and v_original_priority in ('urgent','critical') then return 'urgent'; end if;
    return 'normal';
  end if;
  if v_recovery then return 'low'; end if;
  if v_is_digest then return 'normal'; end if;
  if v_priority not in ('low','normal','high','urgent','critical') then return 'normal'; end if;
  return v_priority;
end;
$$;

create or replace function public.notification_signal_metadata_v1(
  p_type text,
  p_priority text,
  p_title text,
  p_message text,
  p_target_type text,
  p_requires_action boolean,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
immutable
set search_path=public,pg_catalog
as $$
declare
  v_type text := public.canonical_notification_type_v2(coalesce(p_type,'system'));
  v_meta jsonb := coalesce(p_metadata,'{}'::jsonb);
  v_priority text := public.notification_presentation_priority_v1(p_type,p_priority,p_title,p_message,p_target_type,v_meta);
  v_text text := lower(coalesce(p_title,'') || ' ' || coalesce(p_message,''));
  v_original_type text := public.canonical_notification_type_v2(coalesce(v_meta->>'originalType',p_type,'system'));
  v_sla boolean := lower(coalesce(v_meta->>'slaGenerated','false'))='true';
  v_stage text := lower(coalesce(v_meta->>'slaStage',''));
  v_is_digest boolean := lower(coalesce(v_meta->>'isDigest','false'))='true'
    or lower(coalesce(p_target_type,'')) in ('daily_customer_attention','vip_customer_health','vip_customer_digest','branch_operational_digest')
    or v_text like '%تقرير حركة عملاء vip%'
    or v_text like '%ملخص تشغيل الفرع%';
  v_recovery boolean := v_text like '%تمت استعادة مزامنة%'
    or v_text like '%عادت مزامنة%الحالة الطبيعية%'
    or v_text like '%تمت استعادة الاتصال%';
  v_family text;
  v_tier text;
  v_reason text;
begin
  v_family := case
    when v_sla and v_original_type in ('staff_task') then 'tasks'
    when v_sla and v_original_type in ('customer_followup','customer_request','customer_data_review','welcome_task','vip_customer_silence') then 'customers'
    when v_sla and v_original_type='conversation_review' then 'reviews'
    when v_sla and v_original_type in ('inventory','expiry_alert') then 'inventory'
    when v_sla and v_original_type in ('attendance','shift_issue') then 'hr'
    when v_type='staff_task' then 'tasks'
    when v_type in ('customer_followup','customer_request','customer_data_review','welcome_task','vip_customer_silence') then 'customers'
    when v_type='conversation_review' then 'reviews'
    when v_type in ('inventory','expiry_alert') then 'inventory'
    when v_type in ('attendance','shift_issue') then 'hr'
    when v_type in ('reward','deduction','payroll') then 'performance'
    when v_type='sales_target' then 'sales'
    when v_type='manager_alert' then 'management'
    when v_type='system' then 'system'
    else 'other'
  end;

  if v_recovery then
    v_tier := 'info'; v_reason := 'recovery';
  elsif v_is_digest then
    v_tier := 'digest'; v_reason := 'summary';
  elsif v_sla and v_stage='ack' then
    v_tier := 'attention'; v_reason := 'sla_ack';
  elsif v_sla and v_stage='resolution' and lower(coalesce(v_meta->>'originalPriority','normal')) in ('urgent','critical') then
    v_tier := 'critical'; v_reason := 'sla_resolution_critical';
  elsif v_sla and v_stage='resolution' then
    v_tier := 'attention'; v_reason := 'sla_resolution';
  elsif v_priority in ('urgent','critical') then
    v_tier := 'critical'; v_reason := 'priority';
  elsif v_priority='high' and coalesce(p_requires_action,false) then
    v_tier := 'action'; v_reason := 'action_required';
  elsif v_priority='high' then
    v_tier := 'attention'; v_reason := 'high_priority';
  else
    v_tier := 'info'; v_reason := 'informational';
  end if;

  return jsonb_build_object(
    'signalFamily',v_family,
    'signalTier',v_tier,
    'signalReason',v_reason,
    'presentationPriority',v_priority,
    'isDigest',v_is_digest,
    'isRecovery',v_recovery,
    'isSlaReference',v_sla
  );
end;
$$;

create or replace view public.notification_events_v2
with (security_invoker=true)
as
select
  b.id,b.recipient_user_id,b.recipient_staff_id,b.recipient_role,b.branch,b.type,
  case
    when lower(coalesce(b.metadata->>'slaGenerated','false'))='true' and lower(coalesce(b.metadata->>'slaStage',''))='ack'
      then 'تأخر في بدء المتابعة'
    when lower(coalesce(b.metadata->>'slaGenerated','false'))='true' and lower(coalesce(b.metadata->>'slaStage',''))='resolution'
      then 'تأخر في إغلاق التنبيه'
    else b.title
  end as title,
  b.message,
  public.notification_presentation_priority_v1(b.type,b.priority,b.title,b.message,b.target_type,b.metadata) as priority,
  case
    when lower(coalesce(b.action_status,'')) in ('completed','dismissed') then lower(b.action_status)
    when lower(coalesce(b.status,'')) in ('completed','dismissed') then lower(b.status)
    when lower(coalesce(b.title,'')) like 'تمت استعادة مزامنة%' then 'read'
    when coalesce(b.is_read,false) or lower(coalesce(b.status,''))='read' then 'read'
    else 'new'
  end as status,
  b.target_type,b.target_id,
  public.notification_route_v3(b.type,b.target_type,b.target_id,b.route,b.id,b.metadata) as route,
  case
    when lower(coalesce(b.action_status,'')) in ('completed','dismissed') then true
    when lower(coalesce(b.status,'')) in ('completed','dismissed','read') then true
    when lower(coalesce(b.title,'')) like 'تمت استعادة مزامنة%' then true
    else coalesce(b.is_read,false)
  end as is_read,
  b.read_at,
  case
    when lower(coalesce(b.action_status,'')) in ('completed','dismissed') then false
    when lower(coalesce(b.status,'')) in ('completed','dismissed') then false
    when coalesce((b.metadata->>'slaGenerated')::boolean,false) then false
    when lower(coalesce(b.title,'')) like 'تمت استعادة مزامنة%' then false
    else coalesce(b.requires_action,false)
  end as requires_action,
  case
    when lower(coalesce(b.action_status,'')) in ('new','read','in_progress','completed','dismissed','escalated') then lower(b.action_status)
    when lower(coalesce(b.status,'')) in ('in_progress','completed','dismissed','escalated') then lower(b.status)
    when lower(coalesce(b.title,'')) like 'تمت استعادة مزامنة%' then 'read'
    when coalesce(b.is_read,false) then 'read'
    else 'new'
  end as action_status,
  b.completed_at,
  coalesce(b.metadata,'{}'::jsonb)
    || public.notification_signal_metadata_v1(b.type,b.priority,b.title,b.message,b.target_type,b.requires_action,b.metadata)
    || jsonb_build_object(
      'appScope','admin',
      'canonicalType',public.canonical_notification_type_v2(b.type),
      'rawPriority',b.priority,
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
  )
  and not (
    lower(coalesce(b.metadata->>'slaGenerated','false'))='true'
    and lower(coalesce(b.metadata->>'slaStage',''))='ack'
    and exists (
      select 1 from public.notifications nx
      where nx.archived_at is null
        and lower(coalesce(nx.metadata->>'slaGenerated','false'))='true'
        and lower(coalesce(nx.metadata->>'slaStage',''))='resolution'
        and coalesce(nx.metadata->>'sourceNotificationId','')=coalesce(b.metadata->>'sourceNotificationId','')
    )
  )
  and not (
    lower(coalesce(b.target_type,''))='vip_customer'
    and exists (
      select 1 from public.notifications nx
      where nx.archived_at is null
        and nx.created_at>b.created_at
        and lower(coalesce(nx.target_type,nx.entity_type,''))='vip_customer'
        and coalesce(nx.target_id,nx.entity_id,'')=coalesce(b.target_id,'')
        and coalesce(nx.title,'')=coalesce(b.title,'')
        and coalesce(nx.branch,'')=coalesce(b.branch,'')
        and coalesce(nx.recipient_staff_id,nx.staff_id,nx.recipient_role,'')=coalesce(b.recipient_staff_id,b.recipient_role,'')
    )
  )
  and not (
    (lower(coalesce(b.title,'')) like 'تقرير حركة عملاء vip%'
      or lower(coalesce(b.title,'')) like 'ملخص تشغيل الفرع%')
    and exists (
      select 1 from public.notifications nx
      where nx.archived_at is null
        and nx.created_at>b.created_at
        and coalesce(nx.title,'')=coalesce(b.title,'')
        and coalesce(nx.branch,'')=coalesce(b.branch,'')
        and coalesce(nx.recipient_staff_id,nx.staff_id,nx.recipient_role,'')=coalesce(b.recipient_staff_id,b.recipient_role,'')
    )
  );

grant select on public.notification_events_v2 to anon,authenticated,service_role;
notify pgrst,'reload schema';