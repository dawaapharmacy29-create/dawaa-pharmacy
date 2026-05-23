-- Migration to create roles and permissions system
-- Date: 2024-05-20

-- Create roles table
CREATE TABLE IF NOT EXISTS public.roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  name_ar text not null,
  description text,
  permissions jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Create user_permissions table for individual user overrides
CREATE TABLE IF NOT EXISTS public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  permission_key text not null,
  allowed boolean default true,
  created_at timestamptz default now(),
  created_by uuid,
  unique(user_id, permission_key)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS user_permissions_user_id_idx ON public.user_permissions(user_id);
CREATE INDEX IF NOT EXISTS user_permissions_permission_key_idx ON public.user_permissions(permission_key);

-- Add comments
COMMENT ON TABLE public.roles IS 'Roles with predefined permissions';
COMMENT ON TABLE public.user_permissions IS 'Individual user permission overrides';

-- Insert default roles
INSERT INTO public.roles (name, name_ar, description, permissions) VALUES
(
  'general_manager',
  'مدير عام',
  'صلاحيات كاملة على النظام',
  '{
    "view_dashboard": true,
    "view_dashboard_stats": true,
    "view_alerts": true,
    "manage_alerts": true,
    "view_shift_performance": true,
    "create_shift_evaluation": true,
    "edit_shift_evaluation": true,
    "delete_shift_evaluation": true,
    "approve_shift_evaluation": true,
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
    "view_points_rewards": true,
    "create_reward": true,
    "create_deduction": true,
    "edit_points_transaction": true,
    "approve_points_changes": true,
    "export_points_report": true,
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
    "view_incentive_medicines": true,
    "create_incentive_medicine": true,
    "edit_incentive_medicine": true,
    "delete_incentive_medicine": true,
    "dispense_incentive_medicine": true,
    "view_incentive_reports": true,
    "view_delivery": true,
    "create_delivery_evaluation": true,
    "edit_delivery_evaluation": true,
    "approve_delivery_deduction": true,
    "view_delivery_reports": true,
    "view_analytics_sales": true,
    "view_sales_reports": true,
    "export_sales_reports": true,
    "view_branch_comparison": true,
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
    "manage_roles": true,
    "manage_permissions": true,
    "manage_user_permissions": true,
    "view_activity_logs": true,
    "view_activity_details": true,
    "export_activity_logs": true,
    "view_settings": true,
    "manage_settings": true,
    "manage_branches": true,
    "manage_system_config": true
  }'::jsonb
) ON CONFLICT (name) DO NOTHING;

INSERT INTO public.roles (name, name_ar, description, permissions) VALUES
(
  'branch_manager',
  'مدير فرع',
  'صلاحيات مدير الفرع',
  '{
    "view_dashboard": true,
    "view_dashboard_stats": true,
    "view_alerts": true,
    "view_shift_performance": true,
    "create_shift_evaluation": true,
    "edit_shift_evaluation": true,
    "approve_shift_evaluation": true,
    "view_doctor_dashboard": true,
    "view_own_performance": true,
    "view_all_doctors_performance": true,
    "view_customers": true,
    "create_customer": true,
    "edit_customer": true,
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
    "view_schedule": true,
    "create_schedule": true,
    "edit_schedule": true,
    "view_attendance_leaves": true,
    "approve_leave_request": true,
    "reject_leave_request": true,
    "view_points_rewards": true,
    "create_reward": true,
    "create_deduction": true,
    "edit_points_transaction": true,
    "approve_points_changes": true,
    "export_points_report": true,
    "view_conversation_reviews": true,
    "create_conversation_review": true,
    "edit_conversation_review": true,
    "approve_conversation_review": true,
    "view_stagnant_medicines": true,
    "create_stagnant_medicine": true,
    "edit_stagnant_medicine": true,
    "dispense_stagnant_medicine": true,
    "view_stagnant_reports": true,
    "view_incentive_medicines": true,
    "create_incentive_medicine": true,
    "edit_incentive_medicine": true,
    "dispense_incentive_medicine": true,
    "view_incentive_reports": true,
    "view_delivery": true,
    "create_delivery_evaluation": true,
    "edit_delivery_evaluation": true,
    "approve_delivery_deduction": true,
    "view_delivery_reports": true,
    "view_analytics_sales": true,
    "view_sales_reports": true,
    "export_sales_reports": true,
    "view_branch_comparison": true,
    "view_invoice_import": true,
    "import_sales_invoices": true,
    "review_import_errors": true,
    "delete_import_batch": true,
    "view_staff_accounts": true,
    "create_staff_account": true,
    "edit_staff_account": true,
    "reset_staff_password": true,
    "disable_staff_account": true,
    "view_activity_logs": true,
    "view_activity_details": true,
    "export_activity_logs": true,
    "view_settings": true,
    "manage_settings": true
  }'::jsonb
) ON CONFLICT (name) DO NOTHING;

