-- إصلاح جذري: حساب المدير العام (DR.MOAZ) كان مسجّل بـ staff_id = 'admin'
-- (نص عادي، مش UUID حقيقي) لأنه حساب إدارة عليا بدون سجل مطابق في جدول staff.
-- أي عمود أو دالة في النظام متوقعة UUID حقيقي (زي evaluator_staff_id في
-- تقييمات المديرين، أو أي RPC بمعامل uuid) كانت بتفشل مع هذا الحساب تحديدًا
-- برسالة "invalid input syntax for type uuid: admin".
--
-- الحل: إنشاء سجل موظف حقيقي له في جدول staff (بنفس نمط باقي كبار المديرين
-- زي مديرة الفروع: branch = 'كل الفروع')، وربط حساب الدخول بيه بدل النص الثابت.
--
-- طُبّق هذا الإصلاح مباشرة على قاعدة الإنتاج بتاريخ 2026-08-29 (تحقق لاحق:
-- staff_accounts.staff_id لحساب DR.MOAZ بقى UUID حقيقي مطابق لسجل جديد في
-- جدول staff باسم "د/ معاذ"). هذا الملف يوثّق نفس التغيير في المستودع حسب
-- docs/ARCHITECTURE_TARGET.md البند 11. آمن لإعادة التشغيل: الشرط
-- `where staff_id = 'admin'` يمنع أي تكرار لو اتنفذ أكتر من مرة.

do $$
declare
  v_staff_id uuid;
begin
  if exists (select 1 from public.staff_accounts where staff_id = 'admin') then
    insert into public.staff (name, role, branch, active, status)
    values ('د/ معاذ', 'مدير عام', 'كل الفروع', true, 'نشط')
    returning id into v_staff_id;

    update public.staff_accounts
    set staff_id = v_staff_id::text
    where staff_id = 'admin';
  end if;
end $$;
