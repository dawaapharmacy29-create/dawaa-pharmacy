create or replace function public.emit_system_notification_v2(
  p_recipient_staff_id text default null,
  p_recipient_role text default null,
  p_branch text default null,
  p_notification_type text default 'system',
  p_title text default 'إشعار جديد',
  p_message text default '',
  p_entity_type text default null,
  p_entity_id text default null,
  p_action_url text default null,
  p_priority text default 'normal',
  p_metadata jsonb default '{}'::jsonb,
  p_dedupe_key text default null,
  p_requires_action boolean default false,
  p_sound_enabled boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
  v_type text := lower(trim(coalesce(p_notification_type,'system')));
  v_priority text := lower(trim(coalesce(p_priority,'normal')));
  v_route text := nullif(trim(coalesce(p_action_url,'')),'');
  v_key text := nullif(trim(coalesce(p_dedupe_key,'')),'');
  v_metadata jsonb := coalesce(p_metadata,'{}'::jsonb);
  v_requires_action boolean;
  v_vip_incident boolean := false;
  v_vip_state text;
begin
  v_type := case v_type
    when 'chat_evaluation' then 'conversation_review'
    when 'conversation_sales_review' then 'conversation_review'
    when 'task' then 'staff_task'
    when 'employee_task' then 'staff_task'
    when 'cleaning_task' then 'staff_task'
    when 'branch_manager_task' then 'staff_task'
    when 'staff_task_overdue' then 'staff_task'
    when 'staff_task_completed' then 'staff_task'
    when 'daily_task_reminder' then 'staff_task'
    when 'followup' then 'customer_followup'
    when 'customer_alert' then 'customer_followup'
    when 'customer_service_progress' then 'customer_followup'
    when 'customer_service_incomplete' then 'customer_followup'
    when 'customer_service_queue_incomplete' then 'customer_followup'
    when 'daily_followup_queue_missing' then 'customer_followup'
    when 'delivery' then 'delivery_order'
    when 'stock_alert' then 'inventory'
    when 'low_stock' then 'inventory'
    when 'stagnant_item' then 'inventory'
    when 'penalty' then 'deduction'
    when 'vip_customer_health' then 'vip_customer_silence'
    when 'vip_customer_health_digest' then 'vip_customer_silence'
    when 'daily_customer_attention_digest' then 'vip_customer_silence'
    when 'branch_manager_operational_digest' then 'manager_alert'
    when 'branch_manager_checklist_gap' then 'manager_alert'
    when 'monthly_evaluation_ready' then 'manager_alert'
    when 'weekly_evaluation_submitted' then 'manager_alert'
    when 'reminder' then 'manager_alert'
    when 'sync_health' then 'system'
    when 'sync_health_alert' then 'system'
    when 'system_alert' then 'system'
    else v_type
  end;

  if v_type not in (
    'conversation_review','staff_task','customer_followup','customer_request','reward','deduction',
    'payroll','attendance','sales_target','inventory','expiry_alert','delivery_order','shift_issue',
    'manager_alert','vip_customer_silence','customer_data_review','welcome_task','system'
  ) then
    v_type := 'system';
  end if;

  if v_priority not in ('low','normal','high','urgent','critical') then
    v_priority := 'normal';
  end if;

  v_requires_action := case
    when lower(coalesce(v_metadata->>'slaGenerated','false')) = 'true' then false
    else coalesce(p_requires_action,false)
  end;

  v_vip_incident := coalesce(v_key,'') like 'vip-health-alert:%'
    and lower(trim(coalesce(p_entity_type,''))) = 'vip_customer'
    and nullif(trim(coalesce(p_entity_id,'')),'') is not null;

  if v_vip_incident then
    v_vip_state := case
      when lower(coalesce(v_metadata->>'stateAr','')) like '%متوقف%'
        or lower(coalesce(p_title,'')) like '%توقف%'
        or coalesce(nullif(v_metadata->>'currentSales','')::numeric, 1) = 0
      then 'stopped'
      else 'decline'
    end;
    v_key := 'vip-health-alert:' || coalesce(nullif(trim(coalesce(p_branch,'')),''),'all') || ':' || trim(p_entity_id) || ':' || v_vip_state;
    v_metadata := v_metadata || jsonb_build_object(
      'incidentState','open',
      'vipHealthState',v_vip_state,
      'lastObservedAt',now(),
      'signalReason','vip_customer_health_incident'
    );

    update public.notifications n
    set archived_at = coalesce(n.archived_at, now()),
        metadata = coalesce(n.metadata,'{}'::jsonb) || jsonb_build_object('supersededByVipState',v_vip_state,'supersededAt',now())
    where n.archived_at is null
      and n.recipient_staff_id is not distinct from nullif(trim(coalesce(p_recipient_staff_id,'')),'')
      and n.entity_type = 'vip_customer'
      and n.entity_id = trim(p_entity_id)
      and coalesce(n.dedupe_key,'') like 'vip-health-alert:%'
      and coalesce(n.dedupe_key,'') <> v_key;
  end if;

  insert into public.notifications(
    recipient_staff_id, recipient_role, branch,
    notification_type, type, title, message, body,
    entity_type, entity_id, target_type, target_id,
    action_url, target_route, route, priority,
    metadata, dedupe_key, is_global, is_read, read, status,
    requires_action, action_status, sound_enabled, created_at
  ) values (
    nullif(trim(coalesce(p_recipient_staff_id,'')),''),
    nullif(trim(coalesce(p_recipient_role,'')),''),
    nullif(trim(coalesce(p_branch,'')),''),
    v_type, v_type,
    coalesce(nullif(trim(coalesce(p_title,'')),''),'إشعار جديد'),
    coalesce(p_message,''), coalesce(p_message,''),
    nullif(trim(coalesce(p_entity_type,'')),''), nullif(trim(coalesce(p_entity_id,'')),''),
    nullif(trim(coalesce(p_entity_type,'')),''), nullif(trim(coalesce(p_entity_id,'')),''),
    v_route, v_route, v_route, v_priority,
    v_metadata || jsonb_build_object('producerBoundary','emit_system_notification_v2'),
    v_key, false, false, false, 'new', v_requires_action, 'new', p_sound_enabled, now()
  )
  on conflict (dedupe_key) where dedupe_key is not null
  do update set
    recipient_staff_id = excluded.recipient_staff_id,
    recipient_role = excluded.recipient_role,
    branch = excluded.branch,
    notification_type = excluded.notification_type,
    type = excluded.type,
    title = excluded.title,
    message = excluded.message,
    body = excluded.body,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    target_type = excluded.target_type,
    target_id = excluded.target_id,
    action_url = excluded.action_url,
    target_route = excluded.target_route,
    route = excluded.route,
    priority = excluded.priority,
    metadata = case
      when v_vip_incident then coalesce(notifications.metadata,'{}'::jsonb) || excluded.metadata
      else excluded.metadata
    end,
    requires_action = excluded.requires_action,
    sound_enabled = excluded.sound_enabled,
    is_read = case
      when v_vip_incident and not (
        (excluded.priority = 'critical' and coalesce(notifications.priority,'') <> 'critical')
        or (excluded.priority = 'urgent' and coalesce(notifications.priority,'') not in ('urgent','critical'))
        or notifications.created_at <= now() - interval '3 days'
      ) then notifications.is_read
      else false
    end,
    read = case
      when v_vip_incident and not (
        (excluded.priority = 'critical' and coalesce(notifications.priority,'') <> 'critical')
        or (excluded.priority = 'urgent' and coalesce(notifications.priority,'') not in ('urgent','critical'))
        or notifications.created_at <= now() - interval '3 days'
      ) then notifications.read
      else false
    end,
    status = case
      when v_vip_incident and not (
        (excluded.priority = 'critical' and coalesce(notifications.priority,'') <> 'critical')
        or (excluded.priority = 'urgent' and coalesce(notifications.priority,'') not in ('urgent','critical'))
        or notifications.created_at <= now() - interval '3 days'
      ) then notifications.status
      else 'new'
    end,
    action_status = case
      when v_vip_incident and not (
        (excluded.priority = 'critical' and coalesce(notifications.priority,'') <> 'critical')
        or (excluded.priority = 'urgent' and coalesce(notifications.priority,'') not in ('urgent','critical'))
        or notifications.created_at <= now() - interval '3 days'
      ) then notifications.action_status
      else 'new'
    end,
    read_at = case
      when v_vip_incident and not (
        (excluded.priority = 'critical' and coalesce(notifications.priority,'') <> 'critical')
        or (excluded.priority = 'urgent' and coalesce(notifications.priority,'') not in ('urgent','critical'))
        or notifications.created_at <= now() - interval '3 days'
      ) then notifications.read_at
      else null
    end,
    completed_at = case
      when v_vip_incident and not (
        (excluded.priority = 'critical' and coalesce(notifications.priority,'') <> 'critical')
        or (excluded.priority = 'urgent' and coalesce(notifications.priority,'') not in ('urgent','critical'))
        or notifications.created_at <= now() - interval '3 days'
      ) then notifications.completed_at
      else null
    end,
    created_at = case
      when v_vip_incident and not (
        (excluded.priority = 'critical' and coalesce(notifications.priority,'') <> 'critical')
        or (excluded.priority = 'urgent' and coalesce(notifications.priority,'') not in ('urgent','critical'))
        or notifications.created_at <= now() - interval '3 days'
      ) then notifications.created_at
      else now()
    end
  returning id into v_id;

  return v_id;
end;
$$;

with ranked as (
  select id,
         row_number() over (
           partition by recipient_staff_id, entity_id,
             case when lower(coalesce(metadata->>'stateAr','')) like '%متوقف%' or lower(coalesce(title,'')) like '%توقف%' then 'stopped' else 'decline' end
           order by created_at desc, id desc
         ) as rn
  from public.notifications
  where archived_at is null
    and entity_type = 'vip_customer'
    and coalesce(dedupe_key,'') like 'vip-health-alert:%'
)
update public.notifications n
set archived_at = now(),
    metadata = coalesce(n.metadata,'{}'::jsonb) || jsonb_build_object('archivedReason','vip_daily_duplicate_compaction','archivedAt',now())
from ranked r
where n.id = r.id and r.rn > 1;
