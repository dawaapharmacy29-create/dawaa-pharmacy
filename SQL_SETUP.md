# SQL Setup — صيدليات دواء 2027

## كيفية الاستخدام

انسخ كل SQL block واذهب إلى **Supabase → SQL Editor → New Query** والصق وانقر **Run**.

---

## 1. جدول `notifications` (مطلوب للإشعارات)

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title         TEXT NOT NULL,
  message       TEXT,
  body          TEXT,
  description   TEXT,
  type          TEXT NOT NULL DEFAULT 'system',
  priority      TEXT NOT NULL DEFAULT 'normal',
  status        TEXT NOT NULL DEFAULT 'new',
  is_read       BOOLEAN DEFAULT FALSE,
  read          BOOLEAN DEFAULT FALSE,
  requires_action BOOLEAN DEFAULT FALSE,
  action_status TEXT DEFAULT 'new',
  sound_enabled BOOLEAN DEFAULT FALSE,
  recipient_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  recipient_user_id  UUID,
  user_id            UUID,
  recipient_role     TEXT,
  branch             TEXT,
  target_type        TEXT,
  target_id          TEXT,
  target_route       TEXT,
  route              TEXT,
  created_by         UUID,
  created_by_name    TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  read_at            TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  metadata           JSONB,
  details            JSONB
);

