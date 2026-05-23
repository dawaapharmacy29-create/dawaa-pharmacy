# Dawaa Pharmacy 2027 — تقرير الربط والاختبار

## حالة النسخة
تمت مراجعة التطبيق الحالي وبناء نسخة مطورة لا تبدأ من الصفر، بل تعتمد على صفحات وجداول التطبيق الموجودة وتضيف طبقة تشغيل Dawaa Pharmacy 2027 فوقها.

تم تشغيل اختبار build داخل بيئة العمل ونجح:

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run build
```

النتيجة: `built successfully`. التحذير المتبقي خاص بكبر حجم بعض ملفات JavaScript فقط، ولا يمنع التشغيل.

## ما تم ربطه فعليًا

### 1. لوحة القيادة 2027
تم ربط لوحة القيادة ببيانات:
- sales_invoices للمبيعات والفواتير ومتوسط الفاتورة.
- daily_followups للمتابعات المفتوحة.
- employee_transactions للخصومات والمكافآت.
- stagnant_medicines للرواكد.
- tasks للمهام والتنبيهات.

### 2. صفحة الموظف الشاملة
تم توسيع صفحة الموظف بحيث تربط الموظف ببيانات الأداء من:
- staff
- sales_invoices
- employee_transactions
- daily_followups
- stagnant_medicine_dispenses
- incentive_medicine_sales
- shift_schedules
- shift_exceptions
- conversation_sales_reviews

وأضيف قسم واضح باسم: **ملف أداء 2027 المرتبط بالفواتير والعملاء** يعرض:
- فواتير الدورة.
- إجمالي مبيعات الدورة.
- متوسط الفاتورة.
- عدد العملاء المختلفين.
- أهم العملاء بالقيمة.
- أكبر الفواتير.
- المتابعات المغلقة.
- توصيات تنفيذية.

### 3. الحافز الربع سنوي
تم تطوير صفحة الحافز الربع سنوي لتقرأ من:
- sales_invoices
- staff
- doctor_incentive_targets
- doctor_incentive_sales
- stagnant_medicine_dispenses
- employee_transactions

وتحسب:
- المبيعات.
- متوسط الفاتورة.
- العملاء.
- إنجاز اللستة.
- الرواكد.
- جودة التسجيل.
- الحافز من 2000 جنيه.

### 4. ملاحظات العميل التشغيلية
تم تحويل ملاحظات العميل من نص فقط إلى نظام علامات تشغيلية ON/OFF مع ملاحظة حرة.

العلامات تشمل:
VIP، مهم جدًا، لا يضاف له توصيل، يفضل المستورد، لا يحب البدائل، حساس للسعر، لا يحب الترشيحات، عميل أطفال، عميل روشتات، عميل مزمن، يحتاج متابعة شهرية، يحتاج اتصال قبل التوصيل، يفضل دكتور معين، كثير الشكاوى.

ويتم حفظها في:
- customers.customer_flags إن كان العمود موجودًا.
- customer_analysis.customer_flags إن كان العمود موجودًا.
- notes كسطر احتياطي يبدأ بـ FLAGS: حتى لا يضيع المحتوى لو لم يتم تحديث Supabase بعد.

### 5. قواعد التقييم المرنة
تم تثبيت صفحة قواعد التقييم بحيث تستطيع إضافة بنود خصم أو مكافأة جديدة بدون تعديل كود:
- اسم البند.
- خصم أو مكافأة.
- الفئة.
- الدور المستهدف.
- النقاط.
- هل يتضاعف.
- هل يحتاج اعتماد.

### 6. قاعدة دورة 26 إلى 25
تم الاعتماد على منطق دورة 26 إلى 25 الموجود في `src/lib/pharmacy-cycle.ts` وربطه بصفحات 2027 وصفحة الموظف.

## SQL المطلوب تشغيله
شغل الملف:

```text
supabase/20260523_dawaa_pharmacy_2027.sql
```

هذا الملف يضيف أو يثبت:
- cycles
- quarter_cycles
- evaluation_rules
- customer_flags
- customer_notes
- tasks
- quarterly_performance_reviews
- quarterly_performance_items
- doctor_incentive_targets
- doctor_incentive_sales
- activity_logs
- customer_flags على customers و customer_analysis
- أعمدة employee_transactions اللازمة لسياسة 2027

## الجداول الرسمية المقترحة بعد هذه النسخة
- staff
- staff_accounts
- shift_schedules
- shift_exceptions
- sales_invoices
- customers
- customer_analysis
- daily_followups
- employee_transactions
- evaluation_rules
- tasks
- notifications
- customer_flags
- customer_notes
- stagnant_medicines
- stagnant_medicine_dispenses
- doctor_incentive_targets
- doctor_incentive_sales
- quarterly_performance_reviews
- quarterly_performance_items
- activity_logs

## ملاحظات مهمة قبل التشغيل الرسمي
1. يجب رفع فواتير المبيعات يوميًا حتى تظهر التحليلات الحقيقية.
2. يجب توحيد اسم الدكتور في ملف الفواتير قدر الإمكان؛ تم إضافة مطابقة ذكية للأسماء، لكن التوحيد سيزيد الدقة.
3. لا تحذف الجداول القديمة الآن؛ امنع القراءة منها أولًا، ثم أرشفها بعد استقرار التشغيل.
4. يجب تجربة صفحة الموظف مع أكثر من دكتور للتأكد من أن اسم الدكتور في الفواتير يطابق اسمه في staff.
5. الحافز الربع سنوي الآن يحسب من البيانات المتاحة، ويزداد دقة بعد استخدام جداول doctor_incentive_targets و doctor_incentive_sales رسميًا.

## اختبارات مقترحة بعد تشغيل SQL
- افتح لوحة القيادة 2027.
- افتح د/ إسلام من الفريق وتأكد من ظهور مبيعاته وأكبر عملائه وفواتيره.
- افتح عميل وأضف علامات ON/OFF ثم احفظ.
- افتح الحافز الربع سنوي وتأكد من ظهور ترتيب الدكاترة.
- أضف بند خصم جديد من قواعد التقييم.
- اختبر تسجيل صرف راكد مع عميل وفاتورة.
- اختبر مركز المهام والتنبيهات.
