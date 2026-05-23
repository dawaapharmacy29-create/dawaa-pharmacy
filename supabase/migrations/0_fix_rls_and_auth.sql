-- ============================================================
-- المرحلة 0+2: إصلاح RLS و Auth والحسابات الأساسية
-- ============================================================

-- 1. إنشاء جدول user_profiles إذا لم يكن موجودًا
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT DEFAULT 'موظف',
  branch TEXT,
  phone TEXT,
  permissions JSONB DEFAULT '{}'::jsonb,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. إصلاح جدول staff_accounts (إضافة الأعمدة المفقودة)
ALTER TABLE public.staff_accounts ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE public.staff_accounts ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE public.staff_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE public.staff_accounts ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 3. حذف RLS القديم من staff_accounts وإنشاء الجديد
DROP POLICY IF EXISTS "Enable read for all authenticated users" ON public.staff_accounts;
DROP POLICY IF EXISTS "Enable insert for admins" ON public.staff_accounts;
DROP POLICY IF EXISTS "Enable update for admins" ON public.staff_accounts;
DROP POLICY IF EXISTS "Enable delete for admins" ON public.staff_accounts;

ALTER TABLE public.staff_accounts ENABLE ROW LEVEL SECURITY;

-- سياسة SELECT: كل المستخدمين المصرحين
CREATE POLICY "staff_accounts_select_authenticated"
ON public.staff_accounts
FOR SELECT
TO authenticated
USING (true);

-- سياسة INSERT/UPDATE/DELETE: المدير العام أو من له صلاحية manage_staff_accounts
CREATE POLICY "staff_accounts_write_admin"
ON public.staff_accounts
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.auth_user_id = auth.uid()
    AND (
      up.role IN ('مدير عام', 'admin', 'مدير')
      OR coalesce(up.permissions, '{}'::jsonb) ? 'manage_staff_accounts'
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.auth_user_id = auth.uid()
    AND (
      up.role IN ('مدير عام', 'admin', 'مدير')
      OR coalesce(up.permissions, '{}'::jsonb) ? 'manage_staff_accounts'
    )
  )
);

-- 4. إصلاح جدول user_permissions (إذا كان موجودًا)
DROP POLICY IF EXISTS "Enable read for authenticated" ON public.user_permissions;
DROP POLICY IF EXISTS "Enable write for admins" ON public.user_permissions;

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_permissions_select_authenticated"
ON public.user_permissions
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "user_permissions_write_admin"
ON public.user_permissions
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.auth_user_id = auth.uid()
    AND (
      up.role IN ('مدير عام', 'admin', 'مدير')
      OR coalesce(up.permissions, '{}'::jsonb) ? 'manage_permissions'
      OR coalesce(up.permissions, '{}'::jsonb) ? 'manage_roles'
      OR coalesce(up.permissions, '{}'::jsonb) ? 'manage_user_permissions'
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.auth_user_id = auth.uid()
    AND (
      up.role IN ('مدير عام', 'admin', 'مدير')
      OR coalesce(up.permissions, '{}'::jsonb) ? 'manage_permissions'
      OR coalesce(up.permissions, '{}'::jsonb) ? 'manage_roles'
      OR coalesce(up.permissions, '{}'::jsonb) ? 'manage_user_permissions'
    )
  )
);

-- 5. إصلاح جدول roles (إذا كان موجودًا)
DROP POLICY IF EXISTS "Enable read for authenticated" ON public.roles;
DROP POLICY IF EXISTS "Enable write for admins" ON public.roles;

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roles_select_authenticated"
ON public.roles
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "roles_write_admin"
ON public.roles
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.auth_user_id = auth.uid()
    AND (
      up.role IN ('مدير عام', 'admin', 'مدير')
      OR coalesce(up.permissions, '{}'::jsonb) ? 'manage_roles'
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.auth_user_id = auth.uid()
    AND (
      up.role IN ('مدير عام', 'admin', 'مدير')
      OR coalesce(up.permissions, '{}'::jsonb) ? 'manage_roles'
    )
  )
);

-- 6. إصلاح جدول permissions (إذا كان موجودًا)
DROP POLICY IF EXISTS "Enable read for authenticated" ON public.permissions;
DROP POLICY IF EXISTS "Enable write for admins" ON public.permissions;

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "permissions_select_authenticated"
ON public.permissions
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "permissions_write_admin"
ON public.permissions
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.auth_user_id = auth.uid()
    AND (
      up.role IN ('مدير عام', 'admin', 'مدير')
      OR coalesce(up.permissions, '{}'::jsonb) ? 'manage_permissions'
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.auth_user_id = auth.uid()
    AND (
      up.role IN ('مدير عام', 'admin', 'مدير')
      OR coalesce(up.permissions, '{}'::jsonb) ? 'manage_permissions'
    )
  )
);

