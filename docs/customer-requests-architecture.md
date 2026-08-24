# Customer Requests Architecture v4

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

## 3. الهوية المعيارية

### العميل
- `customer_id` هو المفتاح الأساسي.
- `customer_code` مطلوب لاستحقاق النقاط.
- الاسم والهاتف snapshots للعرض والبحث.

### الصنف
- `product_id` هو رابط الكتالوج.
- `product_code` مطلوب للنقاط والتحليلات ومعدل التوفير.
- `medicine_name` للعرض.

### الدكتور
- `doctor_id` يجب أن يكون `staff.id` فقط.
- لا يجوز استخدام `staff_accounts.id` أو الاسم كبديل في الطلبات الجديدة.
- Deep links من ملف الدكتور إلى الطلبات تستخدم `registrarId=staff.id`.

## 4. الفروع

الهوية الدلالية داخل الـDomain:
- `shokry`
- `elshamy`

وعند حدود البيانات ندعم aliases مثل `فرع شكري` / `دواء شكري` و`فرع الشامي` / `دواء الشامي`.

في التسجيل الجديد، الفرع التشغيلي يؤخذ من فرع الدكتور عندما يكون محددًا؛ فرع العميل يظل مرجعًا لبيانات العميل ولا يتم تغييره. اختلافهما يظهر كتنبيه للمستخدم بدل تغيير العميل صامتًا.

## 5. إنشاء الطلب الجديد — Atomic Boundary

المسار المعياري هو RPC:

`create_customer_request_canonical_v1`

داخل Transaction واحدة يقوم بـ:
1. التحقق من App Staff Context.
2. التحقق من العميل وكوده.
3. التحقق من الصنف وكوده.
4. التحقق من الدكتور كـStaff نشط.
5. التحقق من صلاحية المستخدم في نسبة الطلب لهذا الدكتور ونطاق الفرع.
6. تحديد الفرع التشغيلي.
7. فحص Duplicate لنفس العميل + الصنف + الفرع خلال 24 ساعة.
8. إدخال الطلب بهويات العميل والصنف والدكتور كاملة من أول لحظة.
9. إدخال أول Event في Timeline.
10. تشغيل Trigger النقاط بعد اكتمال الهوية.

لا توجد بعد الآن سلسلة `insert request -> link product` للطلبات الجديدة، وبالتالي لا يمكن أن يبقى طلب جزئي إذا فشل ربط الصنف.

## 6. الحالات والانتقالات

الحالات المعتمدة:
`new`, `purchasing_review`, `searching_suppliers`, `needs_customer_confirmation`, `customer_confirmed`, `sourcing`, `available`, `arrived`, `customer_contacted`, `delivered`, `closed`, `cancelled`, `not_available`.

الانتقالات نفسها معرفة مرة واحدة في `domain/transitions.ts`، والـCommand Layer يرفض القفزات غير الصحيحة. أمثلة:
- `new -> purchasing_review` مسموح.
- `available -> customer_contacted` مسموح.
- `customer_contacted -> delivered` مسموح.
- `new -> delivered` مرفوض.
- `delivered -> searching_suppliers` مرفوض.

`not_available` ليس مغلقًا تشغيليًا؛ يبقى قابلًا لمراجعة بديل أو `not_available -> searching_suppliers`، أو إلغاء موثق عند انتهاء المحاولة. لكنه يظل نتيجة غير محققة في حساب Fulfillment.

## 7. تعريف تحقيق الطلب

`request_achieved` يتحقق مرة واحدة عند أول دخول إلى:

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

هذه Performance Points وليست جنيهات.

## 9. شروط النقاط ومنع التكرار

لا تتم التسوية إذا كان العميل أو كوده أو الصنف أو كوده أو الدكتور أو فئته غير صالح، أو إذا كان هناك `sync_conflict` أو Duplicate/خطأ موثق.

الحماية:
- Duplicate check قبل الإنشاء.
- Event unique identity على `request + event + policy`.
- Employee transaction source/source-id فريد.
- Single-owner guard يمنع إعادة نفس الحدث لدكتور آخر.
- Trigger retries بعد إصلاح الهوية بطريقة Idempotent.

## 10. دورة النقاط وفصل المال

الدورة 26 -> 25، واسم الدورة هو شهر انتهائها.

في `employee_transactions`:
- `points_delta` = قيمة الحدث.
- `points` = نفس القيمة.
- `amount = 0`.
- `category = customer_requests`.
- `source = customer_request_incentive`.

التحويل النقدي يظل مسؤولية منظومة الحوافز/الرواتب المركزية.

## 11. الطلبات التاريخية وهوية الموظف

