-- Canonical notification lifecycle state machine.
-- Keeps workflow transitions, note requirements and SLA reference-only behavior in DB.

create or replace function public.notification_transition_allowed_v1(
  p_current_state text,
  p_next_state text,
  p_requires_action boolean default true
)
returns boolean
language sql
immutable
as $$
  with s as (
    select
      lower(trim(coalesce(nullif(p_current_state,''),'new'))) as current_state,
      lower(trim(coalesce(p_next_state,''))) as next_state,
      coalesce(p_requires_action,true) as requires_action
  )
  select case
    when next_state not in ('in_progress','completed','dismissed','escalated') then false
    when current_state in ('completed','dismissed') then next_state = current_state
    when current_state = next_state then true
    when current_state in ('new','read') and next_state = 'completed' and requires_action then false
    when current_state in ('new','read') then next_state in ('in_progress','dismissed','escalated')
    when current_state = 'in_progress' then next_state in ('completed','dismissed','escalated')
    when current_state = 'escalated' then next_state in ('in_progress','completed','dismissed')
    else false
  end
  from s;
$$;

create or replace function public.notification_transition_requires_note_v1(
  p_notification_type text,
  p_priority text,
  p_requires_action boolean,
  p_next_state text
)
returns boolean
language sql
immutable
as $$
  select
    lower(trim(coalesce(p_next_state,''))) in ('completed','dismissed')
    and (
      coalesce(p_requires_action,false)
      or lower(trim(coalesce(p_priority,'normal'))) in ('high','urgent','critical')
      or lower(trim(coalesce(p_notification_type,'system'))) in (
        'staff_task','customer_followup','customer_request','customer_data_review','welcome_task',
        'inventory','expiry_alert','delivery_order','shift_issue','manager_alert','vip_customer_silence'
      )
    );
$$;

create or replace function public.transition_notification_action_with_note_v1(
  p_notification_id uuid,
  p_next_state text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_notification public.notifications%rowtype;
  v_actor_role text;
  v_is_global_manager boolean := false;
  v_is_branch_manager boolean := false;
  v_allowed boolean := false;
  v_now timestamptz := now();
  v_note text := nullif(trim(coalesce(p_note,'')),'');
  v_actor_name text;
  v_current_state text;
  v_notification_type text;
begin
  p_next_state := lower(trim(coalesce(p_next_state,'')));
  if p_next_state not in ('in_progress','completed','dismissed','escalated') then
    raise exception 'invalid notification action state';
  end if;

  select * into v_actor
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active,is_active,true)
    and coalesce(can_login,true);
  if not found then raise exception 'active staff actor required'; end if;

  select * into v_notification
  from public.notifications
  where id = p_notification_id
  for update;
  if not found then return false; end if;

  if lower(coalesce(v_notification.metadata->>'slaGenerated','false')) = 'true' then
    raise exception 'SLA escalation is reference-only; act on the source notification';
  end if;

  v_actor_role := lower(trim(coalesce(v_actor.role,v_actor.staff_role,'')));
  v_actor_name := coalesce(nullif(trim(v_actor.staff_name),''),nullif(trim(v_actor.name),''),nullif(trim(v_actor.username),''),'مستخدم النظام');
  v_is_global_manager := v_actor_role in ('general_manager','executive_manager','branches_manager');
  v_is_branch_manager := v_actor_role in ('branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening','procurement_manager');
  v_allowed := v_notification.recipient_staff_id = v_actor.staff_id
    or v_is_global_manager
    or (
      v_is_branch_manager
      and nullif(trim(coalesce(v_notification.branch,'')),'') is not null
      and trim(coalesce(v_notification.branch,'')) = trim(coalesce(v_actor.branch,''))
    );
  if not v_allowed then raise exception 'notification action not allowed for current actor'; end if;

  v_current_state := lower(trim(coalesce(nullif(v_notification.action_status,''),'new')));
  v_notification_type := lower(trim(coalesce(nullif(v_notification.notification_type,''),nullif(v_notification.type,''),'system')));

  -- Same-state retries are idempotent and do not append duplicate audit events.
  if v_current_state = p_next_state then
    return true;
  end if;

  if not public.notification_transition_allowed_v1(v_current_state,p_next_state,coalesce(v_notification.requires_action,false)) then
    raise exception 'invalid notification lifecycle transition: % -> %', v_current_state, p_next_state;
  end if;

  if public.notification_transition_requires_note_v1(
      v_notification_type,
      v_notification.priority,
      coalesce(v_notification.requires_action,false),
      p_next_state
    ) and v_note is null then
    raise exception 'outcome note is required for this notification transition';
  end if;

  update public.notifications
  set
    action_status = p_next_state,
    requires_action = p_next_state not in ('completed','dismissed'),
    is_read = true,
    read = true,
    read_at = coalesce(read_at,v_now),
    status = case when p_next_state='in_progress' then 'read' else p_next_state end,
    completed_at = case when p_next_state='completed' then v_now else completed_at end,
    priority = case when p_next_state='escalated' then 'urgent' else priority end,
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'actionState',p_next_state,
      'actionStateUpdatedAt',v_now,
      'actionPreviousState',v_current_state,
      'actionByStaffId',v_actor.staff_id,
      'actionByStaffAccountId',v_actor.id,
      'actionByName',v_actor_name,
      'actionByRole',coalesce(nullif(trim(v_actor.role),''),nullif(trim(v_actor.staff_role),'')),
      'actionNote',v_note
    ))
  where id=p_notification_id;

  insert into public.notification_action_events(
    notification_id,action_state,note,actor_staff_account_id,actor_staff_id,actor_name,
    actor_role,actor_branch,notification_type,notification_branch,created_at
  ) values (
    p_notification_id,p_next_state,v_note,v_actor.id,v_actor.staff_id,v_actor_name,
    coalesce(nullif(trim(v_actor.role),''),nullif(trim(v_actor.staff_role),'')),v_actor.branch,
    v_notification_type,v_notification.branch,v_now
  );

  return true;
