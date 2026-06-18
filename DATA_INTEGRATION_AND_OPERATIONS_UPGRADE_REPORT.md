# Dawaa Pharmacy 2027 V3 — Full Operations & Data Binding Upgrade

## Build

- `npm install` completed successfully.
- `npm run build` completed successfully.

## تنفيذات رئيسية

### 1) الموجودون حاليًا في الشيفت

- تم تعزيز صفحة الفريق لتقرأ من `currentShiftPresenceService` بدل الاعتماد على منطق الشيفت القديم فقط.
- service يدعم `shift_schedules.day_name` عندما تكون `shift_date` و `date` فارغتين.
- يظهر الموظفون المجدولون حتى لو لم يبصموا.
- يظهر debug إداري يوضح: اليوم العربي، عدد الشيفتات المحملة، عدد سجلات الحضور، ومصدر البيانات.

### 2) دقة المبيعات ومقارنة الفروع

- تم توحيد قيمة الفاتورة في `dashboardTruthService` لتشمل: `net_amount`, `discounted_amount`, `amount`, `gross_amount`, `total_amount`.
- تم تحديث `salesInvoiceQueries` ليقرأ `total_amount` ضمن الحقول الأساسية.
- صفحة مقارنة الفروع أصبحت أقوى في قراءة الفواتير من `sales_invoices` وبنفس منطق الداشبورد.

### 3) Customer 360

- تم نقل قسم الأصناف المميزة للعميل من LocalStorage فقط إلى خدمة ذكية:
  - يقرأ/يحفظ في `customer_special_items` عند تشغيل SQL.
  - يرجع إلى التخزين المحلي تلقائيًا لو الجدول غير موجود.
- تم تحسين ربط الفواتير لإدخال `total_amount` ضمن حسابات العميل.
- القسم يعرض مصدر البيانات: Supabase أو تخزين محلي مؤقت.

### 4) نموذج مرور وتقييم الفروع

- تم ربط النموذج بجدول `shift_schedules` حسب الفرع واليوم العربي.
- عند اختيار الفرع/التاريخ، يتم تحميل موظفي الشيفت تلقائيًا للتقييم.
- تمت إضافة حقول الإجراء لكل موظف:
  - بدون إجراء
  - لفت نظر
  - خصم نقاط
  - مكافأة نقاط
- عند الحفظ:
  - يتم حفظ تقرير المرور في `branch_inspections`.
  - يتم حفظ تقييمات الموظفين في `branch_visit_staff_reviews`.
  - يتم إنشاء معاملات نقاط في `points_transactions` إذا كان الإجراء له نقاط موجبة أو سالبة.

### 5) SQL المطلوب تشغيله

- تم تحديث `CUSTOMER_CODING_SETUP.sql` ليشمل:
  - `customer_coding_requests`
  - `customer_coding_activity_log`
  - `customer_special_items`
  - `branch_inspections`
  - `branch_visit_staff_reviews`
  - `branch_visit_actions`
- كل SQL آمن: `CREATE TABLE IF NOT EXISTS` و `ADD COLUMN IF NOT EXISTS` بدون حذف بيانات.

## ما يحتاج اختبار بعد الرفع

1. `/team` — التأكد من ظهور موظفي الشيفت من `day_name`.
2. `/branch-comparison` — مراجعة تطابق أرقام الفروع مع الداشبورد.
3. `/customer-360` — إضافة صنف مميز والتأكد من حفظه بعد تشغيل SQL.
4. `/branch-inspection` — اختيار فرع وتاريخ، ثم التأكد من تحميل موظفي الشيفت وتسجيل النقاط عند الحفظ.
5. `/loyalty-tiers` — التأكد من عرض بلاتيني/ذهبي/فضي فقط.

## ملاحظات تشغيل

- يجب تشغيل `CUSTOMER_CODING_SETUP.sql` في Supabase قبل استخدام تكويد العميل / أصناف العميل / مرور المدير بشكل كامل.
- لو جدول `points_transactions` في قاعدة البيانات له أعمدة مختلفة جدًا، قد يتم حفظ تقرير المرور وتقييمات الموظفين بنجاح بينما تفشل معاملات النقاط فقط بصمت؛ راجع Data Health بعد التجربة.
