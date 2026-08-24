-- Align incentive governance with the canonical incentive permissions from permissionSystem.ts.
-- Global governance is a stronger capability than branch payroll management.

CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_staff_account_id uuid;
  v_role text;
  v_allowed_pages text[];
  v_account_permissions jsonb := '{}'::jsonb;
  v_role_json jsonb := '{}'::jsonb;
  v_pages_json jsonb := '{}'::jsonb;
  v_override_json jsonb := '{}'::jsonb;
  v_effective jsonb := '{}'::jsonb;
  v_role_key text;
  v_can_view_reviews boolean := false;
  v_can_add_reviews boolean := false;
  v_can_edit_reviews boolean := false;
  v_can_approve_reviews boolean := false;
  v_can_delete_reviews boolean := false;
  v_can_view_shift_performance boolean := false;
  v_can_create_shift_evaluation boolean := false;
  v_can_edit_shift_evaluation boolean := false;
  v_can_approve_shift_evaluation boolean := false;
  v_can_delete_shift_evaluation boolean := false;
  v_can_view_points boolean := false;
  v_can_manage_points boolean := false;
  v_can_approve_points boolean := false;
  v_can_create_reward boolean := false;
  v_can_create_deduction boolean := false;
  v_can_edit_points_transaction boolean := false;
  v_can_export_points_report boolean := false;
  v_can_view_salary_calculator boolean := false;
  v_can_manage_payroll boolean := false;
  v_can_view_incentives boolean := false;
  v_can_manage_incentives boolean := false;
  v_can_view_quarterly_incentives boolean := false;
  v_can_manage_quarterly_incentives boolean := false;
  v_can_view_penalty_management boolean := false;
  v_can_manage_penalty_management boolean := false;
