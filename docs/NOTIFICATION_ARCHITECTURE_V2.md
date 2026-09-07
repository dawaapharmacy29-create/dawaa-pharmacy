# Notification Architecture V2

## الهدف

منع تكرار منطق الإشعارات بين الواجهة وقاعدة البيانات، ومنع ظهور مسارات كتابة أو قراءة جانبية مع الوقت.

## المسار المعتمد

1. **Producers**
   - المهام، تقييمات المحادثات، العملاء، المزامنة، الحضور، المخزون، الدليفري، الإدارة.
   - المنتج يصف الحدث فقط ولا يكتب مباشرة في جدول `notifications`.

2. **Command boundary**
   - إنشاء الإشعارات من خلال RPCs المعتمدة مثل `create_notification_audience_v1` و `create_staff_notification_client_v1`.
   - منع التكرار يتم وقت الكتابة عبر `dedupe_key`.

3. **Current-state storage**
   - جدول `notifications` هو مخزن الحالة الحالية المتوافق مع البيانات التاريخية.
   - لا توجد كتابة مباشرة من صفحات React.

4. **Canonical read model**
   - `notification_events_v2` هو عقد القراءة الموحد للتطبيق.
   - يوحد أعمدة الهوية والرسالة والمسار وحالة القراءة والحالة التشغيلية بدون إعادة كتابة التاريخ.
   - الواجهة لا تعتمد على الأعمدة القديمة المتعددة مباشرة.

5. **Domain layer**
   - `src/lib/notifications/notificationDomain.ts` هو المالك الوحيد للتعريب، aliases، التصنيف، ترتيب الأهمية، متطلبات الإجراء، وقواعد المسار الافتراضي.

6. **Runtime hook**
   - `useNotifications` مسؤول عن cache/realtime/settings/audience ويقرأ من خدمة الإشعارات، وليس من الجدول الخام.

7. **Workflow**
   - انتقالات `in_progress / completed / escalated / dismissed` تمر عبر `transition_notification_action_with_note_v1`.
   - الحالة الحالية تحفظ على `notifications`.
   - كل انتقال يسجل بشكل append-only في `notification_action_events`.

8. **Operations Center / Header**
   - Consumers فقط.
   - لا يملكان منطق صلاحيات أو routing أو labels مستقل عن الـDomain والـHook.

## Scheduler governance

القواعد المتشابهة في نفس التردد تجمع خلف orchestrator واحد. تم دمج فاحصي المهام المتأخرة في:

- `evaluate_operational_notification_rules_v1()`
- cron: `dawaa-operational-notification-rules-v1` كل 15 دقيقة.

القواعد ذات متطلبات زمنية مختلفة، مثل sync health أو VIP daily digest، تبقى مستقلة في الجدولة لكن تستخدم نفس Notification Command/Domain contracts.

## Security boundaries

- Browser roles لا تملك INSERT/UPDATE/DELETE مباشر على سجل action history.
- `notification_action_events`: SELECT فقط للـanon/authenticated مع RLS يطابق visibility للإشعار الأصلي.
- الانتقالات التشغيلية تتم فقط من SECURITY DEFINER RPC مع فحص actor/role/branch.
- CI `check-notification-architecture.cjs` يمنع direct writers وraw readers الجدد وتكرار منطق domain في الواجهات.

## القاعدة للمستقبل

أي Feature جديدة تريد تنبيهًا يجب أن تضيف producer إلى المسار الحالي، وليس جدولًا جديدًا أو hook جديدًا أو route map جديدًا أو labels خاصة بها.
