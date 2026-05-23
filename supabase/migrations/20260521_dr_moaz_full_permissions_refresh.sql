-- Refresh Dr. Moaz with every permission key currently used by the app.

with full_permissions as (
  select '{
    "view_shift_performance": true,
    "create_shift_evaluation": true,
    "edit_shift_evaluation": true,
    "delete_shift_evaluation": true,
    "approve_shift_evaluation": true,
    "view_dashboard": true,
    "view_dashboard_stats": true,
    "view_alerts": true,
    "manage_alerts": true,
    "view_doctor_dashboard": true,
    "view_own_performance": true,
    "view_all_doctors_performance": true,
    "view_customers": true,
    "create_customer": true,
    "edit_customer": true,
    "delete_customer": true,
    "view_customer_details": true,
    "export_customers": true,
    "view_customer_service": true,
    "create_followup": true,
    "edit_followup": true,
    "close_followup": true,
    "assign_followup": true,
    "whatsapp_customer": true,
    "view_team": true,
    "create_team_member": true,
    "edit_team_member": true,
    "disable_team_member": true,
    "view_schedule": true,
    "create_schedule": true,
    "edit_schedule": true,
    "delete_schedule": true,
    "view_attendance_leaves": true,
    "create_leave_request": true,
    "approve_leave_request": true,
    "reject_leave_request": true,
    "edit_attendance": true,
    "view_points": true,
    "manage_points": true,
    "view_points_rewards": true,
    "create_reward": true,
    "create_deduction": true,
    "edit_points_transaction": true,
    "approve_points_changes": true,
    "approve_points": true,
    "export_points_report": true,
    "view_reviews": true,
    "add_reviews": true,
    "view_conversation_reviews": true,
    "create_conversation_review": true,
    "edit_conversation_review": true,
    "approve_conversation_review": true,
    "view_stagnant_medicines": true,
    "create_stagnant_medicine": true,
    "edit_stagnant_medicine": true,
    "delete_stagnant_medicine": true,
    "dispense_stagnant_medicine": true,
    "view_stagnant_reports": true,
    "view_medicines": true,
    "view_incentive_medicines": true,
    "create_incentive_medicine": true,
    "edit_incentive_medicine": true,
    "delete_incentive_medicine": true,
    "dispense_incentive_medicine": true,
    "view_incentive_reports": true,
    "view_list_medicines": true,
    "create_list_medicine": true,
    "edit_list_medicine": true,
    "delete_list_medicine": true,
    "dispense_list_medicine": true,
    "view_list_reports": true,
    "view_delivery": true,
    "create_delivery_evaluation": true,
    "edit_delivery_evaluation": true,
    "approve_delivery_deduction": true,
    "view_delivery_reports": true,
    "view_analytics": true,
    "view_analytics_sales": true,
    "view_sales_reports": true,
    "export_sales_reports": true,
    "view_branch_comparison": true,
    "view_invoices": true,
    "view_invoice_import": true,
    "import_sales_invoices": true,
    "review_import_errors": true,
    "delete_import_batch": true,
    "reprocess_import_batch": true,
    "view_staff_accounts": true,
    "create_staff_account": true,
    "edit_staff_account": true,
    "reset_staff_password": true,
    "disable_staff_account": true,
    "manage_staff_accounts": true,
    "view_roles_permissions": true,
    "manage_roles": true,
    "manage_permissions": true,
    "manage_user_permissions": true,
    "view_activity_log": true,
    "view_activity_logs": true,
    "view_activity_details": true,
    "export_activity_logs": true,
    "view_settings": true,
    "manage_settings": true,
    "manage_branches": true,
    "manage_system_config": true,
    "view_team_performance": true
  }'::jsonb as permissions
)
update public.staff_accounts sa
set role = 'مدير عام',
    staff_role = 'مدير عام',
    branch = 'كل الفروع',
    active = true,
    can_login = true,
    visible_in_admin = true,
    permissions = coalesce(sa.permissions, '{}'::jsonb) || fp.permissions,
    updated_at = now()
from full_permissions fp
where lower(sa.username) = 'dr.moaz';

with full_permissions as (
  select sa.id as staff_account_id, sa.permissions
  from public.staff_accounts sa
  where lower(sa.username) = 'dr.moaz'
)
update public.user_profiles up
set name = 'د معاذ',
    role = 'مدير عام',
    branch = 'كل الفروع',
    permissions = coalesce(up.permissions, '{}'::jsonb) || fp.permissions,
    active = true,
    updated_at = now()
from full_permissions fp
where up.staff_account_id = fp.staff_account_id;

with full_permissions as (
  select permissions
  from public.staff_accounts
  where lower(username) = 'dr.moaz'
)
update public.roles r
set name_ar = 'مدير عام',
    description = 'صلاحيات كاملة على النظام',
    permissions = coalesce(r.permissions, '{}'::jsonb) || fp.permissions,
    updated_at = now()
from full_permissions fp
where r.name = 'general_manager' or r.name_ar = 'مدير عام';
