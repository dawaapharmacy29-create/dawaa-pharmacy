-- فتح كل صلاحيات "خدمة العملاء" و"طلبات العملاء" و"المشتريات" لفريق دواء
-- (نور/هاجر/هبة حماده) تحديدًا — بالمفاتيح الصحيحة (view_x/manage_x) اللي
-- القائمة الجانبية (ROUTE_PERMISSION_MAP) بتتأكد منها فعليًا وقت العرض،
-- مش المفاتيح القديمة (page.x.view) اللي كانت متسجلة عندهم بالفعل بس
-- مبتفتحش حاجة حقيقي (فيه منظومتين تسمية متوازيتين في النظام، والقائمة
-- الجانبية بتتأكد من الأولى بس).
--
-- اكتشفنا كمان إن customer_welcome_messages_view كان متسجل صراحة false
-- لهاجر وهبة (قفل فعلي حقيقي بيمنعهم يشوفوا صفحة رسائل الترحيب رغم إننا
-- بنينا نوع عملية "رسالة ترحيب" ليهم في نظام العمليات) — اتصلح هنا برضو.
--
-- عمدًا ما اتفتحش: صفحة "مراجعة فواتير المشتريات" (excludeRoles على مستوى
-- الدور، مش صلاحية) — دي بتفضل مقفولة عليهم لإنهم هما اللي بيدخلوا
-- الفواتير، فمينفعش يراجعوا/يعتمدوا فواتيرهم هما بنفسهم (فصل مسؤوليات).
update public.staff_accounts
set permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object(
  'view_customer_service', true,
  'view_customers', true,
  'view_customer_details', true,
  'view_customer_requests', true,
  'manage_customer_requests', true,
  'view_reviews', true,
  'whatsapp_customer', true,
  'customer_welcome_messages_view', true,
  'view_purchases', true,
  'manage_purchases', true
)
where staff_id in ('82b9c2a1-6139-4b07-9937-ef80a6e926d8', 'e3640642-5c60-4815-8001-1bb93193668f', 'dea91886-1ae8-4766-a166-9952866a5024');
