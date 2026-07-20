begin;

create or replace function public.list_open_followup_duplicate_groups_v1(p_branch text default null)
returns table(identity_key text, branch text, request_type text, open_count bigint, canonical_id text, duplicate_ids text[], customer_name text, customer_code text, customer_phone text, newest_at timestamptz)
language sql security invoker set search_path = public as $$
  with open_rows as (
    select d.*, row_number() over (
      partition by d.identity_key, coalesce(d.branch, ''), coalesce(nullif(trim(d.request_type), ''), 'general')
      order by d.created_at asc nulls last, d.id
    ) as rn
    from public.daily_followups d
    where d.identity_key is not null
      and d.completed_at is null
      and d.cancelled_at is null
      and d.archived_at is null
      and coalesce(d.is_hidden, false) = false
      and d.duplicate_of is null
      and (p_branch is null or trim(p_branch) = '' or p_branch = 'كل الفروع' or d.branch = p_branch)
  )
  select identity_key, coalesce(branch, 'غير محدد'), coalesce(nullif(trim(request_type), ''), 'general'), count(*)::bigint,
    min(id::text) filter (where rn = 1),
    array_agg(id::text order by created_at) filter (where rn > 1),
    max(coalesce(customer_name, name)), max(customer_code), max(coalesce(customer_phone, phone)), max(created_at)
  from open_rows
  group by identity_key, branch, coalesce(nullif(trim(request_type), ''), 'general')
  having count(*) > 1
  order by count(*) desc, max(created_at) desc;
$$;

grant execute on function public.list_open_followup_duplicate_groups_v1(text) to anon, authenticated;

create or replace function public.merge_open_followup_duplicates_v1(
  p_canonical_id text,
  p_duplicate_ids text[],
  p_actor_staff_id text,
  p_actor_name text,
  p_reason text default 'دمج يدوي بعد المراجعة'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff record;
  v_count integer := 0;
begin
  select * into v_staff from public.resolve_staff_account_safe(p_actor_staff_id) limit 1;
  if v_staff.id is null or v_staff.active is not true or v_staff.can_login is not true then
    raise exception 'active_staff_account_required';
  end if;
  if coalesce(v_staff.role, '') not in ('customer_service_manager','general_manager','branch_manager','branches_manager','admin') then
    raise exception 'duplicate_merge_permission_denied';
  end if;
  if nullif(trim(p_canonical_id), '') is null or coalesce(array_length(p_duplicate_ids, 1), 0) = 0 then
    raise exception 'canonical_and_duplicates_required';
  end if;

  perform 1 from public.daily_followups
  where id::text = p_canonical_id
    and completed_at is null
    and cancelled_at is null
    and archived_at is null
    and coalesce(is_hidden, false) = false
  for update;
  if not found then raise exception 'canonical_open_followup_not_found'; end if;

  update public.daily_followups
  set duplicate_of = p_canonical_id,
      canonical_followup_id = p_canonical_id,
      is_duplicate = true,
      is_hidden = true,
      hidden_at = coalesce(hidden_at, now()),
      hidden_by = p_actor_staff_id,
      hidden_reason = coalesce(nullif(trim(p_reason), ''), 'دمج يدوي بعد المراجعة'),
      archived_at = coalesce(archived_at, now()),
      archive_reason = coalesce(nullif(trim(p_reason), ''), 'دمج يدوي بعد المراجعة'),
      status = 'merged_duplicate',
      followup_status = 'merged_duplicate',
      updated_by = p_actor_staff_id,
      updated_at = now()
  where id::text = any(p_duplicate_ids)
    and id::text <> p_canonical_id
    and completed_at is null
    and cancelled_at is null;
  get diagnostics v_count = row_count;

  insert into public.customer_service_followup_events(followup_id,event_type,event_status,actor_staff_id,actor_name,notes,metadata)
  values (p_canonical_id,'duplicates_merged','open',p_actor_staff_id,p_actor_name,p_reason,jsonb_build_object('duplicate_ids', p_duplicate_ids, 'merged_count', v_count));

  return jsonb_build_object('canonical_id', p_canonical_id, 'merged_count', v_count);
end;
$$;

revoke all on function public.merge_open_followup_duplicates_v1(text,text[],text,text,text) from public;
grant execute on function public.merge_open_followup_duplicates_v1(text,text[],text,text,text) to anon, authenticated;

commit;
