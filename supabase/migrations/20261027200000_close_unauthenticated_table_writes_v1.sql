-- Close table writes that Production allowed without any verified identity, and scope the
-- remaining legitimate writers by role, branch and operation.
--
-- Production audit (2026-10-27/28, read-only catalog + 4 days of API logs): 65 public tables
-- carry a permissive INSERT/UPDATE policy whose expression is literally `true`, granted to anon
-- and/or authenticated. Browser requests run as `anon` with an x-dawaa-session-token, so the
-- public anon key alone could write them. Money/attendance consumers include
-- get_payroll_incentive_catalog_v18 (incentive_medicines), guard_staff_attendance_device
-- (staff_attendance_devices) and attendance_truth_cycle_v2 (attendance_manual_requests).
--
-- Writer inventory (src/, server/, api/, public/, supabase/functions, SECURITY INVOKER
-- functions, API logs): 13 tables are written by app pages and staff_attendance_devices by the
-- punch trigger; the other 51 (incl. attendance_manual_requests, written only by SECURITY
-- DEFINER RPCs) have no client, server, edge-function or external writer. service_role, cron and SECURITY DEFINER
-- functions run as the owner and are not affected by these policies.
--
-- Change (restrictive policies only; reads untouched):
--   * 51 tables with no client writer: client INSERT/UPDATE/DELETE refused.
--   * 14 written tables: the page's own gate, enforced in the database:
--       senior all-branch roles -> every row; branch roles / explicit permission holders ->
--       rows of their own branch (where the table carries a branch); others refused.
--   * attendance_manual_requests: only the SECURITY DEFINER create/decide RPCs write.
--   * staff_attendance_devices: own device row (first-device binding by the punch trigger)
--     or a biometric-mapping manager.
-- Idempotent. Rollback: see docs/SECURITY_TABLE_WRITE_SCOPE_ROLLBACK_20261028.md.

begin;

-- Branch key helper is IMMUTABLE and used directly in policy expressions.
grant execute on function public.dawaa_customer_request_branch_key(text) to anon, authenticated;

-- Write scope of the current verified actor for an operational table:
--   'ALL'     senior all-branch role, holder of an all-branch permission, or a Team Dawaa
--             Alpha member holding one of p_permissions
--   'shokry' / 'elshamy'   branch-scoped actor holding one of p_permissions or a p_branch_roles role
--   'NONE'    anything else (no session, disabled account, no permission, no branch)
create or replace function public.dawaa_current_operational_write_scope_v1(
  p_permissions text[],
  p_branch_roles text[] default '{}'::text[],
  p_all_branch_permissions text[] default '{}'::text[]
)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_actor uuid;
  v_role text;
  v_branch_key text;
begin
  v_actor := public.dawaa_current_staff_account_id_strict();
  if v_actor is null then return 'NONE'; end if;

  select pg_catalog.lower(pg_catalog.btrim(coalesce(sa.role, ''))),
         public.dawaa_customer_request_branch_key(sa.branch)
    into v_role, v_branch_key
  from public.staff_accounts sa
  where sa.id = v_actor and coalesce(sa.active, false) and coalesce(sa.can_login, false)
  limit 1;
  if not found then return 'NONE'; end if;

  if v_role in ('general_manager', 'admin', 'executive_manager', 'branches_manager', 'procurement_manager') then
    return 'ALL';
  end if;
  if pg_catalog.cardinality(p_all_branch_permissions) > 0
     and public.dawaa_current_actor_can(p_all_branch_permissions) then
    return 'ALL';
  end if;
  if not (v_role = any(p_branch_roles)
          or (pg_catalog.cardinality(p_permissions) > 0 and public.dawaa_current_actor_can(p_permissions))) then
    return 'NONE';
  end if;
  -- Team Dawaa Alpha works across branches (userDataScope.canViewAllBranches); it still
  -- needs one of the table's permissions to reach this point.
  if v_role = 'team_dawaa_alpha' then return 'ALL'; end if;
  if v_branch_key in ('shokry', 'elshamy') then return v_branch_key; end if;
  return 'NONE';
end;
$$;
revoke all on function public.dawaa_current_operational_write_scope_v1(text[], text[], text[]) from public;
grant execute on function public.dawaa_current_operational_write_scope_v1(text[], text[], text[]) to anon, authenticated;

