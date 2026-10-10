-- Delivery Payroll Stage Audit Action Fix
-- Keep payroll_snapshot_audit action values canonical (staged/reused) while preserving V2 route/version in metadata.

create or replace function public.stage_payroll_final_snapshot_v2(
  p_staff_id uuid,
  p_month_cycle text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_preview jsonb;
  v_row public.payroll_final_snapshot_staging%rowtype;
  v_existing boolean:=false;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_snapshot_stage_v2_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)
    and coalesce(can_login,false);

  if not found
     or not public.dawaa_current_actor_can(array['manage_payroll'])
     or not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then
    raise exception 'not_authorized_for_payroll_snapshot_stage_v2' using errcode='42501';
  end if;

  v_preview:=public.payroll_final_snapshot_preview_v2(p_staff_id,p_month_cycle);

  select * into v_row
  from public.payroll_final_snapshot_staging
  where staff_id=p_staff_id
    and month_cycle=p_month_cycle
    and snapshot_fingerprint=v_preview->>'snapshot_fingerprint'
  order by created_at desc
  limit 1;

  if found then
    v_existing:=true;
  else
    insert into public.payroll_final_snapshot_staging(
      staff_id,staff_username,staff_name,branch,month_cycle,cycle_start,cycle_end,
      finalization_ready,snapshot_fingerprint,payload,note,created_by,created_by_name
    )
    values(
      p_staff_id,
      v_preview->>'staff_username',
      v_preview->>'staff_name',
      v_preview->>'branch',
      p_month_cycle,
      nullif(v_preview->>'cycle_start','')::date,
      nullif(v_preview->>'cycle_end','')::date,
      coalesce((v_preview->>'finalization_ready')::boolean,false),
      v_preview->>'snapshot_fingerprint',
      v_preview,
      nullif(trim(coalesce(p_note,'')),''),
      v_actor.id,
      coalesce(v_actor.name,v_actor.username)
    ) returning * into v_row;
  end if;

  insert into public.payroll_snapshot_audit(
    snapshot_id,action,staff_id,month_cycle,snapshot_fingerprint,
    actor_id,actor_name,note,metadata
  )
  values(
    v_row.id,
    case when v_existing then 'reused' else 'staged' end,
    p_staff_id,
    p_month_cycle,
    v_row.snapshot_fingerprint,
    v_actor.id,
    coalesce(v_actor.name,v_actor.username),
    nullif(trim(coalesce(p_note,'')),''),
    jsonb_build_object(
      'finalization_ready',v_row.finalization_ready,
      'snapshot_schema',v_preview->>'snapshot_schema',
      'preview_route',v_preview->>'preview_route',
      'preview_generated_at',v_preview->>'generated_at'
    )
  );

  return jsonb_build_object(
    'success',true,
    'existing',v_existing,
    'snapshot',to_jsonb(v_row)
  );
end;
$$;
