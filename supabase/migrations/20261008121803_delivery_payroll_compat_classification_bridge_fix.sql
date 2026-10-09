create or replace function public.employee_payroll_financial_composition_compat_v1(p_staff_id uuid,p_month_cycle text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_old jsonb; v_new jsonb; v_is_delivery boolean:=false;
  v_order numeric:=0; v_trip numeric:=0; v_monthly numeric:=0; v_quarterly numeric:=0; v_delivery_auto numeric:=0;
  v_base numeric:=0; v_ot numeric:=0; v_manual numeric:=0; v_preview numeric:=0;
  v_manual_adjustment numeric:=0; v_deductions numeric:=0; v_expiry numeric:=0; v_branch numeric:=0; v_individual numeric:=0; v_other numeric:=0;
  v_breakdown_classification jsonb:='{}'::jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'invalid_payroll_financial_compat_input' using errcode='22023'; end if;
  begin v_is_delivery:=coalesce((public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle)->>'payroll_eligible')::boolean,false); exception when others then v_is_delivery:=false; end;
  if not v_is_delivery then
    v_old:=public.employee_payroll_financial_composition_v2(p_staff_id,p_month_cycle);
    return v_old||jsonb_build_object('delivery_mode',false,'compat_adapter','standard_v2_passthrough');
  end if;

  v_new:=public.employee_payroll_financial_composition_v3(p_staff_id,p_month_cycle);
  if coalesce((v_new->>'frozen')::boolean,false) then
    return v_new||jsonb_build_object('compat_adapter','preserve_frozen_delivery_snapshot');
  end if;

  v_base:=coalesce((v_new->'earnings'->>'base_salary')::numeric,0);
  v_ot:=coalesce((v_new->'earnings'->>'approved_overtime')::numeric,0);
  v_order:=coalesce((v_new->'earnings'->>'approved_countable_orders')::numeric,0);
  v_trip:=coalesce((v_new->'earnings'->>'approved_countable_trips')::numeric,0);
  v_monthly:=coalesce((v_new->'earnings'->>'monthly_delivery_incentive')::numeric,0);
  v_quarterly:=coalesce((v_new->'earnings'->>'quarterly_delivery_incentive')::numeric,0);
  v_manual:=coalesce((v_new->'earnings'->>'manual_other_earnings')::numeric,0);
  v_delivery_auto:=round(v_order+v_trip+v_monthly+v_quarterly,2);
  v_preview:=coalesce((v_new->>'preview_net_salary')::numeric,0);
  v_breakdown_classification:=coalesce(v_new->'delivery_preview'->'classification',v_new->'delivery_classification','{}'::jsonb);

  select
    coalesce(sum(-e.signed_amount) filter(where e.entry_kind='deduction'),0),
    coalesce(sum(-e.signed_amount) filter(where e.entry_kind='deduction' and e.category='expiry_shortage'),0),
    coalesce(sum(-e.signed_amount) filter(where e.entry_kind='deduction' and e.category='branch_general'),0),
    coalesce(sum(-e.signed_amount) filter(where e.entry_kind='deduction' and e.category='individual'),0),
    coalesce(sum(-e.signed_amount) filter(where e.entry_kind='deduction' and e.category not in ('expiry_shortage','branch_general','individual')),0),
    coalesce(sum(e.signed_amount) filter(where e.entry_kind='adjustment'),0)
  into v_deductions,v_expiry,v_branch,v_individual,v_other,v_manual_adjustment
  from public.staff_payroll_manual_entries_v1 e where e.staff_id=p_staff_id and e.month_cycle=p_month_cycle;

  return jsonb_build_object(
    'schema','employee_payroll_financial_composition_v2','staff_id',p_staff_id,'month_cycle',p_month_cycle,
    'ready_for_finalization',coalesce((v_new->>'ready_for_finalization')::boolean,false),'source_mode','canonical_manual_ledger_v1',
    'earnings',jsonb_build_object(
      'base_salary',v_base,'automated_incentives_total',v_delivery_auto,
      'performance_incentive_included_in_automated_total',v_monthly,
      'target_bonus_included_in_automated_total',0,'followup_bonus_included_in_automated_total',0,
      'customer_request_bonus_included_in_automated_total',0,'branch_star_bonus_included_in_automated_total',0,
      'list_incentive',0,'approved_overtime',v_ot,'manual_other_incentives',v_manual
    ),
    'adjustments',jsonb_build_object(
      'manual_adjustment',v_manual_adjustment,'deductions_total',v_deductions,
      'expiry_shortage_deduction',v_expiry,'branch_general_deduction',v_branch,'individual_deduction',v_individual,'other_deduction',v_other
    ),
    'manual_ledger',coalesce(v_new->'manual_ledger','{}'::jsonb),
    'preview_net_salary',v_preview,'frozen',false,'frozen_net_salary',null,'display_net_salary',v_preview,
    'double_count_guard',jsonb_build_object(
      'monthly_incentive_component_reference_only',v_monthly,'generic_automated_incentives_excluded',true,'delivery_app_compensation_rates_ignored',true,
      'rule','delivery operational earnings + delivery incentives are represented once inside automated_incentives_total for V2 UI/PDF compatibility; detailed components are in delivery_breakdown'
    ),
    'blockers',coalesce(v_new->'blockers','[]'::jsonb),'warnings',coalesce(v_new->'warnings','[]'::jsonb),
    'delivery_mode',true,
    'delivery_breakdown',jsonb_build_object(
      'base_salary',v_base,'order_pay',v_order,'trip_pay',v_trip,'monthly_incentive',v_monthly,'quarterly_incentive',v_quarterly,
      'approved_overtime',v_ot,'operational_and_incentive_total',v_delivery_auto,
      'classification',v_breakdown_classification,'activity',coalesce(v_new->'delivery_preview'->'delivery_activity',v_new->'delivery_activity'),'preview',v_new->'delivery_preview'
    ),
    'generated_at',now()
  );
end;
$$;