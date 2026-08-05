-- ═══════════════════════════════════════════════════════════════
-- Dawaa Pharmacy 2027 V2 — Performance Upgrade SQL
-- شغّل هذا الملف بعد supabase-setup/CUSTOMER_CODING_SETUP
-- الهدف: تسريع الداشبورد، مقارنة الفروع، مستويات الولاء، والشيفتات
-- بدون حذف أي بيانات
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────
-- 1) Indexes مهمة للأداء
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS sales_invoices_invoice_date_idx
ON sales_invoices(invoice_date DESC);

CREATE INDEX IF NOT EXISTS sales_invoices_branch_invoice_date_idx
ON sales_invoices(branch, invoice_date DESC);

CREATE INDEX IF NOT EXISTS sales_invoices_seller_invoice_date_idx
ON sales_invoices(seller_name, invoice_date DESC);

CREATE INDEX IF NOT EXISTS sales_invoices_customer_code_idx
ON sales_invoices(customer_code);

CREATE INDEX IF NOT EXISTS sales_invoices_customer_phone_idx
ON sales_invoices(customer_phone);

CREATE INDEX IF NOT EXISTS sales_invoices_customer_name_idx
ON sales_invoices(customer_name);

CREATE INDEX IF NOT EXISTS shift_schedules_day_name_idx
ON shift_schedules(day_name);

CREATE INDEX IF NOT EXISTS shift_schedules_staff_id_idx
ON shift_schedules(staff_id);

CREATE INDEX IF NOT EXISTS shift_schedules_branch_day_idx
ON shift_schedules(branch, day_name);

CREATE INDEX IF NOT EXISTS attendance_staff_date_fast_idx
ON attendance(staff_id, date DESC);

CREATE INDEX IF NOT EXISTS attendance_attendance_date_fast_idx
ON attendance(attendance_date DESC);

CREATE INDEX IF NOT EXISTS customers_phone_fast_idx
ON customers(phone);

CREATE INDEX IF NOT EXISTS customers_customer_code_fast_idx
ON customers(customer_code);

CREATE INDEX IF NOT EXISTS customers_total_purchases_fast_idx
ON customers(total_purchases DESC);

-- ─────────────────────────────────────────────
-- 2) مقارنة الفروع بسرعة من داخل Postgres
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_branch_comparison_v2(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  branch TEXT,
  sales_total NUMERIC,
  invoices_count BIGINT,
  avg_invoice NUMERIC,
  linked_customers BIGINT,
  daily_avg NUMERIC,
  link_rate NUMERIC,
  best_day DATE,
  best_day_sales NUMERIC
)
LANGUAGE sql
STABLE
AS $$
WITH normalized AS (
  SELECT
    CASE
      WHEN lower(coalesce(branch, '')) ~ 'shokry|shukri|shkri|shoukry|abou|abo' OR coalesce(branch, '') LIKE '%شكري%' OR coalesce(branch, '') LIKE '%العزم%' THEN 'فرع شكري'
      WHEN lower(coalesce(branch, '')) ~ 'shamy|shami|elshamy|el shamy|alshamy|al shamy' OR coalesce(branch, '') LIKE '%الشامي%' OR coalesce(branch, '') LIKE '%شامي%' THEN 'فرع الشامي'
      WHEN nullif(trim(coalesce(branch, '')), '') IS NULL THEN 'غير محدد'
      ELSE trim(branch)
    END AS norm_branch,
    COALESCE(net_amount, discounted_amount, amount, gross_amount, total_amount, 0)::numeric AS invoice_amount,
    COALESCE(invoice_no, invoice_number, id::text) AS invoice_key,
    NULLIF(trim(COALESCE(customer_code, customer_phone, customer_name, customer_id::text, '')), '') AS customer_key,
    invoice_date::date AS sale_date
  FROM sales_invoices
  WHERE invoice_date >= p_start_date::timestamp
    AND invoice_date < (p_end_date + 1)::timestamp
),
branch_base AS (
  SELECT
    norm_branch,
    SUM(invoice_amount)::numeric AS sales_total,
    COUNT(DISTINCT invoice_key)::bigint AS invoices_count,
    COUNT(DISTINCT customer_key)::bigint AS linked_customers,
    COUNT(DISTINCT sale_date)::numeric AS active_days
  FROM normalized
  GROUP BY norm_branch
),
daily AS (
  SELECT norm_branch, sale_date, SUM(invoice_amount)::numeric AS day_sales
  FROM normalized
  GROUP BY norm_branch, sale_date
),
best_daily AS (
  SELECT DISTINCT ON (norm_branch)
    norm_branch,
    sale_date AS best_day,
    day_sales AS best_day_sales
  FROM daily
  ORDER BY norm_branch, day_sales DESC, sale_date DESC
),
grand AS (
  SELECT NULLIF(SUM(sales_total), 0)::numeric AS grand_total FROM branch_base
)
SELECT
  b.norm_branch AS branch,
  b.sales_total,
  b.invoices_count,
  CASE WHEN b.invoices_count > 0 THEN b.sales_total / b.invoices_count ELSE 0 END AS avg_invoice,
  b.linked_customers,
  CASE WHEN b.active_days > 0 THEN b.sales_total / b.active_days ELSE b.sales_total END AS daily_avg,
  CASE WHEN g.grand_total > 0 THEN (b.sales_total / g.grand_total) * 100 ELSE 0 END AS link_rate,
  d.best_day,
  COALESCE(d.best_day_sales, 0) AS best_day_sales
FROM branch_base b
CROSS JOIN grand g
LEFT JOIN best_daily d ON d.norm_branch = b.norm_branch
ORDER BY b.sales_total DESC;
$$;

