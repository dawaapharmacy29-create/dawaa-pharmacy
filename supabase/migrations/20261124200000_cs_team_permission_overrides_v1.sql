-- فريق خدمة العملاء (team_dawaa_alpha: هاجر، نور، هبه) — صاحب الصيدلية 2026-11-24.
-- شغلهم المسابقة وتسجيل فواتير المشتريات وخدمة العملاء. قاعدة العملاء الكاملة وتصديرها، فواتير المبيعات،
-- عرض العميل 360 وإسناد المتابعات لموظفين تانيين مش من شغلهم، فبتتقفل بـ override صريح (false) بيغلب
-- staff_accounts.permissions و allowed_pages في get_user_permissions.
-- الشيت ومهامه، طلبات العملاء، التكويد، التقييمات، النقاط وتسجيل الفواتير مش معتمدين على أي مفتاح هنا.
-- view_purchases / manage_purchases سايبينهم لحد ما يتحسم مسار المشتريات الأسبوعي في التشيك ليست.
-- اترجع عنه: delete from public.staff_permission_overrides where reason like 'فريق خدمة العملاء 2026-11-24%';

insert into public.staff_permission_overrides (staff_account_id, permission_key, allowed, reason, created_at)
select a.id,
       k,
       false,
       'فريق خدمة العملاء 2026-11-24: قاعدة العملاء الكاملة وفواتير المبيعات وإسناد المتابعات مش من شغلهم (طلب صاحب الصيدلية)',
       now()
from public.staff_accounts a
cross join unnest(array[
  'view_customers',
  'view_invoices',
  'assign_followup',
  'view_customer_360',
  'export_customers',
  'page.customers.view',
  'page.invoices.view',
  'page.crm.view'
]) as k
where a.role = 'team_dawaa_alpha'
on conflict (staff_account_id, permission_key) do update
  set allowed = false,
      reason = excluded.reason;
