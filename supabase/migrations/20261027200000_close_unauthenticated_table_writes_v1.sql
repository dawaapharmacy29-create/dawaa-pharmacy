-- Close table writes that Production allowed without any verified identity.
--
-- Production audit (2026-10-27, read-only catalog): 65 public tables carry a permissive
-- INSERT/UPDATE policy whose expression is literally `true`, granted to anon and/or
-- authenticated. Browser requests run as `anon` with an x-dawaa-session-token, so the
-- public anon key alone could write these tables. Four of them feed money or attendance:
--   * incentive_medicines        -> get_payroll_incentive_catalog_v18 (payroll incentive per unit)
--   * staff_attendance_devices   -> guard_staff_attendance_device (personal punch device binding)
--   * attendance_manual_requests -> attendance_truth_cycle_v2 pending gate / decide_* RPCs
--   * evaluation_rules           -> points / evaluation rules
--
-- Change:
--   1. A RESTRICTIVE write guard on every listed table: INSERT/UPDATE/DELETE need a verified
--      staff session (dawaa_current_staff_account_id_strict()). Logged-in behaviour is
--      unchanged; reads are untouched. service_role, cron and SECURITY DEFINER functions
--      run as the owner and bypass RLS, so imports, settlements and syncs are unaffected.
--   2. incentive_medicines: writes need the same actor the page allows (manager roles down to
--      shift supervisors, mirroring useAuth.canManage, or the explicit incentive permissions).
--   3. evaluation_rules: writes need manage_evaluation_rules (the route permission).
--   4. attendance_manual_requests: no client writes; create/decide RPCs (SECURITY DEFINER)
--      remain the only writers.
--   5. staff_attendance_devices: a session may only write its own device row (the punch
--      trigger runs as the caller), or a biometric-mapping manager.
-- Idempotent. Rollback: drop the policies named *_session_write_guard_v1 / *_scope_v1 and
-- recreate the three dropped attendance_manual_requests policies (definitions below).

begin;

create or replace function public.dawaa_current_actor_is_operations_manager_v1()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1
    from public.staff_accounts a
    where a.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(a.active, false)
      and coalesce(a.can_login, false)
      and lower(trim(coalesce(a.role, ''))) in (
        'general_manager', 'admin', 'executive_manager', 'branches_manager', 'procurement_manager',
        'branch_manager', 'customer_service_manager', 'shift_supervisor_morning', 'shift_supervisor_evening'
      )
  );
$$;
revoke all on function public.dawaa_current_actor_is_operations_manager_v1() from public;
grant execute on function public.dawaa_current_actor_is_operations_manager_v1() to anon, authenticated;