-- ─────────────────────────────────────────────
-- 3) مستويات الولاء من الفواتير بسرعة
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_loyalty_tiers_v2()
RETURNS TABLE (
  customer_key TEXT,
  customer_id TEXT,
  customer_code TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  branch TEXT,
  total_purchases NUMERIC,
  total_invoices BIGINT,
  avg_invoice NUMERIC,
  first_purchase DATE,
  last_purchase DATE,
  tier TEXT
)
LANGUAGE sql
STABLE
AS $$
WITH inv AS (
  SELECT
    NULLIF(trim(COALESCE(customer_code, customer_phone, customer_name, customer_id::text, id::text)), '') AS customer_key,
    customer_id::text AS customer_id,
    customer_code,
    customer_name,
    customer_phone,
    branch,
    COALESCE(net_amount, discounted_amount, amount, gross_amount, total_amount, 0)::numeric AS invoice_amount,
    COALESCE(invoice_no, invoice_number, id::text) AS invoice_key,
    invoice_date::date AS sale_date
  FROM sales_invoices
  WHERE COALESCE(net_amount, discounted_amount, amount, gross_amount, total_amount, 0)::numeric > 0
),
agg AS (
  SELECT
    customer_key,
    MAX(customer_id) AS customer_id,
    MAX(customer_code) AS customer_code,
    MAX(customer_name) AS customer_name,
    MAX(customer_phone) AS customer_phone,
    MAX(branch) AS branch,
    SUM(invoice_amount)::numeric AS total_purchases,
    COUNT(DISTINCT invoice_key)::bigint AS total_invoices,
    MIN(sale_date) AS first_purchase,
    MAX(sale_date) AS last_purchase
  FROM inv
  WHERE customer_key IS NOT NULL
  GROUP BY customer_key
)
SELECT
  customer_key,
  customer_id,
  customer_code,
  COALESCE(customer_name, 'عميل بدون اسم') AS customer_name,
  customer_phone,
  branch,
  total_purchases,
  total_invoices,
  CASE WHEN total_invoices > 0 THEN total_purchases / total_invoices ELSE 0 END AS avg_invoice,
  first_purchase,
  last_purchase,
  CASE
    WHEN total_purchases > 8000 THEN 'بلاتيني'
    WHEN total_purchases >= 4000 AND total_purchases <= 8000 THEN 'ذهبي'
    WHEN total_purchases >= 1500 AND total_purchases < 4000 THEN 'فضي'
    ELSE NULL
  END AS tier
FROM agg
WHERE total_purchases >= 1500
ORDER BY total_purchases DESC;
$$;

-- ─────────────────────────────────────────────
-- 4) شيفت اليوم من day_name أو التاريخ
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_today_shift_presence_v2(p_today DATE DEFAULT (now() AT TIME ZONE 'Africa/Cairo')::date)
RETURNS TABLE (
  staff_id TEXT,
  staff_name TEXT,
  role TEXT,
  branch TEXT,
  day_name TEXT,
  shift_name TEXT,
  shift_start TEXT,
  shift_end TEXT,
  attendance_status TEXT,
  source TEXT
)
LANGUAGE sql
STABLE
AS $$
WITH today AS (
  SELECT
    p_today AS today_date,
    CASE EXTRACT(DOW FROM p_today)::int
      WHEN 0 THEN 'الأحد'
      WHEN 1 THEN 'الاثنين'
      WHEN 2 THEN 'الثلاثاء'
      WHEN 3 THEN 'الأربعاء'
      WHEN 4 THEN 'الخميس'
      WHEN 5 THEN 'الجمعة'
      WHEN 6 THEN 'السبت'
    END AS today_ar
),
schedules AS (
  SELECT ss.*,
         CASE
           WHEN ss.shift_date = (SELECT today_date FROM today) THEN 'shift_date'
           WHEN ss.date = (SELECT today_date FROM today) THEN 'date'
           WHEN ss.day_name = (SELECT today_ar FROM today) THEN 'day_name'
           ELSE 'fallback'
         END AS source
  FROM shift_schedules ss, today t
  WHERE (ss.shift_date = t.today_date OR ss.date = t.today_date OR ss.day_name = t.today_ar)
    AND COALESCE(ss.is_off, false) = false
),
att AS (
  SELECT * FROM attendance a, today t
  WHERE a.date = t.today_date OR a.attendance_date = t.today_date
)
SELECT
  COALESCE(s.staff_id::text, s.id::text) AS staff_id,
  COALESCE(s.staff_name, s.name, 'غير محدد') AS staff_name,
  COALESCE(s.role, 'غير محدد') AS role,
  COALESCE(s.branch, 'غير محدد') AS branch,
  COALESCE(s.day_name, (SELECT today_ar FROM today)) AS day_name,
  s.shift_name,
  COALESCE(s.shift_start::text, s.start_time::text) AS shift_start,
  COALESCE(s.shift_end::text, s.end_time::text) AS shift_end,
  CASE
    WHEN a.check_out IS NOT NULL OR a.last_out IS NOT NULL THEN 'خرج'
    WHEN a.check_in IS NOT NULL OR a.first_in IS NOT NULL THEN 'موجود الآن'
    ELSE 'لم يبصم'
  END AS attendance_status,
  s.source
FROM schedules s
LEFT JOIN att a ON (a.staff_id::text = s.staff_id::text OR a.staff_name = s.staff_name)
ORDER BY branch, role, shift_start, staff_name;
$$;

SELECT 'تم تجهيز تحسينات الأداء و RPC بنجاح ✓' AS result;
