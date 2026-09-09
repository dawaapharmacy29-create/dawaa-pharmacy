# Notification Architecture V2

## الهدف

منع تكرار منطق الإشعارات بين الواجهة وقاعدة البيانات، ومنع ظهور مسارات كتابة أو قراءة أو Workflow جانبية مع الوقت. النظام الحالي مصمم على مبدأ: **مصدر إنشاء واحد، عقد قراءة واحد، Domain واحد، Workflow واحد، SLA واحد**.

## المسار المعتمد

1. **Producers**
   - المهام، تقييمات المحادثات، العملاء، VIP، المزامنة، الحضور، المخزون، الدليفري، الإدارة.
   - الـProducer يصف الحدث فقط ولا يكتب مباشرة في جدول `notifications`.

2. **Creation command boundary**
   - إنشاء إشعارات الواجهة يمر عبر RPCs المعتمدة مثل `create_notification_audience_v1` و`create_staff_notification_client_v1`.
   - النظام والخلفية يستخدمان `emit_system_notification_v2` و`update_system_notification_v2` فقط.
   - منع التكرار يتم وقت الكتابة عبر `dedupe_key`.
   - الاستهداف التشغيلي للواجهة يعتمد على `recipient_staff_id / recipient_role / branch`؛ لا يوجد عقد إنشاء موازي يعتمد على user id.

3. **Current-state storage**
   - جدول `notifications` هو مخزن الحالة الحالية والتوافق التاريخي.
   - لا توجد كتابة مباشرة من صفحات React.
   - Trigger التخزين يمرر metadata الجديدة عبر `normalize_notification_metadata_v2`.

4. **Metadata Contract V2**
   - `src/lib/notifications/notificationMetadata.ts` هو عقد metadata في التطبيق.
   - كل metadata جديدة تحمل `schemaVersion: 2` و`canonicalType` ومفاتيح موحدة مثل route/branch/staff/customer/review/task/sync.
   - البيانات التاريخية لا يعاد كتابتها قسرًا؛ يتم تطبيعها وقت القراءة.
   - `notification_metadata_contract_health_v2()` يفرق بين `v2_valid` و`v2_invalid` و`legacy_unversioned`.

5. **Canonical read model**
   - `notification_events_v2` هو عقد القراءة الموحد للتطبيق.
   - يوحد الهوية والرسالة والمسار وحالة القراءة والحالة التشغيلية وmetadata وSLA بدون إعادة كتابة التاريخ.
   - الواجهة لا تعتمد على `notifications` الخام أو compatibility readers.
   - الـview تعمل بـ`security_invoker` وتبقى RLS هي مصدر الحقيقة في visibility.

6. **Authorization boundary**
   - `dawaa_notification_visible_to_current_user_v2(...)` وRLS في قاعدة البيانات هما مصدر الحقيقة للجمهور.
   - الواجهة لا تعيد تنفيذ audience authorization.
   - `useNotifications` يدير runtime/cache/realtime/settings/retention فقط.

7. **Domain layer**
   - `src/lib/notifications/notificationDomain.ts` هو المالك الوحيد للتعريب، aliases، التصنيف، ترتيب الأهمية، متطلبات الإجراء، قواعد المسار، grouping/facets، وقواعد Lifecycle في الواجهة.

8. **Workflow command gateway**
   - كل انتقالات `in_progress / completed / escalated / dismissed` تمر فقط عبر `src/lib/notifications/notificationWorkflowService.ts` ثم `transition_notification_action_with_note_v1`.
   - `notificationService.ts` لا يملك shortcuts لإنهاء أو إغلاق أو تصعيد Workflow.
   - الحالة الحالية تحفظ على `notifications`.
   - كل انتقال يسجل append-only في `notification_action_events`.

9. **Lifecycle State Machine**
   - `new/read -> in_progress` بداية المتابعة.
   - `in_progress -> completed/dismissed/escalated` حسب قواعد الحالة.
   - `completed` و`dismissed` terminal ولا يعاد فتحهما.
   - الإغلاق المهم أو actionable يحتاج نتيجة/سبب.
   - الانتقال المكرر لنفس الحالة idempotent ولا ينتج Audit event مكرر.
   - SLA-generated escalation reference-only ولا يملك Workflow مستقل.
   - `notification_lifecycle_audit_v1` يكشف أي خرق لهذه القواعد.

