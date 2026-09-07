create or replace function public.transition_notification_action_with_note_v1(
  p_notification_id uuid,
  p_next_state text,
  p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_notification public.notifications%rowtype;
  v_actor_role text;
  v_is_global_manager boolean := false;
  v_is_branch_manager boolean := false;
  v_allowed boolean := false;
  v_now timestamptz := now();
  v_note text := nullif(trim(coalesce(p_note,'')), '');
begin
  if p_next_state not in ('in_progress','completed','dismissed','escalated') then
    raise exception 'invalid notification action state';
  end if;

  select * into v_actor
  from public.staff_accounts
  where id = public.dawaa_current_staff_account_id_strict()
    and coalesce(active, is_active, true)
    and coalesce(can_login, true);

  if not found then
    raise exception 'active staff actor required';
  end if;

  select * into v_notification
  from public.notifications
  where id = p_notification_id
  for update;

  if not found then return false; end if;

  v_actor_role := lower(trim(coalesce(v_actor.role, v_actor.staff_role, '')));
  v_is_global_manager := v_actor_role in ('general_manager','executive_manager','branches_manager');
  v_is_branch_manager := v_actor_role in ('branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening','procurement_manager');

  v_allowed :=
    v_notification.recipient_staff_id = v_actor.staff_id
    or v_is_global_manager
    or (
      v_is_branch_manager
      and nullif(trim(coalesce(v_notification.branch,'')), '') is not null
      and trim(coalesce(v_notification.branch,'')) = trim(coalesce(v_actor.branch,''))
    );

  if not v_allowed then
    raise exception 'notification action not allowed for current actor';
  end if;

  if coalesce(nullif(v_notification.action_status,''),'new') in ('completed','dismissed')
     and p_next_state <> coalesce(nullif(v_notification.action_status,''),'new') then
    raise exception 'terminal notification action cannot be reopened';
  end if;

  update public.notifications
  set action_status = p_next_state,
      requires_action = p_next_state not in ('completed','dismissed'),
      is_read = true,
      read = true,
      read_at = coalesce(read_at, v_now),
      status = case when p_next_state='in_progress' then 'read' else p_next_state end,
      completed_at = case when p_next_state='completed' then v_now else completed_at end,
      priority = case when p_next_state='escalated' then 'urgent' else priority end,
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'actionState', p_next_state,
        'actionStateUpdatedAt', v_now,
        'actionByStaffId', v_actor.staff_id,
        'actionByStaffAccountId', v_actor.id,
        'actionByName', coalesce(nullif(trim(v_actor.staff_name),''), nullif(trim(v_actor.name),''), nullif(trim(v_actor.username),''), 'مستخدم النظام'),
        'actionByRole', coalesce(nullif(trim(v_actor.role),''), nullif(trim(v_actor.staff_role),'')),
        'actionNote', v_note
      ))
  where id = p_notification_id;

  return true;
end;
$function$;

revoke all on function public.transition_notification_action_with_note_v1(uuid,text,text) from public;
grant execute on function public.transition_notification_action_with_note_v1(uuid,text,text) to authenticated;
