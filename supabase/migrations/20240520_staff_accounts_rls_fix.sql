-- Migration to fix RLS on staff_accounts table
-- Date: 2024-05-20

-- Drop existing open policies
DROP POLICY IF EXISTS "Allow anon read staff accounts" ON public.staff_accounts;
DROP POLICY IF EXISTS "Allow anon insert staff accounts" ON public.staff_accounts;
DROP POLICY IF EXISTS "Allow anon update staff accounts" ON public.staff_accounts;
DROP POLICY IF EXISTS "Allow authenticated read staff accounts" ON public.staff_accounts;
DROP POLICY IF EXISTS "Allow authenticated update staff accounts" ON public.staff_accounts;

-- Create policy for authenticated users to read staff_accounts
-- This allows all authenticated users to view staff accounts
CREATE POLICY "staff_accounts_select_authenticated"
ON public.staff_accounts
FOR SELECT
TO authenticated
USING (true);

-- Create policy for authenticated users to insert staff_accounts
-- Only users with manage_staff_accounts permission or general_manager role can insert
CREATE POLICY "staff_accounts_insert_admin"
ON public.staff_accounts
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.staff_accounts sa
    WHERE sa.auth_user_id = auth.uid()
    AND (
      sa.role = 'مدير عام'
      OR sa.role = 'general_manager'
      OR sa.role = 'admin'
      OR (sa.permissions ? 'manage_staff_accounts')
    )
  )
  OR
  EXISTS (
    SELECT 1
    FROM public.roles r
    JOIN public.staff_accounts sa ON sa.role = r.name OR sa.role = r.name_ar
    WHERE sa.auth_user_id = auth.uid()
    AND (
      r.name = 'general_manager'
      OR r.name = 'admin'
      OR (r.permissions ? 'manage_staff_accounts')
    )
  )
);

-- Create policy for authenticated users to update staff_accounts
-- Only users with manage_staff_accounts permission or general_manager role can update
CREATE POLICY "staff_accounts_update_admin"
ON public.staff_accounts
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.staff_accounts sa
    WHERE sa.auth_user_id = auth.uid()
    AND (
      sa.role = 'مدير عام'
      OR sa.role = 'general_manager'
      OR sa.role = 'admin'
      OR (sa.permissions ? 'manage_staff_accounts')
    )
  )
  OR
  EXISTS (
    SELECT 1
    FROM public.roles r
    JOIN public.staff_accounts sa ON sa.role = r.name OR sa.role = r.name_ar
    WHERE sa.auth_user_id = auth.uid()
    AND (
      r.name = 'general_manager'
      OR r.name = 'admin'
      OR (r.permissions ? 'manage_staff_accounts')
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.staff_accounts sa
    WHERE sa.auth_user_id = auth.uid()
    AND (
      sa.role = 'مدير عام'
      OR sa.role = 'general_manager'
      OR sa.role = 'admin'
      OR (sa.permissions ? 'manage_staff_accounts')
    )
  )
  OR
  EXISTS (
    SELECT 1
    FROM public.roles r
    JOIN public.staff_accounts sa ON sa.role = r.name OR sa.role = r.name_ar
    WHERE sa.auth_user_id = auth.uid()
    AND (
      r.name = 'general_manager'
      OR r.name = 'admin'
      OR (r.permissions ? 'manage_staff_accounts')
    )
  )
);

-- Create policy for authenticated users to delete staff_accounts
-- Only users with manage_staff_accounts permission or general_manager role can delete
CREATE POLICY "staff_accounts_delete_admin"
ON public.staff_accounts
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.staff_accounts sa
    WHERE sa.auth_user_id = auth.uid()
    AND (
      sa.role = 'مدير عام'
      OR sa.role = 'general_manager'
      OR sa.role = 'admin'
      OR (sa.permissions ? 'manage_staff_accounts')
    )
  )
  OR
  EXISTS (
    SELECT 1
    FROM public.roles r
    JOIN public.staff_accounts sa ON sa.role = r.name OR sa.role = r.name_ar
    WHERE sa.auth_user_id = auth.uid()
    AND (
      r.name = 'general_manager'
      OR r.name = 'admin'
      OR (r.permissions ? 'manage_staff_accounts')
    )
  )
);

-- Add comments
COMMENT ON POLICY "staff_accounts_select_authenticated" ON public.staff_accounts IS 'Allow all authenticated users to read staff accounts';
COMMENT ON POLICY "staff_accounts_insert_admin" ON public.staff_accounts IS 'Allow only admins to insert staff accounts';
COMMENT ON POLICY "staff_accounts_update_admin" ON public.staff_accounts IS 'Allow only admins to update staff accounts';
COMMENT ON POLICY "staff_accounts_delete_admin" ON public.staff_accounts IS 'Allow only admins to delete staff accounts';
