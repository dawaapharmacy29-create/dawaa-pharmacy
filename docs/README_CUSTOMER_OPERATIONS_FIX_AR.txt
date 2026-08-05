
نسخة تفعيل صفحات العملاء والعمليات - Dawaa Pharmacy 2027

ما تم تعديله داخل النسخة:
1) CRM يعمل حتى لو VITE_DAWAA_COMPANY_ID غير موجود، مع fallback آمن.
2) مرحلة الدلع تستخدم view daw aa_incubation_candidates_v1، ولو فشل ترجع تلقائيا لأعلى العملاء من customers.
3) مستويات ولاء العملاء أصبحت تقرأ من customers ثم customer_analysis ثم sales_invoices حسب المتاح.
4) تمت إضافة ملف SQL شامل: DAWAA_CUSTOMER_OPERATIONS_AUTO_FIX.sql
   يشغّل جداول ودوال: CRM، مرحلة الدلع، تصحيح فروع العملاء، تحديث الهاتف، وسجل الإصلاح.

طريقة التشغيل:
1) انسخ ملفات النسخة فوق المشروع الحالي.
2) ارفع GitHub.
3) افتح Supabase SQL Editor وشغّل DAWAA_CUSTOMER_OPERATIONS_AUTO_FIX.sql مرة واحدة.
4) شغّل في Supabase بعده:
   select * from public.dawaa_run_customer_operations_autofix('د معاذ');
5) في Vercel أضف Environment Variable:
   VITE_DAWAA_COMPANY_ID = 00000000-0000-0000-0000-000000000000
6) اعمل Redeploy without cache.
