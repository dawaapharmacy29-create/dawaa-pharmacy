-- Architecture hardening v4:
-- 1) Retire legacy evaluation rules that have no live ledger usage.
-- 2) Move employee transaction lifecycle changes behind an authorization-aware RPC.

update public.evaluation_rules er
set active = false,
    is_active = false,
    updated_at = now()
where coalesce(nullif(trim(er.rule_code), ''), nullif(trim(er.rule_key), ''), '') like 'legacy_rule_%'
  and coalesce(er.active, er.is_active, true)
  and not exists (
    select 1
    from public.employee_transactions et
    where et.status in ('active', 'approved', 'pending')
      and (
        coalesce(et.metadata ->> 'rule_code', '') = coalesce(nullif(trim(er.rule_code), ''), nullif(trim(er.rule_key), ''), '')
        or coalesce(et.description, '') like ('%__RULE__:' || coalesce(nullif(trim(er.rule_code), ''), nullif(trim(er.rule_key), ''), '') || '%')
      )
  );

create or replace function public.transition_employee_points_transaction_v4(
  p_transaction_id uuid,
  p_status text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor_role text := lower(trim(coalesce(public.employee_operating_actor_role(), '')));
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(), '')), '');
  v_global boolean := v_actor_role in ('general_manager', 'admin', 'executive_manager', 'branches_manager');
  v_row public.employee_transactions%rowtype;
  v_effective_branch text;
begin
  if p_status not in ('pending', 'active', 'cancelled') then
    raise exception 'invalid_status';
  end if;

  if not public.employee_operating_can_manage() then
    raise exception 'not_authorized';
  end if;

  select et.*
    into v_row
  from public.employee_transactions et
  where et.id = p_transaction_id
  for update;

  if not found then
    raise exception 'transaction_not_found';
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
      updated_at = now()
  where id = p_transaction_id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'staff_id', v_row.staff_id,
    'branch', v_effective_branch,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.transition_employee_points_transaction_v4(uuid, text, text) from public;
grant execute on function public.transition_employee_points_transaction_v4(uuid, text, text) to anon, authenticated;
