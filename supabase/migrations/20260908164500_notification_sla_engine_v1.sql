-- Unified SLA governance for actionable v2 notifications.
-- Reuses the existing 15-minute operational notification scheduler; no parallel cron is introduced.

create table if not exists public.notification_sla_policies (
  policy_key text primary key,
  canonical_type text,
  match_priority text,
  ack_minutes integer not null check (ack_minutes > 0),
  resolve_minutes integer not null check (resolve_minutes >= ack_minutes),
  escalation_role text not null,
  escalation_priority text not null default 'urgent' check (escalation_priority in ('low','normal','high','urgent','critical')),
  precedence integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.notification_sla_policies(
  policy_key,canonical_type,match_priority,ack_minutes,resolve_minutes,escalation_role,escalation_priority,precedence,enabled
) values
  ('system_critical','system','critical',15,120,'general_manager','urgent',120,true),
  ('system_urgent','system','urgent',15,120,'general_manager','urgent',115,true),
  ('critical_any',null,'critical',15,120,'general_manager','urgent',110,true),
  ('urgent_any',null,'urgent',30,240,'general_manager','urgent',100,true),
  ('vip_customer','vip_customer_silence',null,60,360,'customer_service_manager','urgent',90,true),
  ('staff_task','staff_task',null,60,360,'branch_manager','high',80,true),
  ('customer_followup','customer_followup',null,120,480,'customer_service_manager','high',70,true),
  ('customer_request','customer_request',null,120,480,'customer_service_manager','high',70,true)
on conflict(policy_key) do update set
  canonical_type=excluded.canonical_type,
  match_priority=excluded.match_priority,
  ack_minutes=excluded.ack_minutes,
  resolve_minutes=excluded.resolve_minutes,
  escalation_role=excluded.escalation_role,
  escalation_priority=excluded.escalation_priority,
  precedence=excluded.precedence,
  enabled=excluded.enabled,
  updated_at=now();

grant select on public.notification_sla_policies to authenticated;
revoke insert,update,delete on public.notification_sla_policies from anon,authenticated;

create table if not exists public.notification_sla_events (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  policy_key text not null references public.notification_sla_policies(policy_key),
  breach_stage text not null check (breach_stage in ('ack','resolution')),
  original_type text,
  canonical_type text not null,
  original_priority text,
  notification_branch text,
  deadline_at timestamptz not null,
  detected_at timestamptz not null default now(),
  escalation_notification_id uuid references public.notifications(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  unique(notification_id,policy_key,breach_stage)
);

create index if not exists notification_sla_events_notification_idx
  on public.notification_sla_events(notification_id,detected_at desc);
create index if not exists notification_sla_events_detected_idx
  on public.notification_sla_events(detected_at desc);

alter table public.notification_sla_events enable row level security;

drop policy if exists notification_sla_events_visible_v1 on public.notification_sla_events;
create policy notification_sla_events_visible_v1
on public.notification_sla_events
for select
to authenticated
using (
  exists (
    select 1
    from public.notifications n
    where n.id=notification_sla_events.notification_id
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

grant select on public.notification_sla_events to authenticated;
revoke insert,update,delete on public.notification_sla_events from anon,authenticated;

create or replace function public.evaluate_notification_sla_v1()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_notification record;
  v_policy public.notification_sla_policies%rowtype;
  v_type text;
  v_action_state text;
  v_stage text;
  v_deadline timestamptz;
  v_event_id uuid;
  v_escalation_id uuid;
  v_count integer := 0;
  v_ack_count integer := 0;
  v_resolution_count integer := 0;
  v_rollout_at constant timestamptz := '2026-09-08 16:45:00+00'::timestamptz;
  v_title text;
  v_message text;
begin
  for v_notification in
    select n.*
    from public.notifications n
    where n.created_at >= v_rollout_at
      and coalesce(n.requires_action,false)=true
      and coalesce(n.metadata->>'schemaVersion','')='2'
      and coalesce(nullif(n.action_status,''),'new') not in ('completed','dismissed')
      and coalesce(n.metadata->>'slaGenerated','false') <> 'true'
  loop
    v_type := public.canonical_notification_type_v2(
      coalesce(nullif(v_notification.notification_type,''),nullif(v_notification.type,''),'system')
    );
    v_action_state := lower(coalesce(nullif(v_notification.action_status,''),'new'));

    select p.* into v_policy
    from public.notification_sla_policies p
    where p.enabled=true
      and (p.canonical_type is null or p.canonical_type=v_type)
      and (p.match_priority is null or p.match_priority=lower(coalesce(v_notification.priority,'normal')))
    order by
      ((p.canonical_type is not null)::int + (p.match_priority is not null)::int) desc,
      p.precedence desc,
      p.policy_key
    limit 1;

    if not found then
      continue;
    end if;

    -- Reading is not an acknowledgement. Only an explicit workflow transition counts.
    if v_action_state='new' then
      v_stage := 'ack';
      v_deadline := v_notification.created_at + make_interval(mins=>v_policy.ack_minutes);
      if now() >= v_deadline then
        v_event_id := null;
        insert into public.notification_sla_events(
          notification_id,policy_key,breach_stage,original_type,canonical_type,original_priority,
          notification_branch,deadline_at,metadata
        ) values (
          v_notification.id,v_policy.policy_key,v_stage,
          coalesce(nullif(v_notification.notification_type,''),nullif(v_notification.type,''),'system'),
          v_type,v_notification.priority,v_notification.branch,v_deadline,
          jsonb_build_object(
            'schemaVersion',2,
            'sourceNotificationId',v_notification.id,
            'slaPolicy',v_policy.policy_key,
            'slaStage',v_stage,
            'ackMinutes',v_policy.ack_minutes,
            'resolveMinutes',v_policy.resolve_minutes
          )
        )
        on conflict(notification_id,policy_key,breach_stage) do nothing
        returning id into v_event_id;

        if v_event_id is not null then
          v_title := 'تجاوز زمن بدء المتابعة';
          v_message := 'لم تبدأ متابعة التنبيه «'||coalesce(v_notification.title,'تنبيه تشغيلي')||'» خلال '||v_policy.ack_minutes||' دقيقة.';
          v_escalation_id := public.emit_system_notification_v2(
            null,
            v_policy.escalation_role,
            v_notification.branch,
            'manager_alert',
            v_title,
            v_message,
            'notification_sla',
            v_notification.id::text,
            '/operations-center?notificationId='||v_notification.id::text,
            v_policy.escalation_priority,
            jsonb_build_object(
              'schemaVersion',2,
              'canonicalType','manager_alert',
              'slaGenerated',true,
              'sourceNotificationId',v_notification.id,
              'slaPolicy',v_policy.policy_key,
              'slaStage','ack',
              'deadlineAt',v_deadline,
              'originalType',v_type,
              'originalPriority',v_notification.priority,
              'branch',v_notification.branch,
              'route','/operations-center?notificationId='||v_notification.id::text
            ),
            'sla:'||v_notification.id::text||':ack',
            false,
            v_policy.escalation_priority in ('urgent','critical')
          );
          update public.notification_sla_events
          set escalation_notification_id=v_escalation_id
          where id=v_event_id;
          v_count := v_count + 1;
          v_ack_count := v_ack_count + 1;
        end if;
      end if;
    end if;

    if v_action_state not in ('completed','dismissed') then
      v_stage := 'resolution';
      v_deadline := v_notification.created_at + make_interval(mins=>v_policy.resolve_minutes);
      if now() >= v_deadline then
        v_event_id := null;
        insert into public.notification_sla_events(
          notification_id,policy_key,breach_stage,original_type,canonical_type,original_priority,
          notification_branch,deadline_at,metadata
        ) values (
          v_notification.id,v_policy.policy_key,v_stage,
          coalesce(nullif(v_notification.notification_type,''),nullif(v_notification.type,''),'system'),
          v_type,v_notification.priority,v_notification.branch,v_deadline,
          jsonb_build_object(
            'schemaVersion',2,
            'sourceNotificationId',v_notification.id,
            'slaPolicy',v_policy.policy_key,
            'slaStage',v_stage,
            'ackMinutes',v_policy.ack_minutes,
            'resolveMinutes',v_policy.resolve_minutes,
            'actionState',v_action_state
          )
        )
        on conflict(notification_id,policy_key,breach_stage) do nothing
        returning id into v_event_id;

        if v_event_id is not null then
          v_title := 'تجاوز زمن إغلاق التنبيه';
          v_message := 'لم يتم إغلاق التنبيه «'||coalesce(v_notification.title,'تنبيه تشغيلي')||'» خلال '||v_policy.resolve_minutes||' دقيقة.';
          v_escalation_id := public.emit_system_notification_v2(
            null,
            v_policy.escalation_role,
            v_notification.branch,
            'manager_alert',
            v_title,
            v_message,
            'notification_sla',
            v_notification.id::text,
            '/operations-center?notificationId='||v_notification.id::text,
            'urgent',
            jsonb_build_object(
              'schemaVersion',2,
              'canonicalType','manager_alert',
              'slaGenerated',true,
              'sourceNotificationId',v_notification.id,
              'slaPolicy',v_policy.policy_key,
              'slaStage','resolution',
              'deadlineAt',v_deadline,
              'originalType',v_type,
              'originalPriority',v_notification.priority,
              'actionState',v_action_state,
              'branch',v_notification.branch,
              'route','/operations-center?notificationId='||v_notification.id::text
            ),
            'sla:'||v_notification.id::text||':resolution',
            false,
            true
          );
          update public.notification_sla_events
          set escalation_notification_id=v_escalation_id
          where id=v_event_id;
          v_count := v_count + 1;
          v_resolution_count := v_resolution_count + 1;
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'evaluatedAt',now(),
    'newBreaches',v_count,
    'ackBreaches',v_ack_count,
    'resolutionBreaches',v_resolution_count
  );
end;
$$;

revoke all on function public.evaluate_notification_sla_v1() from public,anon,authenticated;
grant execute on function public.evaluate_notification_sla_v1() to service_role;

create or replace function public.notification_sla_health_v1(p_hours integer default 24)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_catalog
as $$
  with scoped as (
    select e.*
    from public.notification_sla_events e
    where e.detected_at >= now()-make_interval(hours=>greatest(1,least(coalesce(p_hours,24),720)))
  )
  select jsonb_build_object(
    'windowHours',greatest(1,least(coalesce(p_hours,24),720)),
    'totalBreaches',count(*),
    'ackBreaches',count(*) filter(where breach_stage='ack'),
    'resolutionBreaches',count(*) filter(where breach_stage='resolution'),
    'byType',coalesce((
      select jsonb_object_agg(canonical_type,n)
      from (select canonical_type,count(*) n from scoped group by canonical_type) q
    ),'{}'::jsonb),
    'checkedAt',now()
  )
  from scoped;
$$;

revoke all on function public.notification_sla_health_v1(integer) from public,anon;
grant execute on function public.notification_sla_health_v1(integer) to authenticated,service_role;

-- Extend the existing scheduler entry point instead of adding a second cron.
create or replace function public.evaluate_operational_notification_rules_v1()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_employee_and_branch_tasks integer := 0;
  v_operations_tasks integer := 0;
  v_sla jsonb := '{}'::jsonb;
begin
  v_employee_and_branch_tasks := public.dawaa_notify_overdue_tasks_v1();
  v_operations_tasks := public.dawaa_notify_overdue_operations_tasks_v1();
  v_sla := public.evaluate_notification_sla_v1();
  return jsonb_build_object(
    'evaluated_at',now(),
    'employee_and_branch_task_notifications',v_employee_and_branch_tasks,
    'operations_task_notifications',v_operations_tasks,
    'sla',v_sla,
    'total_notifications',v_employee_and_branch_tasks+v_operations_tasks+coalesce((v_sla->>'newBreaches')::integer,0)
  );
end;
$$;

revoke all on function public.evaluate_operational_notification_rules_v1() from public,anon,authenticated;
grant execute on function public.evaluate_operational_notification_rules_v1() to service_role;
