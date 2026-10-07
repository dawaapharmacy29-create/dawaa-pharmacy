-- Harden the legacy-but-active customer follow-up request command.
-- Preserve its public RPC name for the current UI, but never trust creator identity or branch
-- supplied in the JSON payload.

alter function public.dawaa_create_customer_followup_request_v1(jsonb)
  rename to dawaa_create_customer_followup_request_legacy_v1;
revoke all on function public.dawaa_create_customer_followup_request_legacy_v1(jsonb)
  from public,anon,authenticated;
grant execute on function public.dawaa_create_customer_followup_request_legacy_v1(jsonb)
  to service_role;

create or replace function public.dawaa_create_customer_followup_request_v1(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor record;
  v_payload jsonb := coalesce(p_payload,'{}'::jsonb);
  v_requested_branch text := nullif(trim(coalesce(p_payload->>'branch','')),'');
  v_effective_branch text;
begin
  select * into v_actor
  from public.dawaa_current_followup_actor_v2(null)
  limit 1;

  if v_actor.role not in (
    'customer_service','customer_service_manager','pharmacist',
    'shift_supervisor_morning','shift_supervisor_evening','shift_supervisor_night',
    'branch_manager','general_manager','executive_manager','branches_manager','admin','owner'
  ) then
    raise exception 'followup_request_permission_denied' using errcode='42501';
  end if;

  if v_actor.role in ('general_manager','executive_manager','branches_manager','admin','owner') then
    v_effective_branch := coalesce(v_requested_branch,v_actor.branch);
  else
    if v_actor.branch is null then
      raise exception 'actor_branch_required' using errcode='42501';
    end if;
    if v_requested_branch is not null
       and public.dawaa_customer_request_branch_key(v_requested_branch)
           is distinct from public.dawaa_customer_request_branch_key(v_actor.branch) then
      raise exception 'followup_branch_scope_denied' using errcode='42501';
    end if;
    v_effective_branch := v_actor.branch;
  end if;

  if public.dawaa_customer_request_branch_key(v_effective_branch) is null then
    raise exception 'valid_followup_branch_required';
  end if;

  v_payload := v_payload
    || jsonb_build_object(
      'branch',v_effective_branch,
      'created_by',v_actor.account_id::text,
      'created_by_name',v_actor.actor_name,
      'requested_by',v_actor.actor_name
    );

  return public.dawaa_create_customer_followup_request_legacy_v1(v_payload);
end;
$function$;

revoke all on function public.dawaa_create_customer_followup_request_v1(jsonb) from public;
grant execute on function public.dawaa_create_customer_followup_request_v1(jsonb)
  to anon,authenticated,service_role;

comment on function public.dawaa_create_customer_followup_request_v1(jsonb) is
  'Current-actor-bound compatibility command. Caller JSON cannot spoof creator identity or escape the actor branch scope.';

notify pgrst,'reload schema';