INSERT INTO public.roles (name, name_ar, description, permissions) VALUES
(
  'doctor',
  'دكتور',
  'صلاحيات الدكتور',
  '{
    "view_doctor_dashboard": true,
    "view_own_performance": true,
    "view_customers": true,
    "view_customer_details": true,
    "view_customer_service": true,
    "create_followup": true,
    "edit_followup": true,
    "close_followup": true,
    "whatsapp_customer": true,
    "view_points_rewards": true,
    "view_conversation_reviews": true,
    "create_conversation_review": true,
    "edit_conversation_review": true,
    "view_stagnant_medicines": true,
    "dispense_stagnant_medicine": true,
    "view_stagnant_reports": true,
    "view_incentive_medicines": true,
    "dispense_incentive_medicine": true,
    "view_incentive_reports": true,
    "view_schedule": true,
    "view_attendance_leaves": true,
    "create_leave_request": true,
    "view_activity_logs": true,
    "view_activity_details": true
  }'::jsonb
) ON CONFLICT (name) DO NOTHING;

INSERT INTO public.roles (name, name_ar, description, permissions) VALUES
(
  'pharmacist',
  'صيدلاني',
  'صلاحيات الصيدلاني',
  '{
    "view_dashboard": true,
    "view_dashboard_stats": true,
    "view_alerts": true,
    "view_customers": true,
    "create_customer": true,
    "edit_customer": true,
    "view_customer_details": true,
    "view_customer_service": true,
    "create_followup": true,
    "edit_followup": true,
    "close_followup": true,
    "assign_followup": true,
    "whatsapp_customer": true,
    "view_team": true,
    "view_schedule": true,
    "view_attendance_leaves": true,
    "create_leave_request": true,
    "view_points_rewards": true,
    "view_conversation_reviews": true,
    "create_conversation_review": true,
    "edit_conversation_review": true,
    "view_stagnant_medicines": true,
    "create_stagnant_medicine": true,
    "edit_stagnant_medicine": true,
    "dispense_stagnant_medicine": true,
    "view_stagnant_reports": true,
    "view_incentive_medicines": true,
    "create_incentive_medicine": true,
    "edit_incentive_medicine": true,
    "dispense_incentive_medicine": true,
    "view_incentive_reports": true,
    "view_delivery": true,
    "view_analytics_sales": true,
    "view_sales_reports": true,
    "view_invoice_import": true,
    "import_sales_invoices": true,
    "review_import_errors": true,
    "view_activity_logs": true,
    "view_activity_details": true
  }'::jsonb
) ON CONFLICT (name) DO NOTHING;

INSERT INTO public.roles (name, name_ar, description, permissions) VALUES
(
  'delivery',
  'توصيل',
  'صلاحيات التوصيل',
  '{
    "view_dashboard": true,
    "view_delivery": true,
    "view_delivery_reports": true,
    "view_schedule": true,
    "view_points_rewards": true,
    "view_attendance_leaves": true,
    "create_leave_request": true,
    "view_activity_logs": true,
    "view_activity_details": true
  }'::jsonb
) ON CONFLICT (name) DO NOTHING;

INSERT INTO public.roles (name, name_ar, description, permissions) VALUES
(
  'customer_service',
  'خدمة عملاء',
  'صلاحيات خدمة العملاء',
  '{
    "view_dashboard": true,
    "view_customers": true,
    "create_customer": true,
    "edit_customer": true,
    "view_customer_details": true,
    "view_customer_service": true,
    "create_followup": true,
    "edit_followup": true,
    "close_followup": true,
    "assign_followup": true,
    "whatsapp_customer": true,
    "view_team": true,
    "view_schedule": true,
    "view_attendance_leaves": true,
    "create_leave_request": true,
    "view_activity_logs": true,
    "view_activity_details": true
  }'::jsonb
) ON CONFLICT (name) DO NOTHING;

