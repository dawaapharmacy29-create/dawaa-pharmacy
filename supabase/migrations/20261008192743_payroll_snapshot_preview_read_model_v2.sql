create or replace function public.payroll_final_snapshot_preview_v2(p_staff_id uuid, p_month_cycle text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_gate jsonb;
  v_statement jsonb;
  v_financial jsonb;
  v_components jsonb;
  v_staff public.staff%rowtype;
  v_username text;
  v_snapshot jsonb;
  v_fingerprint_payload jsonb;
  v_delivery boolean := false;
  v_preview_route text;
  v_snapshot_schema text;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_snapshot_preview_v2_input' using errcode='22023';
  end if;

  if not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then
    raise exception 'not_authorized_for_payroll_snapshot_preview_v2' using errcode='42501';
  end if;

  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;

  select coalesce(
    nullif(v_staff.username,''),
    (select sa.username from public.staff_accounts sa where sa.staff_id=p_staff_id::text order by coalesce(sa.active,true) desc,sa.created_at desc nulls last limit 1),
    v_staff.name
  ) into v_username;

  -- Canonical read model: build the expensive truths once, then project them.
  v_gate:=public.payroll_finalization_gate_current_v1(p_staff_id,p_month_cycle);
  v_statement:=public.employee_payroll_statement_current_v1(p_staff_id,p_month_cycle);
  v_financial:=coalesce(v_statement->'financial','{}'::jsonb);
  v_components:=coalesce(v_statement->'payroll_components','{}'::jsonb);
  v_delivery:=coalesce((v_statement->>'delivery_mode')::boolean,false);
  v_preview_route:=case when v_delivery then 'delivery_v2' else 'standard_v1' end;
  v_snapshot_schema:=case when v_delivery then 'payroll_final_snapshot_v4_delivery_aware' else 'payroll_final_snapshot_v3' end;

  v_snapshot:=jsonb_build_object(
    'snapshot_schema',v_snapshot_schema,
    'snapshot_mode','preview_only',
    'fingerprint_schema','deterministic_without_generated_at_v1',
    'preview_route',v_preview_route,
    'staff_id',p_staff_id,
    'staff_username',v_username,
    'staff_name',v_staff.name,
    'branch',v_staff.branch,
    'month_cycle',p_month_cycle,
    'cycle_start',v_gate->>'cycle_start',
    'cycle_end',v_gate->>'cycle_end',
    'finalization_ready',coalesce((v_gate->>'ready')::boolean,false),
    'attendance_truth',v_gate->'attendance_gate',
    'policy_validation',coalesce(v_gate->'policy_validation','{}'::jsonb),
    'payroll_components',v_components,
    'financial_composition',v_financial,
    'employee_statement',v_statement,
    'blockers',coalesce(v_gate->'blockers','[]'::jsonb),
    'warnings',coalesce(v_gate->'warnings','[]'::jsonb),
    'generated_at',now()
  );

  if v_delivery then
    v_snapshot:=v_snapshot||jsonb_build_object(
      'delivery_classification',v_statement->'delivery_classification',
      'delivery_preview',v_statement->'delivery_preview'
    );
  end if;

  v_fingerprint_payload:=public.dawaa_jsonb_strip_generated_at_v1(v_snapshot);
  return v_snapshot||jsonb_build_object('snapshot_fingerprint',md5(v_fingerprint_payload::text));
end;
$function$;

revoke all on function public.payroll_final_snapshot_preview_v2(uuid,text) from public;
grant execute on function public.payroll_final_snapshot_preview_v2(uuid,text) to anon,authenticated,service_role;