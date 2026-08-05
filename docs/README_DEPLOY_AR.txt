نسخة Dawaa Pharmacy 2027 - Stable Vercel Edition

هذه النسخة مجهزة للنشر على Vercel داخل نفس الريبو أو ريبو جديد.

الإعدادات المهمة:
- Node.js: 22.x
- Package Manager: pnpm@9.15.9
- Framework: Vite
- Build Command: pnpm run build
- Output Directory: dist

خطوات الرفع على نفس الريبو:
1) خذ نسخة احتياطية أو اعمل Branch جديد.
2) انسخ محتويات هذه النسخة فوق المشروع الحالي.
3) ارفع التعديلات إلى GitHub.
4) في Vercel اضبط Node.js Version على 22.x.
5) اعمل Redeploy without cache.

ملاحظات:
- تم حذف package-lock.json لتجنب تعارض npm مع pnpm.
- يوجد ملف .nvmrc لتثبيت Node 22.
- يوجد ملف .npmrc لتخفيف مشاكل peer dependencies.
- يوجد script doctor لفحص إعدادات النشر:
  pnpm run doctor

في حالة ظهور مشكلة في Supabase، راجع متغيرات البيئة:
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY

لا تشغل ملفات SQL على قاعدة البيانات إلا بعد مراجعتها.
