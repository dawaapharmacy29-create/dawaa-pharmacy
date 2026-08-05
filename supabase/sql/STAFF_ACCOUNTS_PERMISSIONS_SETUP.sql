-- ═══════════════════════════════════════════════════════════════
  -- STAFF_ACCOUNTS_PERMISSIONS_SETUP.sql
  -- تشغيل هذا الملف مرة واحدة في Supabase SQL Editor
  -- ═══════════════════════════════════════════════════════════════

  -- 1. إضافة أعمدة مفقودة في staff_accounts (آمن — لا يُعيد إنشاء الجدول)
  DO $$
  BEGIN
    -- permissions JSONB
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name='staff_accounts' AND column_name='permissions') THEN
      ALTER TABLE staff_accounts ADD COLUMN permissions JSONB DEFAULT '{}'::jsonb;
    END IF;
    -- role
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name='staff_accounts' AND column_name='role') THEN
      ALTER TABLE staff_accounts ADD COLUMN role TEXT;
    END IF;
    -- branch
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name='staff_accounts' AND column_name='branch') THEN
      ALTER TABLE staff_accounts ADD COLUMN branch TEXT;
    END IF;
    -- can_login
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name='staff_accounts' AND column_name='can_login') THEN
      ALTER TABLE staff_accounts ADD COLUMN can_login BOOLEAN DEFAULT TRUE;
    END IF;
    -- active
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name='staff_accounts' AND column_name='active') THEN
      ALTER TABLE staff_accounts ADD COLUMN active BOOLEAN DEFAULT TRUE;
    END IF;
    -- visible_in_admin
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name='staff_accounts' AND column_name='visible_in_admin') THEN
      ALTER TABLE staff_accounts ADD COLUMN visible_in_admin BOOLEAN DEFAULT TRUE;
    END IF;
    -- staff_id (link to staff table)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name='staff_accounts' AND column_name='staff_id') THEN
      ALTER TABLE staff_accounts ADD COLUMN staff_id UUID REFERENCES staff(id) ON DELETE SET NULL;
    END IF;
    -- staff_name
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name='staff_accounts' AND column_name='staff_name') THEN
      ALTER TABLE staff_accounts ADD COLUMN staff_name TEXT;
    END IF;
    -- temporary_password
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name='staff_accounts' AND column_name='temporary_password') THEN
      ALTER TABLE staff_accounts ADD COLUMN temporary_password TEXT;
    END IF;
    -- password_status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name='staff_accounts' AND column_name='password_status') THEN
      ALTER TABLE staff_accounts ADD COLUMN password_status TEXT DEFAULT 'مؤقتة';
    END IF;
    -- last_login_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name='staff_accounts' AND column_name='last_login_at') THEN
      ALTER TABLE staff_accounts ADD COLUMN last_login_at TIMESTAMPTZ;
    END IF;
    -- updated_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name='staff_accounts' AND column_name='updated_at') THEN
      ALTER TABLE staff_accounts ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
    -- created_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
      WHERE table_name='staff_accounts' AND column_name='created_at') THEN
      ALTER TABLE staff_accounts ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
  END $$;

  -- 2. فهرسة للأداء
  CREATE INDEX IF NOT EXISTS idx_staff_accounts_staff_id   ON staff_accounts(staff_id);
  CREATE INDEX IF NOT EXISTS idx_staff_accounts_username    ON staff_accounts(username);
  CREATE INDEX IF NOT EXISTS idx_staff_accounts_active      ON staff_accounts(active);
  CREATE INDEX IF NOT EXISTS idx_staff_accounts_role        ON staff_accounts(role);

  -- 3. جدول user_permissions للصلاحيات الفردية (overrides per-user)
  CREATE TABLE IF NOT EXISTS user_permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES staff_accounts(id) ON DELETE CASCADE,
    permission_key  TEXT NOT NULL,
    allowed         BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, permission_key)
  );
  CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions(user_id);

  -- 4. دالة تسجيل الدخول (staff_account_login)
  CREATE OR REPLACE FUNCTION staff_account_login(p_username TEXT, p_password TEXT)
  RETURNS TABLE (
    id              UUID,
    staff_id        UUID,
    username        TEXT,
    name            TEXT,
    role            TEXT,
    branch          TEXT,
    phone           TEXT,
    active          BOOLEAN,
    can_login       BOOLEAN,
    permissions     JSONB
  ) LANGUAGE plpgsql SECURITY DEFINER AS $$
  BEGIN
    RETURN QUERY
    SELECT
      sa.id,
      sa.staff_id,
      sa.username,
      COALESCE(sa.staff_name, sa.name)::TEXT AS name,
      COALESCE(sa.role, '')::TEXT AS role,
      COALESCE(sa.branch, '')::TEXT AS branch,
      NULL::TEXT AS phone,
      COALESCE(sa.active, TRUE),
      COALESCE(sa.can_login, TRUE),
      COALESCE(sa.permissions, '{}'::jsonb)
    FROM staff_accounts sa
    WHERE sa.username = p_username
      AND (sa.temporary_password = p_password OR sa.password_hash = p_password)
      AND COALESCE(sa.active, TRUE) = TRUE
      AND COALESCE(sa.can_login, TRUE) = TRUE
    LIMIT 1;

    -- تحديث last_login_at
    UPDATE staff_accounts
      SET last_login_at = NOW()
    WHERE username = p_username
      AND COALESCE(active, TRUE) = TRUE;
  END;
  $$;

  -- 5. دالة get_user_permissions — تجمع permissions من staff_accounts + user_permissions
  CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id UUID)
  RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
  DECLARE
    v_base_perms    JSONB;
    v_overrides     JSONB := '{}'::jsonb;
    v_perm          RECORD;
  BEGIN
    SELECT COALESCE(permissions, '{}'::jsonb) INTO v_base_perms
      FROM staff_accounts WHERE id = p_user_id;

    FOR v_perm IN
      SELECT permission_key, allowed FROM user_permissions WHERE user_id = p_user_id
    LOOP
      v_overrides := v_overrides || jsonb_build_object(v_perm.permission_key, v_perm.allowed);
    END LOOP;

    RETURN v_base_perms || v_overrides;
  END;
  $$;

  -- 6. دالة set_current_user_context (للـ RLS)
  CREATE OR REPLACE FUNCTION set_current_user_context(p_user_id UUID)
  RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
  BEGIN
    PERFORM set_config('app.current_user_id', COALESCE(p_user_id::TEXT, ''), FALSE);
  END;
  $$;

  -- 7. دالة user_has_permission — للتحقق السريع
  CREATE OR REPLACE FUNCTION user_has_permission(p_user_id UUID, p_permission_key TEXT)
  RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
  DECLARE
    v_perms JSONB;
  BEGIN
    v_perms := get_user_permissions(p_user_id);
    RETURN COALESCE((v_perms ->> p_permission_key)::BOOLEAN, FALSE);
  END;
  $$;

  -- ═══════════════════════════════════════════════════════════════
  -- تم بنجاح ✓
  -- الخطوة التالية: اضغط Run في Supabase SQL Editor
  -- ═══════════════════════════════════════════════════════════════
  