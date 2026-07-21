create or replace function public.transfer_customer_followup_branch_v1(
  p_followup_id text,
  p_target_branch text,
  p_actor_staff_id text default null,
  p_actor_name text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.daily_followups%rowtype;
  v_source_branch text;
  v_target_branch text;
  v_followups_updated integer := 0;
  v_queue_updated integer := 0;
  v_override_id uuid;
  v_code text;
  v_phone text;
  v_customer_id text;
begin
  select * into v_row
  from public.daily_followups
  where id::text = trim(p_followup_id)
  limit 1;

  if not found then
    raise exception 'المتابعة غير موجودة';
  end if;

  v_target_branch := case
    when trim(coalesce(p_target_branch, '')) in ('فرع الشامي', 'الشامي') then 'فرع الشامي'
    when trim(coalesce(p_target_branch, '')) in ('فرع شكري', 'شكري') then 'فرع شكري'
    else null
  end;

  if v_target_branch is null then
    raise exception 'الفرع المطلوب غير صحيح';
  end if;

  v_source_branch := coalesce(nullif(trim(v_row.branch), ''), 'غير محدد');
  if v_source_branch = v_target_branch then
    raise exception 'العميل موجود بالفعل في الفرع المطلوب';
  end if;

  v_code := nullif(trim(v_row.customer_code), '');
  v_phone := nullif(regexp_replace(coalesce(v_row.customer_phone, v_row.phone, ''), '\D', '', 'g'), '');
  v_customer_id := nullif(trim(v_row.customer_id), '');

  update public.daily_followups f
  set branch = v_target_branch,
      updated_at = now(),
      updated_by = nullif(trim(coalesce(p_actor_staff_id, '')), '')
  where coalesce(f.is_hidden, false) = false
    and f.completed_at is null
    and (
      f.id::text = trim(p_followup_id)
      or (v_code is not null and trim(coalesce(f.customer_code, '')) = v_code)
      or (v_customer_id is not null and trim(coalesce(f.customer_id, '')) = v_customer_id)
      or (v_phone is not null and regexp_replace(coalesce(f.customer_phone, f.phone, ''), '\D', '', 'g') = v_phone)
    );
  get diagnostics v_followups_updated = row_count;

  update public.customer_service_daily_queue_items q
  set branch = v_target_branch,
      updated_at = now(),
      metadata = coalesce(q.metadata, '{}'::jsonb) || jsonb_build_object(
        'branchTransferredAt', now(),
        'branchTransferredBy', nullif(trim(coalesce(p_actor_name, '')), ''),
        'previousBranch', v_source_branch,
        'targetBranch', v_target_branch
      )
  where q.completed_at is null
    and (
      q.linked_followup_id::text = trim(p_followup_id)
      or (v_code is not null and trim(coalesce(q.customer_code, '')) = v_code)
      or (v_customer_id is not null and trim(coalesce(q.customer_id, '')) = v_customer_id)
      or (v_phone is not null and regexp_replace(coalesce(q.customer_phone, ''), '\D', '', 'g') = v_phone)
    );
  get diagnostics v_queue_updated = row_count;

  update public.customer_branch_overrides
  set active = false
  where active = true
    and (
      (v_code is not null and customer_code = v_code)
      or (v_customer_id is not null and customer_id = v_customer_id)
      or (v_phone is not null and regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g') = v_phone)
    );

  insert into public.customer_branch_overrides(
    customer_code, customer_id, customer_phone, customer_name,
    old_branch, new_branch, suggested_branch, reason,
    created_by, created_by_name, active
  ) values (
    v_code, v_customer_id, v_phone,
    coalesce(v_row.customer_name, v_row.name),
    v_source_branch, v_target_branch, v_target_branch,
    coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'تحويل يدوي من صفحة متابعة العملاء'),
    nullif(trim(coalesce(p_actor_staff_id, '')), ''),
    nullif(trim(coalesce(p_actor_name, '')), ''), true
  ) returning id into v_override_id;

  insert into public.customer_followup_audit_log(
    followup_id, customer_id, action, actor_staff_id, actor_name, branch, metadata
  ) values (
    trim(p_followup_id), v_customer_id, 'branch_transferred',
    nullif(trim(coalesce(p_actor_staff_id, '')), ''),
    nullif(trim(coalesce(p_actor_name, '')), ''), v_target_branch,
    jsonb_build_object(
      'from_branch', v_source_branch,
      'to_branch', v_target_branch,
      'reason', coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'تحويل يدوي'),
      'followups_updated', v_followups_updated,
      'queue_items_updated', v_queue_updated,
      'override_id', v_override_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'from_branch', v_source_branch,
    'to_branch', v_target_branch,
    'followups_updated', v_followups_updated,
    'queue_items_updated', v_queue_updated,
    'override_id', v_override_id
  );
end;
$$;

grant execute on function public.transfer_customer_followup_branch_v1(text, text, text, text, text) to authenticated, anon;