INSERT INTO public.roles (name, name_ar, description, permissions) VALUES
(
  'accountant',
  'محاسب',
  'صلاحيات المحاسب',
  '{
    "view_dashboard": true,
    "view_dashboard_stats": true,
    "view_analytics_sales": true,
    "view_sales_reports": true,
    "export_sales_reports": true,
    "view_branch_comparison": true,
    "view_invoice_import": true,
    "import_sales_invoices": true,
    "review_import_errors": true,
    "delete_import_batch": true,
    "view_points_rewards": true,
    "export_points_report": true,
    "view_activity_logs": true,
    "view_activity_details": true,
    "export_activity_logs": true
  }'::jsonb
) ON CONFLICT (name) DO NOTHING;

INSERT INTO public.roles (name, name_ar, description, permissions) VALUES
(
  'reviewer',
  'مراجع',
  'صلاحيات المراجع',
  '{
    "view_dashboard": true,
    "view_dashboard_stats": true,
    "view_shift_performance": true,
    "edit_shift_evaluation": true,
    "approve_shift_evaluation": true,
    "view_doctor_dashboard": true,
    "view_all_doctors_performance": true,
    "view_conversation_reviews": true,
    "edit_conversation_review": true,
    "approve_conversation_review": true,
    "view_delivery": true,
    "edit_delivery_evaluation": true,
    "approve_delivery_deduction": true,
    "view_points_rewards": true,
    "edit_points_transaction": true,
    "approve_points_changes": true,
    "view_activity_logs": true,
    "view_activity_details": true
  }'::jsonb
) ON CONFLICT (name) DO NOTHING;

INSERT INTO public.roles (name, name_ar, description, permissions) VALUES
(
  'viewer',
  'مشاهد فقط',
  'صلاحيات المشاهد فقط',
  '{
    "view_dashboard": true,
    "view_dashboard_stats": true,
    "view_alerts": true,
    "view_shift_performance": true,
    "view_doctor_dashboard": true,
    "view_customers": true,
    "view_customer_details": true,
    "view_customer_service": true,
    "view_team": true,
    "view_schedule": true,
    "view_attendance_leaves": true,
    "view_points_rewards": true,
    "view_conversation_reviews": true,
    "view_stagnant_medicines": true,
    "view_stagnant_reports": true,
    "view_incentive_medicines": true,
    "view_incentive_reports": true,
    "view_delivery": true,
    "view_delivery_reports": true,
    "view_analytics_sales": true,
    "view_sales_reports": true,
    "view_activity_logs": true,
    "view_activity_details": true
  }'::jsonb
) ON CONFLICT (name) DO NOTHING;

-- Function to get effective permissions for a user (role + overrides)
CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH role_permissions AS (
    SELECT r.permissions
    FROM staff_accounts sa
    JOIN roles r ON r.name = sa.role OR r.name_ar = sa.role
    WHERE sa.id = p_user_id
  ),
  user_overrides AS (
    SELECT permission_key, allowed
    FROM user_permissions
    WHERE user_id = p_user_id
  )
  SELECT 
    COALESCE(
      (
        SELECT jsonb_object_agg(
          ak.key,
          COALESCE(
            (SELECT to_jsonb(uo.allowed) FROM user_overrides uo WHERE uo.permission_key = ak.key),
            (rp.permissions->>ak.key)::jsonb,
            'false'::jsonb
          )
        )
        FROM (
          SELECT jsonb_object_keys(rp.permissions) as key
          FROM role_permissions rp
          UNION
          SELECT permission_key as key
          FROM user_overrides
        ) ak
        CROSS JOIN role_permissions rp
      ),
      '{}'::jsonb
    ) as permissions;
$$;

-- Function to check if user has specific permission
CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id uuid, p_permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((get_user_permissions(p_user_id)->>p_permission_key)::boolean, false);
$$;
