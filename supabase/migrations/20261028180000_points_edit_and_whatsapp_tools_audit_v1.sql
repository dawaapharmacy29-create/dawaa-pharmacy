-- Owner decisions (2026-10-28):
--   1. Changing a points transaction after it was decided (cancel an active one, reactivate, rewrite
--      its note) belongs to the branches manager level, not the branch manager. Branch managers keep
--      recording rewards/deductions and deciding pending ones (approve / reject).
--   2. WhatsApp capture and sales-intelligence QA tools: every change a person makes through them is
--      recorded in activity_log (who, when, what changed). System jobs (no session) are not logged.
--
-- Values (points, amount, reason, staff, ...) of an existing transaction were already immutable for
-- API callers (protect_employee_transaction_ledger_payload_v2); this closes the status/note path.
-- Verified by scripts/verification/test-points-edit-and-whatsapp-audit-native.mjs.
--
-- Rollback:
--   * get_user_permissions: re-run the patch with the two snippets swapped.
--   * transition_employee_points_transaction_v4: drop the "decided rows" check.
--   * drop trigger guard_points_transaction_decision_v1 on public.employee_transactions;
--   * drop the audit_whatsapp_tool_change_v1 triggers and function.

begin;

-- 1a. get_user_permissions: branch_manager no longer receives edit_points_transaction.
-- Patched in place so the rest of the live body stays exactly as it is.
do $patch$
declare
  v_def text := pg_get_functiondef('public.get_user_permissions(uuid)'::regprocedure);
  v_old text := $old$  if v_role_key in ('general_manager','executive_manager','branches_manager','admin','branch_manager') then
    v_can_view_points := true; v_can_manage_points := true; v_can_approve_points := true; v_can_create_reward := true; v_can_create_deduction := true; v_can_edit_points_transaction := true; v_can_export_points_report := true;
  elsif$old$;
  v_new text := $new$  if v_role_key in ('general_manager','executive_manager','branches_manager','admin') then
    v_can_view_points := true; v_can_manage_points := true; v_can_approve_points := true; v_can_create_reward := true; v_can_create_deduction := true; v_can_edit_points_transaction := true; v_can_export_points_report := true;
  elsif v_role_key = 'branch_manager' then
    v_can_view_points := true; v_can_manage_points := true; v_can_approve_points := true; v_can_create_reward := true; v_can_create_deduction := true; v_can_export_points_report := true;
  elsif$new$;
begin
  if position(v_new in v_def) > 0 then
    return; -- already applied
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'get_user_permissions points block not found exactly once; refusing to patch';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- 1b. The status RPC: below the branches-manager level only pending rows can be decided.
create or replace function public.transition_employee_points_transaction_v4(p_transaction_id uuid, p_status text, p_description text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
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

  if not v_global and not (lower(coalesce(v_row.status, '')) = 'pending' and p_status in ('active', 'cancelled')) then
    raise exception 'points_decision_change_requires_branches_manager';
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
$function$;

-- 1c. Direct table updates (manual points sources) follow the same rule as the RPC.
-- SECURITY INVOKER on purpose: current_user is the API role for direct table updates and the
-- definer for commands such as the RPC above, which enforce their own rules (same test as
-- protect_employee_transaction_ledger_payload_v2).
create or replace function public.guard_points_transaction_decision_v1()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_role text;
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;
  v_role := lower(trim(coalesce(public.employee_operating_actor_role(), '')));
  if v_role in ('general_manager', 'admin', 'executive_manager', 'branches_manager') then
    return new;
  end if;
  if lower(coalesce(old.status, '')) = 'pending' and lower(coalesce(new.status, '')) in ('active', 'cancelled') then
    return new;
  end if;
  raise exception 'points_decision_change_requires_branches_manager' using errcode = '42501';
end;
$function$;

drop trigger if exists guard_points_transaction_decision_v1 on public.employee_transactions;
create trigger guard_points_transaction_decision_v1
  before update of status on public.employee_transactions
  for each row
  when (old.source in ('manual_admin', 'manual', 'penalty_incentive', 'penalty_management'))
  execute function public.guard_points_transaction_decision_v1();

-- 2. WhatsApp capture / sales-intelligence QA: record every change made by a signed-in person.
create or replace function public.audit_whatsapp_tool_change_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_key text;
  v_name text;
  v_role text;
  v_branch text;
  -- Identity fields kept for inserts/deletes; conversation text and analysis blobs are never copied.
  v_identity text[] := array['id','case_id','branch','status','review_status','case_state','work_status','action_type','stage','source_filename','staff_name'];
begin
  if v_actor is null then
    return null; -- system job, not a person
  end if;

  if tg_op = 'UPDATE' then
    for v_key in select k from jsonb_object_keys(v_new) k loop
      continue when v_key in ('updated_at');
      continue when (v_old -> v_key) is not distinct from (v_new -> v_key);
      v_before := v_before || jsonb_build_object(v_key, case when length((v_old -> v_key)::text) > 300 then to_jsonb('[' || length((v_old -> v_key)::text) || ' chars]') else v_old -> v_key end);
      v_after := v_after || jsonb_build_object(v_key, case when length((v_new -> v_key)::text) > 300 then to_jsonb('[' || length((v_new -> v_key)::text) || ' chars]') else v_new -> v_key end);
    end loop;
    if v_after = '{}'::jsonb then
      return null; -- nothing changed
    end if;
  else
    select coalesce(jsonb_object_agg(k, v_row -> k), '{}'::jsonb) into v_after
    from unnest(v_identity) k where v_row ? k;
    if tg_op = 'DELETE' then
      v_before := v_after;
      v_after := null;
    else
      v_before := null;
    end if;
  end if;

  select coalesce(nullif(trim(sa.name), ''), sa.staff_name, sa.username), lower(trim(coalesce(sa.role, ''))), sa.branch
    into v_name, v_role, v_branch
  from public.staff_accounts sa where sa.id = v_actor;

  insert into public.activity_log(action, description, user_id, user_name, user_role, branch, module, operation,
    entity_type, entity_id, before_data, after_data, created_at)
  values ('whatsapp_tool_' || lower(tg_op), tg_table_name || ' ' || lower(tg_op), v_actor::text, v_name, v_role,
    coalesce(v_row ->> 'branch', v_branch), 'whatsapp_tools', lower(tg_op),
    tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'case_id'), v_before, v_after, now());
  return null;
end;
$function$;

do $attach$
declare
  v_table text;
begin
  foreach v_table in array array[
    'whatsapp_review_sources', 'sales_intelligence_cases', 'conversation_sales_reviews',
    'whatsapp_conversation_actions', 'whatsapp_customer_cases_v22', 'sales_intelligence_policy_config',
    'whatsapp_auto_followup_requests', 'whatsapp_case_stage_ownership_v23'
  ] loop
    if to_regclass('public.' || v_table) is null then
      continue;
    end if;
    execute format('drop trigger if exists audit_whatsapp_tool_change_v1 on public.%I', v_table);
    execute format('create trigger audit_whatsapp_tool_change_v1 after insert or update or delete on public.%I
      for each row execute function public.audit_whatsapp_tool_change_v1()', v_table);
  end loop;
end;
$attach$;

revoke all on function public.guard_points_transaction_decision_v1() from public, anon, authenticated;
revoke all on function public.audit_whatsapp_tool_change_v1() from public, anon, authenticated;

commit;
