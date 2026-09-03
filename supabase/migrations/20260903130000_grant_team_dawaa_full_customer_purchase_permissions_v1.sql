-- استكمال فتح صلاحيات خدمة العملاء/طلبات العملاء/المشتريات لفريق دواء —
-- الدفعة اللي اتوعدنا بيها في محادثة سابقة بس السطر البرمجي بتاعها ما
-- كانش اتنفذ فعليًا (اتأكدنا من القاعدة مباشرة). دلوقتي شاملة الصلاحيات
-- الحساسة (حذف عميل، استيراد جماعي، إسناد متابعة، تعديل رسالة ترحيب) بعد
-- تأكيد صريح، وكمان view_analytics/view_cashback/view_points اللي طلعت
-- مطلوبة عشان 3 صفحات في القائمة الجانبية بتتأكد من مفتاح مختلف عن اللي
-- ظاهر في تعريف العنصر نفسه (نفس فخ الـ ROUTE_PERMISSION_MAP المكتشف).
update public.staff_accounts
set permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object(
  'create_followup', true,
  'edit_followup', true,
  'close_followup', true,
  'assign_followup', true,
  'customer_welcome_messages_create', true,
  'customer_welcome_messages_update', true,
  'view_customer_incubation', true,
  'manage_customer_incubation', true,
  'create_customer', true,
  'edit_customer', true,
  'delete_customer', true,
  'export_customers', true,
  'import_customers', true,
  'view_customer_360', true,
  'view_invoices', true,
  'view_invoice_import', true,
  'import_sales_invoices', true,
  'view_analytics', true,
  'view_cashback', true,
  'view_points', true
)
where staff_id in ('82b9c2a1-6139-4b07-9937-ef80a6e926d8', 'e3640642-5c60-4815-8001-1bb93193668f', 'dea91886-1ae8-4766-a166-9952866a5024');
