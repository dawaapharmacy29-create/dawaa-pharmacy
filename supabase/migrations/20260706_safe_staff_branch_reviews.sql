-- Safe migration for Dawaa Pharmacy
-- Adds missing doctors in Shamy branch without duplicates.
-- Updates Basant to Shamy branch only if the record exists.
-- Does not delete or modify unrelated staff rows.

DO $$
DECLARE
  has_name boolean := false;
  has_username boolean := false;
  has_role boolean := false;
  has_branch boolean := false;
  has_status boolean := false;
  has_active boolean := false;
  has_is_active boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'name'
  ) INTO has_name;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'username'
  ) INTO has_username;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'role'
  ) INTO has_role;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'branch'
  ) INTO has_branch;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'status'
  ) INTO has_status;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'active'
  ) INTO has_active;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'is_active'
  ) INTO has_is_active;

  IF has_name AND has_username AND has_role AND has_branch AND has_status AND has_active AND has_is_active THEN
    -- Insert new pharmacists only if not already present by username or name.
    INSERT INTO public.staff (name, username, role, branch, status, active, is_active)
    SELECT * FROM (
      VALUES
        ('د رضا', 'dr.reda', 'pharmacist', 'فرع الشامي', 'active', true, true),
        ('د احمد حافظ', 'dr.ahmed.hafez', 'pharmacist', 'فرع الشامي', 'active', true, true),
        ('د احمد وليد', 'dr.ahmed.waleed', 'pharmacist', 'فرع الشامي', 'active', true, true)
    ) AS v(name, username, role, branch, status, active, is_active)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.username IS NOT NULL AND s.username = v.username
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.name IS NOT NULL AND s.name = v.name
    );

    -- Update Basant if an existing row is found, without creating duplicates.
    UPDATE public.staff
    SET branch = 'فرع الشامي',
        status = 'active',
        active = true,
        is_active = true
    WHERE lower(trim(coalesce(name, ''))) IN ('د بسنت', 'د/ بسنت')
       OR lower(trim(coalesce(username, ''))) = 'dr.basant';
  END IF;
END $$;

-- Optional: if a branch-permission table already exists and has the expected columns,
-- add review visibility for the two requested users without creating a new table.
DO $$
DECLARE
  review_perm_table boolean := false;
  review_perm_staff_id boolean := false;
  review_perm_permission_key boolean := false;
  review_perm_permission_value boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'staff_permissions'
  ) INTO review_perm_table;

  IF review_perm_table THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staff_permissions' AND column_name = 'staff_id'
    ) INTO review_perm_staff_id;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staff_permissions' AND column_name = 'permission_key'
    ) INTO review_perm_permission_key;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'staff_permissions' AND column_name = 'permission_value'
    ) INTO review_perm_permission_value;
  END IF;

  IF review_perm_table AND review_perm_staff_id AND review_perm_permission_key AND review_perm_permission_value THEN
    INSERT INTO public.staff_permissions (staff_id, permission_key, permission_value)
    SELECT s.id, 'view_conversation_reviews', true
    FROM public.staff s
    WHERE lower(trim(coalesce(s.name, ''))) IN ('د/ ضحى', 'د ضحى', 'د دنيا', 'د/ دنيا')
      OR lower(trim(coalesce(s.username, ''))) IN ('dr.dahha', 'dr.dunya')
    ON CONFLICT (staff_id, permission_key) DO NOTHING;
  END IF;
END $$;