-- 7. إنشاء الأدوار الافتراضية إذا لم تكن موجودة
INSERT INTO public.roles (name, name_ar, permissions) VALUES
  ('admin', 'مدير عام', '{"manage_staff_accounts": true, "view_staff_accounts": true, "create_staff_account": true, "edit_staff_account": true, "reset_staff_password": true, "disable_staff_account": true, "view_roles_permissions": true, "manage_roles": true, "manage_permissions": true, "manage_user_permissions": true, "view_dashboard": true, "view_analytics_sales": true, "import_sales_invoices": true, "view_activity_logs": true, "manage_settings": true, "manage_branches": true, "view_doctor_dashboard": true, "view_list_medicines": true, "create_list_medicine": true, "edit_list_medicine": true, "dispense_list_medicine": true, "view_stagnant_medicines": true, "create_stagnant_medicine": true, "edit_stagnant_medicine": true, "dispense_stagnant_medicine": true, "view_points_rewards": true, "create_reward": true, "create_deduction": true, "approve_points_changes": true}'::jsonb),
  ('branch_manager', 'مدير فرع', '{"view_staff_accounts": true, "view_roles_permissions": true, "view_dashboard": true, "view_analytics_sales": true, "view_activity_logs": true, "view_doctor_dashboard": true, "view_list_medicines": true, "create_list_medicine": true, "edit_list_medicine": true, "dispense_list_medicine": true, "view_stagnant_medicines": true, "create_stagnant_medicine": true, "edit_stagnant_medicine": true, "dispense_stagnant_medicine": true, "view_points_rewards": true, "create_reward": true, "create_deduction": true}'::jsonb),
  ('pharmacist', 'صيدلاني', '{"view_dashboard": true, "view_doctor_dashboard": true, "view_list_medicines": true, "create_list_medicine": true, "edit_list_medicine": true, "dispense_list_medicine": true, "view_stagnant_medicines": true, "create_stagnant_medicine": true, "edit_stagnant_medicine": true, "dispense_stagnant_medicine": true, "view_points_rewards": true}'::jsonb),
  ('delivery', 'توصيل', '{"view_dashboard": true, "view_points_rewards": true}'::jsonb),
  ('customer_service', 'خدمة عملاء', '{"view_dashboard": true, "view_points_rewards": true}'::jsonb)
ON CONFLICT DO NOTHING;

-- 8. حذف سجل dr.moaz القديم إذا كان موجودًا (لتجنب التعارضات)
DELETE FROM public.staff_accounts WHERE username = 'dr.moaz';

-- 9. إنشاء موظف "د معاذ" في جدول staff إذا لم يكن موجودًا
INSERT INTO public.staff (id, name, username, role, branch, phone, active, created_at, updated_at)
VALUES 
  ('11111111-0000-0000-0000-000000000000'::uuid, 'د معاذ', 'dr.moaz', 'مدير', 'الكل', NULL, true, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET 
  name = 'د معاذ',
  username = 'dr.moaz',
  role = 'مدير',
  branch = 'الكل',
  active = true,
  updated_at = NOW();

-- 10. إنشاء user_profile لـ د معاذ (يحتاج إلى UUID من auth.users)
-- ملاحظة: هذا يتطلب إنشاء المستخدم في Supabase Auth أولًا
-- سيتم هذا عبر تطبيق React بعد ذلك

-- 11. إنشاء حساب staff في جدول staff_accounts
INSERT INTO public.staff_accounts (
  id,
  staff_id,
  username,
  temporary_password,
  password_status,
  name,
  staff_name,
  role,
  staff_role,
  branch,
  active,
  can_login,
  visible_in_admin,
  permissions,
  created_at,
  updated_at
)
VALUES (
  '22222222-0000-0000-0000-000000000000'::uuid,
  '11111111-0000-0000-0000-000000000000'::uuid,
  'dr.moaz',
  '9493',
  'مؤقتة',
  'د معاذ',
  'د معاذ',
  'مدير',
  'مدير',
  'الكل',
  true,
  true,
  true,
  '{"manage_staff_accounts": true, "view_staff_accounts": true, "create_staff_account": true, "edit_staff_account": true, "reset_staff_password": true, "disable_staff_account": true, "view_roles_permissions": true, "manage_roles": true, "manage_permissions": true, "manage_user_permissions": true, "view_dashboard": true, "view_analytics_sales": true, "import_sales_invoices": true, "view_activity_logs": true, "manage_settings": true, "manage_branches": true, "view_doctor_dashboard": true, "view_list_medicines": true, "create_list_medicine": true, "edit_list_medicine": true, "dispense_list_medicine": true, "view_stagnant_medicines": true, "create_stagnant_medicine": true, "edit_stagnant_medicine": true, "dispense_stagnant_medicine": true, "view_points_rewards": true, "create_reward": true, "create_deduction": true, "approve_points_changes": true}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET 
  username = 'dr.moaz',
  temporary_password = '9493',
  password_status = 'مؤقتة',
  active = true,
  can_login = true,
  permissions = '{"manage_staff_accounts": true, "view_staff_accounts": true, "create_staff_account": true, "edit_staff_account": true, "reset_staff_password": true, "disable_staff_account": true, "view_roles_permissions": true, "manage_roles": true, "manage_permissions": true, "manage_user_permissions": true, "view_dashboard": true, "view_analytics_sales": true, "import_sales_invoices": true, "view_activity_logs": true, "manage_settings": true, "manage_branches": true, "view_doctor_dashboard": true, "view_list_medicines": true, "create_list_medicine": true, "edit_list_medicine": true, "dispense_list_medicine": true, "view_stagnant_medicines": true, "create_stagnant_medicine": true, "edit_stagnant_medicine": true, "dispense_stagnant_medicine": true, "view_points_rewards": true, "create_reward": true, "create_deduction": true, "approve_points_changes": true}'::jsonb,
  updated_at = NOW();

-- 12. تعطيل RLS مؤقتًا على activity_logs للسماح بالكتابة
ALTER TABLE public.activity_logs DISABLE ROW LEVEL SECURITY;

-- 13. تعطيل RLS مؤقتًا على notifications
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;

-- 14. إنشاء index على user_profiles للأداء
CREATE INDEX IF NOT EXISTS idx_user_profiles_auth_user_id ON public.user_profiles(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_staff_accounts_username ON public.staff_accounts(username);
CREATE INDEX IF NOT EXISTS idx_staff_accounts_active ON public.staff_accounts(active);
