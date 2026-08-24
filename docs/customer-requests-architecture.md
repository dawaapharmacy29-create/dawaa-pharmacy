# Customer Requests Architecture v3

## الهدف

تحويل `Customer Requests` من صفحة تراكمية كبيرة إلى وحدة تشغيل مستقلة تربط العميل والصنف والفرع والدكتور والتوفير والمتابعة والتحليلات والحوافز من مصادر حقيقة واحدة، مع الحفاظ على النسخة القديمة كـfallback مؤقت على برانش إعادة الهيكلة فقط.

## 1. حدود الوحدة

دورة الطلب التشغيلية:

`تسجيل -> مراجعة/بحث -> توفير -> تواصل -> تسليم/إغلاق`

الوحدة لا تعيد بناء صفحات العملاء أو النواقص أو المشتريات أو النقاط بداخلها؛ بل تربط إليها بمفاتيح ومسارات ثابتة.

## 2. مصادر الحقيقة

### `customer_requests`
الحالة الحالية للطلب والهوية التشغيلية:
- `customer_id` + `customer_code`
- `product_id` + `product_code` + `medicine_name`
- `branch`
- `doctor_id`
- الحالة، الأولوية، الموعد، المسئول، بيانات التوفير

### `customer_request_events`
Timeline للأحداث التشغيلية المنفذة بالفعل.

### `customer_request_incentive_events`
Audit ledger وسيط يثبت حدث نقاط طلب العميل وربطه بمعاملة النقاط النهائية.

### `employee_transactions`
المصدر النهائي المعتمد لنقاط الموظف. لا يوجد رصيد Customer Requests مستقل قابل للاختلاف عنه.

## 3. هوية العميل

- `customer_id` هو المفتاح الأساسي.
- `customer_code` مطلوب لاستحقاق نقاط التسجيل والتحقيق.
- الاسم والهاتف snapshots للعرض والبحث، وليسا بديلًا للهوية.
- الطلب غير المربوط يدخل Data Quality ولا يحصل على نقاط حتى يتم إصلاحه.

## 4. هوية الصنف

- `product_id` هو رابط الكتالوج عند توفره.
- `product_code` مطلوب لاستحقاق النقاط وللتحليلات ومعدل التوفير.
- `medicine_name` مطلوب للعرض.
- ربط الصنف بعد الإنشاء يعيد محاولة تسوية نقطة التسجيل Idempotently.

## 5. الفروع

الهوية الدلالية داخل الـDomain:
- `shokry`
- `elshamy`

وعند حدود البيانات يتم دعم aliases مثل:
- `فرع شكري` / `دواء شكري` / `شكري`
- `فرع الشامي` / `دواء الشامي` / `الشامي`

الاستعلامات الخارجية تستخدم Source Branch المعياري حتى لا تتكرر مشكلة اختلاف أسماء الفروع بين التطبيق وBase44.

## 6. الحالات والـPrimary Action

الحالات المعتمدة:
- `new`
- `purchasing_review`
- `searching_suppliers`
- `needs_customer_confirmation`
- `customer_confirmed`
- `sourcing`
- `available`
- `arrived`
- `customer_contacted`
- `delivered`
- `closed`
- `cancelled`
- `not_available`

كل حالة لها Primary Action واحد في Operations Workspace، بينما الإجراءات الاستثنائية تظهر كخيارات ثانوية.

## 7. تعريف تحقيق الطلب

`request_achieved` يتحقق مرة واحدة عند أول دخول إلى إحدى حالات fulfillment المعتمدة أصلًا في تحليلات النظام:

`available`, `arrived`, `customer_contacted`, `delivered`, `closed`

`cancelled` و`not_available` لا يحصلان على نقاط تحقيق.

## 8. سياسة نقاط الدكاترة

Policy key: `customer_requests_doctor_points`

Policy version: `2026-08-24-v1`

Effective from: `2026-08-24 00:00 Africa/Cairo`

| الفئة | `staff_incentive_tiers.tier_key` | تسجيل طلب صالح | تحقيق الطلب | إجمالي الطلب المحقق |
|---|---|---:|---:|---:|
| الأولى | `senior_doctor` | +2 | +4 | 6 |
| الثانية | `mid_doctor` | +1 | +2 | 3 |
| الثالثة | `assistant` | +0.5 | +1 | 1.5 |

هذه Performance Points وليست جنيهات، ولا تُشتق من `point_rate_egp`.

## 9. صاحب النقاط

