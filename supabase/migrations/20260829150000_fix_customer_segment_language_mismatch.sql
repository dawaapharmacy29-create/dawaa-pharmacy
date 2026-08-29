-- إصلاح: الدالة كانت بتكتب التصنيف بالإنجليزي (VIP/Important/Medium/Normal)
-- لكن كل كود التطبيق (شارة العميل في SegmentBadge، ومضاعف أهمية العميل في
-- تقييم المحادثات ×1/×1.25/×1.5/×2 في incentiveRulesEngine.ts) بيدوّر على
-- القيم بالعربي. النتيجة قبل هذا الإصلاح: كل الـ 17020 عميل كانوا بيُعاملوا
-- كـ"عادي" في كل الحسابات المعتمدة على التصنيف، بغض النظر عن قيمتهم
-- الحقيقية — يعني 845 عميل VIP/مهم كانوا بيتقيّموا زي عميل عادي تمامًا.
--
-- طُبّق هذا الإصلاح مباشرة على قاعدة الإنتاج بتاريخ 2026-08-29 (تحقق لاحق:
-- توزيع القيم بعد الإصلاح طابق بالضبط توزيع القيم الإنجليزية قبله — 454 VIP
-- -> 454 مهم جدًا، 391 Important -> 391 مهم، وهكذا. تصحيح لغة فقط، بدون أي
-- إعادة تصنيف). هذا الملف يوثّق نفس التغيير في المستودع حتى تكون قاعدة
-- البيانات قابلة لإعادة البناء من الـ migrations وحدها، حسب
-- docs/ARCHITECTURE_TARGET.md البند 11.

create or replace function public.update_customer_segment()
returns trigger
language plpgsql
as $function$
begin
  if new.total_spent >= 8000 then
    new.segment := 'مهم جدًا';
  elsif new.total_spent >= 4000 then
    new.segment := 'مهم';
  elsif new.total_spent >= 1500 then
    new.segment := 'متوسط';
  else
    new.segment := 'عادي';
  end if;
  return new;
end;
$function$;

-- إعادة حساب التصنيف لكل العملاء الحاليين فورًا (الدالة أعلاه بتشتغل بس وقت
-- INSERT/UPDATE، فمن غير الخطوة دي الصفوف الحالية كانت هتفضل بالقيمة
-- الإنجليزية القديمة لحد ما حد يعدّل الصف يدويًا).
update public.customers set total_spent = total_spent;
