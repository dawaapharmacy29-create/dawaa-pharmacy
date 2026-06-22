نسخة Dawaa Pharmacy 2027 - Stable Vercel Edition

هذه النسخة مجهزة للنشر على Vercel داخل نفس الريبو أو ريبو جديد.

الإعدادات المهمة:
- Node.js: 20.x
- Package Manager: npm 10
- Framework: Vite
- Install Command: npm ci --legacy-peer-deps --no-audit --no-fund
- Build Command: npm run build
- Output Directory: dist

خطوات الرفع على نفس الريبو:
1) خذ نسخة احتياطية أو اعمل Branch جديد.
2) انسخ محتويات هذه النسخة فوق المشروع الحالي.
3) ارفع التعديلات إلى GitHub.
4) في Vercel اضبط Node.js Version على 20.x.
5) اعمل Redeploy without cache.

ملاحظات:
- package-lock.json هو المصدر المعتمد لتثبيت npm المتكرر.
- استخدم Node 20 محليًا وعلى Vercel.
- يوجد ملف .npmrc لتخفيف مشاكل peer dependencies.
- يوجد script doctor لفحص إعدادات النشر:
  npm run doctor

في حالة ظهور مشكلة في Supabase، راجع متغيرات البيئة:
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY

لا تشغل ملفات SQL على قاعدة البيانات إلا بعد مراجعتها.