نقاط التسجيل والتحقيق تخص الدكتور صاحب الطلب المسجل، بالهوية المعيارية `staff.id`.

ترتيب حل الهوية أثناء الترحيل:
1. `customer_requests.doctor_id` إذا كان Staff ID صالحًا.
2. `created_by` إذا كان مطابقًا لـ`staff.id`.
3. `created_by -> staff_accounts.staff_id` للبيانات القديمة.
4. لا توجد تسوية جديدة بالاسم فقط.

بعد التسوية يتم قفل صاحب الحدث منطقيًا: يوجد Event إيجابي واحد فقط لكل `request_id + event_key + policy_version` حتى لو تغير `doctor_id` لاحقًا، لمنع Double Credit بين دكتورين.

## 10. شروط استحقاق النقاط

لا تتم التسوية إذا كان أي مما يلي غير صالح:
- `customer_id`
- `customer_code`
- `medicine_name`
- `product_code`
- الدكتور/`staff.id`
- فئة الدكتور
- وجود `sync_conflict`
- وجود علامة Duplicate / مكرر / مسجل بالخطأ

إصلاح الهوية يعيد محاولة التسوية تلقائيًا من غير تكرار.

## 11. منع التكرار

الحماية متعددة المستويات:

1. قبل إنشاء الطلب: Duplicate check لنفس العميل + كود الصنف + الفرع ضمن نافذة 24 ساعة للطلبات المفتوحة.
2. Event Ledger: Unique logical event على `request_id + event_key + policy_version`.
3. Employee transaction: Unique source/source-id لحركة Customer Request incentive.
4. Trigger retries آمنة بعد ربط العميل/الصنف/الدكتور.

## 12. دورة النقاط 26 -> 25

الـ`month_cycle` يتبع الاتفاق المعياري للتطبيق: **اسم دورة الشهر هو شهر انتهائها**.

أمثلة:
- 26 يوليو -> 25 أغسطس = `2026-08`
- 26 أغسطس -> 25 سبتمبر = `2026-09`

وبالتالي:
- حدث يوم 1-25 يأخذ نفس شهر التاريخ.
- حدث يوم 26 أو بعده يأخذ الشهر التالي.

هذا متوافق مع الـcanonical staff points snapshot ولا ينشئ رصيدًا خارج الدورة الحالية.

## 13. فصل النقاط عن المال

في `employee_transactions`:
- `points_delta` = قيمة الحدث المعتمدة.
- `points` = نفس قيمة الحدث.
- `amount = 0`.
- `category = customer_requests`.
- `source = customer_request_incentive`.

تحويل النقاط إلى حافز مالي يظل مسؤولية منظومة الحوافز/الرواتب المركزية.

## 14. حدود القراءة والأمان

لأن التطبيق يستخدم Custom Staff Auth فوق Supabase anon role:
- جداول policy/events والـprojection الداخلية ليست مفتوحة مباشرة للـanon.
- القراءة تتم عبر SECURITY DEFINER RPCs محدودة البيانات.
- RPCs تتحقق من `auth.uid()` أو `x-dawaa-user-id` المرتبط بحساب Staff نشط قابل للدخول.
- Direct client SELECT على doctor-points projection غير مطلوب.

RPCs الأساسية:
- `get_customer_request_doctor_incentive_preview`
- `get_customer_request_doctor_points_summary`
- `get_customer_request_doctor_points_leaderboard`
- `get_customer_request_incentive_events`

## 15. الهيكل البرمجي

`src/features/customer-requests/domain`
- branch normalization
- workflow/status
- SLA/urgency/overdue
- identity quality
- operational queues
- incentive policy/eligibility

`src/features/customer-requests/data`
- repository
- paging/summary/deep links
- doctor points read model
- request incentive events

`src/features/customer-requests/commands`
- start search
- record sourcing result
- confirm customer
- record contact result/follow-up
- deliver
- cancel
- send to shortages

`src/features/customer-requests/create`
- canonical request creation
- duplicate guard
- doctor incentive preview

`src/features/customer-requests/hooks`
- workspace orchestration
- separate list/summary loading
- stale response protection
- selected request state

`src/features/customer-requests/workspace`
- Operations Workspace
- Queue Strip
- table-first execution view
- Create Dialog
- Details Drawer
- Doctor Points Card

## 16. Operations Workspace

الواجهة الافتراضية ليست Dashboard ثقيلًا، بل Inbox للتنفيذ:
- بحث بالعميل/الكود/الهاتف/الصنف/كود الصنف.
- اختيار الفرع.
- طلب جديد.
- تحديث مستقل.
- Pagination.

