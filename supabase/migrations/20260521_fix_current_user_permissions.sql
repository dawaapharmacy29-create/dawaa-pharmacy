-- Fix permissions for current user to manage roles and permissions
-- This ensures the current logged-in user has the necessary permissions

-- Update all staff accounts with admin/manager roles to have permissions management
update public.staff_accounts
set permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object(
  'manage_permissions', true,
  'manage_roles', true,
  'manage_user_permissions', true,
  'view_roles_permissions', true
)
where role in ('مدير عام', 'admin', 'أدمن', 'مدير')
  or lower(username) = 'dr.moaz'
  or lower(username) = 'admin';

-- Also update user_profiles to match
update public.user_profiles up
set permissions = coalesce(up.permissions, '{}'::jsonb) || jsonb_build_object(
  'manage_permissions', true,
  'manage_roles', true,
  'manage_user_permissions', true,
  'view_roles_permissions', true
)
from public.staff_accounts sa
where up.staff_account_id = sa.id
  and (sa.role in ('مدير عام', 'admin', 'أدمن', 'مدير') 
       or lower(sa.username) = 'dr.moaz'
       or lower(sa.username) = 'admin');
