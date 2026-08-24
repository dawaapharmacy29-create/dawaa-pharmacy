-- Atomic V2 customer-contact command.
-- Stores exact follow-up time, applies branch authorization, updates request state and writes the timeline event in one transaction.

create or replace function public.record_customer_request_contact_v2(
  p_request_id uuid,
  p_outcome text,
  p_notes text default null,
  p_followup_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account_id uuid;
  v_actor_subject uuid;
  v_actor_name text;
  v_request public.customer_requests%rowtype;
  v_updated public.customer_requests%rowtype;
  v_outcome text := lower(trim(coalesce(p_outcome, '')));
  v_next_status text;
  v_event_notes text;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then
    raise exception 'staff_context_required';
  end if;

  v_actor_subject := public.dawaa_current_staff_subject_uuid_v1();
  select coalesce(nullif(trim(sa.staff_name), ''), nullif(trim(sa.name), ''), nullif(trim(sa.username), ''), 'موظف')
    into v_actor_name
  from public.staff_accounts sa
  where sa.id = v_account_id
    and coalesce(sa.active, false)
    and coalesce(sa.can_login, false);

  select * into v_request
  from public.customer_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'customer_request_not_found';
  end if;

  if not public.dawaa_can_access_customer_request_branch('manage_customer_requests', v_request.branch) then
    raise exception 'customer_request_manage_forbidden';
  end if;

  if lower(trim(coalesce(v_request.status, 'new'))) not in ('available', 'arrived') then
    raise exception 'customer_request_contact_invalid_status';
  end if;

  if v_outcome not in ('answered', 'no_answer', 'later') then
    raise exception 'customer_request_contact_invalid_outcome';
  end if;

  if v_outcome = 'later' then
    if p_followup_at is null then
      raise exception 'customer_request_followup_required';
    end if;
    if p_followup_at <= now() then
      raise exception 'customer_request_followup_must_be_future';
    end if;
    if nullif(trim(coalesce(p_notes, '')), '') is null then
      raise exception 'customer_request_followup_note_required';
    end if;
  end if;

  v_next_status := case when v_outcome = 'answered' then 'customer_contacted' else coalesce(v_request.status, 'available') end;
  v_event_notes := case
    when v_outcome = 'later' then concat(trim(p_notes), ' · موعد المتابعة: ', to_char(p_followup_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'))
    when nullif(trim(coalesce(p_notes, '')), '') is not null then trim(p_notes)
    when v_outcome = 'answered' then 'تم الرد'
    else 'لم يرد'
  end;

  update public.customer_requests
  set status = v_next_status,
      contact_summary = coalesce(nullif(trim(coalesce(p_notes, '')), ''), contact_summary),
      due_date = case when v_outcome = 'later' then (p_followup_at at time zone 'Africa/Cairo')::date else null end,
      next_action_at = case when v_outcome = 'later' then p_followup_at else null end,
      last_action_at = now(),
      customer_contacted_by_name = case when v_outcome = 'answered' then v_actor_name else customer_contacted_by_name end,
      updated_at = now()
  where id = p_request_id
  returning * into v_updated;

  insert into public.customer_request_events (
    request_id,
    old_status,
    new_status,
    action,
    notes,
    created_by,
    created_by_name,
    created_at
  ) values (
    p_request_id,
    v_request.status,
    v_next_status,
    case
      when v_outcome = 'answered' then 'محاولة تواصل: تم الرد'
      when v_outcome = 'no_answer' then 'محاولة تواصل: لم يرد'
      else 'محاولة تواصل: تواصل لاحقًا'
    end,
    v_event_notes,
    v_actor_subject::text,
    v_actor_name,
    now()
  );

  return to_jsonb(v_updated);
end;
$$;

revoke all on function public.record_customer_request_contact_v2(uuid, text, text, timestamptz) from public;
grant execute on function public.record_customer_request_contact_v2(uuid, text, text, timestamptz) to anon, authenticated, service_role;