-- Indexes
CREATE INDEX IF NOT EXISTS notifications_created_at_idx   ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_is_read_idx      ON notifications(is_read);
CREATE INDEX IF NOT EXISTS notifications_status_idx       ON notifications(status);
CREATE INDEX IF NOT EXISTS notifications_branch_idx       ON notifications(branch);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx    ON notifications(recipient_staff_id);

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_notifications" ON notifications;
CREATE POLICY "allow_all_notifications" ON notifications FOR ALL USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
```

---

## 2. جدول `attendance` (مطلوب لتقرير الحضور)

```sql
CREATE TABLE IF NOT EXISTS attendance (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id     UUID REFERENCES staff(id) ON DELETE CASCADE,
  staff_name   TEXT,
  date         DATE NOT NULL,
  check_in     TIME,
  check_out    TIME,
  branch       TEXT,
  shift_start  TIME,
  shift_end    TIME,
  notes        TEXT,
  status       TEXT DEFAULT 'present',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS attendance_date_idx      ON attendance(date DESC);
CREATE INDEX IF NOT EXISTS attendance_staff_idx     ON attendance(staff_id);
CREATE INDEX IF NOT EXISTS attendance_branch_idx    ON attendance(branch);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_staff_date_uidx ON attendance(staff_id, date);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_attendance" ON attendance;
CREATE POLICY "allow_all_attendance" ON attendance FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE attendance;
```

---

## 3. View `dawaa_staff_payroll_summary_v13` (مطلوب لصفحة القبض)

هذا الـ View يجمع بيانات الراتب من جداول الموظفين والمعاملات. عدّل أسماء الجداول حسب ما لديك.

```sql
CREATE OR REPLACE VIEW dawaa_staff_payroll_summary_v13 AS
SELECT
  s.id                                          AS staff_id,
  s.username,
  s.name                                        AS staff_name,
  s.role,
  s.branch,
  COALESCE(pp.base_salary, 0)                   AS base_salary,
  COALESCE(pp.hourly_rate, 0)                   AS hourly_rate,
  COALESCE(pm.worked_hours, 0)                  AS worked_hours,
  COALESCE(pm.overtime_hours, 0)                AS overtime_hours,
  COALESCE(pm.target_bonus, 0)                  AS target_bonus,
  COALESCE(pm.quarterly_bonus, 0)               AS quarterly_bonus,
  COALESCE(
    (SELECT SUM(amount) FROM employee_transactions et
     WHERE et.staff_id = s.id AND et.type IN ('reward','incentive','bonus')
       AND DATE_TRUNC('month', et.created_at) = DATE_TRUNC('month', NOW())), 0
  )                                             AS incentives_total,
  COALESCE(
    (SELECT SUM(amount) FROM employee_transactions et
     WHERE et.staff_id = s.id AND et.type = 'deduction'
       AND DATE_TRUNC('month', et.created_at) = DATE_TRUNC('month', NOW())), 0
  )                                             AS deductions_total,
  COALESCE(pp.base_salary, 0)
    + COALESCE(pm.target_bonus, 0)
    + COALESCE(pm.quarterly_bonus, 0)
    + COALESCE(
        (SELECT SUM(amount) FROM employee_transactions et
         WHERE et.staff_id = s.id AND et.type IN ('reward','incentive','bonus')
           AND DATE_TRUNC('month', et.created_at) = DATE_TRUNC('month', NOW())), 0)
    - COALESCE(
        (SELECT SUM(amount) FROM employee_transactions et
         WHERE et.staff_id = s.id AND et.type = 'deduction'
           AND DATE_TRUNC('month', et.created_at) = DATE_TRUNC('month', NOW())), 0)
                                                AS calculated_net_salary,
  'جارٍ'                                        AS status,
  TO_CHAR(NOW(), 'YYYY-MM')                     AS payroll_month
FROM staff s
LEFT JOIN staff_payroll_profiles_v13 pp ON pp.staff_id = s.id
LEFT JOIN staff_payroll_monthly_v13  pm ON pm.staff_id = s.id
  AND pm.payroll_month = TO_CHAR(NOW(), 'YYYY-MM')
WHERE s.status = 'نشط'
ORDER BY s.name;
```

> **ملاحظة:** إذا لم يكن لديك `staff_payroll_profiles_v13` أو `staff_payroll_monthly_v13`، استبدل الـ LEFT JOINs بـ:
>
> ```sql
> LEFT JOIN (SELECT NULL::uuid AS staff_id, NULL::numeric AS base_salary, NULL::numeric AS hourly_rate) pp ON FALSE
> LEFT JOIN (SELECT NULL::uuid AS staff_id, NULL::numeric AS worked_hours, NULL::numeric AS overtime_hours, NULL::numeric AS target_bonus, NULL::numeric AS quarterly_bonus) pm ON FALSE
> ```

---

## 4. جدول `staff` (الحد الأدنى إذا لم يكن موجوداً)

```sql
CREATE TABLE IF NOT EXISTS staff (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  username    TEXT UNIQUE,
  phone       TEXT,
  role        TEXT NOT NULL,
  branch      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'نشط',
  join_date   DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_staff" ON staff;
CREATE POLICY "allow_all_staff" ON staff FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE staff;
```

---

## 5. جدول `customers` (الحد الأدنى إذا لم يكن موجوداً)

```sql
CREATE TABLE IF NOT EXISTS customers (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name              TEXT NOT NULL,
  phone             TEXT,
  branch            TEXT,
  type              TEXT DEFAULT 'regular',
  total_purchases   NUMERIC DEFAULT 0,
  avg_monthly       NUMERIC DEFAULT 0,
  total_invoices    INTEGER DEFAULT 0,
  avg_invoice       NUMERIC DEFAULT 0,
  clv               NUMERIC DEFAULT 0,
  risk_score        NUMERIC DEFAULT 0,
  retention_status  TEXT DEFAULT 'active',
  last_purchase     DATE,
  first_purchase    DATE,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customers_branch_idx          ON customers(branch);
CREATE INDEX IF NOT EXISTS customers_total_purchases_idx ON customers(total_purchases DESC);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_customers" ON customers;
CREATE POLICY "allow_all_customers" ON customers FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE customers;
```

---

## 6. جدول `stagnant_medicines` (لصلاحية الأدوية)

```sql
CREATE TABLE IF NOT EXISTS stagnant_medicines (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  medicine_name            TEXT NOT NULL,
  product_name             TEXT,
  product_code             TEXT,
  category                 TEXT,
  usage                    TEXT,
  product_type             TEXT,
  expiry_date              DATE,
  nearest_expiry_date      DATE,
  quantity_available       NUMERIC DEFAULT 0,
  total_quantity           NUMERIC DEFAULT 0,
  remaining_quantity       NUMERIC DEFAULT 0,
  dispensed_quantity       NUMERIC DEFAULT 0,
  unit_price               NUMERIC DEFAULT 0,
  product_price            NUMERIC DEFAULT 0,
  branch                   TEXT,
  branch_name              TEXT,
  priority                 TEXT DEFAULT 'عادي',
  status                   TEXT DEFAULT 'نشط',
  notes                    TEXT,
  responsible_doctor       TEXT,
  responsible_doctor_name  TEXT,
  responsible_doctor_id    UUID,
  doctor_id                UUID,
  target_min_percent       NUMERIC,
  target_min_quantity      NUMERIC,
  incentive_per_unit       NUMERIC DEFAULT 0,
  uploaded_by              TEXT,
  upload_date              DATE,
  last_dispensed_at        TIMESTAMPTZ,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stagnant_medicines_expiry_idx  ON stagnant_medicines(expiry_date ASC);
CREATE INDEX IF NOT EXISTS stagnant_medicines_branch_idx  ON stagnant_medicines(branch);

ALTER TABLE stagnant_medicines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_stagnant" ON stagnant_medicines;
CREATE POLICY "allow_all_stagnant" ON stagnant_medicines FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE stagnant_medicines;
```

---

## 7. جدول `sales_invoices` (للتحليلات والمبيعات)

```sql
CREATE TABLE IF NOT EXISTS sales_invoices (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number  TEXT,
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   TEXT,
  customer_phone  TEXT,
  branch          TEXT NOT NULL,
  total_amount    NUMERIC NOT NULL DEFAULT 0,
  invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  staff_id        UUID REFERENCES staff(id) ON DELETE SET NULL,
  staff_name      TEXT,
  notes           TEXT,
  source          TEXT DEFAULT 'manual',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sales_invoices_date_idx    ON sales_invoices(invoice_date DESC);
CREATE INDEX IF NOT EXISTS sales_invoices_branch_idx  ON sales_invoices(branch);
CREATE INDEX IF NOT EXISTS sales_invoices_customer_idx ON sales_invoices(customer_id);

ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_invoices" ON sales_invoices;
CREATE POLICY "allow_all_invoices" ON sales_invoices FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE sales_invoices;
```

---

## 8. تفعيل Realtime لجميع الجداول دفعةً واحدة

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE
  notifications,
  attendance,
  staff,
  customers,
  stagnant_medicines,
  sales_invoices;
```

---

## ترتيب التنفيذ الموصى به

1. `staff` أولاً (لأن جداول أخرى تعتمد عليه)
2. `customers`
3. `notifications`
4. `attendance`
5. `stagnant_medicines`
6. `sales_invoices`
7. `dawaa_staff_payroll_summary_v13` (View — آخراً بعد ما تتأكد من employee_transactions)
8. تفعيل Realtime

## Customer Coding V2

شغّل ملف `CUSTOMER_CODING_SETUP.sql` في Supabase SQL Editor لتفعيل صفحة **تكويد العميل** وجداول الأصناف المميزة.
