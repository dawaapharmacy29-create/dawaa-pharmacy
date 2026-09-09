-- Notification Architecture V2: one database-side command boundary for system/cron/trigger producers.
-- Browser initiated notifications continue through create_notification_audience_v1.

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
) returns uuid
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
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('producerBoundary','emit_system_notification_v2'),
    v_key, false, false, false, 'new', p_requires_action, 'new', p_sound_enabled, now()
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

revoke all on function public.emit_system_notification_v2(text,text,text,text,text,text,text,text,text,text,jsonb,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.emit_system_notification_v2(text,text,text,text,text,text,text,text,text,text,jsonb,text,boolean,boolean) to service_role;

create or replace function public.dawaa_insert_task_notification_v1(
  p_task_id text,
  p_recipient_staff_id text,
  p_branch text,
  p_title text,
  p_message text,
  p_route text,
  p_priority text,
  p_state text,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_key text;
begin
  if nullif(trim(p_task_id),'') is null then return null; end if;
  v_key := format('staff-task:%s:%s', lower(trim(p_task_id)), lower(trim(coalesce(p_state,'current'))));
  return public.emit_system_notification_v2(
    p_recipient_staff_id => p_recipient_staff_id,
    p_branch => p_branch,
    p_notification_type => 'staff_task',
    p_title => p_title,
    p_message => p_message,
    p_entity_type => 'staff_task',
    p_entity_id => p_task_id,
    p_action_url => p_route,
    p_priority => p_priority,
    p_metadata => coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('taskState',p_state),
    p_dedupe_key => v_key,
    p_requires_action => lower(trim(coalesce(p_state,''))) = 'overdue',
    p_sound_enabled => lower(trim(coalesce(p_priority,''))) in ('urgent','critical')
  );
end;
$$;

create or replace function public.notify_missing_weekly_manager_evaluations()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_count integer := 0;
  v_evaluator record;
  v_cycle_start date;
  v_cycle_end date;
  v_expected integer := 0;
  v_submitted integer := 0;
  v_id uuid;
begin
  if extract(day from current_date) >= 26 then
    v_cycle_start := make_date(extract(year from current_date)::int,extract(month from current_date)::int,26);
  else
    v_cycle_start := (make_date(extract(year from current_date)::int,extract(month from current_date)::int,26) - interval '1 month')::date;
  end if;
  v_cycle_end := (v_cycle_start + interval '1 month - 1 day')::date;
  if current_date < v_cycle_end - 2 then return 0; end if;

  select count(*)::integer into v_expected
  from public.staff s
  join public.staff_accounts a on a.staff_id=s.id::text
  where coalesce(s.active,s.is_active,true)=true
    and coalesce(a.active,false)=true
    and coalesce(a.can_login,false)=true
    and lower(coalesce(a.role,'')) in ('branch_manager','customer_service_manager');

  for v_evaluator in
    select distinct s.id,s.name
    from public.staff s
    join public.staff_accounts a on a.staff_id=s.id::text
    where coalesce(s.active,s.is_active,true)=true
      and coalesce(a.active,false)=true
      and coalesce(a.can_login,false)=true
      and lower(coalesce(a.role,''))='branches_manager'
  loop
    select count(distinct e.subject_staff_id)::integer into v_submitted
    from public.manager_weekly_evaluations e
    where e.evaluator_staff_id=v_evaluator.id
      and e.status='submitted'
      and e.evaluation_type in ('branch_manager','customer_service')
      and e.week_start=v_cycle_start
      and e.week_end=v_cycle_end;

    if v_submitted < v_expected then
      v_id := public.emit_system_notification_v2(
        p_recipient_staff_id => v_evaluator.id::text,
        p_recipient_role => 'branches_manager',
        p_notification_type => 'manager_alert',
        p_title => 'التقييم الشهري للإدارة غير مكتمل',
        p_message => 'متبقي تقييم '||(v_expected-v_submitted)||' من مديري الفروع/خدمة العملاء لدورة '||v_cycle_start||' → '||v_cycle_end||'. التقييم المعتمد هو مصدر حافز الأداء الشهري.',
        p_entity_type => 'manager_monthly_evaluation',
        p_entity_id => v_cycle_start::text,
        p_action_url => '/weekly-evaluation/branch_manager',
        p_priority => 'high',
        p_metadata => jsonb_build_object('cycleStart',v_cycle_start,'cycleEnd',v_cycle_end,'remaining',v_expected-v_submitted),
        p_dedupe_key => 'manager-monthly-evaluation:'||v_evaluator.id::text||':'||v_cycle_start::text,
        p_requires_action => true
      );
      if v_id is not null then v_count := v_count + 1; end if;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Runtime producer audit: any function that inserts directly into notification storage
-- outside the approved command functions is architecture debt.
create or replace view public.notification_producer_audit_v1
with (security_invoker = true)
as
select
  p.proname as function_name,
  case
    when p.proname in ('emit_system_notification_v2','create_notification_audience_v1','create_staff_notification') then 'approved_command'
    else 'direct_writer_debt'
  end as architecture_state
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and (
    pg_get_functiondef(p.oid) ilike '%insert into public.notifications%'
    or pg_get_functiondef(p.oid) ilike '%insert into public.app_notifications%'
  );

revoke all on public.notification_producer_audit_v1 from public, anon;
grant select on public.notification_producer_audit_v1 to authenticated, service_role;