-- Generic restrictive write policies: one predicate applied to INSERT (check), UPDATE
-- (old and new row) and DELETE (old row).
create or replace function pg_temp.dawaa_scope_writes(p_table text, p_predicate text)
returns void language plpgsql as $$
declare
  op text;
  name text;
begin
  if to_regclass('public.' || p_table) is null then return; end if;
  foreach op in array array['insert', 'update', 'delete'] loop
    name := p_table || '_' || op || '_write_scope_v1';
    execute format('drop policy if exists %I on public.%I', name, p_table);
    execute format(
      'create policy %I on public.%I as restrictive for %s to anon, authenticated %s',
      name, p_table, op,
      case op
        when 'insert' then format('with check (%s)', p_predicate)
        when 'update' then format('using (%s) with check (%s)', p_predicate, p_predicate)
        else format('using (%s)', p_predicate)
      end);
  end loop;
end $$;

-- 51 tables without any client writer: refuse client writes.
select pg_temp.dawaa_scope_writes(t, 'false')
from unnest(array[
  'accessory_checks','accessory_items','branch_cleaning_items','branch_cleaning_responsibles',
  'branch_cleaning_tasks','branch_visit_actions','branches','cleaning_logs','complaints',
  'customer_flags','customer_important_tags','customer_notes','customer_request_sources',
  'customer_welcome_message_templates','cycles','delivery_orders','delivery_staff',
  'incentive_medicine_sales','inventory_count_events','inventory_count_sessions',
  'manager_role_assignments','medicine_daily_uploads','medicine_dispense_log','objections',
  'offer_dispenses','quarter_cycles','quick_followup_requests','settings','shelf_sections',
  'shelf_task_events','shelf_task_items','shelf_tasks','shelf_zones','shift_exceptions',
  'shortage_events','shortage_items','stagnant_medicine_dispenses','story_performance_reports',
  'story_sales','supplier_directory','supplies_checks','supplies_import_logs','supplies_items',
  'training_assignments','training_attempts','training_modules','training_questions',
  'training_quizzes','ui_layout_preferences','whatsapp_stories',
  'attendance_manual_requests'
]) as t;

-- attendance_manual_requests: drop the unconditional client write policies as well.
-- Previous definitions (rollback):
--   attendance_manual_requests_app_insert  INSERT TO public WITH CHECK (true)
--   manual_requests_insert_authenticated   INSERT TO public WITH CHECK (true)
--   attendance_manual_requests_app_update  UPDATE TO public USING (true) WITH CHECK (true)
drop policy if exists attendance_manual_requests_app_insert on public.attendance_manual_requests;
drop policy if exists manual_requests_insert_authenticated on public.attendance_manual_requests;
drop policy if exists attendance_manual_requests_app_update on public.attendance_manual_requests;