end;
$function$;

revoke all on function public.notification_transition_allowed_v1(text,text,boolean) from public;
revoke all on function public.notification_transition_requires_note_v1(text,text,boolean,text) from public;
grant execute on function public.notification_transition_allowed_v1(text,text,boolean) to authenticated, service_role;
grant execute on function public.notification_transition_requires_note_v1(text,text,boolean,text) to authenticated, service_role;

create or replace view public.notification_lifecycle_audit_v1
with (security_invoker = true)
as
with event_ordered as (
  select
    e.*,
    lag(e.action_state) over (partition by e.notification_id order by e.created_at,e.id) as previous_event_state,
    row_number() over (partition by e.notification_id,e.action_state order by e.created_at,e.id) as same_state_seq
  from public.notification_action_events e
), event_health as (
  select
    e.notification_id,
    count(*) filter (
      where e.same_state_seq > 1
        and e.action_state in ('completed','dismissed')
    ) as duplicate_terminal_events,
    count(*) filter (
      where e.previous_event_state in ('completed','dismissed')
        and e.action_state <> e.previous_event_state
    ) as reopened_after_terminal
  from event_ordered e
  group by e.notification_id
)
select
  n.id as notification_id,
  coalesce(nullif(n.action_status,''),'new') as current_action_state,
  n.requires_action,
  lower(coalesce(n.metadata->>'slaGenerated','false')) = 'true' as sla_generated,
  coalesce(h.duplicate_terminal_events,0) as duplicate_terminal_events,
  coalesce(h.reopened_after_terminal,0) as reopened_after_terminal,
  case
    when lower(coalesce(n.metadata->>'slaGenerated','false')) = 'true' and coalesce(n.requires_action,false) then 'sla_reference_has_workflow'
    when coalesce(nullif(n.action_status,''),'new') in ('completed','dismissed') and coalesce(n.requires_action,false) then 'terminal_requires_action'
    when coalesce(h.reopened_after_terminal,0) > 0 then 'reopened_after_terminal'
    when coalesce(h.duplicate_terminal_events,0) > 0 then 'duplicate_terminal_event'
    else 'valid'
  end as integrity_state
from public.notifications n
left join event_health h on h.notification_id=n.id;

revoke all on public.notification_lifecycle_audit_v1 from public;
grant select on public.notification_lifecycle_audit_v1 to authenticated, service_role;

comment on view public.notification_lifecycle_audit_v1 is
'Canonical notification lifecycle integrity audit. Terminal states cannot reopen, SLA escalations are reference-only, and same-state retries are idempotent.';