Queues:
- يحتاج إجراء
- عاجل
- متأخر
- جاهز للتواصل
- متابعة مستحقة
- بدون مسئول

الجدول يركز على:
`الصنف/الكود | العميل/الكود | التصنيف | الفرع | الدكتور | الموعد | معدل التوفير | الحالة | العمر | الإجراء التالي`

## 17. Drawer التنفيذ

عند فتح الطلب:
- العميل + كوده + الهاتف + رابط ملف العميل.
- الصنف + الكود + الكمية.
- المسجل والمسئول الحالي.
- الحالة والإجراء المطلوب الآن.
- البحث/التوفير.
- التواصل وموعد المتابعة.
- التسليم/الإغلاق.
- الربط بالنواقص.
- Timeline.
- Events النقاط وقيم التسجيل/التحقيق.

## 18. تسجيل الطلب الجديد

المسار:
1. اختيار عميل حقيقي من Customer Search.
2. اختيار صنف حقيقي من Product Catalog.
3. تثبيت الدكتور المسجل والفرع.
4. تحديد الكمية والتصنيف والأولوية والقناة والموعد والملاحظات.
5. عرض Preview لنقاط فئة الدكتور من Policy DB.
6. Duplicate guard.
7. إنشاء الطلب وربط الصنف فورًا.
8. Trigger يسوي `request_registered` إذا أصبحت الهوية مكتملة.

## 19. التوفير والمخازن

V2 يفصل مساحة التوفير عن Inbox اليومي:
- أعلى طلبات تحتاج تدخل.
- دورة المخازن للأصناف غير المتوفرة.
- روابط مباشرة إلى `/shortages`, `/purchases`, `/supplier-performance`.

الطلب يظل الأصل المرتبط بالعميل؛ مسار النواقص/المشتريات لا يصبح نسخة أخرى من الطلب.

## 20. التحليلات

التحليلات تستخدم نفس تعريف fulfillment والفروع المعيارية، وتعرض:
- عدد الطلبات.
- المفتوح والمتأخر.
- نسبة التوفير.
- متوسط زمن الإغلاق/التوفير.
- الأصناف الأكثر طلبًا ومعدل توفيرها.
- أداء الفروع والمسئولين.
- العملاء المتكررين.
- الدكاترة المسجلين.

الضغط على تحليل يعيد المستخدم إلى Operations Workspace بفلاتر Deep Link دقيقة.

## 21. ملف الدكتور

`StaffDetail` يحتفظ بالمحتوى السابق ويضيف Customer Request Points Card من الـcanonical projection:
- الطلبات المؤهلة المسجلة.
- الطلبات المحققة.
- نسبة التحقيق.
- نقاط التسجيل.
- نقاط التحقيق.
- إجمالي نقاط Customer Requests.
- الفئة والدورة.
- Deep Link لطلبات الدكتور.

## 22. Performance / Failure Isolation

- List وSummary يحملان مستقلين.
- فشل Summary لا يوقف التشغيل.
- Timeline والنقاط تحمل عند فتح Drawer فقط.
- Analytics/Quality/Warehouse لا تحمل أثناء Inbox إلا عند فتح تبويبها.
- نتائج الاستعلامات القديمة لا تستبدل نتيجة أحدث داخل Workspace.

## 23. Rollout على البرانش

- `/customer-requests` -> V2 على برانش إعادة الهيكلة.
- `/customer-requests?legacy=1` -> النسخة القديمة للمقارنة والفallback.
- لا يتم حذف Legacy قبل اكتمال الاختبارات والمراجعة.
- لا يتم Merge إلى `main` أثناء مرحلة البناء الحالية.

## 24. قواعد غير قابلة للتفاوض

- لا نقاط بالاسم فقط.
- لا نقاط لطلب غير مربوط بعميل وكود وصنف وكود.
- لا Double Credit لنفس الحدث.
- لا تعريف مختلف لـfulfillment بين الصفحة والحوافز.
- لا mapping فروع جديد داخل كل صفحة.
- لا إعادة حساب مستقلة للنقاط داخل UI.
- `employee_transactions` هو Ledger النقاط النهائي.
- الـPolicy Versioned وقابلة للتدقيق.
- Direct sensitive point projections لا تُفتح للـanon.
- `main` يظل بدون دمج حتى انتهاء المراجعة واعتماد المستخدم.
