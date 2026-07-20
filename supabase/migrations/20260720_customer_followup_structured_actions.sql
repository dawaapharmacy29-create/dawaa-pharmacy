begin;

create or replace function public.customer_followup_apply_action_v1(
  p_followup_id text,
  p_action text,
  p_next_date date,
  p_reason text,
  p_notes text,
  p_actor_staff_id text,
  p_actor_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff record;
  v_row public.daily_followups%rowtype;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_now timestamptz := now();
begin
  select * into v_staff
  from public.resolve_staff_account_safe(p_actor_staff_id)
  limit 1;

  if v_staff.id is null or v_staff.active is not true or v_staff.can_login is not true then
    raise exception 'active_staff_account_required';
  end if;
  if coalesce(v_staff.role, '') not in (
    'customer_service', 'customer_service_manager', 'general_manager', 'branch_manager',
    'branches_manager', 'admin', 'doctor', 'pharmacist', 'shift_supervisor', 'shift_supervisor_evening'
  ) then
    raise exception 'followup_action_permission_denied';
  end if;

  select * into v_row
  from public.daily_followups
  where id::text = p_followup_id
  limit 1
  for update;

  if v_row.id is null then raise exception 'followup_not_found'; end if;
  if v_action not in ('postpone', 'cancel', 'archive') then raise exception 'invalid_followup_action'; end if;

  if v_action = 'postpone' then
    if p_next_date is null or p_next_date < timezone('Africa/Cairo', now())::date then
      raise exception 'valid_future_date_required';
    end if;
    update public.daily_followups
    set postponed_until = p_next_date::timestamptz,
        next_followup_date = p_next_date,
        needs_next_followup = true,
        status = 'مؤجل',
        followup_status = 'مؤجل',
        followup_notes = coalesce(nullif(trim(p_notes), ''), followup_notes),
        updated_by = p_actor_staff_id,
        updated_at = v_now
    where id = v_row.id;
  elsif v_action = 'cancel' then
    if nullif(trim(p_reason), '') is null then raise exception 'cancel_reason_required'; end if;
    update public.daily_followups
    set cancelled_at = v_now,
        cancelled_by = p_actor_staff_id,
        cancelled_reason = trim(p_reason),
        completed_at = coalesce(completed_at, v_now),
        status = 'ملغي',
        followup_status = 'ملغي',
        followup_result = 'تم إلغاء المتابعة',
        contact_result = 'تم إلغاء المتابعة',
        followup_notes = coalesce(nullif(trim(p_notes), ''), trim(p_reason)),
        needs_next_followup = false,
        next_followup_date = null,
        updated_by = p_actor_staff_id,
        updated_at = v_now
    where id = v_row.id;
  else
    if nullif(trim(p_reason), '') is null then raise exception 'archive_reason_required'; end if;
    update public.daily_followups
    set archived_at = coalesce(archived_at, v_now),
        archive_reason = trim(p_reason),
        is_hidden = true,
        hidden_at = coalesce(hidden_at, v_now),
        hidden_by = p_actor_staff_id,
        hidden_reason = trim(p_reason),
        status = 'archived',
        followup_status = 'archived',
        followup_notes = coalesce(nullif(trim(p_notes), ''), followup_notes),
        updated_by = p_actor_staff_id,
        updated_at = v_now
    where id = v_row.id;
  end if;

  insert into public.customer_service_followup_events(
    followup_id, event_type, event_status, actor_staff_id, actor_name, notes, metadata
  ) values (
    v_row.id::text,
    case v_action when 'postpone' then 'scheduled' when 'cancel' then 'cancelled' else 'archived' end,
    case v_action when 'postpone' then 'مؤجل' when 'cancel' then 'ملغي' else 'مؤرشف' end,
    p_actor_staff_id,
    p_actor_name,
    coalesce(nullif(trim(p_notes), ''), nullif(trim(p_reason), '')),
    jsonb_build_object('action', v_action, 'next_date', p_next_date, 'reason', p_reason)
  );

  return jsonb_build_object(
    'followup_id', v_row.id::text,
    'action', v_action,
    'success', true,
    'next_date', p_next_date
  );
end;
$$;

revoke all on function public.customer_followup_apply_action_v1(text,text,date,text,text,text,text) from public;
grant execute on function public.customer_followup_apply_action_v1(text,text,date,text,text,text,text)
  to anon, authenticated;

commit;
