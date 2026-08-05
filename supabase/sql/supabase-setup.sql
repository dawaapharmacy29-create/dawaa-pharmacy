-- ═══════════════════════════════════════════════════════════════
-- داواء صيدليات 2027 — إعداد قاعدة البيانات الكامل
-- قم بتشغيل هذا الملف في Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- تفعيل pgcrypto لتشفير كلمات السر
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ══════════════════════════════════
-- 1) جدول الموظفين (staff)
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  role        text NOT NULL DEFAULT 'pharmacist',
  branch      text,
  phone       text,
  email       text,
  active      boolean NOT NULL DEFAULT true,
  is_active   boolean NOT NULL DEFAULT true,
  status      text DEFAULT 'active',
  points      integer DEFAULT 0,
  max_points  integer DEFAULT 100,
  hire_date   date,
  notes       text,
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ══════════════════════════════════
-- 2) جدول الحسابات (staff_accounts)
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS staff_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id      uuid REFERENCES staff(id) ON DELETE SET NULL,
  username      text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL DEFAULT 'pharmacist',
  branch        text NOT NULL DEFAULT 'الفرع الرئيسي',
  phone         text,
  active        boolean NOT NULL DEFAULT true,
  can_login     boolean NOT NULL DEFAULT true,
  permissions   jsonb DEFAULT '{}',
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ══════════════════════════════════
-- 3) جدول الإشعارات (notifications)
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                text NOT NULL,
  message              text DEFAULT '',
  body                 text DEFAULT '',
  type                 text DEFAULT 'system',
  priority             text DEFAULT 'normal',
  recipient_staff_id   uuid REFERENCES staff(id) ON DELETE CASCADE,
  recipient_user_id    uuid,
  recipient_role       text,
  user_id              uuid,
  branch               text,
  target_type          text,
  target_id            uuid,
  target_route         text,
  route                text,
  status               text DEFAULT 'new',
  is_read              boolean NOT NULL DEFAULT false,
  read                 boolean NOT NULL DEFAULT false,
  requires_action      boolean DEFAULT false,
  action_status        text,
  sound_enabled        boolean DEFAULT true,
  created_by           uuid,
  created_by_name      text,
  metadata             jsonb,
  read_at              timestamptz,
  completed_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ══════════════════════════════════
-- 4) جدول سجل الأنشطة (activity_log)
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS activity_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action      text NOT NULL,
  module      text,
  target_type text,
  target_id   text,
  user_id     text,
  user_name   text,
  user_role   text,
  branch_id   text,
  branch      text,
  branch_name text,
  details     jsonb,
  old_value   jsonb,
  new_value   jsonb,
  route_path  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ══════════════════════════════════
-- 5) جدول المتابعات اليومية (daily_followups)
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS daily_followups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid,
  customer_name     text,
  customer_code     text,
  phone             text,
  branch            text,
  responsible_name  text,
  responsible_id    uuid,
  followup_date     date DEFAULT CURRENT_DATE,
  next_followup_date date,
  followup_status   text DEFAULT 'pending',
  status            text DEFAULT 'active',
  priority          text DEFAULT 'normal',
  notes             text,
  outcome           text,
  call_duration_min integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ══════════════════════════════════
-- 6) جدول الأدوية الراكدة (stagnant_medicines)
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS stagnant_medicines (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_name            text NOT NULL,
  generic_name             text,
  branch                   text NOT NULL,
  quantity                 integer DEFAULT 0,
  unit_price               numeric(10,2) DEFAULT 0,
  nearest_expiry_date      date,
  batch_number             text,
  status                   text DEFAULT 'active',
  priority                 text DEFAULT 'medium',
  responsible_doctor_id    uuid REFERENCES staff(id) ON DELETE SET NULL,
  responsible_doctor_name  text,
  dispense_count           integer DEFAULT 0,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- ══════════════════════════════════
-- 7) جدول الفواتير (sales_invoices)
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS sales_invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number   text,
  invoice_date     date,
  sale_date        date,
  customer_id      uuid,
  customer_name    text,
  customer_code    text,
  customer_phone   text,
  branch           text,
  seller_name      text,
  doctor_name      text,
  total_amount     numeric(12,2) DEFAULT 0,
  net_amount       numeric(12,2) DEFAULT 0,
  discount_amount  numeric(12,2) DEFAULT 0,
  tax_amount       numeric(12,2) DEFAULT 0,
  payment_method   text,
  is_linked        boolean DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ══════════════════════════════════
