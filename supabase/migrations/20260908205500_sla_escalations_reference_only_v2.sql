-- SLA escalation notifications point to the original actionable notification.
-- They must never create a second workflow/action queue item.

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
    when 'followup' then 'customer_followup'
    when 'customer_alert' then 'customer_followup'
    when 'customer_service_progress' then 'customer_followup'
    when 'customer_service_incomplete' then 'customer_followup'
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

  -- SLA-generated notifications are references to one original workflow item.
  -- Never let them become a second actionable notification, regardless of caller input.
  v_requires_action := case
    when lower(coalesce(v_metadata->>'slaGenerated','false')) = 'true' then false
    else coalesce(p_requires_action,false)
  end;

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
    metadata = excluded.metadata,
    requires_action = excluded.requires_action,
    sound_enabled = excluded.sound_enabled,
    is_read = false,
    read = false,
    status = 'new',
    action_status = 'new',
    read_at = null,
    completed_at = null,
    created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;
