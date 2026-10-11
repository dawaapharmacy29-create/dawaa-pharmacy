-- Points lifecycle V5: transitions must preserve who decided, when, and from which state.
-- Approved/active events cannot be silently moved back to pending.

create or replace function public.transition_employee_points_transaction_v4(
  p_transaction_id uuid,
  p_status text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_actor_id text := public.employee_operating_actor_id();
  v_actor_role text := lower(trim(coalesce(public.employee_operating_actor_role(), '')));
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(), '')), '');
  v_global boolean := v_actor_role in ('general_manager', 'admin', 'executive_manager', 'branches_manager');
  v_row public.employee_transactions%rowtype;
  v_old_status text;
  v_effective_branch text;
begin
  if p_status not in ('pending', 'active', 'cancelled') then
    raise exception 'invalid_status';
  end if;
  if v_actor_id is null or not public.employee_operating_can_manage() then
    raise exception 'not_authorized';
  end if;

  select et.* into v_row
  from public.employee_transactions et
  where et.id = p_transaction_id
  for update;
  if not found then raise exception 'transaction_not_found'; end if;

  v_old_status := coalesce(v_row.status,'active');
  if v_old_status = p_status then
    return jsonb_build_object(
      'id',v_row.id,'status',v_row.status,'staff_id',v_row.staff_id,
      'branch',v_row.branch,'updated_at',v_row.updated_at,'idempotent',true
    );
  end if;

  if v_old_status in ('active','approved') and p_status='pending' then
    raise exception 'approved_points_cannot_return_to_pending' using errcode='55000';
  end if;
  if v_old_status='cancelled' and p_status='pending' then
    raise exception 'cancelled_points_cannot_return_to_pending' using errcode='55000';
  end if;

  select nullif(trim(coalesce(v_row.branch, s.branch, '')), '')
    into v_effective_branch
  from public.staff s
  where s.id = v_row.staff_id
  limit 1;

  if not v_global and coalesce(v_effective_branch, '') <> coalesce(v_actor_branch, '') then
    raise exception 'branch_scope_denied';
  end if;

  update public.employee_transactions
  set status = p_status,
      description = case when p_description is null then description else p_description end,
      approved_by = case when p_status='active' then v_actor_id else approved_by end,
      approved_at = case when p_status='active' then now() else approved_at end,
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'last_transition_from',v_old_status,
        'last_transition_to',p_status,
        'last_transition_actor_id',v_actor_id,
        'last_transition_actor_role',v_actor_role,
        'last_transition_at',now(),
        'last_transition_note',nullif(trim(coalesce(p_description,'')),'')
      ),
      updated_at = now()
  where id = p_transaction_id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'previous_status', v_old_status,
    'staff_id', v_row.staff_id,
    'branch', v_effective_branch,
    'transition_actor_id', v_actor_id,
    'updated_at', v_row.updated_at
  );
end;
$function$;

revoke all on function public.transition_employee_points_transaction_v4(uuid,text,text) from public,anon;
grant execute on function public.transition_employee_points_transaction_v4(uuid,text,text) to authenticated,service_role;

notify pgrst,'reload schema';
