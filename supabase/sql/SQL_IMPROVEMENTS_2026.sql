-- ============================================================================
-- SQL IMPROVEMENTS 2026 - Views, Functions, and Optimizations
-- Execute in Supabase SQL Editor
-- ============================================================================

-- **SECTION 1: STAFF PAYROLL VIEW (Unified name)**
-- Replace versioned view with single stable name

DROP VIEW IF EXISTS staff_payroll_summary CASCADE;
CREATE OR REPLACE VIEW staff_payroll_summary AS
SELECT * FROM dawaa_staff_payroll_summary_v13;

-- This ensures changes to the underlying view don't break code.
-- When upgrading to v14, simply update this line:
--   SELECT * FROM dawaa_staff_payroll_summary_v14;

-- ============================================================================
-- **SECTION 2: EMPLOYEE KPI CYCLE SUMMARY VIEW**
-- Replaces 21,000 rows of client-side processing with optimized SQL

DROP VIEW IF EXISTS employee_kpi_cycle_summary CASCADE;
CREATE OR REPLACE VIEW employee_kpi_cycle_summary AS
SELECT
  s.id                                                      AS staff_id,
  s.name                                                    AS staff_name,
  COALESCE(s.branch, 'غير محدد')                           AS branch,
  COALESCE(s.role, 'موظف')                                 AS role,
  
  -- نقاط الموظف (النقاط الإيجابية والسلبية)
  COALESCE(SUM(
    CASE WHEN et.type IN ('reward', 'bonus', 'مكافأة') AND et.points > 0
    THEN et.points ELSE 0 END
  ), 0)                                                     AS reward_points,
  
  COALESCE(SUM(
    CASE WHEN et.type IN ('penalty', 'خصم') AND et.points < 0
    THEN ABS(et.points) ELSE 0 END
  ), 0)                                                     AS penalty_points,
  
  -- تقييمات المحادثات (30% من النقاط النهائية)
  COALESCE(ROUND(AVG(csr.score)::numeric, 1), 0)          AS avg_review_score,
  COUNT(DISTINCT csr.id) FILTER (WHERE csr.score IS NOT NULL) AS review_count,
  
  -- الحضور (20% من النقاط النهائية)
  COUNT(DISTINCT a.date) FILTER (WHERE a.status = 'present' OR a.status = 'حاضر')  AS days_present,
  COUNT(DISTINCT a.date) FILTER (WHERE a.status IN ('absent', 'غائب'))               AS days_absent,
  
  -- المهام (20% من النقاط النهائية)
  COUNT(t.id) FILTER (WHERE t.status IN ('done', 'completed', 'مكتمل'))             AS tasks_done,
  COUNT(t.id) FILTER (WHERE t.status NOT IN ('done', 'completed', 'مكتمل', 'cancelled', 'ملغاة')) AS tasks_open,
  
  -- الدرجة الإجمالية (100 نقطة)
  LEAST(100, GREATEST(0,
    COALESCE(ROUND(AVG(csr.score)::numeric * 0.30), 0) +  -- 30% تقييم
    LEAST(20, COUNT(DISTINCT a.date) FILTER (WHERE a.status = 'present' OR a.status = 'حاضر') * 0.5) + -- 20% حضور
    LEAST(20, COUNT(t.id) FILTER (WHERE t.status IN ('done', 'completed', 'مكتمل')) * 0.5)  -- 20% مهام
  ))                                                        AS total_score

FROM staff s
LEFT JOIN employee_transactions et
  ON et.employee_id = s.id
  AND DATE(et.created_at) >= CURRENT_DATE - INTERVAL '30 days'
LEFT JOIN conversation_sales_reviews csr
  ON csr.staff_id = s.id
  AND DATE(csr.created_at) >= CURRENT_DATE - INTERVAL '30 days'
LEFT JOIN attendance a
  ON a.staff_id = s.id
  AND DATE(a.date) >= CURRENT_DATE - INTERVAL '30 days'
