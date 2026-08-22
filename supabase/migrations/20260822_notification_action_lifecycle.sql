-- Governed notification action lifecycle.
-- Reading an alert and completing the operational action are intentionally separate states.

begin;

create index if not exists notifications_recipient_action_created_idx
  on public.notifications (recipient_staff_id, action_status, created_at desc);

create index if not exists notifications_requires_action_created_idx
  on public.notifications (requires_action, created_at desc)
  where requires_action = true;

create or replace function public.transition_staff_notification_action(
  p_notification_id uuid,
  p_next_state text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.notifications%rowtype;
  v_current text;
  v_is_owner boolean := false;
  v_is_manager boolean := false;
  v_now timestamptz := now();
begin
  if p_next_state not in ('in_progress','completed','dismissed','escalated') then
    raise exception 'invalid notification action state: %', p_next_state;
  end if;

  select * into v_row
  from public.notifications
  where id = p_notification_id
  for update;

  if not found then return false; end if;

  if auth.uid() is not null and to_regclass('public.staff_accounts') is not null then
    select exists (
      select 1 from public.staff_accounts sa
      where sa.auth_user_id = auth.uid()
        and coalesce(sa.is_active, true) = true
        and sa.staff_id::text = coalesce(v_row.recipient_staff_id, '')::text
    ) into v_is_owner;

    select exists (
      select 1 from public.staff_accounts sa
      where sa.auth_user_id = auth.uid()
        and coalesce(sa.is_active, true) = true
        and lower(coalesce(sa.role, '')) in (
          'admin','general_manager','executive_manager','branches_manager',
          'branch_manager','customer_service_manager'
        )
    ) into v_is_manager;
  end if;

  if auth.uid() is not null and not (v_is_owner or v_is_manager) then
    raise exception 'not authorized to transition this notification';
  end if;

  v_current := coalesce(nullif(v_row.action_status, ''), 'new');
  if v_current in ('completed','dismissed') and p_next_state <> v_current and not v_is_manager then
    raise exception 'terminal notification action cannot be reopened by recipient';
  end if;

  update public.notifications
  set
    action_status = p_next_state,
    requires_action = case when p_next_state in ('completed','dismissed') then false else coalesce(requires_action, true) end,
    is_read = true,
    read = true,
    read_at = coalesce(read_at, v_now),
    status = case
      when p_next_state = 'completed' then 'completed'
      when p_next_state = 'dismissed' then 'dismissed'
      when p_next_state = 'escalated' then 'escalated'
      else 'read'
    end,
    completed_at = case when p_next_state = 'completed' then v_now else completed_at end,
    priority = case when p_next_state = 'escalated' then 'urgent' else priority end,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'actionState', p_next_state,
      'actionStateUpdatedAt', v_now
    )
  where id = p_notification_id;

  return true;
end;
$$;

revoke all on function public.transition_staff_notification_action(uuid,text) from public;
grant execute on function public.transition_staff_notification_action(uuid,text) to authenticated;

commit;
