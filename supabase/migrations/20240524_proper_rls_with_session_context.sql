-- Implement proper RLS for staff_accounts using session variables
-- Since the app uses custom authentication (staff_account_login RPC),
-- we use PostgreSQL session variables to track the current user context.
-- Date: 2024-05-24

-- Create a function to set the current user context in session
CREATE OR REPLACE FUNCTION public.set_current_user_context(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id::text, true);
END;
$$;

-- Create a function to get the current user ID from session
CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$;

-- Create a function to check if current user has a specific permission
CREATE OR REPLACE FUNCTION public.current_user_has_permission(p_permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (
      SELECT (get_user_permissions(get_current_user_id())->>p_permission_key)::boolean
      FROM (SELECT 1) AS dummy
      WHERE get_current_user_id() IS NOT NULL
    ),
    false
  );
$$;

-- Update staff_account_login to set the user context
CREATE OR REPLACE FUNCTION public.staff_account_login(
  p_username text,
  p_password text
)
RETURNS table (
  id uuid,
  username text,
  name text,
  role text,
  branch text,
  phone text,
  active boolean,
  permissions jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matched_id uuid;
  v_role_name text;
  v_role_permissions jsonb;
BEGIN
  -- Find matching account
  SELECT id INTO v_matched_id
  FROM public.staff_accounts a
  WHERE lower(a.username) = lower(trim(p_username))
    AND coalesce(a.can_login, true) = true
    AND coalesce(a.active, true) = true
    AND (
      a.temporary_password = p_password
      OR a.password_hash = crypt(p_password, a.password_hash)
      OR a.password_hash = p_password
    )
  LIMIT 1;

  IF v_matched_id IS NULL THEN
    RETURN;
  END IF;

  -- Get role name and permissions
  SELECT coalesce(a.role, a.staff_role, 'صيدلاني') INTO v_role_name
  FROM public.staff_accounts a
  WHERE a.id = v_matched_id;

  SELECT r.permissions INTO v_role_permissions
  FROM public.roles r
  WHERE r.name = v_role_name OR r.name_ar = v_role_name
  LIMIT 1;

  -- Update last login
  UPDATE public.staff_accounts a
  SET last_login_at = now()
  WHERE a.id = v_matched_id;

  -- Set the current user context in session
  PERFORM public.set_current_user_context(v_matched_id);

  -- Return user data
  RETURN QUERY
  SELECT
    a.id,
    a.username,
    coalesce(a.name, a.staff_name),
    coalesce(a.role, a.staff_role),
    coalesce(a.branch, 'الكل'),
    a.phone,
    coalesce(a.active, true),
    coalesce(v_role_permissions, a.permissions, '{}'::jsonb)
  FROM public.staff_accounts a
  WHERE a.id = v_matched_id;
END;
$$;

-- Drop existing open policies on staff_accounts
DROP POLICY IF EXISTS "staff_accounts_open_read" ON public.staff_accounts;
DROP POLICY IF EXISTS "staff_accounts_open_write" ON public.staff_accounts;

-- Create proper RLS policies for staff_accounts

-- Policy: Users can view their own account
CREATE POLICY "staff_accounts_view_own"
ON public.staff_accounts
FOR SELECT
TO anon, authenticated
USING (id = get_current_user_id());

-- Policy: Users with view_staff_accounts permission can view all accounts
CREATE POLICY "staff_accounts_view_all"
ON public.staff_accounts
FOR SELECT
TO anon, authenticated
USING (current_user_has_permission('view_staff_accounts'));

-- Policy: Users with create_staff_account permission can insert
CREATE POLICY "staff_accounts_insert"
ON public.staff_accounts
FOR INSERT
TO anon, authenticated
WITH CHECK (current_user_has_permission('create_staff_account'));

-- Policy: Users can update their own account
CREATE POLICY "staff_accounts_update_own"
ON public.staff_accounts
FOR UPDATE
TO anon, authenticated
USING (id = get_current_user_id())
WITH CHECK (id = get_current_user_id());

-- Policy: Users with edit_staff_account permission can update any account
CREATE POLICY "staff_accounts_update_any"
ON public.staff_accounts
FOR UPDATE
TO anon, authenticated
USING (current_user_has_permission('edit_staff_account'))
WITH CHECK (current_user_has_permission('edit_staff_account'));

-- Policy: Users with disable_staff_account permission can disable accounts
CREATE POLICY "staff_accounts_disable"
ON public.staff_accounts
FOR UPDATE
TO anon, authenticated
USING (
  current_user_has_permission('disable_staff_account') AND
  (old.active = true AND new.active = false)
)
WITH CHECK (
  current_user_has_permission('disable_staff_account') AND
  (old.active = true AND new.active = false)
);

-- Policy: Users with reset_staff_password permission can reset passwords
CREATE POLICY "staff_accounts_reset_password"
ON public.staff_accounts
FOR UPDATE
TO anon, authenticated
USING (
  current_user_has_permission('reset_staff_password') AND
  (old.password_hash IS DISTINCT FROM new.password_hash OR
   old.temporary_password IS DISTINCT FROM new.temporary_password)
)
WITH CHECK (
  current_user_has_permission('reset_staff_password') AND
  (old.password_hash IS DISTINCT FROM new.password_hash OR
   old.temporary_password IS DISTINCT FROM new.temporary_password)
);

-- Policy: Users with manage_staff_accounts permission can delete
CREATE POLICY "staff_accounts_delete"
ON public.staff_accounts
FOR DELETE
TO anon, authenticated
USING (current_user_has_permission('manage_staff_accounts'));

-- Comment on the approach
COMMENT ON FUNCTION public.set_current_user_context IS 'Sets the current user ID in a PostgreSQL session variable for RLS purposes';
COMMENT ON FUNCTION public.get_current_user_id IS 'Retrieves the current user ID from the session variable';
COMMENT ON FUNCTION public.current_user_has_permission IS 'Checks if the current session user has a specific permission';