-- 8) جدول العملاء (customers)
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  code          text UNIQUE,
  phone         text,
  branch        text,
  gender        text,
  birth_date    date,
  address       text,
  cashback      numeric(10,2) DEFAULT 0,
  points        integer DEFAULT 0,
  status        text DEFAULT 'active',
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ══════════════════════════════════
-- 9) جداول الجداول والمناوبات
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS shift_schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    uuid REFERENCES staff(id) ON DELETE CASCADE,
  staff_name  text,
  branch      text,
  shift_date  date NOT NULL,
  shift_type  text DEFAULT 'morning',
  start_time  time,
  end_time    time,
  status      text DEFAULT 'scheduled',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     uuid REFERENCES staff(id) ON DELETE CASCADE,
  staff_name   text,
  branch       text,
  date         date NOT NULL,
  check_in     timestamptz,
  check_out    timestamptz,
  status       text DEFAULT 'present',
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ══════════════════════════════════
-- 10) جدول المهام (tasks)
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  description  text,
  assigned_to  uuid REFERENCES staff(id) ON DELETE SET NULL,
  assigned_name text,
  branch       text,
  due_date     date,
  priority     text DEFAULT 'normal',
  status       text DEFAULT 'pending',
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ══════════════════════════════════
-- 11) جدول الفروع (branches)
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS branches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text UNIQUE NOT NULL,
  address    text,
  phone      text,
  manager_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  active     boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ══════════════════════════════════
-- 12) جدول الإعدادات (settings)
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS settings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text UNIQUE NOT NULL,
  value      jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- الـ Functions (وظائف قاعدة البيانات)
-- ═══════════════════════════════════════════════════════════════

-- دالة تسجيل الدخول بكلمة السر المشفرة
CREATE OR REPLACE FUNCTION staff_account_login(
  p_username text,
  p_password text
)
RETURNS SETOF staff_accounts
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM staff_accounts
  WHERE username = p_username
    AND password_hash = crypt(p_password, password_hash)
    AND active = true
    AND can_login = true
  LIMIT 1;

  -- تحديث آخر تسجيل دخول
  UPDATE staff_accounts
  SET last_login_at = now()
  WHERE username = p_username
    AND password_hash = crypt(p_password, password_hash);
END;
$$;

-- دالة ضبط سياق المستخدم الحالي (لـ RLS)
CREATE OR REPLACE FUNCTION set_current_user_context(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM set_config('app.current_user_id', COALESCE(p_user_id::text, ''), false);
END;
$$;

-- دالة جلب صلاحيات المستخدم
CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_permissions jsonb;
BEGIN
  SELECT COALESCE(permissions, '{}')
  INTO v_permissions
  FROM staff_accounts
  WHERE id = p_user_id;

  RETURN COALESCE(v_permissions, '{}');
END;
$$;

-- دالة التحقق من صلاحية معينة
CREATE OR REPLACE FUNCTION user_has_permission(p_user_id uuid, p_permission text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_permissions jsonb;
BEGIN
  SELECT COALESCE(permissions, '{}')
  INTO v_permissions
  FROM staff_accounts
  WHERE id = p_user_id;

  RETURN COALESCE((v_permissions ->> p_permission)::boolean, false);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- بيانات أولية
-- ═══════════════════════════════════════════════════════════════

-- إضافة الفروع الأساسية
INSERT INTO branches (name, address) VALUES
  ('الفرع الرئيسي', 'الفرع الرئيسي'),
  ('فرع المعادي', 'المعادي'),
  ('فرع مدينة نصر', 'مدينة نصر')
ON CONFLICT (name) DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- إنشاء المستخدم الإداري الأول
-- غيّر username وpassword وname وbranch حسب رغبتك
-- ══════════════════════════════════════════════════════════════
INSERT INTO staff_accounts (username, password_hash, name, role, branch, active, can_login, permissions)
VALUES (
  'admin',
  crypt('admin123', gen_salt('bf')),
  'المدير العام',
  'general_manager',
  'الفرع الرئيسي',
  true,
  true,
  '{}'
)
ON CONFLICT (username) DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- تفعيل Realtime للجداول المهمة (مطلوب للإشعارات الفورية)
-- ══════════════════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE daily_followups;
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;

-- ══════════════════════════════════════════════════════════════
-- سياسات الأمان (RLS) — اختياري في البداية، فعّلها لاحقاً
-- ══════════════════════════════════════════════════════════════
-- ALTER TABLE staff_accounts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- تمت بنجاح ✅
-- بيانات الدخول الافتراضية:
--   اسم المستخدم: admin
--   كلمة المرور:  admin123
-- غيّرها فور الدخول!
-- ═══════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════
-- جدول نماذج المرور والتقييم (branch_inspections)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS branch_inspections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch          text NOT NULL,
  date            date NOT NULL DEFAULT CURRENT_DATE,
  time            text,
  inspector_name  text,
  inspector_id    uuid REFERENCES staff_accounts(id) ON DELETE SET NULL,
  sections        jsonb DEFAULT '[]',
  staff_evals     jsonb DEFAULT '[]',
  action_items    jsonb DEFAULT '[]',
  overall_notes   text,
  overall_score   numeric(3,2) DEFAULT 0,
  next_visit_date date,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- فعّل Realtime لنماذج المرور
ALTER PUBLICATION supabase_realtime ADD TABLE branch_inspections;
