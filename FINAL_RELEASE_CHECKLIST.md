# قائمة الإطلاق النهائية لتطوير نظام التشغيل

## 1. قاعدة البيانات

شغّل migrations بالترتيب:

1. `supabase/migrations/20260712_operations_upgrade_foundation.sql`
2. `supabase/migrations/20260712_operations_upgrade_phase2.sql`

بعدها تحقق من وجود:

- `branch_daily_tasks`
- `branch_daily_task_templates`
- `staff_leave_requests`
- `branch_cleaning_checklists`
- `operations_activity_log`
- `customer_metrics`
- RPC `create_daily_branch_tasks`
- RPC `review_staff_leave_request`
- RPC `list_staff_accounts_safe`

## 2. الواجهة

قبل الدمج النهائي يجب ربط الصفحات التالية بالمصادر الجديدة:

- `/team`: تقسيم الموجودين حسب الفرع ثم الدكاترة/المساعدين/الدليفري.
- `/attendance-report`: أفضل قراءة GPS من 3 محاولات وحالة مراجعة يدوية.
- `/staff-accounts`: استخدام `list_staff_accounts_safe` مع فلاتر وتعديل الصلاحيات.
- `/time-off`: اعتماد/رفض/إرجاع الإجازة وربطها بالتقرير الشهري.
- `/employee-operating-system`: استخدام `branch_daily_tasks` بدل إنشاء مهام مكرر.
- `/activity-log`: القراءة من `operations_activity_log` مع نطاق الدور والفرع.
- `/reports`: استخدام `customer_metrics` ومصادر مجمعة وعدم إظهار أصفار عند الفشل.
- `/whatsapp-analytics`: تصدير Excel متعدد الأوراق.
- صفحة النظافة: استخدام `branch_cleaning_checklists` وربط route/sidebar/permissions.

## 3. الاختبارات

- المدير العام يرى كل الحسابات والفروع.
- مدير الفرع يرى فرعه فقط.
- الدكتور يرى بياناته وفرعه فقط.
- إنشاء مهام اليوم مرتين لا يكرر المهام.
- اعتماد الإجازة يظهر في التقرير الشهري.
- GPS الضعيف داخل نطاق الفرع يتحول للمراجعة بدل الرفض الخاطئ.
- التقرير لا يعتمد على أول 1000 صف.
- لا توجد صفحة تحتاج Zoom Out.

## 4. أوامر التحقق

```bash
npm ci
npm run typecheck --if-present
npm run test --if-present
npm run build
```

## 5. الإطلاق

- تحويل PR #6 من Draft إلى Ready بعد نجاح الاختبارات.
- دمج PR #6 إلى `main`.
- انتظار Vercel حتى تصبح الحالة `Ready / Production`.
- تحديث قوي للمتصفح `Ctrl + Shift + R`.
- تنفيذ Smoke Test على الصفحات المذكورة أعلاه.
