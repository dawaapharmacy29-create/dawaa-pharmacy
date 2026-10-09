-- Payroll routing must fail closed when delivery classification is unavailable.
--
-- Several current payroll functions historically wrapped delivery classification with
-- `exception when others then ... := false`, silently routing a failed classification to the
-- standard-payroll path. That can change the salary engine selected for a delivery employee.
--
-- This migration adds one strict classification boundary and rewires every live router/calculator
-- that still contains that fallback. A successful canonical classification with
-- payroll_eligible=false remains a valid standard route. Missing/invalid eligibility or a failed
-- classification blocks the read/finalization instead of inventing a standard classification.

create or replace function public.dawaa_delivery_payroll_classification_strict_v1(
  p_staff_id uuid,
  p_month_cycle text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_class jsonb;
begin
  begin
    v_class := public.dawaa_delivery_payroll_classification_v1(p_staff_id, p_month_cycle);
  exception
    when sqlstate '22023' then raise;
    when sqlstate '42501' then raise;
    when others then
      raise exception 'delivery_payroll_classification_unavailable' using errcode='55000';
  end;

  if v_class is null
     or not (v_class ? 'payroll_eligible')
     or jsonb_typeof(v_class->'payroll_eligible') <> 'boolean' then
    raise exception 'delivery_payroll_classification_unavailable: %',
      coalesce(v_class->>'status','missing_payroll_eligible')
      using errcode='55000';
  end if;

  return v_class;
end;
$function$;

revoke all on function public.dawaa_delivery_payroll_classification_strict_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.dawaa_delivery_payroll_classification_strict_v1(uuid,text) to service_role;

-- Patch the final definitions in-place. Every anchor must exist exactly once; otherwise stop instead
-- of guessing against a drifted payroll function.
do $migration$
declare
  v_sig text;
  v_oid regprocedure;
  v_def text;
  v_old text;
  v_new text;
  v_hits integer;
  v_is_delivery_targets text[] := array[
    'public.payroll_finalization_gate_v2(uuid,text)',
    'public.payroll_finalization_gate_current_v1(uuid,text)',
    'public.employee_payroll_financial_composition_v3(uuid,text)',
    'public.employee_payroll_transparency_v2(uuid,text)'
  ];
  v_delivery_targets text[] := array[
    'public.employee_payroll_financial_composition_current_v1(uuid,text)',
    'public.employee_payroll_transparency_current_v1(uuid,text)',
    'public.employee_payroll_statement_v2(uuid,text)'
  ];
begin
  v_old := 'begin v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle); v_is_delivery:=coalesce((v_class->>''payroll_eligible'')::boolean,false); exception when others then v_is_delivery:=false; end;';
  v_new := 'v_class:=public.dawaa_delivery_payroll_classification_strict_v1(p_staff_id,p_month_cycle); v_is_delivery:=(v_class->>''payroll_eligible'')::boolean;';
  foreach v_sig in array v_is_delivery_targets loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then raise exception 'payroll classification fail-closed: missing %',v_sig; end if;
    v_def := pg_get_functiondef(v_oid);
    v_hits := (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old);
    if v_hits <> 1 then raise exception 'payroll classification fail-closed: expected one legacy fallback in %, found %',v_sig,v_hits; end if;
    execute replace(v_def,v_old,v_new);
  end loop;

  v_old := 'begin v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle); v_delivery:=coalesce((v_class->>''payroll_eligible'')::boolean,false); exception when others then v_delivery:=false; end;';
  v_new := 'v_class:=public.dawaa_delivery_payroll_classification_strict_v1(p_staff_id,p_month_cycle); v_delivery:=(v_class->>''payroll_eligible'')::boolean;';
  foreach v_sig in array v_delivery_targets loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then raise exception 'payroll classification fail-closed: missing %',v_sig; end if;
    v_def := pg_get_functiondef(v_oid);
    v_hits := (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old);
    if v_hits <> 1 then raise exception 'payroll classification fail-closed: expected one legacy fallback in %, found %',v_sig,v_hits; end if;
    execute replace(v_def,v_old,v_new);
  end loop;

  v_sig := 'public.employee_payroll_financial_composition_compat_v1(uuid,text)';
  v_oid := to_regprocedure(v_sig);
  if v_oid is null then raise exception 'payroll classification fail-closed: missing %',v_sig; end if;
  v_def := pg_get_functiondef(v_oid);
  v_old := 'begin v_is_delivery:=coalesce((public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle)->>''payroll_eligible'')::boolean,false); exception when others then v_is_delivery:=false; end;';
  v_new := 'v_is_delivery:=(public.dawaa_delivery_payroll_classification_strict_v1(p_staff_id,p_month_cycle)->>''payroll_eligible'')::boolean;';
  v_hits := (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old);
  if v_hits <> 1 then raise exception 'payroll classification fail-closed: expected one legacy fallback in %, found %',v_sig,v_hits; end if;
  execute replace(v_def,v_old,v_new);

  v_sig := 'public.finalize_payroll_snapshot_v3(uuid)';
  v_oid := to_regprocedure(v_sig);
  if v_oid is null then raise exception 'payroll classification fail-closed: missing %',v_sig; end if;
  v_def := pg_get_functiondef(v_oid);
  v_old := 'begin v_class:=public.dawaa_delivery_payroll_classification_v1(v_snapshot.staff_id,v_snapshot.month_cycle); v_delivery:=coalesce((v_class->>''payroll_eligible'')::boolean,false); exception when others then v_delivery:=false; end;';
  v_new := 'v_class:=public.dawaa_delivery_payroll_classification_strict_v1(v_snapshot.staff_id,v_snapshot.month_cycle); v_delivery:=(v_class->>''payroll_eligible'')::boolean;';
  v_hits := (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old);
  if v_hits <> 1 then raise exception 'payroll classification fail-closed: expected one legacy fallback in %, found %',v_sig,v_hits; end if;
  execute replace(v_def,v_old,v_new);
end;
$migration$;

comment on function public.dawaa_delivery_payroll_classification_strict_v1(uuid,text) is
  'Fail-closed payroll routing boundary: a canonical classification must explicitly provide boolean payroll_eligible; unavailable classification never falls back to standard payroll.';