10. **SLA Engine**
   - السياسات مركزية في `notification_sla_policies` وليست شروطًا مبعثرة في الواجهة.
   - الأحداث التاريخية في `notification_sla_events` append-only.
   - `evaluate_notification_sla_v1()` هو evaluator واحد للتجاوزات.
   - acknowledge يقاس من Workflow action فعلي، وليس مجرد القراءة.
   - التصعيد يستخدم dedupe ثابت ويرتبط بالتنبيه الأصلي، ولا ينشئ Workflow ثانيًا.
   - `notification_sla_integrity_audit_v1` و`notification_sla_integrity_health_v1` يراجعان سلامة source/escalation/event chain.

11. **Scheduler governance**
   - القواعد ذات نفس cadence تمر خلف `evaluate_operational_notification_rules_v1()`.
   - cron واحد `dawaa-operational-notification-rules-v1` كل 15 دقيقة يشغل القواعد التشغيلية وSLA بدل Cron جديد لكل نوع.
   - Sync health وVIP daily jobs تبقى مستقلة فقط لأن cadence والمعنى مختلفان، لكنها تستخدم نفس notification contracts.

12. **Operations Center**
   - Consumer تشغيلي للـcanonical feed.
   - يستخدم `allNotifications` حتى لا تخفي إعدادات العرض الشخصية تنبيهًا إداريًا مهمًا.
   - Tabs/facets متداخلة: نفس التنبيه يمكن أن يظهر مثلًا في عاجل + VIP بدون نسخ سجل جديد.
   - SLA يظهر على التنبيه الأصلي، وescalation يفتح المصدر نفسه.
   - KPI يحتاج إجراء/قيد المتابعة لا يعد escalation المرجعي كمهمة ثانية.

13. **Header**
   - Consumer فقط للـhook والـDomain.
   - لا يملك route inference أو route fallback خاصًا بالإشعارات؛ النقر يمر مباشرة عبر `handleNotificationClick` الذي يستخدم canonical routing.
   - يحتفظ فقط بعرض القائمة، إعدادات العرض والصوت، وحالة القراءة.

## Security boundaries

- Browser roles لا تملك INSERT/UPDATE/DELETE مباشر على سجل action history أو جداول SLA الداخلية.
- `notification_action_events`: قراءة فقط حسب visibility للإشعار الأصلي.
- الانتقالات التشغيلية تتم من SECURITY DEFINER RPC مع فحص actor/role/branch.
- trusted system producer functions غير متاحة كمسار كتابة حر للواجهة.
- `notification_producer_audit_v1` يجب أن يبقى بدون `direct_writer_debt`.

## CI Architecture Guard

`scripts/check-notification-architecture.cjs` يمنع:

- direct writes إلى `notifications` من `src`.
- raw reads من `notifications` في التطبيق.
- استدعاء Workflow RPC مباشرة خارج `notificationWorkflowService`.
- إعادة إدخال shortcuts القديمة `markNotificationCompleted / dismissNotification / escalateNotification` من `notificationService`.
- تكرار labels/grouping/scoring/lifecycle/routing خارج الـDomain.
- إنشاء SLA cron موازٍ لمسار orchestrator الحالي.
- إزالة العقود الأساسية الخاصة بالmetadata/SLA/lifecycle.

## قاعدة التطوير بعد الدمج

أي Feature جديدة تحتاج إشعارًا تضيف Producer إلى المسار الحالي فقط. ممنوع إنشاء جدول إشعارات جديد، Hook موازٍ، Workflow Gateway جديد، route map داخل صفحة، SLA scheduler منفصل، أو audience authorization في الواجهة.

قبل الدمج أو أي تغيير معماري كبير يجب أن تنجح على الأقل: **Build + Quality Gate + Notification Architecture Boundary**.