لا يوجد Auto-attribution من الاسم.

المسار:
1. Review RPC يعرض أسماء المصدر، الفرع، عدد الطلبات، والتطابق المقترح.
2. التطابق الوحيد يمكن اعتماده بشريًا مع سبب مكتوب.
3. الاعتماد وحده لا يعدل الطلبات.
4. Preview مستقل يعرض عدد الطلبات التي ستتغير وعدد المكتمل منها لهوية النقاط.
5. Apply منفصل يحتاج Mapping معتمد وExplicit confirmation.
6. الأسماء الملتبسة أو غير المطابقة لا تطبق تلقائيًا.

هذا يمنع منح نقاط تاريخية لشخص خطأ لمجرد تشابه الاسم.

## 12. القراءة والأمان

التطبيق يستخدم Custom Staff Auth فوق anon role، لذلك:
- Policy/events/projections الحساسة ليست مفتوحة Direct SELECT للـanon.
- القراءة تتم عبر SECURITY DEFINER RPCs تتحقق من `x-dawaa-user-id` أو Supabase Auth.
- Staff attribution apply مسموح فقط للأدوار الإدارية المحددة.
- المستخدم العادي لا يستطيع إنشاء طلب منسوب لدكتور آخر.

## 13. هيكل الكود

`src/features/customer-requests/domain`
- branch normalization
- status/workflow
- transition guards
- SLA/urgency/overdue
- identity quality
- operational queues
- incentive policy/eligibility

`src/features/customer-requests/create`
- atomic canonical create contract
- doctor incentive preview

`src/features/customer-requests/commands`
- start search
- sourcing result
- customer confirmation
- contact/follow-up
- delivery
- cancellation
- shortage link

`src/features/customer-requests/data`
- repository
- paging/summary/deep links
- doctor points read model
- request incentive events
- Excel export

`src/features/customer-requests/workspace`
- Operations Workspace
- Queue Strip
- table-first execution view
- Create Dialog
- Details Drawer
- Doctor Points Card

## 14. V2 Workspace

أربع مساحات فقط:
1. التنفيذ.
2. التوفير.
3. التحليلات.
4. جودة البيانات.

Operations Inbox هو العرض الافتراضي، ويعرض العميل والكود والصنف والكود والدكتور والمرحلة والموعد ومعدل التوفير والإجراء التالي.

تحميل القائمة مستقل عن Summary، وفشل المؤشرات لا يوقف التنفيذ.

`not_available` يظهر ضمن الطلبات القابلة للتدخل بدل الاختفاء من القوائم، بينما Summary وRepository يستخدمان نفس تعريف الإغلاق التشغيلي.

## 15. Drawer التنفيذ

عند فتح الطلب:
- العميل + الكود + الهاتف + رابط الملف.
- الصنف + الكود + الكمية.
- المسجل والمسئول.
- الحالة والإجراء المطلوب الآن.
- التوفير والتواصل والمتابعة والتسليم.
- الربط بالنواقص.
- Timeline.
- Events النقاط وقيم التسجيل/التحقيق.

كل Action يمر بالـCommand Layer والـTransition Guard، وليس بتعديل Status عشوائي من UI.

## 16. ملف الدكتور

ملف الدكتور يقرأ من Safe points projection ويعرض:
- الطلبات المسجلة المؤهلة.
- الطلبات المحققة.
- نسبة التحقيق.
- نقاط التسجيل.
- نقاط التحقيق.
- الإجمالي.

الانتقال من ملف الدكتور إلى Customer Requests يتم بـ`staff.id`، وليس باسم قد يتكرر أو يتغير.

## 17. Legacy Data Quality

تم تنفيذ Backfill حتمي فقط:
- Customer Code من العلاقة الموجودة بالعميل.
- Product link فقط عند Exact unique catalog match.
- لا Doctor ID من الاسم تلقائيًا.

طلبات البيانات القديمة غير المؤكدة تظل في Data Quality حتى المراجعة.

## 18. قواعد غير قابلة للتفاوض

- لا نقاط بالاسم فقط.
- لا `doctor_id` من Account ID.
- لا نقاط لطلب غير مربوط بعميل وكود وصنف وكود.
- لا نقاط مكررة لنفس الحدث.
- لا إنشاء طلب جديد متعدد الخطوات يترك سجلًا جزئيًا.
- لا انتقالات حالة عشوائية.
- لا إعادة حساب نقاط في الواجهة.
- `employee_transactions` هو Ledger النهائي.
- `not_available` يظل قابلًا لمراجعة البديل حتى إغلاقه صراحة.
- Legacy route يبقى fallback حتى اكتمال parity والتحقق النهائي.
