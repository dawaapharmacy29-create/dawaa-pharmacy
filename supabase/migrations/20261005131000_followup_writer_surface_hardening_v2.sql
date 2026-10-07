-- Follow-up / customer-service writer-surface hardening V2.
-- Keep active UI commands working under the same RPC names, but bind every mutation to the
-- authenticated Dawaa staff account rather than caller-supplied actor ids/names.
-- Maintenance and points settlement functions become service-only.

create or replace function public.dawaa_current_followup_actor_v2(p_claimed_actor text default null)
returns table(
  account_id uuid,
  staff_id text,
  actor_name text,
  role text,
  branch text
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_current uuid := public.dawaa_current_staff_account_id_strict();
begin
  if v_current is null then
    raise exception 'not_authorized' using errcode='42501';
  end if;

  return query
  select
    a.id,
    nullif(trim(coalesce(a.staff_id,'')),''),
    coalesce(nullif(trim(coalesce(a.name,'')),''),nullif(trim(coalesce(a.staff_name,'')),''),nullif(trim(coalesce(a.username,'')),''),'مستخدم'),
    lower(trim(coalesce(a.role,''))),
    nullif(trim(coalesce(a.branch,'')),'')
  from public.staff_accounts a
  where a.id=v_current
    and coalesce(a.active,false)=true
    and coalesce(a.can_login,false)=true
    and (
      nullif(trim(coalesce(p_claimed_actor,'')),'') is null
      or trim(p_claimed_actor)=a.id::text
      or trim(p_claimed_actor)=nullif(trim(coalesce(a.staff_id,'')),'')
    );

  if not found then
    raise exception 'actor_mismatch_or_inactive_account' using errcode='42501';
  end if;
end;
$function$;

revoke all on function public.dawaa_current_followup_actor_v2(text) from public,anon,authenticated;
grant execute on function public.dawaa_current_followup_actor_v2(text) to service_role;

-- -----------------------------------------------------------------------------
-- Active UI writer: customer-data correction.
-- Preserve implementation as service-only legacy body; expose a bound wrapper under same name.
-- -----------------------------------------------------------------------------
alter function public.correct_customer_followup_data_v1(text,text,text,text,text,text,text,text)
  rename to correct_customer_followup_data_legacy_v1;
revoke all on function public.correct_customer_followup_data_legacy_v1(text,text,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.correct_customer_followup_data_legacy_v1(text,text,text,text,text,text,text,text)
  to service_role;

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
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor record;
  v_followup_branch text;
begin
  select * into v_actor from public.dawaa_current_followup_actor_v2(p_actor_staff_id) limit 1;

  if v_actor.role not in ('customer_service','customer_service_manager','general_manager','executive_manager','branches_manager','branch_manager','admin','owner') then
    raise exception 'customer_correction_permission_denied' using errcode='42501';
  end if;

  select branch into v_followup_branch
  from public.daily_followups
  where id::text=trim(p_followup_id)
  limit 1;
  if v_followup_branch is null then raise exception 'followup_not_found'; end if;

  if v_actor.role not in ('general_manager','executive_manager','branches_manager','admin','owner')
     and public.dawaa_customer_request_branch_key(v_followup_branch)
         is distinct from public.dawaa_customer_request_branch_key(v_actor.branch) then
    raise exception 'followup_branch_scope_denied' using errcode='42501';
  end if;

  return public.correct_customer_followup_data_legacy_v1(
    p_followup_id,p_customer_name,p_customer_code,p_customer_phone,p_branch,
    v_actor.account_id::text,v_actor.actor_name,p_note
  );
end;
$function$;

revoke all on function public.correct_customer_followup_data_v1(text,text,text,text,text,text,text,text) from public;
grant execute on function public.correct_customer_followup_data_v1(text,text,text,text,text,text,text,text)
  to anon,authenticated,service_role;

-- -----------------------------------------------------------------------------
-- Active UI writer: duplicate merge.
-- -----------------------------------------------------------------------------
alter function public.merge_open_followup_duplicates_v1(text,text[],text,text,text)
  rename to merge_open_followup_duplicates_legacy_v1;
revoke all on function public.merge_open_followup_duplicates_legacy_v1(text,text[],text,text,text)
  from public,anon,authenticated;
grant execute on function public.merge_open_followup_duplicates_legacy_v1(text,text[],text,text,text)
  to service_role;

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
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor record;
  v_branch text;
begin
  select * into v_actor from public.dawaa_current_followup_actor_v2(p_actor_staff_id) limit 1;
  if v_actor.role not in ('customer_service_manager','general_manager','executive_manager','branch_manager','branches_manager','admin','owner') then
    raise exception 'duplicate_merge_permission_denied' using errcode='42501';
  end if;

  select branch into v_branch from public.daily_followups where id::text=trim(p_canonical_id) limit 1;
  if v_branch is null then raise exception 'canonical_open_followup_not_found'; end if;
  if v_actor.role not in ('general_manager','executive_manager','branches_manager','admin','owner')
     and public.dawaa_customer_request_branch_key(v_branch)
         is distinct from public.dawaa_customer_request_branch_key(v_actor.branch) then
    raise exception 'followup_branch_scope_denied' using errcode='42501';
  end if;

  if exists (
    select 1 from public.daily_followups d
    where d.id::text=any(coalesce(p_duplicate_ids,'{}'::text[]))
      and public.dawaa_customer_request_branch_key(d.branch)
          is distinct from public.dawaa_customer_request_branch_key(v_branch)
  ) then
    raise exception 'cross_branch_duplicate_merge_denied' using errcode='42501';
  end if;

  return public.merge_open_followup_duplicates_legacy_v1(
    p_canonical_id,p_duplicate_ids,v_actor.account_id::text,v_actor.actor_name,p_reason
  );
end;
$function$;

revoke all on function public.merge_open_followup_duplicates_v1(text,text[],text,text,text) from public;
grant execute on function public.merge_open_followup_duplicates_v1(text,text[],text,text,text)
  to anon,authenticated,service_role;

-- -----------------------------------------------------------------------------
-- Active UI writer: branch transfer.
-- -----------------------------------------------------------------------------
alter function public.transfer_customer_followup_branch_v1(text,text,text,text,text)
  rename to transfer_customer_followup_branch_legacy_v1;
revoke all on function public.transfer_customer_followup_branch_legacy_v1(text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.transfer_customer_followup_branch_legacy_v1(text,text,text,text,text)
  to service_role;

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
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor record;
  v_source_branch text;
begin
  select * into v_actor from public.dawaa_current_followup_actor_v2(p_actor_staff_id) limit 1;
  if v_actor.role not in (
    'customer_service','customer_service_manager','pharmacist',
    'shift_supervisor_morning','shift_supervisor_evening','shift_supervisor_night',
    'branch_manager','general_manager','executive_manager','branches_manager','admin','owner'
  ) then
    raise exception 'followup_transfer_permission_denied' using errcode='42501';
  end if;

  select branch into v_source_branch from public.daily_followups where id::text=trim(p_followup_id) limit 1;
  if v_source_branch is null then raise exception 'followup_not_found'; end if;
  if v_actor.role not in ('general_manager','executive_manager','branches_manager','admin','owner')
     and public.dawaa_customer_request_branch_key(v_source_branch)
         is distinct from public.dawaa_customer_request_branch_key(v_actor.branch) then
    raise exception 'followup_branch_scope_denied' using errcode='42501';
  end if;

  return public.transfer_customer_followup_branch_legacy_v1(
    p_followup_id,p_target_branch,v_actor.account_id::text,v_actor.actor_name,p_reason
  );
end;
$function$;

revoke all on function public.transfer_customer_followup_branch_v1(text,text,text,text,text) from public;
grant execute on function public.transfer_customer_followup_branch_v1(text,text,text,text,text)
  to anon,authenticated,service_role;

-- -----------------------------------------------------------------------------
-- Active UI writer: follow-up result import.
-- -----------------------------------------------------------------------------
alter function public.import_customer_followup_results_v1(uuid,text,text,jsonb)
  rename to import_customer_followup_results_legacy_v1;
revoke all on function public.import_customer_followup_results_legacy_v1(uuid,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.import_customer_followup_results_legacy_v1(uuid,text,text,jsonb)
  to service_role;

create or replace function public.import_customer_followup_results_v1(
  p_actor_id uuid,
  p_branch text,
  p_file_name text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor record;
begin
  select * into v_actor from public.dawaa_current_followup_actor_v2(p_actor_id::text) limit 1;
  return public.import_customer_followup_results_legacy_v1(v_actor.account_id,p_branch,p_file_name,p_rows);
end;
$function$;

revoke all on function public.import_customer_followup_results_v1(uuid,text,text,jsonb) from public;
grant execute on function public.import_customer_followup_results_v1(uuid,text,text,jsonb)
  to anon,authenticated,service_role;

-- -----------------------------------------------------------------------------
-- Active UI writer: smart queue import V4.
-- -----------------------------------------------------------------------------
alter function public.import_customer_service_queue_results_v4(uuid,text,text,jsonb)
  rename to import_customer_service_queue_results_legacy_v4;
revoke all on function public.import_customer_service_queue_results_legacy_v4(uuid,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.import_customer_service_queue_results_legacy_v4(uuid,text,text,jsonb)
  to service_role;

create or replace function public.import_customer_service_queue_results_v4(
  p_actor_id uuid,
  p_branch text,
  p_file_name text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor record;
begin
  select * into v_actor from public.dawaa_current_followup_actor_v2(p_actor_id::text) limit 1;
  return public.import_customer_service_queue_results_legacy_v4(v_actor.account_id,p_branch,p_file_name,p_rows);
end;
$function$;

revoke all on function public.import_customer_service_queue_results_v4(uuid,text,text,jsonb) from public;
grant execute on function public.import_customer_service_queue_results_v4(uuid,text,text,jsonb)
  to anon,authenticated,service_role;

-- Older smart-queue import generations are no longer called by the current UI.
revoke all on function public.import_customer_service_queue_results_v2(uuid,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.import_customer_service_queue_results_v2(uuid,text,text,jsonb)
  to service_role;
revoke all on function public.import_customer_service_queue_results_v3(uuid,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.import_customer_service_queue_results_v3(uuid,text,text,jsonb)
  to service_role;

-- -----------------------------------------------------------------------------
-- Maintenance / trigger / points functions: never client-callable.
-- Trigger execution does not require client EXECUTE privilege.
-- -----------------------------------------------------------------------------
revoke all on function public.apply_followup_incentive_points() from public,anon,authenticated;
grant execute on function public.apply_followup_incentive_points() to service_role;

revoke all on function public.compute_followup_points(text) from public,anon,authenticated;
grant execute on function public.compute_followup_points(text) to service_role;

revoke all on function public.flag_burst_followup_registrations() from public,anon,authenticated;
grant execute on function public.flag_burst_followup_registrations() to service_role;

revoke all on function public.repair_customer_followup_duplicates_and_branches() from public,anon,authenticated;
grant execute on function public.repair_customer_followup_duplicates_and_branches() to service_role;

revoke all on function public.settle_doctor_self_logged_followup(text) from public,anon,authenticated;
grant execute on function public.settle_doctor_self_logged_followup(text) to service_role;

revoke all on function public.settle_followup_doctor_points(text,text) from public,anon,authenticated;
grant execute on function public.settle_followup_doctor_points(text,text) to service_role;

revoke all on function public.dawaa_sync_whatsapp_action_evidence_v17() from public,anon,authenticated;
grant execute on function public.dawaa_sync_whatsapp_action_evidence_v17() to service_role;

revoke all on function public.dawaa_sync_whatsapp_invoice_evidence_v17() from public,anon,authenticated;
grant execute on function public.dawaa_sync_whatsapp_invoice_evidence_v17() to service_role;

revoke all on function public.trg_monthly_narrative_evaluation_notify() from public,anon,authenticated;
grant execute on function public.trg_monthly_narrative_evaluation_notify() to service_role;

comment on function public.dawaa_current_followup_actor_v2(text) is
  'Binds customer-service mutations to the current Dawaa login account. Caller-supplied actor ids are accepted only when they identify that same account/staff row.';

notify pgrst,'reload schema';
