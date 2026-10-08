create or replace function public.employee_payroll_financial_composition_current_v1(
  p_staff_id uuid,
  p_month_cycle text
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_delivery boolean:=false;
  v_class jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_financial_current_input' using errcode='22023';
  end if;
  if not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then
    raise exception 'not_authorized_for_payroll_financial_current' using errcode='42501';
  end if;
  begin
    v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle);
    v_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false);
  exception when others then
    v_delivery:=false;
  end;
  if v_delivery then
    return public.employee_payroll_financial_composition_compat_v1(p_staff_id,p_month_cycle)
      || jsonb_build_object('current_route','delivery_v3_compat');
  end if;
  return public.employee_payroll_financial_composition_v2(p_staff_id,p_month_cycle)
    || jsonb_build_object('current_route','standard_v2');
end;
$$;

create or replace function public.employee_payroll_statement_current_v1(
  p_staff_id uuid,
  p_month_cycle text
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_employee_payroll_statement_current_input' using errcode='22023';
  end if;
  if not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then
    raise exception 'not_authorized_for_employee_payroll_statement_current' using errcode='42501';
  end if;
  return public.employee_payroll_statement_v2(p_staff_id,p_month_cycle);
end;
$$;

create or replace function public.employee_payroll_transparency_current_v1(
  p_staff_id uuid,
  p_month_cycle text
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_delivery boolean:=false;
  v_class jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_transparency_current_input' using errcode='22023';
  end if;
  if not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then
    raise exception 'not_authorized_for_payroll_transparency_current' using errcode='42501';
  end if;
  begin
    v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle);
    v_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false);
  exception when others then
    v_delivery:=false;
  end;
  if v_delivery then
    return public.employee_payroll_transparency_v2(p_staff_id,p_month_cycle)
      || jsonb_build_object('current_route','delivery_v2');
  end if;
  return public.employee_payroll_transparency_v1(p_staff_id,p_month_cycle)
    || jsonb_build_object('current_route','standard_v1');
end;
$$;

create or replace function public.payroll_finalization_gate_current_v1(
  p_staff_id uuid,
  p_month_cycle text
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_class jsonb;
  v_is_delivery boolean:=false;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_finalization_current_input' using errcode='22023';
  end if;
  if not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then
    raise exception 'not_authorized_for_payroll_finalization_current' using errcode='42501';
  end if;
  begin
    v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle);
    v_is_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false);
  exception when others then
    v_is_delivery:=false;
  end;
  if v_is_delivery then
    return public.payroll_finalization_gate_v2(p_staff_id,p_month_cycle)
      || jsonb_build_object('schema','payroll_finalization_gate_current_v1','route','delivery_v2');
  end if;
  return public.payroll_finalization_gate_v1(p_staff_id,p_month_cycle)
    || jsonb_build_object('schema','payroll_finalization_gate_current_v1','route','standard_v1');
end;
$$;

revoke all on function public.employee_payroll_financial_composition_current_v1(uuid,text) from public;
revoke all on function public.employee_payroll_statement_current_v1(uuid,text) from public;
revoke all on function public.employee_payroll_transparency_current_v1(uuid,text) from public;
revoke all on function public.payroll_finalization_gate_current_v1(uuid,text) from public;
revoke all on function public.payroll_final_snapshot_preview_v2(uuid,text) from public;
revoke all on function public.stage_payroll_final_snapshot_v2(uuid,text,text) from public;
revoke all on function public.compare_payroll_final_snapshot_v2(uuid) from public;
revoke all on function public.review_payroll_staged_snapshot_v2(uuid,text,text) from public;
revoke all on function public.list_payroll_snapshot_reviews_v2(uuid,integer) from public;
revoke all on function public.finalize_payroll_snapshot_v3(uuid) from public;

grant execute on function public.employee_payroll_financial_composition_current_v1(uuid,text) to anon, authenticated, service_role;
grant execute on function public.employee_payroll_statement_current_v1(uuid,text) to anon, authenticated, service_role;
grant execute on function public.employee_payroll_transparency_current_v1(uuid,text) to anon, authenticated, service_role;
grant execute on function public.payroll_finalization_gate_current_v1(uuid,text) to anon, authenticated, service_role;
grant execute on function public.payroll_final_snapshot_preview_v2(uuid,text) to anon, authenticated, service_role;
grant execute on function public.stage_payroll_final_snapshot_v2(uuid,text,text) to anon, authenticated, service_role;
grant execute on function public.compare_payroll_final_snapshot_v2(uuid) to anon, authenticated, service_role;
grant execute on function public.review_payroll_staged_snapshot_v2(uuid,text,text) to anon, authenticated, service_role;
grant execute on function public.list_payroll_snapshot_reviews_v2(uuid,integer) to anon, authenticated, service_role;
grant execute on function public.finalize_payroll_snapshot_v3(uuid) to anon, authenticated, service_role;
