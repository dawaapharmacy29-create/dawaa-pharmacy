-- ═══════════════════════════════════════════════════════════════
-- Dawaa Pharmacy 2027 V2 — Customer Coding workflow
-- آمن: لا يحذف بيانات، ينشئ الجداول الناقصة فقط
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS customer_coding_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT,
  branch TEXT,
  source TEXT DEFAULT 'داخل الفرع',
  notes TEXT,
  status TEXT DEFAULT 'open',
  customer_id UUID,
  created_by UUID,
  created_by_name TEXT,
  completed_by UUID,
  completed_by_name TEXT,
  beeconnect_coded_at TIMESTAMPTZ,
  welcome_sent_at TIMESTAMPTZ,
  customers_db_saved_at TIMESTAMPTZ,
  phone_saved_at TIMESTAMPTZ,
  evaluated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE customer_coding_requests
ADD COLUMN IF NOT EXISTS customer_name TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS branch TEXT,
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'داخل الفرع',
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open',
ADD COLUMN IF NOT EXISTS customer_id UUID,
ADD COLUMN IF NOT EXISTS created_by UUID,
ADD COLUMN IF NOT EXISTS created_by_name TEXT,
ADD COLUMN IF NOT EXISTS completed_by UUID,
ADD COLUMN IF NOT EXISTS completed_by_name TEXT,
ADD COLUMN IF NOT EXISTS beeconnect_coded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS welcome_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS customers_db_saved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS phone_saved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS customer_coding_phone_idx ON customer_coding_requests(phone);
CREATE INDEX IF NOT EXISTS customer_coding_status_idx ON customer_coding_requests(status);
CREATE INDEX IF NOT EXISTS customer_coding_branch_idx ON customer_coding_requests(branch);
CREATE INDEX IF NOT EXISTS customer_coding_created_at_idx ON customer_coding_requests(created_at DESC);

CREATE TABLE IF NOT EXISTS customer_coding_activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID REFERENCES customer_coding_requests(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  action_label TEXT,
  performed_by UUID,
  performed_by_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_coding_activity_request_idx ON customer_coding_activity_log(request_id);
CREATE INDEX IF NOT EXISTS customer_coding_activity_created_idx ON customer_coding_activity_log(created_at DESC);

CREATE TABLE IF NOT EXISTS customer_special_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID,
  customer_code TEXT,
  customer_phone TEXT,
  item_name TEXT NOT NULL,
  reason TEXT,
  notes TEXT,
  is_monthly BOOLEAN DEFAULT FALSE,
  last_requested_at TIMESTAMPTZ,
  created_by UUID,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_special_items_customer_id_idx ON customer_special_items(customer_id);
CREATE INDEX IF NOT EXISTS customer_special_items_code_idx ON customer_special_items(customer_code);
CREATE INDEX IF NOT EXISTS customer_special_items_phone_idx ON customer_special_items(customer_phone);

ALTER TABLE customer_coding_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_coding_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_special_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_customer_coding_requests" ON customer_coding_requests;
CREATE POLICY "allow_all_customer_coding_requests" ON customer_coding_requests FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_customer_coding_activity_log" ON customer_coding_activity_log;
CREATE POLICY "allow_all_customer_coding_activity_log" ON customer_coding_activity_log FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_customer_special_items" ON customer_special_items;
CREATE POLICY "allow_all_customer_special_items" ON customer_special_items FOR ALL USING (true) WITH CHECK (true);

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE customer_coding_requests; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE customer_coding_activity_log; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

SELECT 'تم إنشاء جداول تكويد العملاء والأصناف المميزة بنجاح ✓' AS result;

-- ═══════════════════════════════════════════════════════════════
-- جداول مرور المدير وربط التقييم بالنقاط والحوافز
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS branch_inspections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  branch TEXT,
  date DATE,
  time TIME,
  inspector_id UUID,
  inspector_name TEXT,
  sections JSONB DEFAULT '[]'::jsonb,
  staff_evals JSONB DEFAULT '[]'::jsonb,
  action_items JSONB DEFAULT '[]'::jsonb,
  overall_notes TEXT,
  overall_score NUMERIC DEFAULT 0,
  next_visit_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE branch_inspections
ADD COLUMN IF NOT EXISTS branch TEXT,
ADD COLUMN IF NOT EXISTS date DATE,
ADD COLUMN IF NOT EXISTS time TIME,
ADD COLUMN IF NOT EXISTS inspector_id UUID,
ADD COLUMN IF NOT EXISTS inspector_name TEXT,
ADD COLUMN IF NOT EXISTS sections JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS staff_evals JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS action_items JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS overall_notes TEXT,
ADD COLUMN IF NOT EXISTS overall_score NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS next_visit_date DATE,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS branch_visit_staff_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID REFERENCES branch_inspections(id) ON DELETE CASCADE,
  staff_id UUID,
  staff_name TEXT,
  role TEXT,
  branch TEXT,
  shift_start TIME,
  shift_end TIME,
  rating TEXT,
  note TEXT,
  action_type TEXT DEFAULT 'none',
  points_delta NUMERIC DEFAULT 0,
  money_amount NUMERIC DEFAULT 0,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE branch_visit_staff_reviews
ADD COLUMN IF NOT EXISTS report_id UUID,
ADD COLUMN IF NOT EXISTS staff_id UUID,
ADD COLUMN IF NOT EXISTS staff_name TEXT,
ADD COLUMN IF NOT EXISTS role TEXT,
ADD COLUMN IF NOT EXISTS branch TEXT,
ADD COLUMN IF NOT EXISTS shift_start TIME,
ADD COLUMN IF NOT EXISTS shift_end TIME,
ADD COLUMN IF NOT EXISTS rating TEXT,
ADD COLUMN IF NOT EXISTS note TEXT,
ADD COLUMN IF NOT EXISTS action_type TEXT DEFAULT 'none',
ADD COLUMN IF NOT EXISTS points_delta NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS money_amount NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS created_by_name TEXT,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS branch_visit_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID REFERENCES branch_inspections(id) ON DELETE CASCADE,
  action_text TEXT,
  priority TEXT,
  assigned_to TEXT,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS branch_inspections_branch_date_idx ON branch_inspections(branch, date DESC);
CREATE INDEX IF NOT EXISTS branch_visit_staff_reviews_report_idx ON branch_visit_staff_reviews(report_id);
CREATE INDEX IF NOT EXISTS branch_visit_staff_reviews_staff_idx ON branch_visit_staff_reviews(staff_id);
CREATE INDEX IF NOT EXISTS branch_visit_actions_report_idx ON branch_visit_actions(report_id);

ALTER TABLE branch_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_visit_staff_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_visit_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_branch_inspections" ON branch_inspections;
CREATE POLICY "allow_all_branch_inspections" ON branch_inspections FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_branch_visit_staff_reviews" ON branch_visit_staff_reviews;
CREATE POLICY "allow_all_branch_visit_staff_reviews" ON branch_visit_staff_reviews FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_branch_visit_actions" ON branch_visit_actions;
CREATE POLICY "allow_all_branch_visit_actions" ON branch_visit_actions FOR ALL USING (true) WITH CHECK (true);
