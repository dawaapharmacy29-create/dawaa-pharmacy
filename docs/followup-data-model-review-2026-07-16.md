# مراجعة نموذج بيانات المتابعات

## القرار

لا يتم إنشاء جدول جديد لسجل المتابعات.

التطبيق يحتوي بالفعل على:

- `daily_followups`: السجل الأساسي للمتابعة.
- `customer_followup_edit_logs`: سجل تغييرات المتابعة.
- `insert_customer_followup_edit_log(jsonb)`: مسار الكتابة الآمن للسجل الموجود.

## التعديلات

- تبويب «متابعاتي المطلوبة» يعتمد على `created_by` و`created_by_name` الموجودين بالفعل في `daily_followups`.
- تم إلغاء الاعتماد على أعمدة جديدة مثل `requested_by_staff_id` و`source_type`.
- Timeline يقرأ من `customer_followup_edit_logs` الموجود بدل إنشاء `daily_followup_events`.
- تم حذف migration التي كانت ستنشئ جدولًا جديدًا.

## قاعدة التطوير

قبل أي SQL جديد يجب مراجعة الجداول والـRPCs والـtriggers والمigrations الحالية، ثم إعادة استخدام الموجود أو توسيعه بأقل تغيير ممكن.
