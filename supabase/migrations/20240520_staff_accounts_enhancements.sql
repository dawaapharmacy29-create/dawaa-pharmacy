-- Migration to enhance staff_accounts table for automatic account creation
-- Date: 2024-05-20

-- Add missing columns to staff_accounts table
ALTER TABLE public.staff_accounts
ADD COLUMN IF NOT EXISTS password_status text default 'مؤقتة',
ADD COLUMN IF NOT EXISTS auth_user_id uuid,
ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- Add comments for documentation
COMMENT ON COLUMN public.staff_accounts.password_status IS 'Password status: مؤقتة, تم التغيير, etc.';
COMMENT ON COLUMN public.staff_accounts.auth_user_id IS 'Reference to Supabase Auth user ID if created';
COMMENT ON COLUMN public.staff_accounts.last_login_at IS 'Timestamp of last successful login';

-- Create function to generate username from Arabic name
CREATE OR REPLACE FUNCTION public.generate_username_from_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 
    CASE
      WHEN p_name IS NULL OR p_name = '' THEN 'user_' || substr(gen_random_uuid()::text, 1, 8)
      ELSE lower(
        regexp_replace(
          regexp_replace(
            regexp_replace(p_name, 'د/? ', 'dr.', 'g'),
            '[^\w\s-]', '', 'g'
          ),
          '\s+', '.', 'g'
        )
      )
    END;
$$;

-- Create function to generate default password
CREATE OR REPLACE FUNCTION public.generate_default_password()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT 'Temp' || substr(md5(random()::text), 1, 6);
$$;
