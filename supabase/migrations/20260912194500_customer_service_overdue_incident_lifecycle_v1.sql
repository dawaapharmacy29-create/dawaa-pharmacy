create or replace function public.upsert_customer_service_overdue_incident_v1(
  p_recipient_role text,
  p_branch text default null,
  p_count integer default 0,
  p_max_minutes_late integer default 0,
  p_action_url text default '/customer-service?status=%D9%85%D8%AA%D8%A3%D8%AE%D8%B1%D8%A9&filter=overdue'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor_id text := public.dawaa_current_notification_account_id_v1();
  v_role text := lower(trim(coalesce(p_recipient_role,'')));
  v_branch text := nullif(trim(coalesce(p_branch,'')),'');
  v_scope text;
  v_base_key text;
  v_title text := 'تأخر متابعات خدمة العملاء';
  v_message text;
  v_priority text;
  v_existing_count integer := 0;
  v_previous_count integer := 0;
  v_previous_max integer := 0;
  v_previous_priority text := 'normal';
  v_should_resurface boolean := false;
  v_id uuid;
  v_updated integer := 0;
begin
  if v_actor_id is null then
    raise exception 'active staff actor required';
  end if;

  if v_role not in ('general_manager','executive_manager','branches_manager','customer_service_manager','branch_manager') then
    raise exception 'unsupported notification audience role';
  end if;

  v_scope := case when v_branch is null then 'all' else lower(v_branch) end;
  v_base_key := 'cs-overdue-incident:' || v_role || ':' || md5(v_scope);
  v_priority := case
    when greatest(coalesce(p_max_minutes_late,0),0) >= 120 then 'critical'
    when greatest(coalesce(p_max_minutes_late,0),0) >= 60 then 'urgent'
    else 'high'
  end;

  select
    count(*)::integer,
    coalesce(max(nullif(n.metadata->>'count','')::integer),0),
    coalesce(max(nullif(n.metadata->>'max_minutes_late','')::integer),0),
    coalesce(max(n.priority) filter (where n.priority in ('critical','urgent','high','normal','low')),'normal')
  into v_existing_count, v_previous_count, v_previous_max, v_previous_priority
  from public.notifications n
  where n.archived_at is null
    and n.dedupe_key like v_base_key || ':%';

  if greatest(coalesce(p_count,0),0) <= 0 then
    update public.notifications n
    set
      metadata = coalesce(n.metadata,'{}'::jsonb) || jsonb_build_object(
        'incidentState','resolved',
        'resolvedAt',now(),
        'count',0,
        'max_minutes_late',0
      ),
      requires_action = false,
      is_read = true,
      read = true,
      status = case when coalesce(n.status,'new') in ('completed','dismissed') then n.status else 'completed' end,
      action_status = case when coalesce(n.action_status,'new') in ('completed','dismissed') then n.action_status else 'completed' end,
      completed_at = coalesce(n.completed_at,now())
    where n.archived_at is null
      and n.dedupe_key like v_base_key || ':%'
      and coalesce(n.status,'new') not in ('completed','dismissed');
    get diagnostics v_updated = row_count;
    return jsonb_build_object('state','resolved','updated',v_updated,'dedupeBase',v_base_key);
  end if;

  v_message := 'يوجد ' || greatest(p_count,0) || ' متابعة متأخرة'
    || case when v_branch is not null then ' في ' || v_branch else '' end
    || '. أطول تأخير ' || greatest(p_max_minutes_late,0) || ' دقيقة.';

  if v_existing_count = 0 then
    v_id := public.create_notification_audience_v1(
      p_recipient_staff_id => null,
      p_recipient_role => v_role,
      p_branch => v_branch,
      p_notification_type => 'customer_followup',
      p_title => v_title,
      p_message => v_message,
      p_entity_type => 'customer_service_followup_overdue',
      p_entity_id => 'overdue:' || v_scope,
      p_action_url => nullif(trim(coalesce(p_action_url,'')),''),
      p_priority => v_priority,
      p_metadata => jsonb_build_object(
        'source','global_customer_service_alert_ticker',
        'incidentState','open',
        'count',greatest(p_count,0),
        'max_minutes_late',greatest(p_max_minutes_late,0),
        'requiresFollowup',true,
        'signalTier',case when v_priority in ('critical','urgent') then 'critical' else 'action' end,
        'signalReason','customer_service_overdue'
      ),
      p_dedupe_key => v_base_key
    );
    return jsonb_build_object('state','created','id',v_id,'dedupeBase',v_base_key);
  end if;

  v_should_resurface :=
    (v_priority = 'critical' and v_previous_priority <> 'critical')
    or (v_priority = 'urgent' and v_previous_priority not in ('urgent','critical'))
    or greatest(p_count,0) >= v_previous_count + 5
    or greatest(p_max_minutes_late,0) >= v_previous_max + 60;

  update public.notifications n
  set
    title = v_title,
    message = v_message,
    body = v_message,
    priority = v_priority,
    entity_type = 'customer_service_followup_overdue',
    entity_id = 'overdue:' || v_scope,
    target_type = 'customer_service_followup_overdue',
    target_id = 'overdue:' || v_scope,
    action_url = nullif(trim(coalesce(p_action_url,'')),''),
    target_route = nullif(trim(coalesce(p_action_url,'')),''),
    route = nullif(trim(coalesce(p_action_url,'')),''),
    metadata = coalesce(n.metadata,'{}'::jsonb) || jsonb_build_object(
      'source','global_customer_service_alert_ticker',
      'incidentState','open',
      'count',greatest(p_count,0),
      'max_minutes_late',greatest(p_max_minutes_late,0),
      'requiresFollowup',true,
      'lastObservedAt',now(),
      'signalTier',case when v_priority in ('critical','urgent') then 'critical' else 'action' end,
      'signalReason','customer_service_overdue'
    ),
    requires_action = true,
    is_read = case when v_should_resurface and coalesce(n.status,'new') not in ('completed','dismissed') then false else n.is_read end,
    read = case when v_should_resurface and coalesce(n.status,'new') not in ('completed','dismissed') then false else n.read end,
    status = case when v_should_resurface and coalesce(n.status,'new') not in ('completed','dismissed') then 'new' else n.status end,
    action_status = case when v_should_resurface and coalesce(n.action_status,'new') not in ('completed','dismissed') then 'new' else n.action_status end,
    read_at = case when v_should_resurface and coalesce(n.status,'new') not in ('completed','dismissed') then null else n.read_at end,
    created_at = case when v_should_resurface and coalesce(n.status,'new') not in ('completed','dismissed') then now() else n.created_at end
  where n.archived_at is null
    and n.dedupe_key like v_base_key || ':%';
  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'state',case when v_should_resurface then 'escalated' else 'updated' end,
    'updated',v_updated,
    'dedupeBase',v_base_key,
    'resurfaced',v_should_resurface
  );
end;
$$;

revoke all on function public.upsert_customer_service_overdue_incident_v1(text,text,integer,integer,text) from public;
grant execute on function public.upsert_customer_service_overdue_incident_v1(text,text,integer,integer,text) to anon, authenticated;