begin
  select id, role, allowed_pages, coalesce(permissions, '{}'::jsonb)
  into v_staff_account_id, v_role, v_allowed_pages, v_account_permissions
  from public.staff_accounts
  where (id = p_user_id or auth_user_id = p_user_id)
    and coalesce(active, false)
    and coalesce(can_login, false)
  order by case when id = p_user_id then 0 else 1 end, updated_at desc nulls last
  limit 1;
  if v_staff_account_id is null then return '{}'::jsonb; end if;

  select coalesce(jsonb_object_agg(permission_key, allowed), '{}'::jsonb) into v_role_json
  from public.app_role_section_permissions where role_key = v_role;
  select coalesce(jsonb_object_agg(x, true), '{}'::jsonb) into v_pages_json
  from unnest(coalesce(v_allowed_pages, '{}'::text[])) as x;
  select coalesce(jsonb_object_agg(permission_key, allowed), '{}'::jsonb) into v_override_json
  from public.staff_permission_overrides where staff_account_id = v_staff_account_id;
  v_effective := v_role_json || v_pages_json || v_account_permissions || v_override_json;
  v_role_key := lower(trim(coalesce(v_role, '')));

  if v_role_key in ('general_manager','executive_manager','branches_manager','admin') then
    v_can_view_reviews := true; v_can_add_reviews := true; v_can_edit_reviews := true; v_can_approve_reviews := true; v_can_delete_reviews := true;
  elsif v_role_key in ('branch_manager','customer_service_manager') then
    v_can_view_reviews := true; v_can_add_reviews := true; v_can_edit_reviews := true; v_can_approve_reviews := true;
  elsif v_role_key in ('shift_supervisor_morning','shift_supervisor_evening','customer_service') then
    v_can_view_reviews := true; v_can_add_reviews := true;
  elsif v_role_key = 'pharmacist' then v_can_view_reviews := true;
  end if;
  v_effective := jsonb_set(v_effective, '{view_reviews}', to_jsonb(v_can_view_reviews and coalesce(nullif(v_account_permissions->>'view_reviews','')::boolean, true) and coalesce(nullif(v_override_json->>'view_reviews','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{add_reviews}', to_jsonb(v_can_add_reviews and coalesce(nullif(v_account_permissions->>'add_reviews','')::boolean, true) and coalesce(nullif(v_override_json->>'add_reviews','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{edit_reviews}', to_jsonb(v_can_edit_reviews and coalesce(nullif(v_account_permissions->>'edit_reviews','')::boolean, true) and coalesce(nullif(v_override_json->>'edit_reviews','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{approve_reviews}', to_jsonb(v_can_approve_reviews and coalesce(nullif(v_account_permissions->>'approve_reviews','')::boolean, true) and coalesce(nullif(v_override_json->>'approve_reviews','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{delete_reviews}', to_jsonb(v_can_delete_reviews and coalesce(nullif(v_account_permissions->>'delete_reviews','')::boolean, true) and coalesce(nullif(v_override_json->>'delete_reviews','')::boolean, true)), true);

  if v_role_key in ('general_manager','executive_manager','branches_manager','admin') then
    v_can_view_shift_performance := true; v_can_create_shift_evaluation := true; v_can_edit_shift_evaluation := true; v_can_approve_shift_evaluation := true; v_can_delete_shift_evaluation := true;
  elsif v_role_key = 'branch_manager' then
    v_can_view_shift_performance := true; v_can_create_shift_evaluation := true; v_can_edit_shift_evaluation := true; v_can_approve_shift_evaluation := true;
  elsif v_role_key in ('shift_supervisor_morning','shift_supervisor_evening') then
    v_can_view_shift_performance := true; v_can_create_shift_evaluation := true; v_can_edit_shift_evaluation := true;
  end if;
  v_effective := jsonb_set(v_effective, '{view_shift_performance}', to_jsonb(v_can_view_shift_performance and coalesce(nullif(v_account_permissions->>'view_shift_performance','')::boolean, true) and coalesce(nullif(v_override_json->>'view_shift_performance','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{create_shift_evaluation}', to_jsonb(v_can_create_shift_evaluation and coalesce(nullif(v_account_permissions->>'create_shift_evaluation','')::boolean, true) and coalesce(nullif(v_override_json->>'create_shift_evaluation','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{edit_shift_evaluation}', to_jsonb(v_can_edit_shift_evaluation and coalesce(nullif(v_account_permissions->>'edit_shift_evaluation','')::boolean, true) and coalesce(nullif(v_override_json->>'edit_shift_evaluation','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{approve_shift_evaluation}', to_jsonb(v_can_approve_shift_evaluation and coalesce(nullif(v_account_permissions->>'approve_shift_evaluation','')::boolean, true) and coalesce(nullif(v_override_json->>'approve_shift_evaluation','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{delete_shift_evaluation}', to_jsonb(v_can_delete_shift_evaluation and coalesce(nullif(v_account_permissions->>'delete_shift_evaluation','')::boolean, true) and coalesce(nullif(v_override_json->>'delete_shift_evaluation','')::boolean, true)), true);

  if v_role_key in ('general_manager','executive_manager','branches_manager','admin','branch_manager') then
    v_can_view_points := true; v_can_manage_points := true; v_can_approve_points := true; v_can_create_reward := true; v_can_create_deduction := true; v_can_edit_points_transaction := true; v_can_export_points_report := true;
  elsif v_role_key in ('shift_supervisor_morning','shift_supervisor_evening') then
    v_can_view_points := true; v_can_create_reward := true; v_can_create_deduction := true;
  elsif v_role_key in ('customer_service_manager','customer_service','pharmacist') then v_can_view_points := true;
  end if;
  v_effective := jsonb_set(v_effective, '{view_points}', to_jsonb(v_can_view_points and coalesce(nullif(v_account_permissions->>'view_points','')::boolean, true) and coalesce(nullif(v_override_json->>'view_points','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{manage_points}', to_jsonb(v_can_manage_points and coalesce(nullif(v_account_permissions->>'manage_points','')::boolean, true) and coalesce(nullif(v_override_json->>'manage_points','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{approve_points}', to_jsonb(v_can_approve_points and coalesce(nullif(v_account_permissions->>'approve_points','')::boolean, true) and coalesce(nullif(v_override_json->>'approve_points','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{create_reward}', to_jsonb(v_can_create_reward and coalesce(nullif(v_account_permissions->>'create_reward','')::boolean, true) and coalesce(nullif(v_override_json->>'create_reward','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{create_deduction}', to_jsonb(v_can_create_deduction and coalesce(nullif(v_account_permissions->>'create_deduction','')::boolean, true) and coalesce(nullif(v_override_json->>'create_deduction','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{edit_points_transaction}', to_jsonb(v_can_edit_points_transaction and coalesce(nullif(v_account_permissions->>'edit_points_transaction','')::boolean, true) and coalesce(nullif(v_override_json->>'edit_points_transaction','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{export_points_report}', to_jsonb(v_can_export_points_report and coalesce(nullif(v_account_permissions->>'export_points_report','')::boolean, true) and coalesce(nullif(v_override_json->>'export_points_report','')::boolean, true)), true);

  if v_role_key in ('general_manager','executive_manager','branches_manager','admin','manager','branch_manager') then
    v_can_view_salary_calculator := true; v_can_manage_payroll := true;
  elsif v_role_key = 'customer_service_manager' then v_can_view_salary_calculator := true;
  end if;
  v_effective := jsonb_set(v_effective, '{view_salary_calculator}', to_jsonb(v_can_view_salary_calculator and coalesce(nullif(v_account_permissions->>'view_salary_calculator','')::boolean, true) and coalesce(nullif(v_override_json->>'view_salary_calculator','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{manage_payroll}', to_jsonb(v_can_manage_payroll and coalesce(nullif(v_account_permissions->>'manage_payroll','')::boolean, true) and coalesce(nullif(v_override_json->>'manage_payroll','')::boolean, true)), true);
  v_effective := v_effective - 'manage_salary_calculator';

  if v_role_key in ('general_manager','executive_manager','branches_manager','admin','manager') then
    v_can_view_incentives := true;
    v_can_manage_incentives := true;
    v_can_view_quarterly_incentives := true;
    v_can_manage_quarterly_incentives := true;
    v_can_view_penalty_management := true;
    v_can_manage_penalty_management := true;
  elsif v_role_key = 'branch_manager' then
    v_can_view_incentives := true;
    v_can_view_quarterly_incentives := true;
    v_can_view_penalty_management := true;
  end if;
  v_effective := jsonb_set(v_effective, '{view_incentives}', to_jsonb(v_can_view_incentives and coalesce(nullif(v_account_permissions->>'view_incentives','')::boolean, true) and coalesce(nullif(v_override_json->>'view_incentives','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{manage_incentives}', to_jsonb(v_can_manage_incentives and coalesce(nullif(v_account_permissions->>'manage_incentives','')::boolean, true) and coalesce(nullif(v_override_json->>'manage_incentives','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{view_quarterly_incentives}', to_jsonb(v_can_view_quarterly_incentives and coalesce(nullif(v_account_permissions->>'view_quarterly_incentives','')::boolean, true) and coalesce(nullif(v_override_json->>'view_quarterly_incentives','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{manage_quarterly_incentives}', to_jsonb(v_can_manage_quarterly_incentives and coalesce(nullif(v_account_permissions->>'manage_quarterly_incentives','')::boolean, true) and coalesce(nullif(v_override_json->>'manage_quarterly_incentives','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{view_penalty_management}', to_jsonb(v_can_view_penalty_management and coalesce(nullif(v_account_permissions->>'view_penalty_management','')::boolean, true) and coalesce(nullif(v_override_json->>'view_penalty_management','')::boolean, true)), true);
  v_effective := jsonb_set(v_effective, '{manage_penalty_management}', to_jsonb(v_can_manage_penalty_management and coalesce(nullif(v_account_permissions->>'manage_penalty_management','')::boolean, true) and coalesce(nullif(v_override_json->>'manage_penalty_management','')::boolean, true)), true);

  return v_effective;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dawaa_can_manage_incentives()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce((public.get_user_permissions(public.dawaa_current_staff_account_id_strict())->>'manage_incentives')::boolean, false);
$function$;