-- Written by the invoice importer and invoice management: same permission as sales_invoices
-- writes. Rows are per-customer aggregates across branches (4,276 have no branch), so the
-- branch of the row is not the boundary; the import permission is.
select pg_temp.dawaa_scope_writes('customer_analysis',
  $p$(select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices'])) <> 'NONE'$p$);

-- IncentiveMedicines page: canManage || create/edit_incentive_medicine. Feeds payroll, so
-- branch roles only touch rows of their own branch; all-branch rows need a senior role or an
-- explicit incentive permission.
select pg_temp.dawaa_scope_writes('incentive_medicines',
  $p$(select public.dawaa_current_operational_write_scope_v1(
        '{}'::text[],
        array['branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening'],
        array['manage_incentive_medicines','create_incentive_medicine','edit_incentive_medicine'])) = 'ALL'
     or public.dawaa_customer_request_branch_key(branch) = (select public.dawaa_current_operational_write_scope_v1(
        '{}'::text[],
        array['branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening'],
        array['manage_incentive_medicines','create_incentive_medicine','edit_incentive_medicine']))$p$);

-- StagnantMedicines page: canManage || create/edit/delete_stagnant_medicine, own branch.
select pg_temp.dawaa_scope_writes('stagnant_medicines',
  $p$(select public.dawaa_current_operational_write_scope_v1(
        array['create_stagnant_medicine','edit_stagnant_medicine','delete_stagnant_medicine'],
        array['branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening'])) = 'ALL'
     or public.dawaa_customer_request_branch_key(coalesce(branch, branch_name)) = (select public.dawaa_current_operational_write_scope_v1(
        array['create_stagnant_medicine','edit_stagnant_medicine','delete_stagnant_medicine'],
        array['branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening']))$p$);

-- Delivery page: canManage || create/edit_delivery_evaluation || approve_delivery_deduction, own branch.
select pg_temp.dawaa_scope_writes('delivery_evaluations',
  $p$(select public.dawaa_current_operational_write_scope_v1(
        array['create_delivery_evaluation','edit_delivery_evaluation','approve_delivery_deduction'],
        array['branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening'])) = 'ALL'
     or public.dawaa_customer_request_branch_key(branch) = (select public.dawaa_current_operational_write_scope_v1(
        array['create_delivery_evaluation','edit_delivery_evaluation','approve_delivery_deduction'],
        array['branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening']))$p$);

-- Offers page (route manage_operations), own branch.
select pg_temp.dawaa_scope_writes('offers',
  $p$(select public.dawaa_current_operational_write_scope_v1(
        array['manage_operations'],
        array['branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening'])) = 'ALL'
     or public.dawaa_customer_request_branch_key(branch) = (select public.dawaa_current_operational_write_scope_v1(
        array['manage_operations'],
        array['branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening']))$p$);

-- Customer-service surfaces (route view_customer_service), own branch; rows without a branch
-- stay workable (664 welcome tasks carry none).
select pg_temp.dawaa_scope_writes('customer_welcome_tasks',
  $p$(select public.dawaa_current_operational_write_scope_v1(array['view_customer_service'])) = 'ALL'
     or (branch is null and (select public.dawaa_current_operational_write_scope_v1(array['view_customer_service'])) <> 'NONE')
     or public.dawaa_customer_request_branch_key(branch) = (select public.dawaa_current_operational_write_scope_v1(array['view_customer_service']))$p$);
select pg_temp.dawaa_scope_writes('customer_service_credit_movements',
  $p$(select public.dawaa_current_operational_write_scope_v1(array['view_customer_service'])) = 'ALL'
     or public.dawaa_customer_request_branch_key(branch) = (select public.dawaa_current_operational_write_scope_v1(array['view_customer_service']))$p$);
select pg_temp.dawaa_scope_writes('customer_coding_requests',
  $p$(select public.dawaa_current_operational_write_scope_v1(array['view_customer_service','view_customers'])) = 'ALL'
     or (coalesce(branch, branch_name) is null and (select public.dawaa_current_operational_write_scope_v1(array['view_customer_service','view_customers'])) <> 'NONE')
     or public.dawaa_customer_request_branch_key(coalesce(branch, branch_name)) = (select public.dawaa_current_operational_write_scope_v1(array['view_customer_service','view_customers']))$p$);

-- Tables without a branch column: role / permission only.
select pg_temp.dawaa_scope_writes('customer_special_items',
  $p$(select public.dawaa_current_operational_write_scope_v1(array['view_customer_service','edit_customers'])) <> 'NONE'$p$);
select pg_temp.dawaa_scope_writes('inventory_count_items',
  $p$(select public.dawaa_current_operational_write_scope_v1(array['view_inventory','manage_inventory'])) <> 'NONE'$p$);
-- Budget screen is general-manager only in the UI (isAdmin).
select pg_temp.dawaa_scope_writes('customer_service_credit_budgets',
  $p$(select public.dawaa_current_actor_can(array['manage_customer_service_credit']))$p$);
-- Identity aliases: staff-account administration (matches draft #556).
select pg_temp.dawaa_scope_writes('staff_identity_aliases',
  $p$(select public.dawaa_current_actor_can(array['manage_staff_accounts']))$p$);
-- Evaluation rules: route permission.
select pg_temp.dawaa_scope_writes('evaluation_rules',
  $p$(select public.dawaa_current_actor_can(array['manage_evaluation_rules']))$p$);
-- Attendance devices: own row (punch trigger binds the first device) or biometric managers.
select pg_temp.dawaa_scope_writes('staff_attendance_devices',
  $p$staff_id = (select public.dawaa_current_attendance_subject_id()) or (select public.dawaa_can_manage_biometric_mapping_v1())$p$);

commit;
