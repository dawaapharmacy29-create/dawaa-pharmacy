-- سد فجوة حقيقية: مسؤول خدمة العملاء (غير المدير) كان بيفتح صفحة "التشيك ليست
-- اليومي" ويلاقيها فاضية تمامًا — مفيش أي بند متسجل له في staff_daily_checklist_items
-- أصلاً (بس مسؤولة النظافة ومساعد الصيدلي كان ليهم بنود). نفس النمط المستخدم
-- للأدوار التانية: كل بند مربوط بقاعدة تقييم حقيقية (evaluation_rules) عشان
-- الرفض من المدير يترتب عليه خصم نقاط فعلي عبر settle_checklist_review، مش
-- مجرد علامة بصرية.
--
-- طُبّق هذا الإصلاح مباشرة على قاعدة الإنتاج بتاريخ 2026-08-29 (تحقق لاحق:
-- 5 بنود جديدة لدور "مسؤول خدمة العملاء" مع 5 قواعد تقييم مطابقة). هذا الملف
-- يوثّق نفس التغيير في المستودع حسب docs/ARCHITECTURE_TARGET.md البند 11.

insert into public.evaluation_rules
  (title, type, category, target_role, points, base_points, repeatable, requires_approval, visible_to_employee, severity, active, rule_key, cycle_type, source, pillar_key)
values
  ('عدم تنفيذ المتابعات المتأخرة فور فتح الفرع', 'penalty', 'خدمة العملاء', 'مسؤول خدمة العملاء', 15, 15, true, true, true, 'medium', true, 'customer_service_overdue_followup_miss', 'monthly', 'dawaa_2027', 'discipline'),
  ('تأخر في الرد على رسائل العملاء المعلقة', 'penalty', 'خدمة العملاء', 'مسؤول خدمة العملاء', 15, 15, true, true, true, 'medium', true, 'customer_service_response_delay', 'monthly', 'dawaa_2027', 'discipline'),
  ('عدم تحديث حالة طلبات العملاء المفتوحة', 'penalty', 'خدمة العملاء', 'مسؤول خدمة العملاء', 10, 10, true, true, true, 'medium', true, 'customer_service_request_update_miss', 'monthly', 'dawaa_2027', 'discipline'),
  ('عدم إرسال رسائل الترحيب للعملاء الجدد', 'penalty', 'خدمة العملاء', 'مسؤول خدمة العملاء', 10, 10, true, true, true, 'medium', true, 'customer_service_welcome_message_miss', 'monthly', 'dawaa_2027', 'discipline'),
  ('تسليم شيفت ناقص أو بدون توثيق الحالات المعلقة', 'penalty', 'خدمة العملاء', 'مسؤول خدمة العملاء', 15, 15, true, true, true, 'medium', true, 'customer_service_handover_miss', 'monthly', 'dawaa_2027', 'discipline')
on conflict do nothing;

insert into public.staff_daily_checklist_items
  (role, item_key, title, description, requires_photo, time_slot, sort_order, rule_key_on_fail, active)
values
  ('مسؤول خدمة العملاء', 'cs_review_overdue_followups', 'مراجعة وتنفيذ المتابعات المتأخرة', 'افتح قائمة المتابعات المتأخرة أول حاجة وابدأ تنفيذها قبل أي حاجة تانية.', false, 'فتح', 1, 'customer_service_overdue_followup_miss', true),
  ('مسؤول خدمة العملاء', 'cs_clear_pending_messages', 'الرد على كل رسائل الواتساب المعلقة', 'صفّر صندوق الرسائل المعلقة أول ساعتين من الشيفت.', false, 'فتح', 2, 'customer_service_response_delay', true),
  ('مسؤول خدمة العملاء', 'cs_update_customer_requests', 'تحديث حالة طلبات العملاء المفتوحة', 'راجع كل طلب عميل مفتوح وحدّث حالته (متوفر / لسه مستنى / تم التسليم).', false, 'أثناء اليوم', 3, 'customer_service_request_update_miss', true),
  ('مسؤول خدمة العملاء', 'cs_send_welcome_messages', 'إرسال رسائل الترحيب للعملاء الجدد', 'أي عميل جديد النهاردة لازم ياخد رسالة ترحيب رسمية.', false, 'أثناء اليوم', 4, 'customer_service_welcome_message_miss', true),
  ('مسؤول خدمة العملاء', 'cs_shift_handover', 'تسليم الشيفت وتوثيق الحالات المعلقة', 'قبل قفل الشيفت، وثّق عدد المتابعات المفتوحة والحالات المعلقة للمسؤول التالي.', false, 'قفل', 5, 'customer_service_handover_miss', true)
on conflict do nothing;
