create or replace function public.create_or_link_customer_followup(p_payload jsonb)
returns public.daily_followups
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.daily_followups;
  v_result jsonb;
  v_actor_staff_id text := coalesce(
    nullif(btrim(p_payload->>'requested_by_staff_id'), ''),
    nullif(btrim(p_payload->>'created_by'), ''),
    nullif(btrim(p_payload->>'staff_id'), '')
  );
  v_next_date date;
begin
  begin
    v_next_date := nullif(btrim(p_payload->>'next_followup_date'), '')::date;
  exception when others then
    v_next_date := null;
  end;

  if v_actor_staff_id is not null then
    v_result := public.find_or_create_open_customer_followup(
      p_customer_id := p_payload->>'customer_id',
      p_customer_code := p_payload->>'customer_code',
      p_customer_name := coalesce(p_payload->>'customer_name', p_payload->>'name', 'عميل غير مسجل'),
      p_customer_phone := coalesce(p_payload->>'customer_phone', p_payload->>'phone'),
      p_branch := p_payload->>'branch',
      p_request_type := coalesce(p_payload->>'request_type', p_payload->>'followup_type', 'general'),
      p_request_details := coalesce(p_payload->>'request_details', p_payload->>'notes'),
      p_followup_reason := coalesce(p_payload->>'followup_reason', p_payload->>'notes'),
      p_priority := p_payload->>'priority',
      p_next_followup_date := v_next_date,
      p_actor_staff_id := v_actor_staff_id,
      p_actor_name := coalesce(p_payload->>'created_by_name', p_payload->>'responsible_name', v_actor_staff_id),
      p_client_request_id := p_payload->>'client_request_id',
      p_source := coalesce(p_payload->>'request_source', 'legacy_create_or_link')
    );

    select * into v_row
    from public.daily_followups
    where id = v_result->>'followup_id'
    limit 1;

    if v_row.id is not null then return v_row; end if;
  end if;

  insert into public.daily_followups
  select * from jsonb_populate_record(null::public.daily_followups, p_payload)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.create_or_link_customer_followup(jsonb) from public;
grant execute on function public.create_or_link_customer_followup(jsonb) to anon, authenticated;

comment on function public.create_or_link_customer_followup(jsonb)
is 'Compatibility wrapper: forwards staff-attributed writes to find_or_create_open_customer_followup; falls back to guarded insert for legacy system payloads.';