do $$
declare
  t text;
  op text;
  tables text[] := array[
    'accessory_checks','accessory_items','attendance_manual_requests','branch_cleaning_items',
    'branch_cleaning_responsibles','branch_cleaning_tasks','branch_visit_actions','branches',
    'cleaning_logs','complaints','customer_analysis','customer_coding_requests','customer_flags',
    'customer_important_tags','customer_notes','customer_request_sources',
    'customer_service_credit_budgets','customer_service_credit_movements','customer_special_items',
    'customer_welcome_message_templates','customer_welcome_tasks','cycles','delivery_evaluations',
    'delivery_orders','delivery_staff','evaluation_rules','incentive_medicine_sales',
    'incentive_medicines','inventory_count_events','inventory_count_items','inventory_count_sessions',
    'manager_role_assignments','medicine_daily_uploads','medicine_dispense_log','objections',
    'offer_dispenses','offers','quarter_cycles','quick_followup_requests','settings','shelf_sections',
    'shelf_task_events','shelf_task_items','shelf_tasks','shelf_zones','shift_exceptions',
    'shortage_events','shortage_items','staff_attendance_devices','staff_identity_aliases',
    'stagnant_medicine_dispenses','stagnant_medicines','story_performance_reports','story_sales',
    'supplier_directory','supplies_checks','supplies_import_logs','supplies_items',
    'training_assignments','training_attempts','training_modules','training_questions',
    'training_quizzes','ui_layout_preferences','whatsapp_stories'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    foreach op in array array['insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', t || '_' || op || '_session_write_guard_v1', t);
      execute format(
        'create policy %I on public.%I as restrictive for %s to anon, authenticated %s',
        t || '_' || op || '_session_write_guard_v1', t, op,
        case op
          when 'insert' then 'with check ((select public.dawaa_current_staff_account_id_strict()) is not null)'
          when 'update' then 'using ((select public.dawaa_current_staff_account_id_strict()) is not null) with check ((select public.dawaa_current_staff_account_id_strict()) is not null)'
          else 'using ((select public.dawaa_current_staff_account_id_strict()) is not null)'
        end
      );
    end loop;
  end loop;
end $$;

-- incentive_medicines: the actor the page lets edit.
drop policy if exists incentive_medicines_insert_scope_v1 on public.incentive_medicines;
drop policy if exists incentive_medicines_update_scope_v1 on public.incentive_medicines;
create policy incentive_medicines_insert_scope_v1 on public.incentive_medicines as restrictive
  for insert to anon, authenticated
  with check ((select public.dawaa_current_actor_is_operations_manager_v1())
    or (select public.dawaa_current_actor_can(array['manage_incentive_medicines','create_incentive_medicine','edit_incentive_medicine'])));
create policy incentive_medicines_update_scope_v1 on public.incentive_medicines as restrictive
  for update to anon, authenticated
  using ((select public.dawaa_current_actor_is_operations_manager_v1())
    or (select public.dawaa_current_actor_can(array['manage_incentive_medicines','edit_incentive_medicine'])))
  with check ((select public.dawaa_current_actor_is_operations_manager_v1())
    or (select public.dawaa_current_actor_can(array['manage_incentive_medicines','edit_incentive_medicine'])));

-- evaluation_rules: the route permission.
drop policy if exists evaluation_rules_write_scope_v1 on public.evaluation_rules;
create policy evaluation_rules_write_scope_v1 on public.evaluation_rules as restrictive
  for all to anon, authenticated
  using (true)
  with check ((select public.dawaa_current_actor_can(array['manage_evaluation_rules'])));
drop policy if exists evaluation_rules_update_scope_v1 on public.evaluation_rules;
create policy evaluation_rules_update_scope_v1 on public.evaluation_rules as restrictive
  for update to anon, authenticated
  using ((select public.dawaa_current_actor_can(array['manage_evaluation_rules'])));
drop policy if exists evaluation_rules_delete_scope_v1 on public.evaluation_rules;
create policy evaluation_rules_delete_scope_v1 on public.evaluation_rules as restrictive
  for delete to anon, authenticated
  using ((select public.dawaa_current_actor_can(array['manage_evaluation_rules'])));

-- attendance_manual_requests: only the SECURITY DEFINER request/decision RPCs write.
-- Previous definitions (for rollback):
--   attendance_manual_requests_app_insert  INSERT TO public WITH CHECK (true)
--   manual_requests_insert_authenticated   INSERT TO public WITH CHECK (true)
--   attendance_manual_requests_app_update  UPDATE TO public USING (true) WITH CHECK (true)
drop policy if exists attendance_manual_requests_app_insert on public.attendance_manual_requests;
drop policy if exists manual_requests_insert_authenticated on public.attendance_manual_requests;
drop policy if exists attendance_manual_requests_app_update on public.attendance_manual_requests;

-- staff_attendance_devices: own device row (first-device binding by the punch trigger) or
-- a biometric-mapping manager.
drop policy if exists staff_attendance_devices_write_scope_v1 on public.staff_attendance_devices;
create policy staff_attendance_devices_write_scope_v1 on public.staff_attendance_devices as restrictive
  for all to anon, authenticated
  using (true)
  with check (staff_id = (select public.dawaa_current_attendance_subject_id())
    or (select public.dawaa_can_manage_biometric_mapping_v1()));
drop policy if exists staff_attendance_devices_update_scope_v1 on public.staff_attendance_devices;
create policy staff_attendance_devices_update_scope_v1 on public.staff_attendance_devices as restrictive
  for update to anon, authenticated
  using (staff_id = (select public.dawaa_current_attendance_subject_id())
    or (select public.dawaa_can_manage_biometric_mapping_v1()));

commit;
