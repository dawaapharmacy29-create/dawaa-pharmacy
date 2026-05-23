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

-- 4. إصلاح جدول user_permissions
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

-- 5. إصلاح جدول roles
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

-- 6. إصلاح جدول permissions
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

-- 7. تعطيل RLS مؤقتًا على activity_logs والـ notifications
ALTER TABLE public.activity_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;

-- 8. إنشاء index للأداء
CREATE INDEX IF NOT EXISTS idx_user_profiles_auth_user_id ON public.user_profiles(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_staff_accounts_username ON public.staff_accounts(username);
CREATE INDEX IF NOT EXISTS idx_staff_accounts_active ON public.staff_accounts(active);