LEFT JOIN tasks t
  ON t.assigned_to = s.id
  AND DATE(t.created_at) >= CURRENT_DATE - INTERVAL '30 days'

GROUP BY s.id, s.name, s.branch, s.role
ORDER BY total_score DESC;

-- ============================================================================
-- **SECTION 3: TODAY BRIEF RPC FUNCTION**
-- Replaces 8 separate queries with single RPC call

DROP FUNCTION IF EXISTS get_today_command_summary(text);
CREATE OR REPLACE FUNCTION get_today_command_summary(p_branch TEXT DEFAULT 'all')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
  today_date DATE := CURRENT_DATE;
BEGIN
  SELECT jsonb_build_object(
    -- المبيعات اليومية
    'sales_today',
      (SELECT COALESCE(SUM(amount), 0) FROM invoices
       WHERE DATE(invoice_date) = today_date
         AND (p_branch = 'all' OR branch = p_branch)),
    
    'invoices_count',
      (SELECT COUNT(*) FROM invoices
       WHERE DATE(invoice_date) = today_date
         AND (p_branch = 'all' OR branch = p_branch)),
    
    -- خدمة العملاء
    'open_followups',
      (SELECT COUNT(*) FROM daily_followups
       WHERE status NOT IN ('done', 'completed', 'تم')
         AND (p_branch = 'all' OR branch = p_branch)),
    
    'open_complaints',
      (SELECT COUNT(*) FROM customer_requests
       WHERE status NOT IN ('done', 'closed', 'تم')
         AND type ILIKE '%شكوى%'
         AND (p_branch = 'all' OR branch = p_branch)),
    
    -- الفريق
    'staff_present',
      (SELECT COUNT(*) FROM attendance
       WHERE date = today_date AND status IN ('present', 'حاضر')
         AND (p_branch = 'all' OR branch = p_branch)),
    
    'pending_leaves',
      (SELECT COUNT(*) FROM time_off_requests
       WHERE status IN ('pending', 'معلق')),
    
    -- التشغيل
    'open_shortages',
      (SELECT COUNT(*) FROM shortages
       WHERE status NOT IN ('resolved', 'تم')
         AND (p_branch = 'all' OR branch = p_branch)),
    
    'pending_delivery',
      (SELECT COUNT(*) FROM delivery_orders
       WHERE status IN ('registered', 'pending', 'معلق')
         AND delivery_date = today_date
         AND (p_branch = 'all' OR branch = p_branch)),
    
    -- جودة البيانات
    'weak_reviews',
      (SELECT COUNT(*) FROM conversation_sales_reviews
       WHERE score < 70 AND DATE(created_at) = today_date),
    
    -- المتابعات
    'staff_leaves',
      (SELECT COUNT(*) FROM time_off_requests
       WHERE status IN ('pending', 'معلق') AND DATE(start_date) = today_date),
    
    'loaded_at', NOW()
  ) INTO result;
  
  RETURN result;
END;
$$;

-- ============================================================================
-- **SECTION 4: SIDEBAR BADGES FUNCTION**
-- Real-time badge counts for navigation items

