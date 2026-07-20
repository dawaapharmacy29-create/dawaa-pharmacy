begin;

create or replace function public.correct_customer_followup_data_v1(
  p_followup_id text,
  p_customer_name text,
  p_customer_code text,
  p_customer_phone text,
  p_branch text,
  p_actor_staff_id text,
  p_actor_name text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff record;
  v_row public.daily_followups%rowtype;
  v_phone text;
  v_updated_followups integer := 0;
  v_updated_customers integer := 0;
begin
  select * into v_staff
  from public.resolve_staff_account_safe(p_actor_staff_id)
  limit 1;

  if v_staff.id is null or v_staff.active is not true or v_staff.can_login is not true then
    raise exception 'active_staff_account_required';
  end if;
  if coalesce(v_staff.role, '') not in (
    'customer_service', 'customer_service_manager', 'general_manager', 'branch_manager', 'branches_manager', 'admin'
  ) then
    raise exception 'customer_correction_permission_denied';
  end if;

  select * into v_row
  from public.daily_followups
  where id::text = p_followup_id
  limit 1
  for update;

  if v_row.id is null then
    raise exception 'followup_not_found';
  end if;

  v_phone := public.dawaa_normalize_egyptian_mobile_v1(
    coalesce(p_customer_phone, v_row.customer_phone, v_row.phone)
  );

  update public.daily_followups
  set customer_name = coalesce(nullif(trim(p_customer_name), ''), customer_name),
      name = coalesce(nullif(trim(p_customer_name), ''), name),
      customer_code = coalesce(nullif(trim(p_customer_code), ''), customer_code),
      customer_phone = coalesce(nullif(trim(v_phone), ''), customer_phone),
      phone = coalesce(nullif(trim(v_phone), ''), phone),
      branch = coalesce(nullif(trim(p_branch), ''), branch),
      data_quality_status = 'reviewed',
      data_issues = '{}'::text[],
      updated_by = p_actor_staff_id,
      updated_at = now()
  where id = v_row.id
     or (
       v_row.customer_id is not null
       and customer_id = v_row.customer_id
       and completed_at is null
       and cancelled_at is null
       and archived_at is null
     );
  get diagnostics v_updated_followups = row_count;

  if v_row.customer_id is not null then
    update public.customers
    set name = coalesce(nullif(trim(p_customer_name), ''), name),
        customer_code = coalesce(nullif(trim(p_customer_code), ''), customer_code),
        phone = coalesce(nullif(trim(v_phone), ''), phone),
        mobile = coalesce(nullif(trim(v_phone), ''), mobile),
        branch = coalesce(nullif(trim(p_branch), ''), branch)
    where id::text = v_row.customer_id::text;
    get diagnostics v_updated_customers = row_count;
  end if;

  insert into public.customer_service_followup_events(
    followup_id, event_type, event_status, actor_staff_id, actor_name, notes, metadata
  ) values (
    v_row.id::text,
    'customer_data_corrected',
    'open',
    p_actor_staff_id,
    p_actor_name,
    p_note,
    jsonb_build_object(
      'name', p_customer_name,
      'code', p_customer_code,
      'phone', v_phone,
      'branch', p_branch
    )
  );

  return jsonb_build_object(
    'followups_updated', v_updated_followups,
    'customers_updated', v_updated_customers
  );
end;
$$;

revoke all on function public.correct_customer_followup_data_v1(text,text,text,text,text,text,text,text) from public;
grant execute on function public.correct_customer_followup_data_v1(text,text,text,text,text,text,text,text)
  to anon, authenticated;

commit;