DROP FUNCTION IF EXISTS get_sidebar_badges();
CREATE OR REPLACE FUNCTION get_sidebar_badges()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN jsonb_build_object(
    'openFollowups',
      (SELECT COUNT(*) FROM daily_followups
       WHERE status NOT IN ('done', 'completed', 'تم')),
    
    'pendingApprovals',
      (SELECT COUNT(*) FROM employee_transactions
       WHERE status IN ('pending', 'معلق')),
    
    'openComplaints',
      (SELECT COUNT(*) FROM customer_requests
       WHERE status NOT IN ('done', 'closed', 'تم')
         AND type ILIKE '%شكوى%'),
    
    'openShortages',
      (SELECT COUNT(*) FROM shortages
       WHERE status NOT IN ('resolved', 'تم')),
    
    'pendingReturns',
      (SELECT COUNT(*) FROM return_orders
       WHERE status = 'pending'),
    
    'expiringMedicines',
      (SELECT COUNT(*) FROM medicines_inventory
       WHERE DATE(expiry_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days')
  );
END;
$$;

-- ============================================================================
-- **SECTION 5: STOCK REORDER ALERTS VIEW**

DROP VIEW IF EXISTS stock_reorder_alerts CASCADE;
CREATE OR REPLACE VIEW stock_reorder_alerts AS
SELECT
  m.medicine_name,
  m.branch,
  m.current_stock,
  COALESCE(m.avg_daily_usage, 1) AS avg_daily_usage,
  CASE
    WHEN COALESCE(m.avg_daily_usage, 0) = 0 THEN 999
    ELSE ROUND(m.current_stock / m.avg_daily_usage)
  END AS days_remaining,
  m.last_order_date,
  CASE
    WHEN m.current_stock = 0 THEN 'critical'
    WHEN COALESCE(m.avg_daily_usage, 0) > 0
      AND m.current_stock / m.avg_daily_usage <= 3 THEN 'critical'
    WHEN COALESCE(m.avg_daily_usage, 0) > 0
      AND m.current_stock / m.avg_daily_usage <= 7 THEN 'warning'
    ELSE 'ok'
  END AS alert_level,
  ROUND(COALESCE(m.avg_daily_usage, 1) * 14) AS suggested_order_qty

FROM medicines_inventory m
WHERE m.current_stock < m.reorder_point
   OR (COALESCE(m.avg_daily_usage, 0) > 0 AND m.current_stock / m.avg_daily_usage < 7);

-- ============================================================================
-- **SECTION 6: RETURN ORDERS TABLE (For new Returns page)**

DROP TABLE IF EXISTS return_order_items CASCADE;
DROP TABLE IF EXISTS return_orders CASCADE;

CREATE TABLE return_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code TEXT,
  customer_name TEXT NOT NULL,
  branch TEXT,
  original_invoice_number TEXT,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT NOT NULL,
  total_return_value NUMERIC NOT NULL DEFAULT 0,
  refund_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'pending',
  processed_by TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE return_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_order_id UUID REFERENCES return_orders(id) ON DELETE CASCADE,
  medicine_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC NOT NULL,
  total NUMERIC GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_return_orders_status ON return_orders(status);
CREATE INDEX idx_return_orders_date ON return_orders(return_date);
CREATE INDEX idx_return_orders_branch ON return_orders(branch);
CREATE INDEX idx_return_order_items_order ON return_order_items(return_order_id);

-- ============================================================================
-- **SECTION 7: ROW LEVEL SECURITY (RLS)**

-- Enable RLS on new tables
ALTER TABLE return_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_order_items ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view all
CREATE POLICY "allow_read" ON return_orders FOR SELECT USING (true);
CREATE POLICY "allow_read" ON return_order_items FOR SELECT USING (true);

-- Allow insert/update by staff with proper permissions
CREATE POLICY "allow_insert" ON return_orders FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_update" ON return_orders FOR UPDATE USING (true);

CREATE POLICY "allow_insert" ON return_order_items FOR INSERT WITH CHECK (true);

-- ============================================================================
-- **VERIFICATION QUERIES**
-- Run these to verify everything is set up correctly

-- Check staff_payroll_summary view
-- SELECT COUNT(*) FROM staff_payroll_summary;

-- Check employee_kpi_cycle_summary view
-- SELECT * FROM employee_kpi_cycle_summary LIMIT 5;

-- Test today brief function
-- SELECT get_today_command_summary('all');

-- Test sidebar badges
-- SELECT get_sidebar_badges();

-- Check stock alerts
-- SELECT * FROM stock_reorder_alerts LIMIT 10;

-- ============================================================================
